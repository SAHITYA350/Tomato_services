import mongoose, { Schema, Document } from "mongoose";

export interface ICoupon extends Document {
  code: string;
  type: "PERCENT" | "FIXED" | "FREE_DELIVERY";
  value: number; // The discount amount or percentage
  maxDiscount?: number; // Optional for FIXED or FREE_DELIVERY
  minOrderValue: number;
  description: string;
  isActive: boolean;
  usageLimit: number;
  usedCount: number;
  firstOrderOnly: boolean;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CouponSchema = new Schema<ICoupon>({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  type: {
    type: String,
    enum: ["PERCENT", "FIXED", "FREE_DELIVERY"],
    required: true,
  },
  value: {
    type: Number,
    required: true,
    min: 0,
  },
  maxDiscount: {
    type: Number,
  },
  minOrderValue: {
    type: Number,
    default: 0,
  },
  description: {
    type: String,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  usageLimit: {
    type: Number,
    default: 100000,
  },
  usedCount: {
    type: Number,
    default: 0,
  },
  firstOrderOnly: {
    type: Boolean,
    default: false,
  },
  expiresAt: {
    type: Date,
  },
}, { timestamps: true });

const Coupon = mongoose.model<ICoupon>("Coupon", CouponSchema);
export default Coupon;
