import mongoose, { Schema, Document } from "mongoose";

export interface IViewHistory extends Document {
  userId: string;
  reelId: string;
  watchSeconds: number;
  completed: boolean;
  createdAt: Date;
}

const ViewHistorySchema = new Schema<IViewHistory>({
  userId: { type: String, required: true },
  reelId: { type: String, required: true, index: true },
  watchSeconds: { type: Number, default: 0 },
  completed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

export const ViewHistory = mongoose.model<IViewHistory>("ViewHistory", ViewHistorySchema);
