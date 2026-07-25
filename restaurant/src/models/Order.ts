import mongoose, {Schema, Document} from "mongoose";

export interface IOrder extends Document {
    userId: string;
    customerName?: string;
    customerImage?: string;
    restaurantId: string;
    restaurantName: string;
    riderId?: string | null;
    riderPhone: number | null;
    riderName: string | null;
    riderImage: string | null;
    distance: number;
    riderAmount: number;

    items: {
        itemId: string;
        name: string;
        price: number;
        quantity: number;
        image?: string;
    }[];

    subtotal: number;
    deliveryFee: number;
    platformFee: number;
    couponCode?: string;
    discountAmount?: number;
    totalAmount: number;

    addressId: string;

    deliveryAddress: {
        formattedAddress: string;
        mobile: number;
        latitude: number;
        longitude: number;
    };

    status: | "placed" | "accepted" | "preparing" | "ready_for_rider" | "rider_assigned" | "picked_up" | "delivered" | "cancelled";

    paymentMethod: "razorpay" | "stripe";
    paymentStatus: "pending" | "paid" | "failed";
    expiresAt: Date;

    restaurantRating?: number;
    restaurantFeedback?: string;
    riderRating?: number;
    riderFeedback?: string;

    createdAt: Date;
    updatedAt: Date;
}

const OrderSchema = new Schema<IOrder>({
    userId: {
        type: String,
        required: true,
    },
    customerName: {
        type: String,
        default: "Foodie",
    },
    customerImage: {
        type: String,
        default: "",
    },
    restaurantId: {
        type: String,
        required: true,
    },
    restaurantName: {
        type: String,
        required: true,
    },
    riderId: {
        type: String,
        default: null,
    },
    riderName: {
        type: String,
        default: null,
    },
    riderPhone: {
        type: Number,
        default: null,
    },
    riderAmount: {
        type: Number,
        required: true,
    },
    distance: {
        type: Number,
        required: true,
    },

    items: [
        {
            itemId: String,
            name: String,
            price: Number,
            quantity: Number,
            image: String
        }
    ],

    subtotal: Number,
    deliveryFee: Number,
    platformFee: Number,
    couponCode: {
        type: String,
        default: null,
    },
    discountAmount: {
        type: Number,
        default: 0,
    },
    totalAmount: Number,


    addressId: {
        type: String,
        required: true,
    },

    deliveryAddress: {
        formattedAddress: { type: String, required: true },
        mobile: { type: Number, required: true },
        latitude: Number,
        longitude: Number,
    },

    status: {
        type: String,
        enum: ["placed", "accepted", "preparing", "ready_for_rider", "rider_assigned", "picked_up", "delivered", "cancelled"],
        default: "placed",
    },

    paymentMethod: {
        type: String,
        enum: ["razorpay", "stripe"],
        required: true,
    },
    
    paymentStatus: {
        type: String,
        enum: ["pending", "paid", "failed"],
        default: "pending",
    },

    expiresAt: {
        type: Date,
        index: { expireAfterSeconds: 0 },
    },

    restaurantRating: { type: Number, min: 1, max: 5 },
    restaurantFeedback: { type: String },
    riderRating: { type: Number, min: 1, max: 5 },
    riderFeedback: { type: String },
}, {

    timestamps: true,
}

);

export default mongoose.model<IOrder>("Order", OrderSchema);