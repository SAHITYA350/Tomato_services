import express from 'express';
import connectDB from './config/db.js';
import restaurantRoutes from "./routes/restaurant.js"
import itemRoutes from "./routes/menuitem.js"
import cartRoutes from "./routes/cart.js"
import addressRoutes from "./routes/address.js"
import orderRoutes from "./routes/order.js"
import aiRoutes from "./routes/ai.js"
import realtimeRoutes from "./routes/realtime.js"
import campaignRoutes from "./routes/campaign.js"
import cors from "cors";
import dotenv from "dotenv";
import { connectRabbitMQ } from './config/rabbitmq.js';
dotenv.config();

await connectRabbitMQ();

const app = express();

app.use(cors());

app.use(express.json());

const PORT = process.env.PORT || 5001;

app.use("/api/restaurant", restaurantRoutes);
app.use("/api/item", itemRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/address", addressRoutes);
app.use("/api/order", orderRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/campaign", campaignRoutes);
app.use("/api/realtime", realtimeRoutes);

const startServer = async () => {
    try {
        app.listen(PORT, () => {
            console.log(`Restaurant service is running on port ${PORT}`);
        });
        await connectDB();
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
};

startServer();