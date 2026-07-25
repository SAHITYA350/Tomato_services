import express from "express";
import { isAuth, optionalAuth } from "../middlewares/isAuth.js";
import {
  getReels,
  createReel,
  toggleLikeReel,
  addComment,
  getComments,
  recordView,
} from "../controllers/reel.js";

const router = express.Router();

// Public / Optional Auth Routes
router.get("/", optionalAuth, getReels);
router.get("/:id/comments", getComments);

// Authenticated Routes
router.post("/upload", isAuth, createReel);
router.post("/:id/like", isAuth, toggleLikeReel);
router.post("/:id/comment", isAuth, addComment);
router.post("/:id/view", optionalAuth, recordView);

export default router;
