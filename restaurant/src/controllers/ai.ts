import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatGroq } from "@langchain/groq";
import { ChatMistralAI } from "@langchain/mistralai";
import axios from "axios";
import PQueue from "p-queue";
import { AuthenticatedRequest } from "../middlewares/isAuth.js";
import TryCatch from "../middlewares/trycatch.js";
import Restaurant from "../models/Restaurant.js";
import MenuItems from "../models/MenuItems.js";
import Order from "../models/Order.js";
import Coupon from "../models/Coupon.js";
import Cart from "../models/Cart.js";
import * as cheerio from "cheerio";
import { MistralAIEmbeddings } from "@langchain/mistralai";
import { redisClient } from "../config/redis.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const GROQ_MODEL = "llama-3.1-8b-instant";
const MISTRAL_MODEL = "mistral-small-latest";
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;
const MAX_CONCURRENT_LLM = 2;          // limit concurrent LLM calls
const HISTORY_TTL_SECONDS = 86400;     // 24h

// ─── Request Queue ────────────────────────────────────────────────────────────
const llmQueue = new PQueue({ concurrency: MAX_CONCURRENT_LLM });

// ─── LLM Provider Wrapper with Fallback ──────────────────────────────────────
let groqLLM: ChatGroq | null = null;
let mistralLLM: ChatMistralAI | null = null;
let mistralVisionLLM: ChatMistralAI | null = null;

function getGroqLLM(): ChatGroq {
  if (!groqLLM) {
    groqLLM = new ChatGroq({
      apiKey: process.env.GROQ_API_KEY!,
      model: GROQ_MODEL,
      temperature: 0.3,
      maxRetries: 0,          // we handle retries ourselves
    });
  }
  return groqLLM;
}

function getMistralLLM(): ChatMistralAI {
  if (!mistralLLM) {
    mistralLLM = new ChatMistralAI({
      apiKey: process.env.MISTRAL_API_KEY!,
      model: MISTRAL_MODEL,
      temperature: 0.3,
      maxRetries: 0,
    });
  }
  return mistralLLM;
}

/** Vision-capable Mistral model (pixtral-12b-2409) — free tier, supports image_url */
function getMistralVisionLLM(): ChatMistralAI {
  if (!mistralVisionLLM) {
    mistralVisionLLM = new ChatMistralAI({
      apiKey: process.env.MISTRAL_API_KEY!,
      model: "pixtral-12b-2409",
      temperature: 0.2,
      maxRetries: 0,
    });
  }
  return mistralVisionLLM;
}

// ─── Persistent Memory (Redis with memory fallback) ───────────────────────────
async function getChatHistory(userId: string): Promise<any[]> {
  try {
    if ((redisClient as any).status !== "ready") return [];
    const raw = await redisClient.get(`chat:history:${userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function appendChatHistory(userId: string, messages: any[]) {
  try {
    if ((redisClient as any).status !== "ready") return;
    const trimmed = messages.slice(-20); // keep last 20 messages
    await redisClient.setex(`chat:history:${userId}`, HISTORY_TTL_SECONDS, JSON.stringify(trimmed));
  } catch (err) {
    // Silent memory fallback
  }
}

// ─── Haversine Distance ────────────────────────────────────────────────────────
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return +(R * c).toFixed(2);
}

// ─── RAG Vector Store (Mistral Embeddings → HuggingFace Fallback) ─────────────
interface VectorDoc { content: string; embedding: number[]; }
let vectorDocs: VectorDoc[] = [];
let isInitializingVectorStore = false;
let mistralEmbeddings: MistralAIEmbeddings | null = null;

function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na  += (a[i] ?? 0) ** 2;
    nb  += (b[i] ?? 0) ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Embed documents using HuggingFace Inference API (free, no quota) */
async function embedWithHuggingFace(texts: string[]): Promise<number[][]> {
  const HF_TOKEN = process.env.HUGGINGFACEHUB_API_TOKEN;
  const MODEL = "sentence-transformers/all-MiniLM-L6-v2";

  const results: number[][] = [];
  // HF API accepts batches of up to 10
  const BATCH = 10;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await axios.post(
      `https://api-inference.huggingface.co/pipeline/feature-extraction/${MODEL}`,
      { inputs: batch, options: { wait_for_model: true } },
      {
        headers: {
          Authorization: HF_TOKEN ? `Bearer ${HF_TOKEN}` : "",
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );
    const embeddings: number[][] = res.data;
    results.push(...embeddings);
  }
  return results;
}

const initializeVectorStore = async () => {
  if (vectorDocs.length > 0 || isInitializingVectorStore) return;
  isInitializingVectorStore = true;
  console.log("🚀 Initializing Vector Store...");
  try {
    const contentsSet = new Set<string>();

    const restaurants = await Restaurant.find({ isOpen: true });
    for (const r of restaurants) {
      contentsSet.add(
        `RESTAURANT: ${r.name}. Description: ${r.description || "A great restaurant."}` +
        (r.autoLocation?.coordinates ? ` LAT:${r.autoLocation.coordinates[1]} LON:${r.autoLocation.coordinates[0]}` : "") +
        ` (RESTAURANT_ID:${r._id})`
      );
    }

    const items = await MenuItems.find({ isAvailable: true }).populate("restaurantId", "name autoLocation");
    for (const i of items) {
      const r = i.restaurantId as any;
      if (!r?._id) continue;
      const coords = r.autoLocation?.coordinates;
      contentsSet.add(
        `MENU_ITEM: ${i.name} at ${r.name}. Price: ₹${i.price}. ` +
        `Description: ${i.description || "Delicious food."}` +
        (coords ? ` LAT:${coords[1]} LON:${coords[0]}` : "") +
        ` (ITEM_ID:${i._id} RESTAURANT_ID:${r._id})`
      );
    }

    const contents = Array.from(contentsSet);
    if (contents.length === 0) {
      console.log("⚠️ Vector Store: no documents to embed, skipping.");
      return;
    }

    console.log(`Generating embeddings for ${contents.length} unique documents...`);

    let embeds: number[][] = [];

    // ── Primary: Mistral embeddings ──────────────────────────────────────────
    try {
      mistralEmbeddings = new MistralAIEmbeddings({
        apiKey: process.env.MISTRAL_API_KEY as string,
        model: "mistral-embed",
      });
      embeds = await mistralEmbeddings.embedDocuments(contents);
      console.log("✅ Vector Store: Mistral embeddings used.");
    } catch (mistralErr: any) {
      const isAuthErr = mistralErr?.statusCode === 401 || mistralErr?.response?.status === 401 ||
                        (mistralErr?.message || "").includes("401") || (mistralErr?.message || "").includes("Unauthorized");
      console.warn(`⚠️ Mistral embeddings failed (${isAuthErr ? "invalid key" : mistralErr?.message}) → falling back to HuggingFace...`);
      mistralEmbeddings = null; // disable for RAG queries too

      // ── Fallback: HuggingFace sentence-transformers (free, no quota) ──────
      try {
        embeds = await embedWithHuggingFace(contents);
        console.log("✅ Vector Store: HuggingFace embeddings used (fallback).");
      } catch (hfErr: any) {
        console.error("❌ HuggingFace embeddings also failed:", hfErr.message);
        console.log("ℹ️ RAG will use token-based similarity only — service continues normally.");
        return; // RAG won't have embeddings but everything else works fine
      }
    }

    for (let i = 0; i < contents.length; i++) {
      vectorDocs.push({ content: contents[i] as string, embedding: embeds[i] as number[] });
    }
    console.log(`✅ Vector Store initialized with ${vectorDocs.length} documents.`);
  } catch (err) {
    console.error("❌ Vector store init failed:", err);
  } finally {
    isInitializingVectorStore = false;
  }
};

initializeVectorStore();

// ─── Dynamic & Static Tools Factory ──────────────────────────────────────────
function buildAllTools(
  userId: string,
  userToken: string,
  userName: string,
  userRole?: string,
  screenContext?: { location?: { lat: number; lng: number }; visibleRestaurants?: { name: string; description?: string }[] }
) {
  const searchRestaurants = tool(
    async ({ query }) => {
      const userLatitude = screenContext?.location?.lat;
      const userLongitude = screenContext?.location?.lng;
      let filter: any = { isOpen: true };
      if (query) {
        filter.$or = [
          { name: { $regex: query, $options: "i" } },
          { description: { $regex: query, $options: "i" } },
        ];
      }
      let restaurants = await Restaurant.find(filter).limit(8);
      if (restaurants.length === 0) {
        delete filter.isOpen;
        restaurants = await Restaurant.find(filter).limit(8);
      }
      return JSON.stringify(restaurants.map((r: any) => {
        const result: any = {
          restaurantId: r._id.toString(),
          name: r.name,
          description: r.description,
          address: r.autoLocation?.formattedAddress,
          isOpen: r.isOpen !== false,
        };
        if (userLatitude && userLongitude && r.autoLocation?.coordinates) {
          const [lon, lat] = r.autoLocation.coordinates;
          const km = getDistanceKm(userLatitude, userLongitude, lat, lon);
          result.distance = `${km} km (${+(km * 0.621371).toFixed(2)} miles)`;
        }
        return result;
      }));
    },
    {
      name: "searchRestaurants",
      description: "PRIMARY TOOL. Search internal Tomato platform seller-created restaurants in the database (e.g. Odisa Restaurant). ALWAYS use this first before any web search.",
      schema: z.object({
        query: z.string().nullable().optional().describe("Search term"),
      }),
    }
  );

  const searchMenu = tool(
    async ({ query, maxPrice, restaurantName }) => {
      const filter: any = { isAvailable: true };
      if (query) {
        filter.$or = [
          { name: { $regex: query, $options: "i" } },
          { description: { $regex: query, $options: "i" } },
        ];
      }
      if (maxPrice) filter.price = { $lte: Number(maxPrice) };

      let items = await MenuItems.find(filter).populate("restaurantId", "name").limit(12);

      if (restaurantName) {
        items = items.filter((i: any) =>
          i.restaurantId?.name?.toLowerCase().includes(restaurantName.toLowerCase())
        );
      }

      return JSON.stringify(items.map((i: any) => ({
        itemId: i._id.toString(),
        restaurantId: i.restaurantId?._id?.toString(),
        name: i.name,
        price: i.price,
        restaurantName: i.restaurantId?.name,
        description: i.description,
        isAvailable: i.isAvailable,
      })));
    },
    {
      name: "searchMenu",
      description: "Search menu items by name, description, max price, or restaurant name. Returns itemId and restaurantId needed for addItemToCart.",
      schema: z.object({
        query: z.string().nullable().optional().describe("Food item search term"),
        maxPrice: z.number().nullable().optional().describe("Max price in INR"),
        restaurantName: z.string().nullable().optional().describe("Filter by restaurant name"),
      }),
    }
  );

  const semanticSearch = tool(
    async ({ query }) => {
      const userLatitude = screenContext?.location?.lat;
      const userLongitude = screenContext?.location?.lng;
      if (vectorDocs.length === 0) {
        await initializeVectorStore();
        if (vectorDocs.length === 0 || !mistralEmbeddings)
          return "Knowledge base not ready yet. Try searchMenu instead.";
      }
      const qEmbed = await mistralEmbeddings!.embedQuery(query);
      const scored = vectorDocs.map(doc => {
        let distStr = "";
        if (userLatitude && userLongitude) {
          const latM = doc.content.match(/LAT:([\d.-]+)/);
          const lonM = doc.content.match(/LON:([\d.-]+)/);
          if (latM && lonM) {
            const km = getDistanceKm(userLatitude, userLongitude, parseFloat(latM[1]!), parseFloat(lonM[1]!));
            distStr = ` [${km} km / ${+(km * 0.621371).toFixed(2)} miles away]`;
          }
        }
        return { content: doc.content + distStr, score: cosineSimilarity(qEmbed, doc.embedding) };
      }).sort((a, b) => b.score - a.score).slice(0, 6);

      return JSON.stringify(scored.map(r => r.content));
    },
    {
      name: "semanticSearch",
      description: "RAG-based semantic search across the entire menu and restaurants. Use for vague queries like 'best biryani', 'cheap veg meal', 'something spicy'.",
      schema: z.object({
        query: z.string().describe("Natural language search query"),
      }),
    }
  );

  const getRestaurantRating = tool(
    async ({ restaurantId, restaurantName }) => {
      let rId = restaurantId;
      if (!rId && restaurantName) {
        const r = await Restaurant.findOne({ name: { $regex: restaurantName, $options: "i" } });
        rId = r?._id?.toString();
      }
      if (!rId) return "Restaurant not found.";

      const orders = await Order.find({ restaurantId: rId, restaurantRating: { $exists: true, $ne: null } })
        .select("restaurantRating restaurantFeedback")
        .limit(50);

      if (orders.length === 0) return `No ratings yet for this restaurant.`;

      const avg = orders.reduce((s, o) => s + (o.restaurantRating || 0), 0) / orders.length;
      const recentFeedback = orders
        .filter(o => o.restaurantFeedback)
        .slice(-3)
        .map(o => `"${o.restaurantFeedback}"`);

      const stars = "⭐".repeat(Math.round(avg));
      return JSON.stringify({
        averageRating: +avg.toFixed(1),
        totalRatings: orders.length,
        stars,
        recentFeedback,
      });
    },
    {
      name: "getRestaurantRating",
      description: "Get the average star rating and recent customer feedback for a restaurant. Use when user asks about ratings or reviews.",
      schema: z.object({
        restaurantId: z.string().nullable().optional().describe("MongoDB _id of the restaurant"),
        restaurantName: z.string().nullable().optional().describe("Restaurant name to search for"),
      }),
    }
  );

  const suggestCombo = tool(
    async ({ title, items, totalPrice, description }) => {
      return `__COMBO_DATA__=${JSON.stringify({ title, items, totalPrice, description })}`;
    },
    {
      name: "suggestCombo",
      description: "Create an interactive combo meal card. Use ONLY when user asks for a 'combo', 'meal for X people', 'party platter', or 'full meal plan'. First use semanticSearch or searchMenu to find real items with valid itemId and restaurantId.",
      schema: z.object({
        title: z.string().describe("Catchy combo name e.g. 'Family Feast for 4 🍕'"),
        description: z.string().describe("Why you recommend this combo"),
        totalPrice: z.number().describe("Sum of all item prices"),
        items: z.array(z.object({
          itemId: z.string().describe("Real ITEM_ID from semanticSearch or searchMenu result"),
          restaurantId: z.string().describe("Real RESTAURANT_ID from semanticSearch or searchMenu result"),
          name: z.string(),
          price: z.number(),
        })),
      }),
    }
  );

  const checkDiscounts = tool(
    async () => {
      const coupons = await Coupon.find({ isActive: true });
      if (coupons.length === 0) return "No active discounts right now. Check back soon!";
      return JSON.stringify(coupons.map(c => ({
        code: c.code,
        type: c.type,
        value: c.value,
        maxDiscount: c.maxDiscount,
        minOrderValue: c.minOrderValue,
        description: c.description,
      })));
    },
    {
      name: "checkDiscounts",
      description: "Fetch all active promo codes and discount offers. Use when user asks about deals, offers, coupons, or discounts.",
      schema: z.object({ _unused: z.string().nullable().optional() }),
    }
  );

  const realWorldSearch = tool(
    async ({ query }) => {
      if (!process.env.TAVILY_API_KEY) return "Web search unavailable (no Tavily key).";
      try {
        const res = await axios.post("https://api.tavily.com/search", {
          api_key: process.env.TAVILY_API_KEY,
          query,
          search_depth: "basic",
          max_results: 3,
        });
        const results: any[] = res.data.results || [];
        if (!results.length) return "No results found online.";
        return results.map(r => `📰 ${r.title}\n${r.content}\nSource: ${r.url}`).join("\n\n");
      } catch (e: any) {
        return `Web search failed: ${e.message}`;
      }
    },
    {
      name: "realWorldSearch",
      description: "Search the web for real-world restaurant info, Zomato/Swiggy menus, reviews, or any live information using Tavily.",
      schema: z.object({ query: z.string() }),
    }
  );

  const scrapeWebsite = tool(
    async ({ url }) => {
      try {
        const { data } = await axios.get(url, { timeout: 8000 });
        const $ = cheerio.load(data);
        $("script, style, nav, footer, header").remove();
        const text = $("body").text().replace(/\s+/g, " ").trim();
        return text.slice(0, 2500) + (text.length > 2500 ? "..." : "");
      } catch (e: any) {
        return `Could not read that URL: ${e.message}`;
      }
    },
    {
      name: "scrapeWebsite",
      description: "Read the content of any URL the user shares. Useful for reading menus, reviews, or article links.",
      schema: z.object({ url: z.string().url() }),
    }
  );

  const addItemToCart = tool(
    async ({ itemId, restaurantId, quantity, itemName }) => {
      try {
        const conflictingItem = await Cart.findOne({
          userId,
          restaurantId: { $ne: restaurantId }
        }).populate("restaurantId", "name");

        if (conflictingItem) {
          const otherRestaurantName = (conflictingItem.restaurantId as any)?.name || "another restaurant";
          return `DIFFERENT_RESTAURANT_ERROR: The user already has items from "${otherRestaurantName}" in their cart. They can only order from one restaurant at a time. Inform the user of this conflict and ask if they would like to clear their cart so you can add "${itemName}".`;
        }

        const port = process.env.PORT || 5001;
        await axios.post(
          `http://localhost:${port}/api/cart/add`,
          { itemId, restaurantId, quantity: quantity || 1 },
          { headers: { Authorization: `Bearer ${userToken}` } }
        );
        return `__CART_ACTION__=${JSON.stringify({ action: "added", itemId, restaurantId, itemName, quantity: quantity || 1 })}`;
      } catch (e: any) {
        const msg = e?.response?.data?.message || e.message;
        return `Failed to add to cart: ${msg}`;
      }
    },
    {
      name: "addItemToCart",
      description: "Add a specific food item to the user's cart. MUST have a valid itemId and restaurantId from searchMenu or semanticSearch results. Use when user says 'add this', 'book this', 'I want this', 'order this', or confirms a specific item.",
      schema: z.object({
        itemId: z.string().describe("The ITEM_ID of the menu item (from searchMenu/semanticSearch)"),
        restaurantId: z.string().describe("The RESTAURANT_ID of the item"),
        itemName: z.string().describe("Human-readable name of the item"),
        quantity: z.number().nullable().optional().describe("Number of items. Default 1. For group orders, use count per person."),
      }),
    }
  );

  const getOrderHistory = tool(
    async ({ limit }) => {
      const orders = await Order.find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit || 5)
        .select("restaurantName items totalAmount status createdAt restaurantRating");
      if (orders.length === 0) return `${userName} hasn't ordered yet. Great time for their first order! 🎉`;
      return JSON.stringify(orders.map(o => ({
        restaurant: o.restaurantName,
        items: o.items.map(i => `${i.name} x${i.quantity}`).join(", "),
        total: `₹${o.totalAmount}`,
        status: o.status,
        rating: o.restaurantRating ?? "Not rated",
        date: new Date(o.createdAt).toLocaleDateString("en-IN"),
      })));
    },
    {
      name: "getOrderHistory",
      description: "Fetch the user's past orders for personalization. Use to suggest repeat orders, understand preferences, or when user asks 'what did I order before'.",
      schema: z.object({
        limit: z.number().nullable().optional().describe("Number of recent orders to fetch. Default 5."),
      }),
    }
  );

  const getCart = tool(
    async () => {
      const cartItems = await Cart.find({ userId }).populate("itemId").populate("restaurantId", "name");
      if (cartItems.length === 0) return "The user's cart is currently empty.";
      const restaurantName = (cartItems[0]?.restaurantId as any)?.name || "Unknown Restaurant";
      return JSON.stringify({
        restaurantName,
        items: cartItems.map(c => {
          const item = c.itemId as any;
          return {
            name: item?.name || "Unknown Item",
            price: item?.price || 0,
            quantity: c.quantity
          };
        })
      });
    },
    {
      name: "getCart",
      description: "Retrieve the current items in the user's cart and the restaurant they belong to. Use to inspect the cart or when user asks 'what is in my cart'.",
      schema: z.object({ _unused: z.string().nullable().optional() })
    }
  );

  const clearUserCart = tool(
    async () => {
      try {
        await Cart.deleteMany({ userId });
        return "SUCCESS: Cart cleared successfully. You can now add items from any restaurant.";
      } catch (e: any) {
        return `Failed to clear cart: ${e.message}`;
      }
    },
    {
      name: "clearUserCart",
      description: "Clear all items from the user's cart. Use when user explicitly asks to 'clear my cart', 'reset cart', or agrees to clear their cart to add items from a different restaurant.",
      schema: z.object({ _unused: z.string().nullable().optional() })
    }
  );

  // ─── Seller Specific Tools ──────────────────────────────────────────────────
  const getSellerOrders = tool(
    async ({ status }) => {
      try {
        const restaurant = await Restaurant.findOne({ ownerId: userId });
        if (!restaurant) return "No restaurant found associated with your account. Please register a restaurant first.";

        const filter: any = { restaurantId: restaurant._id.toString() };
        const activeStatuses = ["placed", "accepted", "preparing", "ready_for_rider", "rider_assigned", "picked_up"];

        if (status === "active") {
          filter.status = { $in: activeStatuses };
        } else if (status === "completed") {
          filter.status = { $in: ["delivered", "cancelled"] };
        }

        const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(15);
        if (orders.length === 0) {
          return JSON.stringify({
            summary: `Live Orders Operations Dashboard for ${restaurant.name}`,
            active_orders_count: 0,
            total_revenue: "₹0",
            orders: []
          });
        }

        const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        return JSON.stringify({
          summary: `Live Orders Operations Dashboard for ${restaurant.name}`,
          active_orders_count: orders.length,
          total_revenue: `₹${totalRevenue}`,
          orders: orders.map(o => ({
            order_id: o._id.toString(),
            customer_name: o.customerName || "Customer",
            status: o.status,
            items: o.items.map(i => ({
              name: i.name,
              quantity: i.quantity,
              unit_price: i.price,
              total_price: i.price * i.quantity
            })),
            order_total: o.totalAmount,
            rider: o.riderName ? {
              name: o.riderName,
              phone: o.riderPhone,
              vehicle_type: "Delivery Bike"
            } : null,
            tracking_status: o.status === "placed" ? "Order Placed - Kitchen Action Required" : `Status: ${o.status}`,
            estimated_delivery_time: "25-30 mins"
          }))
        });
      } catch (e: any) {
        return `Failed to fetch seller orders: ${e.message}`;
      }
    },
    {
      name: "getSellerOrders",
      description: "Fetch live active or completed orders for seller's restaurant. Return raw JSON matching operations dashboard.",
      schema: z.object({
        status: z.enum(["active", "completed", "all"]).nullable().optional().describe("Filter by status: 'active', 'completed', or 'all'"),
      }),
    }
  );

  const getSellerMenu = tool(
    async ({ filter }) => {
      try {
        const restaurant = await Restaurant.findOne({ ownerId: userId });
        if (!restaurant) return "No restaurant found associated with your account.";

        const queryFilter: any = { restaurantId: restaurant._id };
        if (filter === "available") queryFilter.isAvailable = true;
        if (filter === "unavailable") queryFilter.isAvailable = false;

        const items = await MenuItems.find(queryFilter).sort({ createdAt: -1 });
        if (items.length === 0) return `No menu items found in "${restaurant.name}".`;

        return JSON.stringify({
          restaurantName: restaurant.name,
          totalItems: items.length,
          items: items.map(i => ({
            itemId: i._id.toString(),
            name: i.name,
            price: `₹${i.price}`,
            description: i.description || "No description",
            isAvailable: i.isAvailable ? "Available ✅" : "Out of Stock ❌"
          }))
        });
      } catch (e: any) {
        return `Failed to fetch seller menu: ${e.message}`;
      }
    },
    {
      name: "getSellerMenu",
      description: "Fetch seller's menu items, prices, descriptions, and availability stock. Use when seller asks 'what items are available', 'show my menu', 'check inventory', or 'item prices'.",
      schema: z.object({
        filter: z.enum(["all", "available", "unavailable"]).nullable().optional().describe("Filter menu items: 'all', 'available', or 'unavailable'"),
      }),
    }
  );

  const getSellerAnalyticsAndRecommendations = tool(
    async () => {
      try {
        const restaurant = await Restaurant.findOne({ ownerId: userId });
        if (!restaurant) return "No restaurant found.";

        const allOrders = await Order.find({ restaurantId: restaurant._id.toString() }).sort({ createdAt: -1 });
        const menuItems = await MenuItems.find({ restaurantId: restaurant._id });
        const ratedOrders = await Order.find({
          restaurantId: restaurant._id.toString(),
          restaurantRating: { $exists: true, $ne: null }
        }).sort({ createdAt: -1 });

        const itemCounts: Record<string, { count: number; totalRevenue: number }> = {};
        allOrders.forEach(o => {
          o.items.forEach(i => {
            if (!itemCounts[i.name]) itemCounts[i.name] = { count: 0, totalRevenue: 0 };
            const entry = itemCounts[i.name]!;
            entry.count += i.quantity;
            entry.totalRevenue += i.price * i.quantity;
          });
        });

        const topSelling = Object.entries(itemCounts)
          .map(([name, data]) => ({ name, ordersCount: data.count, revenue: `₹${data.totalRevenue}` }))
          .sort((a, b) => b.ordersCount - a.ordersCount)
          .slice(0, 5);

        const lowRated = ratedOrders
          .filter(o => (o.restaurantRating || 5) <= 3)
          .map(o => ({
            issue: o.restaurantFeedback ? (o.restaurantFeedback.toLowerCase().includes("quantity") ? "Quantity / Portion Size Concern" : "Food Quality & Preparation") : "Low Rating Audit",
            feedback: o.restaurantFeedback || "Low rating feedback",
            rating: `⭐ ${o.restaurantRating}/5`,
            customer: o.customerName || "Customer",
            date: new Date(o.createdAt).toLocaleDateString("en-IN")
          })).slice(0, 5);

        const totalRevenue = allOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        const activeCount = allOrders.filter(o => ["placed", "accepted", "preparing", "ready_for_rider", "rider_assigned", "picked_up"].includes(o.status)).length;

        const recommendations: string[] = [];
        if (menuItems.length < 5) {
          recommendations.push("💡 Expand Menu: Add 2-3 popular regional dishes or combos (e.g. Biriyani Combo) to boost sales.");
        }
        if (topSelling.length > 0 && topSelling[0]) {
          recommendations.push(`🔥 Promote Bestseller: "${topSelling[0].name}" is your star performer (${topSelling[0].ordersCount} orders)! Feature it in a 10% Combo Deal.`);
        }
        if (lowRated.length > 0) {
          recommendations.push(`⚠️ Quality Control: Address portion size or hygiene feedback from ${lowRated.length} recent low-rated reviews.`);
        }
        recommendations.push("⚡ Smart Pricing: Keep prices competitive with Zomato/Swiggy regional averages.");

        return JSON.stringify({
          summary: `Performance & Menu Intelligence Audit for ${restaurant.name}`,
          total_orders: allOrders.length,
          active_orders_count: activeCount,
          total_revenue: `₹${totalRevenue}`,
          top_selling_items: topSelling,
          low_rated_items: lowRated,
          recommendations: recommendations,
        });
      } catch (e: any) {
        return `Failed to generate seller analytics: ${e.message}`;
      }
    },
    {
      name: "getSellerAnalyticsAndRecommendations",
      description: "Fetch seller business performance, top selling dishes, low rated feedback, sales revenue summary, and AI recommendations for menu additions or pricing optimization.",
      schema: z.object({ _unused: z.string().nullable().optional() }),
    }
  );

  const getSellerReviewsAndFeedback = tool(
    async () => {
      try {
        const restaurant = await Restaurant.findOne({ ownerId: userId });
        if (!restaurant) return "No restaurant found.";

        const ratedOrders = await Order.find({
          restaurantId: restaurant._id.toString(),
          restaurantRating: { $exists: true, $ne: null }
        }).sort({ createdAt: -1 }).limit(20);

        if (ratedOrders.length === 0) return `No customer ratings yet for "${restaurant.name}".`;

        const avg = ratedOrders.reduce((s, o) => s + (o.restaurantRating || 0), 0) / ratedOrders.length;
        const reviews = ratedOrders
          .filter(o => o.restaurantFeedback)
          .map(o => ({
            customer: o.customerName || "Customer",
            rating: `⭐ ${o.restaurantRating}/5`,
            feedback: o.restaurantFeedback,
            date: new Date(o.createdAt).toLocaleDateString("en-IN")
          }));

        return JSON.stringify({
          restaurantName: restaurant.name,
          averageRating: `⭐ ${+avg.toFixed(1)} / 5`,
          totalReviews: ratedOrders.length,
          recentFeedback: reviews.slice(0, 5)
        });
      } catch (e: any) {
        return `Failed to fetch reviews: ${e.message}`;
      }
    },
    {
      name: "getSellerReviewsAndFeedback",
      description: "Fetch customer star ratings and feedback reviews for the seller's restaurant.",
      schema: z.object({ _unused: z.string().nullable().optional() }),
    }
  );

  // ─── Customer Specific Tools ────────────────────────────────────────────────
  const recommendDishes = tool(
    async ({ preference, maxPrice }) => {
      try {
        const filter: any = { isAvailable: true };
        if (preference === "vegetarian") {
          filter.$or = [
            { name: { $regex: "paneer|veg|dal|roti|biryani|thali|sabzi|chaat|dahi|chole|paratha|salad|rice|dosa|idli", $options: "i" } },
            { description: { $regex: "veg|vegetarian|paneer|dal|pure", $options: "i" } }
          ];
        } else if (preference === "spicy") {
          filter.$or = [
            { name: { $regex: "spicy|chilli|masala|schezwan|tikka|kadai|peri peri", $options: "i" } },
            { description: { $regex: "spicy|spices|masala", $options: "i" } }
          ];
        }

        if (maxPrice) filter.price = { $lte: Number(maxPrice) };

        let items = await MenuItems.find(filter).populate("restaurantId", "name isOpen").limit(8);

        if (items.length === 0) {
          items = await MenuItems.find({ isAvailable: true }).populate("restaurantId", "name isOpen").limit(6);
        }

        return JSON.stringify(items.map((i: any) => ({
          itemId: i._id.toString(),
          restaurantId: i.restaurantId?._id?.toString(),
          name: i.name,
          price: i.price,
          restaurantName: i.restaurantId?.name || "Local Restaurant",
          description: i.description || "Delicious food"
        })));
      } catch (e: any) {
        return `Failed to fetch dish recommendations: ${e.message}`;
      }
    },
    {
      name: "recommendDishes",
      description: "Recommend top food items matching user cravings, dietary preferences (vegetarian, spicy, healthy, budget, trending), or price limit. Returns real item IDs for easy cart adding.",
      schema: z.object({
        preference: z.string().describe("Food preference e.g. 'vegetarian', 'spicy', 'healthy', 'budget', 'trending', 'sweet'"),
        maxPrice: z.number().nullable().optional().describe("Optional budget ceiling in INR"),
      }),
    }
  );

  return [
    getSellerOrders,
    getSellerMenu,
    getSellerAnalyticsAndRecommendations,
    getSellerReviewsAndFeedback,
    searchRestaurants,
    searchMenu,
    semanticSearch,
    recommendDishes,
    getRestaurantRating,
    suggestCombo,
    checkDiscounts,
    realWorldSearch,
    scrapeWebsite,
    addItemToCart,
    getOrderHistory,
    getCart,
    clearUserCart,
  ];
}

// ─── Role-Aware System Prompt ────────────────────────────────────────────────
function buildSystemPrompt(
  userName: string,
  userRole: string,
  screenContext?: { location?: { lat: number; lng: number }; visibleRestaurants?: { name: string; description?: string }[] }
): string {
  if (userRole === "seller") {
    return [
      "You are Tomato AI OS 🍅, an Executive AI Co-Pilot for Restaurant Sellers created by Sahitya Ghosh. Professional, data-driven, highly efficient.",
      `SELLER NAME: ${userName}`,
      "ROLE: RESTAURANT SELLER / OWNER",
      "",
      "RULES FOR SELLER CO-PILOT:",
      "1. Greet warmly by the seller's actual name on initial turn (e.g. 'Hi ' + SELLER NAME). DO NOT re-greet on follow-up turns.",
      "2. For active or pending order queries, ALWAYS call getSellerOrders(status='active').",
      "3. For menu, stock, or available dish queries, ALWAYS call getSellerMenu().",
      "4. For sales stats, top selling dishes, low rated feedback, pricing recommendations, or daily advice, ALWAYS call getSellerAnalyticsAndRecommendations().",
      "5. For customer ratings & reviews, ALWAYS call getSellerReviewsAndFeedback().",
      "6. For competitor market research on Zomato/Swiggy, use realWorldSearch.",
      "7. OUTPUT FORMAT: For dashboard tool results (orders, sales stats, menu items, reviews), return raw flat JSON. For simple conversational or Q&A queries (e.g. 'who are you', competitor price checks, general advice), respond in natural clear text.",
      "8. NEVER say 'cart is empty' or treat the seller as a customer.",
      "9. MULTILINGUAL SUPPORT: Respond in the seller's requested language (English, Bengali, Hindi).",
    ].join("\n");
  }

  // Customer Prompt
  return [
    "You are Tomato AI 🍅, a premium AI food butler & waiter created by Sahitya Ghosh. Warm, professional, helpful.",
    `CUSTOMER NAME: ${userName}`,
    `GPS LOCATION: ${screenContext?.location ? `lat ${screenContext.location.lat}, lng ${screenContext.location.lng}` : "unknown"}`,
    `RESTAURANTS ON SCREEN: ${screenContext?.visibleRestaurants?.length ? screenContext.visibleRestaurants.map(r => r.name).join(", ") : "none"}`,
    "",
    "CRITICAL PREFERENCE & SEARCH RULES:",
    "1. 🥇 1ST PREFERENCE - TOMATO PLATFORM SELLER RESTAURANTS:",
    "   - ALWAYS search and display restaurants created by sellers on the Tomato platform database FIRST (e.g. Odisa Restaurant).",
    "   - ALWAYS call `searchRestaurants` before doing any external search.",
    "   - ALWAYS present Tomato platform seller-created restaurants as the PRIMARY options to the user with their name, status (🟢 OPEN / 🔴 CLOSED), distance, and available menu items.",
    "   - NEVER claim there are no restaurants listed if a seller-created restaurant exists in the Tomato platform database!",
    "   - ONLY after listing Tomato platform restaurants can you optionally offer secondary external web suggestions.",
    "",
    "CRITICAL CONVERSATION & CONFIRMATION RULES:",
    "2. CHECK CHAT HISTORY FIRST: Always review past messages in the conversation to maintain multi-turn context.",
    "3. CART CONFLICT CONFIRMATION ('ok', 'yes', 'sure', 'proceed', 'clear it', 'add it'):",
    "   - If the previous assistant message asked for confirmation to clear the cart or add a specific item, and the user replies with 'ok' / 'yes' / 'sure' / 'proceed':",
    "     a. Call `clearUserCart()` first.",
    "     b. Then call `addItemToCart()` with the item requested in the previous context (or run `searchMenu` to find it if IDs are needed).",
    "     c. Confirm: '✅ Cart cleared and added [item name] to your cart! Ready to checkout?'",
    "4. DO NOT RE-GREET: If this is an ongoing conversation (messages exist in history), DO NOT output a generic 'Hello! Welcome to Tomato AI' greeting. Seamlessly continue the ongoing flow.",
    "5. FOOD RECOMMENDATIONS: For food suggestions / cravings (e.g. 'suggest a vegetarian meal', 'which food is best'), call `recommendDishes` or `searchMenu`/`semanticSearch`. List top dishes with prices (₹XX), restaurant names, and ratings (⭐).",
    "6. ADD TO CART: When user says 'add this [dish]', use `addItemToCart` with exact `itemId` and `restaurantId`. If ONE restaurant per cart conflict occurs, ask user if they want to clear the cart.",
    "7. RATINGS & DISCOUNTS: Ratings → `getRestaurantRating`. Discounts → `checkDiscounts`. History → `getOrderHistory`.",
    "8. FORMATTING: Use vivid food descriptions, ₹ prices, ⭐ ratings, natural emojis.",
  ].join("\n");
}

// ─── Main Chat Controller ─────────────────────────────────────────────────────
export const chatWithAI = TryCatch(async (req: AuthenticatedRequest, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: "Unauthorized" });

  const userMessage: string = req.body.message || "";
  const screenContext = req.body.screenContext;
  if (!userMessage.trim()) return res.status(400).json({ message: "Message is required." });

  const userId = user._id.toString();
  const rawName = (user as any).name?.trim() || (user as any).email?.split("@")[0] || "Seller";
  const userName = rawName.split(" ")[0] || "Seller";
  const userRole = (user as any).role || screenContext?.role || (req.body.isSeller ? "seller" : "customer");
  const authHeader = req.headers.authorization || "";
  const userToken = authHeader.replace("Bearer ", "").trim();

  const threadId = userId;
  const config = { configurable: { thread_id: threadId }, recursionLimit: 12 };

  // Load persistent history from Redis or fallback to request body history
  let history = await getChatHistory(userId);
  if ((!history || history.length === 0) && req.body.history && Array.isArray(req.body.history)) {
    history = req.body.history;
  } else if (req.body.history && Array.isArray(req.body.history) && req.body.history.length > history.length) {
    history = req.body.history;
  }

  const allTools = buildAllTools(userId, userToken, userName, userRole, screenContext);
  const systemPrompt = buildSystemPrompt(userName, userRole, screenContext);

  const ctxPrefix = screenContext?.location
    ? `[CONTEXT: lat=${screenContext.location.lat}, lng=${screenContext.location.lng}] `
    : "";
  const humanMsg = new HumanMessage(ctxPrefix + userMessage);

  const messages = [
    new SystemMessage(systemPrompt),
    ...history.map(m => m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)),
    humanMsg,
  ];

  // Run through queue with exponential backoff + provider fallback
  let result: any;
  let attempts = 0;
  let useMistral = false;

  while (attempts < MAX_RETRIES) {
    try {
      const currentLLM = useMistral ? getMistralLLM() : getGroqLLM();
      const currentAgent = createReactAgent({
        llm: currentLLM,
        tools: allTools,
        stateModifier: systemPrompt,
      });

      await llmQueue.add(async () => {
        result = await currentAgent.invoke({ messages }, config);
      });
      break;
    } catch (err: any) {
      const is429 = err?.message?.includes("429") || err?.status === 429 || err?.code === "rate_limit_exceeded";
      if (is429 && attempts < MAX_RETRIES - 1) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempts) + Math.random() * 1000;
        console.warn(`⚠️ Rate limited on ${useMistral ? "Mistral" : "Groq"} (attempt ${attempts + 1}/${MAX_RETRIES}) — waiting ${Math.round(backoff / 1000)}s...`);
        await new Promise(r => setTimeout(r, backoff));
        useMistral = !useMistral;
        attempts++;
        continue;
      }

      console.error("❌ AI Agent Error:", err.message);

      // ── SMART DIRECT DATABASE FALLBACK ─────────────────────────────────────
      try {
        const msgLower = userMessage.toLowerCase().trim();

        // 1. Handle confirmation 'ok' / 'yes' / 'clear' fallback for cart conflict
        if (["ok", "yes", "sure", "proceed", "clear", "clear it", "add it", "do it"].includes(msgLower)) {
          await Cart.deleteMany({ userId });
          let addedItemName = "your requested item";
          const lastAssistantMsg = [...history].reverse().find(m => m.role === "assistant")?.content || "";
          const dishMatch = lastAssistantMsg.match(/adding\s+([A-Za-z0-9\s]+)\?/i) || lastAssistantMsg.match(/add\s+([A-Za-z0-9\s]+)\s+from/i);
          if (dishMatch && dishMatch[1]) {
            const targetName = dishMatch[1].trim();
            const menuItem = await MenuItems.findOne({ name: { $regex: targetName, $options: "i" }, isAvailable: true }).populate("restaurantId", "name");
            if (menuItem) {
              await Cart.create({
                userId,
                restaurantId: (menuItem.restaurantId as any)._id,
                itemId: menuItem._id,
                quantity: 1
              });
              addedItemName = menuItem.name;
            }
          }
          return res.status(200).json({
            text: `✅ Cleared your cart and added **${addedItemName}** to your cart! Ready to checkout? 🛒✨`,
            cartAction: { action: "cleared_and_added" },
            comboData: null
          });
        }

        if (userRole === "seller") {
          const restaurant = await Restaurant.findOne({ ownerId: userId });
          if (restaurant) {
            if (msgLower.includes("order") || msgLower.includes("active") || msgLower.includes("pending") || msgLower.includes("complete")) {
              const activeOrders = await Order.find({
                restaurantId: restaurant._id.toString(),
                status: { $in: ["placed", "accepted", "preparing", "ready_for_rider", "rider_assigned", "picked_up"] }
              }).sort({ createdAt: -1 });

              if (activeOrders.length === 0) {
                return res.status(200).json({
                  text: `Hi ${userName}! 🍅 You currently have **0 active orders** for **${restaurant.name}**. I'll notify you when a new order arrives! 🔔`,
                  cartAction: null, comboData: null
                });
              }
              const orderSummary = activeOrders.map(o => `- **Order #${o._id.toString().slice(-4)}** (${o.customerName || 'Customer'}): ${o.items.map(i => `${i.name} x${i.quantity}`).join(', ')} — **₹${o.totalAmount}** [Status: *${o.status}*]`).join("\n");
              return res.status(200).json({
                text: `Hi ${userName}! 🍅 Here are your **${activeOrders.length} active orders** for **${restaurant.name}**:\n\n${orderSummary}`,
                cartAction: null, comboData: null
              });
            }

            if (msgLower.includes("menu") || msgLower.includes("item") || msgLower.includes("available") || msgLower.includes("dish")) {
              const menuItems = await MenuItems.find({ restaurantId: restaurant._id });
              const available = menuItems.filter(i => i.isAvailable);
              const itemSummary = available.map(i => `- **${i.name}** — ₹${i.price} (*${i.description || 'Delicious'}*)`).join("\n");
              return res.status(200).json({
                text: `Hi ${userName}! 🍅 Here are the **${available.length} items currently available** in **${restaurant.name}**:\n\n${itemSummary}`,
                cartAction: null, comboData: null
              });
            }
          }
        } else {
          // Customer fallback
          const isRestaurantQuery = /restaurant|restauarnt|resturant|restrunt|open|near|how many|details|list|where|place/i.test(msgLower);

          if (isRestaurantQuery) {
            const userLat = screenContext?.location?.lat;
            const userLng = screenContext?.location?.lng;

            let restaurants = await Restaurant.find({ isOpen: { $ne: false } }).limit(10);
            if (restaurants.length === 0) {
              restaurants = await Restaurant.find().limit(10);
            }

            if (restaurants.length === 0) {
              return res.status(200).json({
                text: `Hi ${userName}! 🍅 Currently, there are no restaurants listed on the platform. Please check back soon!`,
                cartAction: null, comboData: null
              });
            }

            const restDetails = restaurants.map(r => {
              let distStr = "";
              if (userLat && userLng && r.autoLocation?.coordinates) {
                const [lon, lat] = r.autoLocation.coordinates;
                const km = getDistanceKm(userLat, userLng, lat, lon);
                distStr = ` (${km} km away)`;
              }
              const statusBadge = r.isOpen !== false ? "🟢 **OPEN**" : "🔴 **CLOSED**";
              return `📍 **${r.name}** ${statusBadge}${distStr}\n   *${r.description || "Popular Local Eatery"}*\n   Address: ${r.autoLocation?.formattedAddress || "Nearby"}`;
            }).join("\n\n");

            return res.status(200).json({
              text: `Hi ${userName}! 🍅 Here are the **${restaurants.length} restaurants** currently available near your location:\n\n${restDetails}\n\nLet me know what you'd like to order from any of these! 🍽️✨`,
              cartAction: null, comboData: null
            });
          }

          if (msgLower.includes("veg") || msgLower.includes("food") || msgLower.includes("suggest") || msgLower.includes("recommend") || msgLower.includes("eat") || msgLower.includes("dish") || msgLower.includes("menu")) {
            const items = await MenuItems.find({ isAvailable: true }).populate("restaurantId", "name").limit(6);
            const suggestions = items.map(i => `- **${i.name}** from *${(i.restaurantId as any)?.name || 'Local Restaurant'}* — ₹${i.price} (${i.description || 'Delicious'})`).join("\n");
            return res.status(200).json({
              text: `Hi ${userName}! 🍽️ Here are top recommended dishes available right now:\n\n${suggestions}\n\nLet me know which one you'd like to add to your cart! 😊`,
              cartAction: null, comboData: null
            });
          }

          // General rich fallback if query is unspecified
          const openRest = await Restaurant.find({ isOpen: { $ne: false } }).limit(5);
          if (openRest.length > 0) {
            const listStr = openRest.map(r => `- **${r.name}** (🟢 OPEN) — *${r.description || "Local Favorite"}*`).join("\n");
            return res.status(200).json({
              text: `Hi ${userName}! 🍅 I'm here to help you order food! Here are nearby restaurants open right now:\n\n${listStr}\n\nWhat would you like to eat today? 🍕🍔 Biryani, Pizza, or something else?`,
              cartAction: null, comboData: null
            });
          }
        }
      } catch (fallbackErr: any) {
        console.error("❌ Fallback query failed:", fallbackErr.message);
      }

      return res.status(200).json({
        text: `Hi ${userName}! 🍅 I'm **Tomato AI**, your personal food waiter. Ask me about nearby open restaurants, food recommendations, ratings, or adding items to your cart! 🍕`,
        cartAction: null,
        comboData: null,
      });
    }
  }


  if (!result?.messages?.length) {
    return res.status(200).json({
      text: "Hmm, I couldn't process that query. Please try asking again! 🤔",
      cartAction: null,
      comboData: null,
    });
  }

  // Extract final AI text and special payloads
  let aiText = result.messages[result.messages.length - 1].content as string;
  let comboData = null;
  let cartAction = null;

  for (const msg of result.messages) {
    if (typeof msg.content !== "string") continue;

    if (msg.content.includes("__COMBO_DATA__=")) {
      const parts = msg.content.split("__COMBO_DATA__=");
      if (parts[1]) {
        try { comboData = JSON.parse(parts[1]); } catch (_) {}
      }
      aiText = aiText.replace(/\s*__COMBO_DATA__=.*/, "").trim();
    }

    if (msg.content.includes("__CART_ACTION__=")) {
      const parts = msg.content.split("__CART_ACTION__=");
      if (parts[1]) {
        try { cartAction = JSON.parse(parts[1]); } catch (_) {}
      }
    }
  }

  // Persist conversation to Redis
  await appendChatHistory(userId, [
    { role: "user", content: userMessage },
    { role: "assistant", content: aiText },
  ]);

  return res.status(200).json({
    text: aiText,
    comboData,
    cartAction,
  });
});


// ─── Transcribe Audio ─────────────────────────────────────────────────────────
export const transcribeAudio = TryCatch(async (req: AuthenticatedRequest, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Audio file is required" });
  }
  try {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype });
    form.append("file", blob, req.file.originalname || "recording.webm");
    form.append("temperature", "0");
    let prompt = "Restaurant order, menu, price, food. Zomato Swiggy.";
    if (req.body.language && req.body.language !== "auto") {
      const langCode = req.body.language.split("-")[0];
      form.append("language", langCode);
      if (langCode === "bn") prompt = "রেস্টুরেন্ট অর্ডার, মেনু, দাম, খাবার, জোম্যাটো, সুইগ্গি।";
      else if (langCode === "hi") prompt = "रेस्तोरेंट ऑर्डर, मेनू, कीमत, खाना, ज़ोमैटो, स्विगी।";
    }
    form.append("prompt", prompt);

    const whisperModels = ["whisper-large-v3", "whisper-large-v3-turbo"];
    let text = "";

    for (let i = 0; i < whisperModels.length; i++) {
      try {
        form.set("model", whisperModels[i]);
        const whisperRes = await axios.post("https://api.groq.com/openai/v1/audio/transcriptions", form, {
          headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}` }
        });
        text = whisperRes.data.text;
        break;
      } catch (err: any) {
        console.warn(`⚠️ Whisper ${whisperModels[i]} failed: ${err.message}`);
        if (i === whisperModels.length - 1) throw err;
      }
    }

    res.status(200).json({ text });
  } catch (err: any) {
    console.error("❌ Whisper standalone transcription failed completely:", err.message);
    res.status(500).json({ message: "Transcription failed due to server rate limits." });
  }
});

// ─── Email Report ─────────────────────────────────────────────────────────────
export const sendEmailReport = TryCatch(async (req: AuthenticatedRequest, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: "Unauthorized - Please Login" });

  const { restaurantId, healthScore, insights, inventory, prepTime } = req.body;
  const restaurant = await Restaurant.findById(restaurantId);
  const ownerEmail = user.email;
  if (!ownerEmail) return res.status(400).json({ message: "No email found for your account." });

  let nodemailer: any;
  try { nodemailer = await import("nodemailer"); }
  catch (err) { return res.status(500).json({ message: "Email service not configured." }); }

  const transporter = nodemailer.default.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER || "", pass: process.env.EMAIL_PASS || "" },
  });

  const insightsList = (insights || []).map((i: string) => `<li style="padding:4px 0;font-size:14px;color:#374151;">${i}</li>`).join("");
  const inventoryList = (inventory || []).map((i: string) => `<li style="padding:4px 0;font-size:14px;color:#ef4444;">${i}</li>`).join("");

  const htmlContent = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fff;border-radius:16px;border:1px solid #f3f4f6;">
      <div style="background:#E23744;padding:20px 24px;border-radius:12px;margin-bottom:20px;">
          <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">🧠 AI Insights Report</h1>
          <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:12px;">Generated by Tomato AI — Your AI Operations Partner</p>
      </div>
      <div style="margin-bottom:20px;padding:16px;background:#f0fdf4;border-radius:12px;border:1px solid #dcfce7;">
          <h2 style="margin:0 0 4px;font-size:16px;color:#16a34a;">Restaurant Health Score</h2>
          <p style="margin:0;font-size:32px;font-weight:800;color:#16a34a;">${healthScore || "—"}/100</p>
      </div>
      ${insightsList ? `<div style="margin-bottom:20px;"><h3 style="font-size:15px;color:#1f2937;margin-bottom:8px;">📊 Performance Insights</h3><ul style="margin:0;padding-left:20px;">${insightsList}</ul></div>` : ""}
      ${inventoryList ? `<div style="margin-bottom:20px;"><h3 style="font-size:15px;color:#1f2937;margin-bottom:8px;">⚠️ Inventory Alerts</h3><ul style="margin:0;padding-left:20px;">${inventoryList}</ul></div>` : ""}
      ${prepTime ? `<div style="margin-bottom:20px;padding:14px;background:#f0f9ff;border-radius:10px;border:1px solid #bae6fd;"><h3 style="font-size:14px;color:#0284c7;margin:0 0 6px;">⏱️ Prep Time</h3><p style="margin:0;font-size:13px;color:#374151;">Est: <strong>${prepTime.estimatedMinutes} min</strong> | Orders: <strong>${prepTime.activeOrders}</strong> | Load: <strong>${prepTime.loadLevel}</strong></p></div>` : ""}
      <div style="border-top:1px solid #f3f4f6;padding-top:16px;margin-top:20px;">
          <p style="font-size:11px;color:#9ca3af;margin:0;">Restaurant: ${restaurant?.name || "Your Restaurant"}</p>
      </div>
  </div>`;

  try {
    await transporter.sendMail({
      from: `"Tomato AI Reports" <${process.env.EMAIL_USER || "noreply@example.com"}>`,
      to: ownerEmail,
      subject: `🧠 AI Insights Report — ${restaurant?.name || "Your Restaurant"} | Score: ${healthScore || "—"}/100`,
      html: htmlContent,
    });
    return res.json({ success: true, message: "Report sent successfully!" });
  } catch (err: any) {
    console.error("❌ Email failed:", err.message);
    return res.status(500).json({ message: "Failed to send email." });
  }
});


// ─── Analysis Context Interface ─────────────────────────────────────────────
interface AnalysisContext {
  filename?: string;
  restaurantName?: string;
  location?: string;
  existingMenuItems?: string[];
}

// ─── Mistral Vision OCR Helper ────────────────────────────────────────────────
async function analyzeDishWithMistralVision(
  imageBase64: string,
  mimetype: string,
  context: AnalysisContext
): Promise<{
  name: string; description: string; cuisineType: string; primaryIngredients: string[];
}> {
  const imageUrl = `data:${mimetype};base64,${imageBase64}`;
  const mistral = getMistralVisionLLM(); // use pixtral-12b-2409 vision model

  const prompt = `You are an expert food vision & OCR analyst for Indian & Global food delivery applications (Zomato / Swiggy).
Context provided from restaurant dashboard:
- Uploaded image filename: "${context.filename || 'food_item'}"
- Restaurant: "${context.restaurantName || 'Local Restaurant'}" located in "${context.location || 'India'}"
${context.existingMenuItems?.length ? `- Existing Menu Items: ${context.existingMenuItems.join(', ')}` : ''}

Instructions for image & pixel analysis:
1. Examine the visual image features carefully: check colors, shape, texture, liquid/curd vs gravy, fried lentil fritters (vada), spices, chutneys, garnishes, or any visible menu text (OCR).
2. Use the filename hint ("${context.filename || ''}") and regional location ("${context.location || 'India'}") to accurately identify traditional Indian or regional dishes (e.g. if the image or filename suggests Dahi Vada / Dahi Bhalla, identify it correctly as Dahi Vada, NOT Paneer Tikka).
3. Be precise with Indian regional snacks, sweets, chaat, and main dishes.

Return ONLY a raw JSON object with these exact keys:
{
  "name": "accurate dish name (e.g. Dahi Vada)",
  "description": "appetizing description (1-2 sentences)",
  "cuisineType": "e.g. North Indian / South Indian / Chaat / Fast Food",
  "primaryIngredients": ["ingredient1", "ingredient2", "ingredient3"]
}

No markdown, no explanation, JSON only.`;

  const response = await mistral.invoke([
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ]);

  const raw = (response.content as string).trim();
  const cleaned = raw.startsWith("```") ? raw.replace(/^```(json)?/, "").replace(/```$/, "").trim() : raw;
  return JSON.parse(cleaned);
}

// ─── HuggingFace BLIP-2 Caption Fallback ─────────────────────────────────────
async function analyzeDishWithHuggingFace(
  imageBuffer: Buffer,
  mimetype: string,
  context: AnalysisContext
): Promise<{
  name: string; description: string; cuisineType: string; primaryIngredients: string[];
}> {
  const HF_TOKEN = process.env.HUGGINGFACEHUB_API_TOKEN;
  if (!HF_TOKEN) throw new Error("No HuggingFace token");

  // Step 1: BLIP-2 image captioning
  const captionRes = await axios.post(
    "https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-large",
    imageBuffer,
    {
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": mimetype,
      },
      timeout: 30000,
    }
  );

  const caption: string = Array.isArray(captionRes.data)
    ? captionRes.data[0]?.generated_text || "food dish"
    : captionRes.data?.generated_text || "food dish";

  // Step 2: Use Groq to convert BLIP caption + context → structured food data
  const groqRes = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: "You are an expert Indian food analyst. Given an image caption, filename hint, and restaurant location, return a raw JSON object ONLY with keys: name (string), description (string), cuisineType (string), primaryIngredients (array of strings). No markdown.",
        },
        {
          role: "user",
          content: `Image caption: "${caption}". Filename hint: "${context.filename || ''}". Restaurant: "${context.restaurantName || ''}" in "${context.location || ''}". Identify exact dish name and details.`,
        },
      ],
      temperature: 0.2,
    },
    { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" }, timeout: 15000 }
  );

  let pt = groqRes.data.choices[0].message.content.trim();
  if (pt.startsWith("```")) pt = pt.replace(/^```(json)?/, "").replace(/```$/, "").trim();
  return JSON.parse(pt);
}

// ─── RAG: Find Similar Menu Items for Pricing Context ─────────────────────────
async function getRAGPricingContext(dishName: string, restaurantId: string): Promise<string> {
  try {
    // Fetch existing menu items from DB
    const existingItems = await MenuItems.find({ restaurantId, isAvailable: true }).limit(20);
    if (existingItems.length === 0) return "";

    // Simple token-based similarity (semantic matching without full vector call)
    const dishTokens = dishName.toLowerCase().split(/\s+/);
    const scored = existingItems.map((item) => {
      const itemTokens = (item.name + " " + (item.description || "")).toLowerCase().split(/\s+/);
      const overlap = dishTokens.filter((t) => itemTokens.includes(t)).length;
      return { name: item.name, price: item.price, score: overlap };
    }).sort((a, b) => b.score - a.score).slice(0, 3);

    // If vector store is ready, try semantic similarity (works with both Mistral and HF embeddings)
    if (vectorDocs.length > 0) {
      try {
        let qEmbed: number[];
        if (mistralEmbeddings) {
          qEmbed = await mistralEmbeddings.embedQuery(dishName);
        } else {
          // Vector store was built with HuggingFace — use HF for query too
          const hfEmbeds = await embedWithHuggingFace([dishName]);
          qEmbed = hfEmbeds[0] as number[];
        }

        const semanticResults = vectorDocs
          .filter((d) => d.content.includes("MENU_ITEM"))
          .map((d) => ({ content: d.content, score: cosineSimilarity(qEmbed, d.embedding) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

        const semanticContext = semanticResults.map((r) => r.content).join(" | ");
        const prices = semanticContext.match(/₹(\d+)/g)?.map((p) => parseInt(p.replace("₹", ""), 10)) || [];
        if (prices.length) {
          const avg = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
          return `Similar items in your menu avg ₹${avg}. RAG context: ${semanticContext.slice(0, 300)}`;
        }
      } catch (_) {}
    }


    if (scored[0] && scored[0].score > 0) {
      return `Similar items in your menu: ${scored.map((i) => `${i.name} @ ₹${i.price}`).join(", ")}`;
    }
    return "";
  } catch (_) {
    return "";
  }
}

// ─── Analyze Dish ─────────────────────────────────────────────────────────────
export const analyzeDish = TryCatch(async (req: AuthenticatedRequest, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: "Unauthorized - Please Login" });
  if (!req.file) return res.status(400).json({ message: "Dish image is required." });

  const imageBase64 = req.file.buffer.toString("base64");
  const mimetype = req.file.mimetype;
  const originalFilename = req.file.originalname || "";

  // ── Step 1: Get restaurant & location context FIRST ─────────────────────────
  const restaurant = await Restaurant.findOne({ ownerId: user._id });
  const location = restaurant?.autoLocation?.formattedAddress || "India";
  const existingItems = restaurant ? await MenuItems.find({ restaurantId: restaurant._id, isAvailable: true }).limit(10) : [];
  const existingNames = existingItems.map(i => i.name);

  const context: AnalysisContext = {
    filename: originalFilename,
    restaurantName: restaurant?.name || "Local Restaurant",
    location,
    existingMenuItems: existingNames,
  };

  // ── Step 2: Vision — Mistral pixtral-12b (free) with HuggingFace fallback ──
  let visionData: { name: string; description: string; cuisineType: string; primaryIngredients: string[] };

  try {
    console.log(`🔍 Analyzing dish image "${originalFilename}" with Mistral Vision for restaurant in ${location}...`);
    visionData = await analyzeDishWithMistralVision(imageBase64, mimetype, context);
    console.log("✅ Mistral Vision success:", visionData.name);
  } catch (mistralErr: any) {
    console.warn("⚠️ Mistral Vision failed:", mistralErr.message, "→ Trying HuggingFace BLIP-2...");
    try {
      visionData = await analyzeDishWithHuggingFace(req.file.buffer, mimetype, context);
      console.log("✅ HuggingFace BLIP-2 fallback success:", visionData.name);
    } catch (hfErr: any) {
      console.error("❌ Both vision providers failed:", hfErr.message);
      return res.status(500).json({
        message: "Could not analyze image. Both Mistral Vision and HuggingFace failed.",
        error: hfErr.message,
      });
    }
  }

  // ── Step 3: RAG — find similar items in own menu for pricing context ─────────
  let recommendedPrice = 149;
  let competitorInsights = "Suggested based on average regional pricing.";
  let scraperDataText = "";

  const ragContext = restaurant
    ? await getRAGPricingContext(visionData.name, restaurant._id.toString())
    : "";

  // ── Step 4: Tavily web search — Zomato/Swiggy competitor pricing in current location ──
  if (process.env.TAVILY_API_KEY && visionData.name) {
    try {
      const tavilyRes = await axios.post("https://api.tavily.com/search", {
        api_key: process.env.TAVILY_API_KEY,
        query: `average price of "${visionData.name}" on Zomato Swiggy in ${location}`,
        search_depth: "basic",
        max_results: 3,
      }, { timeout: 10000 });

      if (tavilyRes.data?.results?.length) {
        scraperDataText = tavilyRes.data.results.slice(0, 3)
          .map((r: any) => `${r.title}: ${r.content}`).join("\n");
        const matches = scraperDataText.match(/₹?\d+/g);
        if (matches) {
          const prices = matches
            .map((m: string) => parseInt(m.replace("₹", ""), 10))
            .filter((p: number) => p > 30 && p < 2000);
          if (prices.length) {
            recommendedPrice = Math.round(prices.reduce((s: number, p: number) => s + p, 0) / prices.length);
          }
        }
      }
    } catch (_) {}
  }

  // ── Step 5: Groq — generate appetizing description + final price recommendation ─
  let appetizingDescription = visionData.description || "";
  try {
    const pricingRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: `You are a professional restaurant menu copywriter and pricing strategist for Indian food delivery apps.
Return ONLY a raw JSON object with keys:
- recommendedPrice (integer in INR, realistic for Zomato/Swiggy in ${location})
- description (string, 1-2 sentences, appetizing and vivid, suitable for a menu card)
- explanation (string, brief pricing rationale considering regional market in ${location})`,
          },
          {
            role: "user",
            content: `Dish Name: "${visionData.name}"
Cuisine: ${visionData.cuisineType}
Ingredients: ${(visionData.primaryIngredients || []).join(", ")}
Restaurant: ${restaurant?.name || "Local Restaurant"} in ${location}
RAG context (own menu): ${ragContext || "No similar items yet"}
Competitor data in ${location}: ${scraperDataText || `Avg ~₹${recommendedPrice} based on regional data`}

Generate a menu description and recommend a fair price for ${visionData.name} in ${location}.`,
          },
        ],
        temperature: 0.3,
      },
      {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        timeout: 15000,
      }
    );

    let pt = pricingRes.data.choices[0].message.content.trim();
    if (pt.startsWith("```")) pt = pt.replace(/^```(json)?/, "").replace(/```$/, "").trim();
    const pd = JSON.parse(pt);
    recommendedPrice = Number(pd.recommendedPrice) || recommendedPrice;
    competitorInsights = pd.explanation || competitorInsights;
    if (pd.description) appetizingDescription = pd.description;
  } catch (_) {}

  return res.json({
    name: visionData.name || "",
    description: appetizingDescription,
    cuisineType: visionData.cuisineType || "",
    primaryIngredients: visionData.primaryIngredients || [],
    recommendedPrice,
    competitorInsights,
    ragContext: ragContext || null,
  });
});



