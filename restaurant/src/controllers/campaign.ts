import { Request, Response } from "express";
import { redisClient, MOCK_COUPONS, MOCK_ADS } from "../config/redis.js";
import TryCatch from "../middlewares/trycatch.js";
import Restaurant from "../models/Restaurant.js";
import MenuItem from "../models/MenuItems.js";
import Coupon from "../models/Coupon.js";
import Order from "../models/Order.js";
import { AuthenticatedRequest } from "../middlewares/isAuth.js";

// Utility to randomly shuffle an array
const shuffleArray = (array: any[]) => {
  return array.sort(() => Math.random() - 0.5);
};

export const getAds = TryCatch(async (req: Request, res: Response) => {
  // Fetch a few random open restaurants to feature as Ads
  const restaurants = await Restaurant.aggregate([
    { $match: { isOpen: true } },
    { $sample: { size: 5 } }
  ]);

  const bgGradients = [
    "linear-gradient(to right, #111827, #000000)", // gray-900 to black
    "linear-gradient(to right, #18181b, #171717)", // zinc-900 to neutral-900
    "linear-gradient(to right, #0f172a, #18181b)", // slate-900 to zinc-900
    "linear-gradient(to right, #1a1a1a, #0a0a0a)", // dark grays
    "linear-gradient(to right, #1c1917, #000000)"  // stone-900 to black
  ];

  const promos = [
    { title: "Festival Special 🪔", subtitle: "Flat 30% OFF. Use code FEST30" },
    { title: "Welcome Offer 🎉", subtitle: "New user? Use code WELCOME50" },
    { title: "Midnight Sale 🌙", subtitle: "20% OFF. Use code FLAT20" },
    { title: "Flash Deal ⚡", subtitle: "Limited time discount!" },
    { title: "Premium Dining 🍷", subtitle: "Experience luxury at home." }
  ];

  const ads = restaurants.map((restaurant, index) => {
    const promo = promos[index % promos.length];
    return {
      id: `ad_${restaurant._id}`,
      restaurantId: restaurant._id,
      title: promo?.title || "Special Offer",
      subtitle: `${promo?.subtitle || "Great deals"} at ${restaurant.name.substring(0, 15)}`,
      image: restaurant.image || "https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=600&auto=format&fit=crop",
      bgColor: bgGradients[index % bgGradients.length],
    };
  });

  if (ads.length === 0) {
    return res.json({ success: true, ads: MOCK_ADS });
  }

  res.json({ success: true, ads });
});

export const getRecommendedItems = TryCatch(async (req: Request, res: Response) => {
  // Fetch 10 random menu items
  const items = await MenuItem.aggregate([
    { $match: { isAvailable: true } },
    { $sample: { size: 10 } },
    {
      $lookup: {
        from: "restaurants",
        localField: "restaurantId",
        foreignField: "_id",
        as: "restaurant"
      }
    },
    { $unwind: "$restaurant" }
  ]);

  const feedbackAnalysis = [
    "🔥 Loved for its authentic flavor!",
    "⭐ 94% users recommend this.",
    "🌶️ Perfect balance of spices.",
    "🏆 Top ordered item this week.",
    "🤤 'Absolutely delicious!' - User feedback",
    "✨ Highly rated for freshness.",
    "💯 Best value for money.",
    "❤️ A customer favorite."
  ];

  const recommendedItems = items.map((item, index) => {
    // Generate a pseudo-random rating between 4.1 and 4.9 based on index
    const rating = (4.1 + (index % 9) * 0.1).toFixed(1);
    const feedback = feedbackAnalysis[index % feedbackAnalysis.length];

    return {
      _id: item._id,
      name: item.name,
      price: item.price,
      image: item.image,
      restaurantId: item.restaurantId,
      restaurantName: item.restaurant.name,
      rating: parseFloat(rating),
      feedbackAnalysis: feedback
    };
  });

  res.json({ success: true, items: recommendedItems });
});

export const getCoupons = TryCatch(async (req: Request, res: Response) => {
  try {
    const cachedCoupons = await redisClient.hgetall("campaign:coupons");
    if (cachedCoupons && Object.keys(cachedCoupons).length > 0) {
      const coupons = Object.values(cachedCoupons).map((c: any) => JSON.parse(c as string));
      return res.json({ success: true, coupons });
    }
  } catch (error) {
    console.warn("Redis fetch failed, falling back to local memory for coupons.");
  }

  // Fallback
  res.json({ success: true, coupons: Object.values(MOCK_COUPONS) });
});

export const validateCoupon = TryCatch(async (req: AuthenticatedRequest, res: Response) => {
  const { code, orderValue } = req.body;
  const user = req.user;

  if (!code || typeof orderValue !== "number") {
    return res.json({ success: false, message: "Code and orderValue are required." });
  }

  const normalizedCode = code.toUpperCase();
  
  // Query actual MongoDB Coupon collection
  const couponData = await Coupon.findOne({ code: normalizedCode, isActive: true });

  if (!couponData) {
    return res.json({ success: false, message: "Invalid or expired coupon code." });
  }

  if (couponData.usedCount >= couponData.usageLimit) {
    return res.json({ success: false, message: "Coupon usage limit reached." });
  }

  if (couponData.expiresAt && new Date() > couponData.expiresAt) {
    return res.json({ success: false, message: "Coupon has expired." });
  }

  if (couponData.firstOrderOnly && user) {
    const previousOrder = await Order.findOne({ userId: user._id });
    if (previousOrder) {
      return res.json({ success: false, message: "This coupon is valid for first-time orders only." });
    }
  }

  if (orderValue < couponData.minOrderValue) {
    return res.json({ 
        success: false, 
        message: `Order value must be at least ₹${couponData.minOrderValue} to apply this coupon.` 
    });
  }

  res.json({
    success: true,
    message: "Coupon applied successfully!",
    coupon: couponData
  });
});
