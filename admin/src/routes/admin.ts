import express from "express";
import { isAdmin, isAuth } from "../middlewares/isAuth.js";
import {
    getDashboardStats,
    getAllCustomers,
    getCustomerOrders,
    getAllRestaurants,
    getRestaurantOrders,
    getRestaurantMenu,
    getAllRiders,
    getAllOrders,
    getOrderDetail,
    getPendingRestaurant,
    getPendingRiders,
    verifyRestaurant,
    verifyRider,
    getAllReels,
    deleteReel,
    getDetailedAnalytics,
    getControlTowerData,
} from "../controllers/admin.js";

const router = express.Router();

// Dashboard & Control Tower
router.get("/admin/dashboard/stats", isAuth, isAdmin, getDashboardStats);
router.get("/admin/analytics", isAuth, isAdmin, getDetailedAnalytics);
router.get("/admin/control-tower", isAuth, isAdmin, getControlTowerData);

// Customers
router.get("/admin/customers", isAuth, isAdmin, getAllCustomers);
router.get("/admin/customers/:userId/orders", isAuth, isAdmin, getCustomerOrders);

// Restaurants
router.get("/admin/restaurants", isAuth, isAdmin, getAllRestaurants);
router.get("/admin/restaurants/:id/orders", isAuth, isAdmin, getRestaurantOrders);
router.get("/admin/restaurants/:id/menu", isAuth, isAdmin, getRestaurantMenu);

// Riders
router.get("/admin/riders", isAuth, isAdmin, getAllRiders);

// Orders
router.get("/admin/orders", isAuth, isAdmin, getAllOrders);
router.get("/admin/orders/:id", isAuth, isAdmin, getOrderDetail);

// Food Reels Management
router.get("/admin/reels", isAuth, isAdmin, getAllReels);
router.delete("/admin/reels/:id", isAuth, isAdmin, deleteReel);

// Legacy pending endpoints (still used)
router.get("/admin/restaurant/pending", isAuth, isAdmin, getPendingRestaurant);
router.get("/admin/rider/pending", isAuth, isAdmin, getPendingRiders);

// Verification
router.patch("/verify/rider/:id", isAuth, isAdmin, verifyRider);
router.patch("/verify/restaurant/:id", isAuth, isAdmin, verifyRestaurant);

export default router;