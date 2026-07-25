import mongoose, { Schema, Document } from "mongoose";

export interface IComment extends Document {
  userId: string;
  userName: string;
  userImage?: string;
  reelId: string;
  text: string;
  createdAt: Date;
}

const CommentSchema = new Schema<IComment>({
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  userImage: { type: String, default: "" },
  reelId: { type: String, required: true, index: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

export const Comment = mongoose.model<IComment>("Comment", CommentSchema);
