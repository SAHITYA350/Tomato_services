import express from "express";
import connectDB from "./config/db.js";
import cors from "cors";
import riderRoutes from "./routes/rider.js";
import aiRiderRoutes from "./routes/aiRider.js";
import dotenv from "dotenv";
import { connectRabbitMQ } from "./config/rabbitmq.js";
dotenv.config();

await connectRabbitMQ();

const app = express();
app.use(express.json());
app.use(cors());

app.use("/api/rider", riderRoutes);
app.use("/api/rider/ai", aiRiderRoutes);

const PORT = process.env.PORT || 5005;

const startServer = async () => {
    try {
        app.listen(PORT, () => {
            console.log(`Rider service is running on port ${PORT}`);
        });
        await connectDB();
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
};

startServer();