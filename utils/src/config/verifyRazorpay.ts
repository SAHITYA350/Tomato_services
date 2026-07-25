import crypto from 'crypto';
import dotenv from "dotenv";
dotenv.config();

export const verifyRazorpaySignature = (
    orderId: string,
    paymentId: string,
    signature: string,
) => {
    const body = `${orderId}|${paymentId}`;

    const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
        .update(body)
        .digest("hex");

        return expectedSignature === signature;
};