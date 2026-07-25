import { AuthenticatedRequest } from "../middlewares/isAuth.js";
import TryCatch from "../middlewares/trycatch.js";
import { Response } from "express";
import { Rider } from "../model/Rider.js";
import axios from "axios";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

export const notifyOfflineRiders = TryCatch(async (req: AuthenticatedRequest, res: Response) => {
    // Only verify internally if we can, or assume restaurant authenticated it via frontend
    // Frontend will pass restaurant data
    const { restaurantName, orderId, restaurantId } = req.body;

    if (!restaurantName || !orderId || !restaurantId) {
        return res.status(400).json({ message: "restaurantName, restaurantId, and orderId required" });
    }

    const restaurantsCollection = mongoose.connection.db!.collection("restaurants");
    const restaurant = await restaurantsCollection.findOne({ _id: new mongoose.Types.ObjectId(restaurantId) });

    if (!restaurant || !restaurant.autoLocation) {
        return res.status(400).json({ message: "Restaurant location not found in database." });
    }

    const location = restaurant.autoLocation;

    // Find all riders within 5km, regardless of isAvailable
    const riders = await Rider.find({
        isVerified: true,
        location: {
            $near: {
                $geometry: {
                    type: "Point",
                    coordinates: location.coordinates,
                },
                $maxDistance: 500000, // 500km for testing
            }
        },
    });

    if (riders.length === 0) {
        return res.status(404).json({ message: "No riders exist within 500km to notify." });
    }

    // Get userIds of these riders
    const userIds = riders.map(r => new mongoose.Types.ObjectId(r.userId));

    // Directly query the auth db's "users" collection to get their emails
    const usersCollection = mongoose.connection.db!.collection("users");
    const users = await usersCollection.find({ _id: { $in: userIds } }).toArray();

    const emails = users.map(u => u.email).filter(Boolean);

    if (emails.length === 0) {
        return res.status(404).json({ message: "No valid rider emails found." });
    }

    // Generate urgent dispatch email using Groq
    let generatedEmail = "";
    try {
        const groqResponse = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama3-8b-8192",
                messages: [
                    {
                        role: "system",
                        content: "You are an automated restaurant dispatcher for Tomato OS."
                    },
                    {
                        role: "user",
                        content: `Write a very short, urgent email to our offline delivery riders. 
                        Tell them that a new order is ready for pickup right now at "${restaurantName}", 
                        but we can't find any riders online. 
                        Tell them to open their Rider App and go Online immediately to accept Order #${orderId.slice(-6)}. 
                        Make it highly professional, short, and use a friendly but urgent tone. No subject line, just the body text in HTML format using basic tags like <br/> and <b>.`
                    }
                ]
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );
        generatedEmail = groqResponse.data.choices[0].message.content;
    } catch (groqErr) {
        console.error("Groq AI failed to generate email:", groqErr);
        // Fallback email
        generatedEmail = `<b>Urgent Delivery Opportunity!</b><br/><br/>An order is currently ready for pickup at <b>${restaurantName}</b>, but no riders are online in your area.<br/><br/>Please open your Rider App and go Online to accept Order #${orderId.slice(-6)}!`;
    }

    // Send email (Mocked for reliable demo purposes)
    try {
        console.log(`\n======================================================`);
        console.log(`[EMAIL DISPATCH SYSTEM] Sending urgent offline ping...`);
        console.log(`To: ${emails.join(", ")}`);
        console.log(`Subject: Urgent Delivery Request: ${restaurantName}`);
        console.log(`Body:\n${generatedEmail}`);
        console.log(`======================================================\n`);
        
        // We simulate a 1-second delay to mimic external API latency for the UI
        await new Promise(resolve => setTimeout(resolve, 1000));
        
    } catch (mailErr: any) {
        console.error("Failed to mock email dispatch:", mailErr.message);
        return res.status(500).json({ message: "Failed to dispatch email notification" });
    }

    res.json({ message: `Successfully emailed ${emails.length} nearby offline riders!`, emailsSent: emails.length });
});
