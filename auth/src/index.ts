import express from "express";
import dotenv from "dotenv";
dotenv.config();
import connectDB from "./config/db.js";
import authRoutes from "./routes/auth.js";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
const PORT = process.env.PORT || 5000;

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global error handler:", err.message || err);
    res.status(500).json({ message: err.message || "Internal Server Error" });
});

const startServer = async () => {
    try {
        app.listen(PORT, () => {
            console.log(`Auth service is running on port ${PORT}`);
        });
        await connectDB();
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
};

startServer();