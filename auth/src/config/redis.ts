import { Redis } from "ioredis";
import dotenv from "dotenv";
dotenv.config();

const RedisConstructor = (Redis as any).default || Redis;

export const redisClient = new (RedisConstructor as any)(process.env.REDIS_URL || "redis://localhost:6379", {
  retryStrategy: (times: number) => {
    if (times > 3) {
      console.warn("⚠️ Redis is unreachable (Auth Service). Falling back to memory mode.");
      return null;
    }
    return Math.min(times * 50, 2000);
  },
  maxRetriesPerRequest: 1,
});

redisClient.on("connect", () => console.log("Connected to Redis (Auth Service)"));
redisClient.on("error", (err: any) => {
  if (err?.code !== "ECONNREFUSED") {
    console.error("Redis Error (Auth Service):", err);
  }
});
