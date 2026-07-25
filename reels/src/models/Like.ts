import mongoose, { Schema, Document } from "mongoose";

export interface ILike extends Document {
  userId: string;
  reelId: string;
  createdAt: Date;
}

const LikeSchema = new Schema<ILike>({
  userId: { type: String, required: true },
  reelId: { type: String, required: true, index: true },
  createdAt: { type: Date, default: Date.now }
});

LikeSchema.index({ userId: 1, reelId: 1 }, { unique: true });

export const Like = mongoose.model<ILike>("Like", LikeSchema);
