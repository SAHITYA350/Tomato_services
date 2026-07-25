import express from "express";
import cors from "cors";
import adminRoutes from "./routes/admin.js"
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/v1', adminRoutes);

app.listen(process.env.PORT, () => {
    console.log(`Admin Service is running on port ${process.env.PORT}`);
});