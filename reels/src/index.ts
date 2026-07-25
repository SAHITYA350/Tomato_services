import express, { Request, Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import mongoose from "mongoose";
import reelRoutes from "./routes/reels.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5006;

app.use(cors({
  origin: "*",
  credentials: true
}));
app.use(express.json());

// Routes
app.use("/api/reels", reelRoutes);

app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", service: "reels-service", port: PORT });
});

// Database Connection & Server Boot
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://Sahitya:Sahitya123@cluster0.p7xpt.mongodb.net/zomato_clone?retryWrites=true&w=majority";

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("🎬 Reels Service DB Connected 🚀");
    app.listen(PORT, () => {
      console.log(`🍿 Reels Service running on port ${PORT}`);
    });
  })
  .catch((err: any) => {
    console.error("❌ Reels Service DB Connection Error:", err);
  });
