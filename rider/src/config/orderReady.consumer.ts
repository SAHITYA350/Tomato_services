import axios from "axios";
import { getChannel } from "./rabbitmq.js";
import { Rider } from "../model/Rider.js";
import dotenv from "dotenv";
dotenv.config();

export const startOrderReadyConsumer = async () => {
    const channel = getChannel();

    console.log("Starting to consume from : ", process.env.ORDER_READY_QUEUE);
    
    channel.consume(process.env.ORDER_READY_QUEUE!, async (msg) => {
        if(!msg) return;
       try {
         console.log("Recieved Message", msg.content.toString());
         
         const event = JSON.parse(msg.content.toString());
         console.log("event type :", event.type);
       
         if(event.type !== "ORDER_READY_FOR_RIDER") {
            console.log("skipping non-order-ready-for-rider event");
            channel.ack(msg);
            return;
         }
         
       const {
            orderId,
            restaurantId,
            location,
            userId,
       } = event.data;

       if (!location || !location.coordinates) {
          console.log("Invalid location in event data, skipping...");
          channel.ack(msg);
          return;
       }

       console.log("Searching for rider near coordinates:", location.coordinates);

       // Find nearby available riders (within 5km radius)
       const riders = await Rider.aggregate([
           {
               $geoNear: {
                   near: { type: "Point", coordinates: location.coordinates },
                   distanceField: "distance",
                   maxDistance: 500000, // 500km for testing
                   spherical: true,
                   query: { isAvailable: true, isVerified: true }
               }
           },
           { $limit: 3 }
       ]);
       
       console.log(`Found ${riders.length} nearby riders`);

       if(riders.length === 0) {
        console.log("No riders available nearby for order", orderId);
        try {
            await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`, {
                event: "order:no_riders_found",
                room: `restaurant:${restaurantId}`,
                payload: { orderId }
            }, { headers: { "x-internal-key": process.env.INTERNAL_SERVICE_KEY } });

            await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`, {
                event: "order:no_riders_found",
                room: `user:${userId}`,
                payload: { orderId }
            }, { headers: { "x-internal-key": process.env.INTERNAL_SERVICE_KEY } });
        } catch (emitErr) {
            console.error("Failed to emit no_riders_found:", (emitErr as any)?.message);
        }

        channel.ack(msg);
        return;
       }

       try {
        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`, {
            event: "order:riders_found",
            room: `restaurant:${restaurantId}`,
            payload: { orderId, count: riders.length }
        }, { headers: { "x-internal-key": process.env.INTERNAL_SERVICE_KEY } });
       } catch (emitErr) {
        console.error("Failed to emit riders_found:", (emitErr as any)?.message);
       }
       
       for (const rider of riders) {
        console.log(`Notifying rider userId: ${rider.userId}`);

        try {
            await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`, {
                event: "order:available",
                room: `user:${rider.userId}`,
                payload: {orderId, restaurantId}
            },
            {
                headers: {
                "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                }, 
            }
        );
        console.log(`Notified rider ${rider.userId} successfully`);
        } catch (error) {
            console.log(`Failed to notify rider ${rider.userId}`);
        }
       }
        channel.ack(msg);
        console.log("Message acknowledged");
       } catch (error) {
        console.log("OrderReady consumer error : ", error);
       }
    });

};