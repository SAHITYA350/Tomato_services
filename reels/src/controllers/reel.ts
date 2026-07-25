import { Response } from "express";
import { AuthenticatedRequest } from "../middlewares/isAuth.js";
import TryCatch from "../middlewares/trycatch.js";
import { Reel } from "../models/Reel.js";
import { Like } from "../models/Like.js";
import { Comment } from "../models/Comment.js";
import { ViewHistory } from "../models/ViewHistory.js";
import axios from "axios";

// ─── DEMO FOOD REELS SEED DATA ─────────────────────────────────────────────
const INITIAL_DEMO_REELS = [
  {
    restaurantId: "6a4f456f02e1b71c431c5847",
    restaurantName: "SG Restaurant",
    uploadedBy: "seller_sg",
    title: "Crispy Dahi Vada Special ✨",
    caption: "Fresh homemade lentil fritters soaked in sweetened yogurt, topped with roasted cumin & tangy tamarind chutney!",
    videoUrl: "https://assets.mixkit.co/videos/preview/mixkit-chef-preparing-a-salad-41584-large.mp4",
    thumbnailUrl: "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=600&q=80",
    foodName: "Dahi Vada",
    price: 120,
    likesCount: 142,
    commentsCount: 18,
    category: "Street Food",
    hashtags: ["#DahiVada", "#SGRestaurant", "#IndianStreetFood"]
  },
  {
    restaurantId: "6a4f456f02e1b71c431c5847",
    restaurantName: "SG Restaurant",
    uploadedBy: "seller_sg",
    title: "Sizzling Chicken Biryani 🔥",
    caption: "Fragrant basmati rice cooked with succulent chicken pieces & authentic aromatic spices!",
    videoUrl: "https://assets.mixkit.co/videos/preview/mixkit-putting-sauce-on-a-pizza-41589-large.mp4",
    thumbnailUrl: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&q=80",
    foodName: "Chicken Biryani",
    price: 195,
    likesCount: 389,
    commentsCount: 42,
    category: "Biryani",
    hashtags: ["#BiryaniLove", "#Sizzling", "#SGRestaurant"]
  },
  {
    restaurantId: "6a5f29715a2f1db39ec244ec",
    restaurantName: "Odisa Restaurant",
    uploadedBy: "seller_odisa",
    title: "Double Cheese Loaded Burger 🍔",
    caption: "Juicy patty grilled to perfection with double cheddar cheese and secret smoked paprika sauce!",
    videoUrl: "https://assets.mixkit.co/videos/preview/mixkit-hands-holding-a-slice-of-pizza-41588-large.mp4",
    thumbnailUrl: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80",
    foodName: "Cheese Burger",
    price: 160,
    likesCount: 275,
    commentsCount: 31,
    category: "Fast Food",
    hashtags: ["#CheesyBurger", "#OdisaRestaurant", "#Foodie"]
  },
  {
    restaurantId: "6a5f29715a2f1db39ec244ec",
    restaurantName: "Odisa Restaurant",
    uploadedBy: "seller_odisa",
    title: "Tandoori Chicken Tikka 🍗",
    caption: "Marinated in spicy yogurt & chargrilled in clay tandoor oven for smokey perfection!",
    videoUrl: "https://assets.mixkit.co/videos/preview/mixkit-preparing-food-in-a-pan-41585-large.mp4",
    thumbnailUrl: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=600&q=80",
    foodName: "Tandoori Chicken",
    price: 240,
    likesCount: 512,
    commentsCount: 64,
    category: "Tandoori",
    hashtags: ["#Tandoori", "#ChickenTikka", "#Smokey"]
  }
];

// Helper to broadcast socket updates to Realtime service
const broadcastRealtime = async (room: string, event: string, payload: any) => {
  try {
    const realtimeUrl = process.env.REALTIME_SERVICE || "http://localhost:5003";
    await axios.post(
      `${realtimeUrl}/api/v1/internal/emit`,
      { event, room, payload },
      { headers: { "x-internal-key": process.env.VITE_INTERNAL_SERVICE_KEY || "zomato_internal_secret_key_2026" } }
    );
  } catch (e) {
    // Silently ignore socket broadcast error if realtime is offline
  }
};

// ─── 1. Get Reels with Cursor Pagination & Optional Restaurant Filtering ───
export const getReels = TryCatch(async (req: AuthenticatedRequest, res: Response) => {
  const { cursor, limit = "8", restaurantId, category } = req.query;
  const parsedLimit = Math.min(parseInt(limit as string) || 8, 20);

  // Clean up any remaining dummy/mock seed reels so only real uploaded reels exist
  await Reel.deleteMany({
    $or: [
      { uploadedBy: "seller_sg" },
      { uploadedBy: "seller_odisa" },
      { videoUrl: { $regex: "mixkit" } },
      { title: "Odisa Veg meal" },
      { foodName: "Veg meal" }
    ]
  });

  const query: any = {};
  if (restaurantId) {
    query.restaurantId = restaurantId;
  }
  if (category && category !== "All") {
    query.category = category;
  }
  if (cursor) {
    query.createdAt = { $lt: new Date(cursor as string) };
  }

  const reels = await Reel.find(query)
    .sort({ createdAt: -1 })
    .limit(parsedLimit + 1);

  const hasNextPage = reels.length > parsedLimit;
  const items = hasNextPage ? reels.slice(0, parsedLimit) : reels;
  const nextCursor = hasNextPage && items.length > 0 ? items[items.length - 1].createdAt.toISOString() : null;

  // If user is logged in, attach isLikedByMe status for each reel
  let userLikesSet = new Set<string>();
  if (req.user?._id) {
    const reelIds = items.map((r: any) => r._id.toString());
    const userLikes = await Like.find({ userId: req.user._id, reelId: { $in: reelIds } });
    userLikesSet = new Set(userLikes.map((l: any) => l.reelId));
  }

  const formattedItems = items.map((r: any) => ({
    ...r.toObject(),
    isLikedByMe: userLikesSet.has(r._id.toString()),
  }));

  return res.json({
    reels: formattedItems,
    nextCursor,
    hasNextPage,
  });
});

// ─── 2. Create Reel (Seller Upload) ─────────────────────────────────────────
export const createReel = TryCatch(async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: "Unauthorized" });

  const {
    restaurantId,
    restaurantName,
    title,
    caption,
    videoUrl,
    thumbnailUrl,
    foodName,
    price,
    category,
    hashtags
  } = req.body;

  if (!restaurantId || !title || !videoUrl || !foodName || !price) {
    return res.status(400).json({ message: "Restaurant, title, video, food name & price are required." });
  }

  const reel = await Reel.create({
    restaurantId,
    restaurantName: restaurantName || "Restaurant Kitchen",
    uploadedBy: user._id,
    title,
    caption: caption || "",
    videoUrl,
    thumbnailUrl: thumbnailUrl || "",
    foodName,
    price: Number(price),
    category: category || "Fast Food",
    hashtags: Array.isArray(hashtags) ? hashtags : (hashtags ? hashtags.split(",").map((h: string) => h.trim()) : []),
  });

  return res.status(201).json({
    message: "Food Reel uploaded successfully! 🎬",
    reel,
  });
});

// ─── 3. Toggle Like Reel ───────────────────────────────────────────────────
export const toggleLikeReel = TryCatch(async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: "Unauthorized" });

  const id = req.params.id as string;
  const reel = await Reel.findById(id);
  if (!reel) return res.status(404).json({ message: "Reel not found" });

  const existingLike = await Like.findOne({ userId: user._id, reelId: id });

  let isLiked = false;
  if (existingLike) {
    await Like.deleteOne({ _id: existingLike._id });
    reel.likesCount = Math.max(0, reel.likesCount - 1);
    isLiked = false;
  } else {
    await Like.create({ userId: user._id, reelId: id });
    reel.likesCount += 1;
    isLiked = true;
  }

  await reel.save();

  // Real-time Socket broadcast
  broadcastRealtime(`reel:${id}`, "reel:like_updated", {
    reelId: id,
    likesCount: reel.likesCount,
    userId: user._id,
    isLiked
  });

  return res.json({
    message: isLiked ? "Reel Liked ❤️" : "Unliked",
    isLiked,
    likesCount: reel.likesCount,
  });
});

// ─── 4. Add Comment ────────────────────────────────────────────────────────
export const addComment = TryCatch(async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: "Unauthorized" });

  const id = req.params.id as string;
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ message: "Comment text cannot be empty." });
  }

  const reel = await Reel.findById(id);
  if (!reel) return res.status(404).json({ message: "Reel not found" });

  const comment = await Comment.create({
    userId: user._id,
    userName: user.name || "Foodie Customer",
    userImage: user.image || "",
    reelId: id,
    text: text.trim(),
  });

  reel.commentsCount += 1;
  await reel.save();

  // Socket broadcast
  broadcastRealtime(`reel:${id}`, "reel:comment_added", {
    reelId: id,
    commentsCount: reel.commentsCount,
    comment
  });

  return res.status(201).json({
    message: "Comment posted! 💬",
    comment,
    commentsCount: reel.commentsCount
  });
});

// ─── 5. Get Comments ───────────────────────────────────────────────────────
export const getComments = TryCatch(async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params.id as string;
  const comments = await Comment.find({ reelId: id }).sort({ createdAt: -1 }).limit(50);
  return res.json({ comments });
});

// ─── 6. Record View Analytics ─────────────────────────────────────────────
export const recordView = TryCatch(async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params.id as string;
  const { watchSeconds = 0, completed = false } = req.body;

  const reel = await Reel.findById(id);
  if (reel) {
    reel.viewsCount += 1;
    await reel.save();
  }

  if (req.user?._id) {
    await ViewHistory.create({
      userId: req.user._id,
      reelId: id,
      watchSeconds: Number(watchSeconds),
      completed: Boolean(completed),
    });
  }

  return res.json({ success: true });
});
