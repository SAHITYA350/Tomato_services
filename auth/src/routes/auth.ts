import express from "express";
import { loginUser, addUserRole, myProfile, updateProfile } from "../controller/auth.js";
import { isAuth } from "../middlewares/isAuth.js";

const router = express.Router();

router.post("/login", loginUser);
router.post("/role", isAuth, addUserRole);
router.get("/me", isAuth, myProfile);
router.put("/update", isAuth, updateProfile);

export default router;