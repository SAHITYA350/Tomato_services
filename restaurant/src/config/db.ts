import mongoose from "mongoose";
import dotenv from 'dotenv';
import Coupon from '../models/Coupon.js';

dotenv.config();

const seedCoupons = async () => {
    try {
        const defaultCoupons = [
            {
                code: "WELCOME50",
                type: "PERCENT",
                value: 50,
                maxDiscount: 100,
                minOrderValue: 150,
                firstOrderOnly: true,
                description: "Get 50% off up to ₹100 on your first order!"
            },
            {
                code: "FLAT20",
                type: "PERCENT",
                value: 20,
                maxDiscount: 200,
                minOrderValue: 200,
                description: "Flat 20% off on orders above ₹200."
            },
            {
                code: "FEST30",
                type: "PERCENT",
                value: 30,
                maxDiscount: 150,
                minOrderValue: 300,
                description: "Festival Special! Flat 30% off."
            },
            {
                code: "TOMATO30",
                type: "PERCENT",
                value: 30,
                maxDiscount: 120,
                minOrderValue: 200,
                description: "Special Tomato discount code."
            },
            {
                code: "FREEDEL",
                type: "FREE_DELIVERY",
                value: 0,
                minOrderValue: 199,
                description: "Free Delivery on orders above ₹199."
            },
            {
                code: "SAVE100",
                type: "FIXED",
                value: 100,
                minOrderValue: 400,
                description: "Flat ₹100 off on orders above ₹400."
            }
        ];

        for (const coupon of defaultCoupons) {
            await Coupon.findOneAndUpdate(
                { code: coupon.code },
                { $set: coupon },
                { upsert: true, new: true }
            );
        }
        console.log("Coupons seeded successfully 🎫");
    } catch (error) {
        console.error("Failed to seed coupons:", error);
    }
};

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI as string, {
            dbName: "Zomato_Clone"
        });
        console.log(`Database Connected 🚀`);
        
        await seedCoupons();
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
    }
}

export default connectDB;