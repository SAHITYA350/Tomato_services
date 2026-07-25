import express from "express";
import { isAuth } from "../middlewares/isAuth.js";
import { getAds, getCoupons, validateCoupon, getRecommendedItems } from "../controllers/campaign.js";

const router = express.Router();

// All campaign routes are public for the customer dashboard 
// (or require basic auth depending on the app's requirement)
router.get("/ads", getAds);
router.get("/recommended-items", getRecommendedItems);
router.get("/coupons", getCoupons);
router.post("/validate-coupon", isAuth, validateCoupon); // requires auth since it's used in cart

export default router;
