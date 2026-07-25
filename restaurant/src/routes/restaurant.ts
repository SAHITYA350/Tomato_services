import express from "express";
import { isAuth, isSeller } from "../middlewares/isAuth.js";
import { addRestaurant, fetchMyRestaurant, fetchSingleRestaurant, getNearbyRestaurant, updateRestaurant, updateStatusRestaurant, updateSmartModeRestaurant, getTrendingItems, getSearchAutocomplete } from "../controllers/restaurant.js";
import uploadFile from "../middlewares/multer.js";

const router = express.Router();

router.post("/new", isAuth, isSeller, uploadFile, addRestaurant);
router.get("/my", isAuth, isSeller, fetchMyRestaurant);
router.put("/status", isAuth, isSeller, updateStatusRestaurant);
router.put("/smart-mode", isAuth, isSeller, updateSmartModeRestaurant);
router.put("/edit", isAuth, isSeller, uploadFile, updateRestaurant);
router.get("/all", isAuth, getNearbyRestaurant);
router.get("/trending", isAuth, getTrendingItems);
router.get("/autocomplete", isAuth, getSearchAutocomplete);
router.get("/:id", isAuth, fetchSingleRestaurant);

export default router;