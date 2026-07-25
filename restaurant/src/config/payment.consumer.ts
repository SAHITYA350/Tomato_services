import axios from "axios";
import Order from "../models/Order.js";
import Cart from "../models/Cart.js";
import { getChannel } from "./rabbitmq.js";
import { evaluateSmartOperations } from "../controllers/restaurant.js";

export const startPaymentConsumer = async () => {
    const channel = getChannel();

    channel.consume(process.env.PAYMENT_QUEUE!, async(msg) => {
        if(!msg) return;

        try {
            const event = JSON.parse(msg.content.toString())

            if(event.type !== "payment_success") {
                channel.ack(msg);
                return;
            }  

            const { orderId } = event.data;
            const order = await Order.findOneAndUpdate(
                 {
                    _id: orderId,
                    paymentStatus: {$ne: "paid"}
                 },
                 {
                    $set: {
                        paymentStatus: "paid",
                        status: "placed"
                    },
                    $unset: {
                        expiresAt: 1
                    }
                 },
                 { new: true }
            );

            if(!order) {
               channel.ack(msg);
               return;
            } 

            // Clear the cart for the user who placed this order
            await Cart.deleteMany({ userId: order.userId });

            console.log("✅Order Placed : ", order._id);
            
            try {
                await evaluateSmartOperations(order.restaurantId.toString());
            } catch (err) {
                console.error("Error evaluating smart operations in payment consumer:", err);
            }
            
            //socket work

            await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`, {

            event:  "order:new",
            room: `restaurant:${order.restaurantId}`,
            payload: {
                orderId: order._id,
            },
        },{
            headers: {
                "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
            },
          }
        );

        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`, {
            event:  `restaurant:${order.restaurantId}:analytics-update`,
            room: `restaurant:${order.restaurantId}`,
            payload: {
                orderId: order._id,
                status: order.status,
            },
        },{
            headers: {
                "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
            },
          }
        );

        channel.ack(msg);

        } catch (error) {
           console.error("❌Payment consumer error : ", error);
    }
    });
}