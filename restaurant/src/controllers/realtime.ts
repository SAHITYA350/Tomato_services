import { AuthenticatedRequest } from "../middlewares/isAuth.js";
import TryCatch from "../middlewares/trycatch.js";
import axios from "axios";
import Restaurant from "../models/Restaurant.js";
import mongoose from "mongoose";

// Mock storage for active users (in production, use Redis)
const activeUsers = new Map<string, any>();

// Calculate distance between coordinates
const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return +(R * c).toFixed(2);
};

// Get active users nearby (riders, customers, sellers)
export const getActiveUsersNearby = TryCatch(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { restaurantLat, restaurantLng, radius = 15 } = req.query;

    if (!restaurantLat || !restaurantLng) {
        return res.status(400).json({ message: "restaurantLat and restaurantLng required" });
    }

    const lat = parseFloat(restaurantLat as string);
    const lng = parseFloat(restaurantLng as string);

    try {
        // Query realtime service for active users
        const realtimeResponse = await axios.get(
            `${process.env.REALTIME_SERVICE}/api/v1/active-users`,
            {
                headers: {
                    "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                    Authorization: `Bearer ${req.headers.authorization?.split(" ")[1] || ""}`
                },
                params: { radius }
            }
        ).catch(() => ({ data: { activeUsers: [] } })); // Fallback if realtime service not available

        let users = realtimeResponse.data.activeUsers || [];

        // Filter by distance from restaurant
        users = users
            .map((u: any) => ({
                ...u,
                distance: calculateDistance(lat, lng, u.lat, u.lng)
            }))
            .filter((u: any) => u.distance <= parseFloat(radius as string))
            .sort((a: any, b: any) => a.distance - b.distance);

        res.json({
            success: true,
            count: users.length,
            radius: parseFloat(radius as string),
            restaurantLocation: { lat, lng },
            activeUsers: users
        });
    } catch (error: any) {
        console.error("Error fetching active users:", error.message);
        res.json({
            success: true,
            count: 0,
            radius: parseFloat(radius as string),
            restaurantLocation: { lat, lng },
            activeUsers: []
        });
    }
});

// Register user as online (called from frontend via Socket.io)
export const registerUserOnline = TryCatch(async (req: AuthenticatedRequest, res) => {
    const { userId, type, name, lat, lng, status } = req.body;

    if (!userId || !type || !lat || !lng) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    const user = {
        id: userId,
        type,
        name,
        lat,
        lng,
        status,
        timestamp: Date.now()
    };

    activeUsers.set(userId, user);
    
    // NOTE: Rider DB location is now managed exclusively by the rider service's /api/rider/toggle endpoint.
    // Do NOT update rider DB coordinates here — the SocketContext sends browser GPS which may differ
    // from the rider's intended operating location.

    // Notify realtime service
    try {
        await axios.post(
            `${process.env.REALTIME_SERVICE}/api/v1/internal/user-online`,
            user,
            {
                headers: {
                    "x-internal-key": process.env.INTERNAL_SERVICE_KEY
                }
            }
        );
    } catch (err) {
        console.error("Failed to notify realtime service:", (err as any).message);
    }

    res.json({ success: true, message: "User registered online" });
});

// Unregister user (called on logout/disconnect)
export const registerUserOffline = TryCatch(async (req: AuthenticatedRequest, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ message: "userId required" });
    }

    const user = activeUsers.get(userId);
    if (user && user.type === "rider") {
        try {
            await mongoose.connection.collection("riders").updateOne(
                { userId },
                { $set: { isAvailable: false } }
            );
        } catch (e) {}
    }

    activeUsers.delete(userId);

    // Notify realtime service
    try {
        await axios.post(
            `${process.env.REALTIME_SERVICE}/api/v1/internal/user-offline`,
            { userId },
            {
                headers: {
                    "x-internal-key": process.env.INTERNAL_SERVICE_KEY
                }
            }
        );
    } catch (err) {
        console.error("Failed to notify realtime service:", (err as any).message);
    }

    res.json({ success: true, message: "User registered offline" });
});

// Update user location (called periodically)
export const updateUserLocation = TryCatch(async (req: AuthenticatedRequest, res) => {
    const { userId, lat, lng, status } = req.body;

    if (!userId || lat === undefined || lng === undefined) {
        return res.status(400).json({ message: "userId, lat, lng required" });
    }

    let existingUser = activeUsers.get(userId);
    if (!existingUser) {
        const user = req.user;
        existingUser = {
            id: userId,
            type: user?.role || "customer",
            name: user?.name || "User",
            lat: Number(lat),
            lng: Number(lng),
            status: status || "online",
            timestamp: Date.now()
        };
        activeUsers.set(userId, existingUser);

        // Notify realtime service of user-online
        try {
            await axios.post(
                `${process.env.REALTIME_SERVICE}/api/v1/internal/user-online`,
                existingUser,
                {
                    headers: {
                        "x-internal-key": process.env.INTERNAL_SERVICE_KEY
                    }
                }
            );
        } catch (err: any) {
            console.error("Failed to notify realtime service of dynamically registered user:", err.message);
        }
    }
    
    // NOTE: Rider DB location is now managed exclusively by the rider service's /api/rider/toggle endpoint.
    // Do NOT update rider DB coordinates here — the SocketContext sends browser GPS which may differ
    // from the rider's intended operating location.

    const updatedUser = {
        ...existingUser,
        lat: Number(lat),
        lng: Number(lng),
        status: status || existingUser.status,
        timestamp: Date.now()
    };

    activeUsers.set(userId, updatedUser);

    // Notify realtime service
    try {
        await axios.post(
            `${process.env.REALTIME_SERVICE}/api/v1/internal/user-location-update`,
            updatedUser,
            {
                headers: {
                    "x-internal-key": process.env.INTERNAL_SERVICE_KEY
                }
            }
        );
    } catch (err: any) {
        console.error("Failed to notify realtime service:", err.message);
    }

    res.json({ success: true, message: "Location updated", user: updatedUser });
});

// Get summary statistics
export const getRealTimeStats = TryCatch(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const riders = Array.from(activeUsers.values()).filter(u => u.type === "rider").length;
    const customers = Array.from(activeUsers.values()).filter(u => u.type === "customer").length;
    const sellers = Array.from(activeUsers.values()).filter(u => u.type === "seller").length;

    res.json({
        success: true,
        stats: {
            totalRidersOnline: riders,
            totalCustomersOnline: customers,
            totalSellersOnline: sellers,
            totalUsersOnline: riders + customers + sellers
        }
    });
});
