import express from 'express';
import { getIO } from '../socket.js';
import { activeUsers } from '../activeUsers.js';

const router = express.Router();

router.post("/emit", (req, res) => {
     if (req.headers["x-internal-key"]!== process.env.INTERNAL_SERVICE_KEY) {
        return res.status(403).json({
            message: "Forbidden",
        });
     }

     const { event, room, payload } = req.body;
     if(!event || !room ) {
        return res.status(400).json({
             message: "Event and room are required",
         });
     } 

     const io = getIO();
     console.log(`📶 Emitting event ${event} to room ${room}`);

     io.to(room).emit(event, payload ?? {});

     return res.json({
        success: true,
     });
     
 });

router.post("/user-online", (req, res) => {
    if (req.headers["x-internal-key"] !== process.env.INTERNAL_SERVICE_KEY) {
        return res.status(403).json({ message: "Forbidden" });
    }

    const { id, type, name, lat, lng, status } = req.body;
    if (!id || !type || lat === undefined || lng === undefined) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    const user = {
        id,
        type,
        name: name || "User",
        lat: Number(lat),
        lng: Number(lng),
        status: status || "online",
        timestamp: Date.now()
    };
    activeUsers.set(id, user);

    try {
        const io = getIO();
        console.log(`📶 User online: ${id} (${type})`);
        io.to("global").emit("user:online", user);
    } catch (err) {
        console.warn("Socket not ready, skipping broadcast");
    }

    return res.json({ success: true });
});

router.post("/user-offline", (req, res) => {
    if (req.headers["x-internal-key"] !== process.env.INTERNAL_SERVICE_KEY) {
        return res.status(403).json({ message: "Forbidden" });
    }

    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ message: "userId required" });
    }

    activeUsers.delete(userId);

    try {
        const io = getIO();
        console.log(`📶 User offline: ${userId}`);
        io.to("global").emit("user:offline", userId);
    } catch (err) {
        console.warn("Socket not ready, skipping broadcast");
    }

    return res.json({ success: true });
});

router.post("/user-location-update", (req, res) => {
    if (req.headers["x-internal-key"] !== process.env.INTERNAL_SERVICE_KEY) {
        return res.status(403).json({ message: "Forbidden" });
    }

    const { id, lat, lng, status } = req.body;
    if (!id || lat === undefined || lng === undefined) {
        return res.status(400).json({ message: "id, lat, lng required" });
    }

    const existing = activeUsers.get(id);
    if (!existing) {
        return res.status(404).json({ message: "User not found" });
    }

    const updated = {
        ...existing,
        lat: Number(lat),
        lng: Number(lng),
        status: status || existing.status,
        timestamp: Date.now()
    };
    activeUsers.set(id, updated);

    try {
        const io = getIO();
        console.log(`📶 User location update: ${id} to [${lat}, ${lng}]`);
        io.to("global").emit("user:location-update", updated);
    } catch (err) {
        console.warn("Socket not ready, skipping broadcast");
    }

    return res.json({ success: true, user: updated });
});


 export default router;
