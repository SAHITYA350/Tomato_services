import Redis from "ioredis";

// Configure Redis Client with graceful degradation
const redisURL = process.env.REDIS_URL || "redis://localhost:6379";
export const redisClient = new (Redis as any)(redisURL, {
  retryStrategy: (times: number) => {
    // Stop retrying after 3 attempts to prevent infinite loops if Redis is down
    if (times > 3) {
      console.warn("⚠️ Redis is unreachable. Falling back to local memory for campaigns.");
      return null;
    }
    return Math.min(times * 50, 2000);
  },
  maxRetriesPerRequest: 1,
});

redisClient.on("error", (err: any) => {
  // Silent error handler to prevent app crash if Redis isn't running
  if (err.code !== "ECONNREFUSED") {
    console.error("Redis Error:", err);
  }
});

redisClient.on("connect", () => {
  console.log("Redis Connected for Campaign System 🚀");
  seedCampaignData();
});

// Mock Seed Data
export const MOCK_ADS = [
  {
    id: "ad_1",
    title: "50% OFF on Tomato Gold!",
    subtitle: "Upgrade your dining experience with unlimited free deliveries.",
    image: "https://images.unsplash.com/photo-1550547660-d9450f859349?q=80&w=600&auto=format&fit=crop",
    bgColor: "from-gray-900 to-black"
  },
  {
    id: "ad_2",
    title: "Free Dessert on Orders Above ₹500",
    subtitle: "Treat yourself to something sweet.",
    image: "https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?q=80&w=600&auto=format&fit=crop",
    bgColor: "from-zinc-900 to-stone-900"
  },
  {
    id: "ad_3",
    title: "Healthy Salads 🥗",
    subtitle: "Starting at just ₹149. Stay fit, eat fresh.",
    image: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=600&auto=format&fit=crop",
    bgColor: "from-green-400 to-emerald-600",
  }
];

export const MOCK_COUPONS = {
  "WELCOME50": {
    code: "WELCOME50",
    discountPercent: 50,
    maxDiscount: 100,
    minOrderValue: 150,
    description: "Get 50% off up to ₹100 on your order."
  },
  "FLAT20": {
    code: "FLAT20",
    discountPercent: 20,
    maxDiscount: 200,
    minOrderValue: 200,
    description: "Flat 20% off on orders above ₹200."
  }
};

async function seedCampaignData() {
  try {
    // Seed ads
    await redisClient.set("campaign:ads", JSON.stringify(MOCK_ADS));
    
    // Seed coupons
    for (const [code, data] of Object.entries(MOCK_COUPONS)) {
      await redisClient.hset("campaign:coupons", code, JSON.stringify(data));
    }
    console.log("Campaign Mock Data Seeded to Redis ✨");
  } catch (error) {
    console.warn("Failed to seed Redis (Running without Redis caching fallback active)");
  }
}
