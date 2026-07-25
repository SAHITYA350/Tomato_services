import mongoose, { Schema, Document } from "mongoose";

export interface IReel extends Document {
  restaurantId: string;
  restaurantName: string;
  uploadedBy: string;
  title: string;
  caption: string;
  videoUrl: string;
  thumbnailUrl?: string;
  foodName: string;
  price: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  category: string;
  hashtags: string[];
  createdAt: Date;
}

const ReelSchema = new Schema<IReel>({
  restaurantId: { type: String, required: true, index: true },
  restaurantName: { type: String, required: true },
  uploadedBy: { type: String, required: true },
  title: { type: String, required: true },
  caption: { type: String, default: "" },
  videoUrl: { type: String, required: true },
  thumbnailUrl: { type: String, default: "" },
  foodName: { type: String, required: true },
  price: { type: Number, required: true },
  likesCount: { type: Number, default: 0 },
  commentsCount: { type: Number, default: 0 },
  sharesCount: { type: Number, default: 0 },
  viewsCount: { type: Number, default: 0 },
  category: { type: String, default: "Fast Food" },
  hashtags: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now, index: true },
});

export const Reel = mongoose.model<IReel>("Reel", ReelSchema);
