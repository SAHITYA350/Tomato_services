import axios from "axios";
import getBuffer from "../config/datauri.js";
import { AuthenticatedRequest } from "../middlewares/isAuth.js";
import TryCatch from "../middlewares/trycatch.js";
import { Rider } from "../model/Rider.js";
import dotenv from "dotenv";
dotenv.config();

export const addRiderProfile = TryCatch(async (req: AuthenticatedRequest, res) => {
    const user = req.user;

    if (!user) {
        return res.status(401).json({
            message: "Unauthorized",
        });
    }

    if (user.role !== "rider") {
        return res.status(403).json({
            message: "Only riders can create rider profile",
        });
    }

    const file = req.file;

    if (!file) {
        return res.status(400).json({
            message: "Rider Image is required",
        });
    }

    const fileBuffer = getBuffer(file);

    if (!fileBuffer?.content) {
        return res.status(500).json({
            message: "Failed to generate image buffer",
        });
    }

    const { data: uploadResult } = await axios.post(`${process.env.UTILS_SERVICE}/api/upload`, {
        buffer: fileBuffer.content,
    });

    const { 
        phoneNumber,
        addharNumber,
        drivingLicenseNumber,
        latitude,
        longitude
    } = req.body;

    if (!phoneNumber || !addharNumber || !drivingLicenseNumber || latitude === undefined || longitude === undefined) {
        return res.status(400).json({
            message: "All fields are required",
        });
    }

    const existingProfile = await Rider.findOne({
        userId: user._id,
    });

    if (existingProfile) {
        return res.status(400).json({
            message: "Rider profile already exists",
        });
    }

    const riderProfile = await Rider.create({
        userId: user._id,
        picture: uploadResult.url,
        phoneNumber,
        addharNumber,
        drivingLicenseNumber,
        location: {
            type: "Point",
            coordinates: [Number(longitude), Number(latitude)],
        },
        isAvailable: false,
        isVerified: true,
    });

    return res.status(201).json({
        message: "Rider profile created successfully",
        riderProfile,
    });
});

export const fetchMyProfile = TryCatch(async (req: AuthenticatedRequest, res) => {
    const user = req.user;

    if (!user) {
        return res.status(401).json({
            message: "Unauthorized",
        });
    }

    const account = await Rider.findOne({ userId: user._id });
    return res.json(account);
});

export const toggleRiderAvailability = TryCatch(async (req: AuthenticatedRequest, res) => {
    const user = req.user;

    if (!user) {
        return res.status(401).json({
            message: "Unauthorized",
        });
    }

    if (user.role !== "rider") {
        return res.status(403).json({
            message: "Only riders can toggle availability",
        });
    }

    const { isAvailable, latitude, longitude } = req.body;

    if (typeof isAvailable !== "boolean") {
        return res.status(400).json({
            message: "isAvailable must be a boolean",
        });
    }

    if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({
            message: "location is required",
        });
    }

    const rider = await Rider.findOne({
        userId: user._id,
    });

    if (!rider) {
        return res.status(404).json({
            message: "Rider profile not found",
        });
    }

    if (isAvailable && !rider.isVerified) {
        return res.status(403).json({
            message: "Rider is not verified",
        });
    }

    rider.isAvailable = isAvailable;
    rider.location = {
        type: "Point",
        coordinates: [Number(longitude), Number(latitude)],
    };

    rider.lastActiveAt = new Date();

    await rider.save();

    return res.json({
        message: isAvailable ? "Rider is now online" : "Rider is now offline",
        rider,
    });
});

export const acceptOrder = TryCatch(async (req: AuthenticatedRequest, res) => {
    const riderUserId = req.user?._id;
    const { orderId } = req.params;

    if (!riderUserId) {
        return res.status(400).json({
            message: "Please Login",
        });
    }

    const rider = await Rider.findOne({ userId: riderUserId, isAvailable: true });

    if (!rider) {
        return res.status(404).json({
            message: "rider not found"
        });
    }

    try {
        const { data } = await axios.put(`${process.env.RESTAURANT_SERVICE}/api/order/assign/rider`, {
            orderId,
            riderId: rider._id.toString(),
            riderUserId: rider.userId,
            riderName: req.user?.name || "Rider",
            riderImage: rider.picture,
            riderPhone: rider.phoneNumber,
        },{
             headers: {
                "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
             },
        });

     if (data.success) {
        const riderDetails = await Rider.findOneAndUpdate({
            userId: riderUserId,
            isAvailable: true,
        },
        { isAvailable: false },
        { new: true }
        );

        res.json({
            message: "Order accepted"
        });

      }
    } catch (error) {
        res.status(400).json({
            message: "Order already taken",
        });
    }
});

export const fetchMyCurrentOrder = TryCatch(async (req: AuthenticatedRequest, res) => {
    const riderUserId = req.user?._id;

     if (!riderUserId) {
        return res.status(400).json({
            message: "Please Login",
        });
    }

    const rider = await Rider.findOne({ 
        userId: riderUserId,
        isVerified: true
    });

    if (!rider) {
        return res.status(404).json({
            message: "rider not found"
        });
    }

    try {
        const { data } = await axios.get(`${process.env.RESTAURANT_SERVICE}/api/order/current/rider?riderId=${rider._id}`, {
            headers: {
                "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
            }
        });

        res.json({
            order: data,
        });
    } catch (error: any) {
        if (error?.response?.status === 404) {
            return res.json({
                order: null,
            });
        }
        const msg = error?.response?.data?.message || "No active order found";
        res.status(error?.response?.status || 500).json({
            message: msg,
        });
    }
});

export const updateOrderStatus = TryCatch(async (req: AuthenticatedRequest, res) => {
    const userId = req.user?._id;

    if(!userId) {
        return res.status(401).json({
            message: "Please Login",
        });
    }

    const rider = await Rider.findOne({
        userId: userId
    });

    if (!rider) {
        return res.status(400).json({
            message: "Please Login",
        });
    }

    const {orderId} = req.params;

    try {
        const {data} = await axios.put(`${process.env.RESTAURANT_SERVICE}/api/order/update/status/rider`,
            { orderId },
            {
                headers: {
                    "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                },
            }
        );

        // Check if the order is now delivered (which returns 404 from current order API)
        try {
            await axios.get(`${process.env.RESTAURANT_SERVICE}/api/order/current/rider?riderId=${rider._id}`, {
                headers: {
                    "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                }
            });
        } catch (err: any) {
            if (err?.response?.status === 404) {
                rider.isAvailable = true;
                await rider.save();
            }
        }

        res.json({
            message: data.message,
        });

    } catch (error: any) {
        res.status(500).json({
            message: "Internal server error",
        });
    }
});

export const updateRiderProfile = TryCatch(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { phoneNumber, latitude, longitude } = req.body;
    let pictureUrl;

    const file = req.file;
    if (file) {
        const fileBuffer = getBuffer(file);
        if (fileBuffer?.content) {
            const { data: uploadResult } = await axios.post(`${process.env.UTILS_SERVICE}/api/upload`, {
                buffer: fileBuffer.content,
            });
            pictureUrl = uploadResult.url;
        }
    }

    const updates: any = {};
    if (phoneNumber) updates.phoneNumber = phoneNumber;
    if (pictureUrl) updates.picture = pictureUrl;
    
    if (latitude !== undefined && longitude !== undefined) {
        updates.location = {
            type: "Point",
            coordinates: [Number(longitude), Number(latitude)],
        };
    }

    const rider = await Rider.findOneAndUpdate(
        { userId: user._id },
        updates,
        { new: true }
    );

    if (!rider) {
        return res.status(404).json({ message: "Rider profile not found" });
    }

    res.json({ message: "Profile updated successfully", rider });
});
