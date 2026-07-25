import express from 'express';
import cloudinary from "cloudinary";
import cors from "cors";
import uploadRoutes from "./routes/cloudinary.js";
import { connectRabbitMQ } from './config/rabbitmq.js';
import paymentRoutes from "./routes/payment.js";
import dotenv from "dotenv";
dotenv.config();

connectRabbitMQ();

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const { CLOUD_NAME, CLOUD_API_KEY, CLOUD_API_SECRET_KEY } = process.env; 

if(!CLOUD_NAME || !CLOUD_API_KEY || !CLOUD_API_SECRET_KEY) {
    throw new Error("Cloudinary credentials are missing");
    process.exit(1);
}

cloudinary.v2.config({
    cloud_name: CLOUD_NAME,
    api_key: CLOUD_API_KEY,
    api_secret: CLOUD_API_SECRET_KEY,
});

app.use("/api", uploadRoutes);
app.use("/api/payment", paymentRoutes);

const PORT = process.env.PORT || 5002;

const startServer = async () => {
    try {
        app.listen(PORT, () => {
            console.log(`Utils service is running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
};

startServer();