import express from 'express';
import { isAuth } from "../middlewares/isAuth.js";
import {
    getActiveUsersNearby,
    registerUserOnline,
    registerUserOffline,
    updateUserLocation,
    getRealTimeStats
} from "../controllers/realtime.js";

const router = express.Router();

// Get active users nearby restaurant
router.get("/active-users", isAuth, getActiveUsersNearby);

// Get real-time statistics
router.get("/stats", isAuth, getRealTimeStats);

// Register user online
router.post("/user-online", isAuth, registerUserOnline);

// Register user offline
router.post("/user-offline", isAuth, registerUserOffline);

// Update user location
router.post("/location-update", isAuth, updateUserLocation);

export default router;
