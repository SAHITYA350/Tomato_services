import expres from "express";
import cors from "cors";
import http from "http";
import { initSocket } from "./socket.js";
import internalRoute from "./routes/internal.js";
import { activeUsers } from "./activeUsers.js";
import dotenv from "dotenv";
import helmet from "helmet";
dotenv.config();

const app = expres();

app.use(cors());
app.use(helmet());
app.use(expres.json());

app.use("/api/v1/internal", internalRoute);

// Public API to query active online users
app.get("/api/v1/active-users", (req, res) => {
    return res.json({
        success: true,
        activeUsers: Array.from(activeUsers.values())
    });
});

const server = http.createServer(app);

initSocket(server);

server.listen(process.env.PORT, () => {
    console.log(`Realtime service is running on port ${process.env.PORT}`);
})