import { Rider } from "../model/Rider.js";
import TryCatch from "../middlewares/trycatch.js";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

// Calculate distance using Haversine formula
function calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371; // Earth radius in KM
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export interface RiderCandidateScore {
    riderId: string;
    userId: string;
    name: string;
    phone: string;
    picture: string;
    distanceKm: number;
    distanceScore: number;
    workloadScore: number;
    ratingScore: number;
    vehicleBonus: number;
    trafficDelayPenalty: number;
    totalScore: number;
    isBatchable: boolean;
    batchCandidateOrder?: string;
    vehicleType: string;
}

export const evaluateDispatchCandidates = TryCatch(async (req, res) => {
    const { restaurantLat, restaurantLng, orderId, orderValue } = req.body;

    if (restaurantLat === undefined || restaurantLng === undefined) {
        return res.status(400).json({
            message: "restaurantLat and restaurantLng are required",
        });
    }

    // 1. Fetch all online & verified riders
    const onlineRiders = await Rider.find({
        isVerified: true,
        isAvailable: true,
    });

    if (!onlineRiders || onlineRiders.length === 0) {
        return res.json({
            success: false,
            message: "No online riders available in dispatch radius",
            candidates: [],
            recommendedRider: null,
            batchRecommendation: null,
        });
    }

    // 2. Multi-factor scoring for each candidate
    const scoredCandidates: RiderCandidateScore[] = [];

    for (const rider of onlineRiders) {
        const coords = rider.location?.coordinates || [85.8245, 20.2961];
        const riderLng = coords[0];
        const riderLat = coords[1];

        // A. Geospatial Distance Score (max 100 points, -10 per km)
        const distKm = Number(
            calculateHaversineDistance(
                Number(restaurantLat),
                Number(restaurantLng),
                riderLat,
                riderLng
            ).toFixed(2)
        );
        const distanceScore = Math.max(0, 100 - distKm * 12);

        // B. Workload Score (100 pts if 0 active orders, 40 pts if 1 order (batching), 0 if >= 2)
        const currentActiveCount = rider.isAvailable ? 0 : 1;
        let workloadScore = 100;
        let isBatchable = false;

        if (currentActiveCount === 1) {
            workloadScore = 40;
            if (distKm <= 1.5) {
                isBatchable = true; // Batching candidate
            }
        } else if (currentActiveCount >= 2) {
            workloadScore = 0;
        }

        // C. Rating Score (Rating * 20)
        const rating = (rider as any).rating || 5.0;
        const ratingScore = Math.min(100, Math.round(rating * 20));

        // D. Vehicle Type Bonus
        let vehicleBonus = 15; // default bike
        const vehicle = (rider as any).vehicleType || "bike";
        if (vehicle === "electric_ev") vehicleBonus = 20;
        if (vehicle === "cycle") vehicleBonus = 5;

        // E. Simulated Traffic / Zone Delay Penalty
        const trafficDelayPenalty = distKm > 4 ? 15 : distKm > 2 ? 5 : 0;

        // Weighted Combined Score Formula
        // Total = (0.45 * Distance) + (0.25 * Workload) + (0.20 * Rating) + (0.10 * Vehicle) - Traffic
        const totalScore = Math.round(
            distanceScore * 0.45 +
                workloadScore * 0.25 +
                ratingScore * 0.2 +
                vehicleBonus * 0.1 -
                trafficDelayPenalty
        );

        scoredCandidates.push({
            riderId: rider._id.toString(),
            userId: rider.userId,
            name: (rider as any).name || "Partner Rider",
            phone: rider.phoneNumber,
            picture: rider.picture,
            distanceKm: distKm,
            distanceScore: Math.round(distanceScore),
            workloadScore,
            ratingScore,
            vehicleBonus,
            trafficDelayPenalty,
            totalScore: Math.max(0, totalScore),
            isBatchable,
            vehicleType: vehicle,
        });
    }

    // Rank candidates by totalScore descending
    scoredCandidates.sort((a, b) => b.totalScore - a.totalScore);

    const recommendedRider = scoredCandidates.length > 0 ? scoredCandidates[0] : null;

    // Check for Batching opportunity
    const batchCandidate = scoredCandidates.find((c) => c.isBatchable);
    const batchRecommendation = batchCandidate
        ? {
              riderId: batchCandidate.riderId,
              name: batchCandidate.name,
              message: `Order Batching Opportunity: Rider ${batchCandidate.name} is ${batchCandidate.distanceKm}km away with 1 existing pickup on same route. Combine orders to save 22% fuel & delivery time!`,
          }
        : null;

    return res.json({
        success: true,
        totalOnlineRiders: onlineRiders.length,
        orderId,
        recommendedRider,
        batchRecommendation,
        candidates: scoredCandidates,
    });
});

export const executeAutoDispatch = TryCatch(async (req, res) => {
    const { orderId, restaurantLat, restaurantLng } = req.body;

    if (!orderId) {
        return res.status(400).json({ message: "orderId is required" });
    }

    // Run evaluation
    const onlineRiders = await Rider.find({ isVerified: true, isAvailable: true });

    if (!onlineRiders || onlineRiders.length === 0) {
        return res.status(404).json({
            success: false,
            message: "No available online riders in dispatch queue",
        });
    }

    // Pick top scoring rider
    let bestRider: any = onlineRiders[0];
    let minDistance = 9999;

    for (const rider of onlineRiders) {
        const coords = rider.location?.coordinates || [85.8245, 20.2961];
        const dist = calculateHaversineDistance(
            Number(restaurantLat || 20.2961),
            Number(restaurantLng || 85.8245),
            coords[1],
            coords[0]
        );
        if (dist < minDistance) {
            minDistance = dist;
            bestRider = rider;
        }
    }

    if (!bestRider) {
        return res.status(404).json({ message: "No suitable rider found for dispatch" });
    }

    // Assign via Restaurant Service
    try {
        const { data } = await axios.put(
            `${process.env.RESTAURANT_SERVICE}/api/order/assign/rider`,
            {
                orderId,
                riderId: bestRider._id.toString(),
                riderUserId: bestRider.userId,
                riderName: "Partner Rider",
                riderImage: bestRider.picture,
                riderPhone: bestRider.phoneNumber,
            },
            {
                headers: {
                    "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                },
            }
        );

        if (data.success) {
            bestRider.isAvailable = false;
            await bestRider.save();

            // Emit realtime dispatch notification
            axios
                .post(
                    `${process.env.REALTIME_SERVICE}/api/v1/internal/emit`,
                    {
                        event: "order:rider_assigned",
                        room: `order:${orderId}`,
                        payload: { orderId, riderId: bestRider._id },
                    },
                    {
                        headers: {
                            "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                        },
                    }
                )
                .catch(() => {});

            return res.json({
                success: true,
                message: `Order #${String(orderId).slice(-6)} dynamically dispatched to Rider ${bestRider.phoneNumber}`,
                assignedRider: {
                    riderId: bestRider._id,
                    phone: bestRider.phoneNumber,
                    distanceKm: minDistance.toFixed(2),
                },
            });
        }
    } catch (err: any) {
        return res.status(400).json({
            message: err?.response?.data?.message || "Order already assigned or taken",
        });
    }

    return res.status(400).json({ message: "Dispatch execution failed" });
});
