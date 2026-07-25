import express from 'express';
import { isAuth, isSeller } from "../middlewares/isAuth.js"; 
import { createOrder, fetchOrderForPayment, fetchRestaurantOrders, fecthSingleOrder, getMyOrders, updateOrderStatus, assignRiderToOrder, getCurrentOrderForRider, updateOrderStatusRider, getRestaurantAnalytics, rateRestaurant, rateRider, getRiderAnalytics, getLiveFeed } from "../controllers/order.js";

const router = express.Router();

router.get("/feed", getLiveFeed);

// Specific routes MUST come before wildcard /:id routes
router.get("/myorder", isAuth, getMyOrders);
router.post("/new", isAuth, createOrder);
router.get("/payment/:id", fetchOrderForPayment);
router.get("/restaurant/:restaurantId", isAuth, isSeller, fetchRestaurantOrders);
router.get("/restaurant/:restaurantId/analytics", isAuth, isSeller, getRestaurantAnalytics);
router.get("/rider/:riderId/analytics", getRiderAnalytics);
router.get("/current/rider", getCurrentOrderForRider);
router.put("/assign/rider", assignRiderToOrder);
router.put("/update/status/rider", updateOrderStatusRider);

// Wildcard routes last
router.get("/:id", isAuth, fecthSingleOrder);
router.put("/:orderId", isAuth, isSeller, updateOrderStatus);
router.post("/:orderId/rate-restaurant", isAuth, rateRestaurant);
router.post("/:orderId/rate-rider", isAuth, rateRider);

export default router;
