import express from "express";
import { isAuth } from "../middlewares/isAuth.js";
import uploadFile from "../middlewares/multer.js";
import { chatWithAI, analyzeDish, sendEmailReport, transcribeAudio } from "../controllers/ai.js";

const router = express.Router();

// Route for text and voice chat with the AI assistant
router.post("/chat", isAuth, uploadFile, chatWithAI);

// Route for pure fast audio transcription
router.post("/transcribe", isAuth, uploadFile, transcribeAudio);

// Route for Vision analysis & pricing suggestions
router.post("/analyze-dish", isAuth, uploadFile, analyzeDish);

// Route for emailing AI insights report
router.post("/email-report", isAuth, sendEmailReport);

export default router;
