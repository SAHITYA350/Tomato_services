import express from 'express';
import { isAuth } from '../middlewares/isAuth.js';
import { acceptOrder, addRiderProfile, fetchMyCurrentOrder, fetchMyProfile, toggleRiderAvailability, updateOrderStatus, updateRiderProfile } from '../controllers/rider.js';
import { notifyOfflineRiders } from '../controllers/notify.js';
import { evaluateDispatchCandidates, executeAutoDispatch } from '../controllers/dispatchEngine.js';
import uploadFile from '../middlewares/multer.js';

const router = express.Router();

router.post("/new", isAuth, uploadFile, addRiderProfile);
router.get("/myprofile", isAuth, fetchMyProfile);
router.put("/profile", isAuth, uploadFile, updateRiderProfile);
router.patch("/toggle", isAuth, toggleRiderAvailability);
router.post("/accept/:orderId", isAuth, acceptOrder);
router.get("/order/current", isAuth, fetchMyCurrentOrder);
router.put("/order/update/:orderId", isAuth, updateOrderStatus); 
router.post("/notify-offline/:orderId", isAuth, notifyOfflineRiders);

// Uber Eats-Style Dynamic Delivery Dispatch Engine Endpoints
router.post("/dispatch/evaluate", evaluateDispatchCandidates);
router.post("/dispatch/execute", executeAutoDispatch);

export default router;