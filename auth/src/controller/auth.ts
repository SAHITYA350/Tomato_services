import User from "../model/User.js";
import jwt from "jsonwebtoken";
import TryCatch from "../middlewares/trycatch.js";
import { AuthenticatedRequest } from "../middlewares/isAuth.js";
import { oauth2Client } from "../config/googleConfig.js";
import axios from "axios";

import { google } from 'googleapis';

export const loginUser = TryCatch(async (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({
            message: "Authorization code is required"
        });
    }

    // Create a fresh OAuth2 client for each request to avoid credential pollution
    const client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        "postmessage"
    );

    let googleRes;
    try {
        googleRes = await client.getToken(code);
    } catch (err: any) {
        console.error("Google OAuth token exchange failed:", err?.message || err);
        return res.status(400).json({
            message: "Google authorization expired or invalid. Please try logging in again."
        });
    }

    if (!googleRes.tokens || !googleRes.tokens.access_token) {
        return res.status(400).json({
            message: "Failed to obtain access token from Google."
        });
    }

    const userRes = await axios.get(`https://www.googleapis.com/oauth2/v2/userinfo?alt=json&access_token=${googleRes.tokens.access_token}`);

    const { email, name, picture } = userRes.data;
    
    let user = await User.findOne({ email });

    if (!user) {
        user = await User.create({
            name,
            email,
            image: picture
        });
    } 

    const payloadUser = user.toObject ? user.toObject() : user;
    const token = jwt.sign({ user: payloadUser }, process.env.JWT_SECRET as string, { expiresIn: "15d" });
    
    res.status(200).json({
        message: "LoggedIn successful",
        token,
        user
    });
});

const allowedRoles = ["customer", "rider", "seller", "admin"] as const;
type Role = (typeof allowedRoles)[number];

export const addUserRole = TryCatch(async(req: AuthenticatedRequest, res) => {
    if(!req.user?._id) {
        return res.status(401).json({message: "Unauthorized - No user in request"});
    }
  
    const { role } = req.body as { role: Role };
    if(!allowedRoles.includes(role)){
        return res.status(400).json({message: "Invalid role provided"});
    }

    const user = await User.findByIdAndUpdate(req.user._id, { role }, { returnDocument: "after" });
    if(!user) {
        return res.status(404).json({message: "User not found"});
    }

    const payloadUser = user.toObject ? user.toObject() : user;
    const token = jwt.sign({ user: payloadUser }, process.env.JWT_SECRET as string, { expiresIn: "15d" });

    res.json({ user, token });
});

export const myProfile = TryCatch(async(req: AuthenticatedRequest, res) => {
    const user = req.user;
    // Re-issue a fresh 15-day token on every /me call.
    // This silently auto-renews tokens for active users so they never
    // see "session expired" as long as they open the app within 15 days.
    const freshToken = jwt.sign(
        { user },
        process.env.JWT_SECRET as string,
        { expiresIn: "15d" }
    );
    res.json({ user, token: freshToken });
});
export const updateProfile = TryCatch(async (req: AuthenticatedRequest, res) => {
    if (!req.user?._id) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { name, image } = req.body;

    const updates: any = {};
    if (name) updates.name = name;
    if (image) updates.image = image;

    const user = await User.findByIdAndUpdate(req.user._id, updates, { returnDocument: "after" });
    if (!user) {
        return res.status(404).json({ message: "User not found" });
    }

    const payloadUser = user.toObject ? user.toObject() : user;
    const token = jwt.sign({ user: payloadUser }, process.env.JWT_SECRET as string, { expiresIn: "15d" });

    res.json({ message: "Profile updated successfully", user, token });
});
