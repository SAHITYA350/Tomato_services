import express from "express";
import { isAuth } from "../middlewares/isAuth.js";
import {
  getRiderClusters,
  emergencyTransferOrder,
  dynamicOrderSwap,
  predictDeliveryFailure,
  reserveParkingSlot,
  smartOrderBundle,
  sopRAGAssistant
} from "../controllers/aiRider.js";

const router = express.Router();

router.get("/clusters", isAuth, getRiderClusters);
router.post("/emergency-transfer", isAuth, emergencyTransferOrder);
router.post("/dynamic-swap", isAuth, dynamicOrderSwap);
router.post("/predict-failure", isAuth, predictDeliveryFailure);
router.post("/reserve-parking", isAuth, reserveParkingSlot);
router.post("/smart-bundle", isAuth, smartOrderBundle);
router.post("/sop-rag", isAuth, sopRAGAssistant);

export default router;
