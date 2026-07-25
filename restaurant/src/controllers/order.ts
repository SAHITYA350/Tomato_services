import { AuthenticatedRequest } from "../middlewares/isAuth.js";
import TryCatch from "../middlewares/trycatch.js";
import Address from "../models/Address.js";
import Cart from "../models/Cart.js";
import { IMenuItem } from "../models/MenuItems.js";
import Restaurant, { IRestaurant } from "../models/Restaurant.js";
import Order from "../models/Order.js";
import axios from "axios";
import dotenv from "dotenv";
import { publishEvent } from "../config/order.publisher.js";
import { evaluateSmartOperations } from "./restaurant.js";
import { Request } from "express";
import { redisClient, MOCK_COUPONS } from "../config/redis.js";
import Coupon from "../models/Coupon.js";
dotenv.config();


export const createOrder = TryCatch(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if(!user) {
        return res.status(401).json({
            message: "Unauthorized"
        })
    }

    const { paymentMethod, addressId, couponCode } = req.body;
    
    if (!addressId) {
        return res.status(400).json({
            message: "Address is required"
        })
    }

    const address = await Address.findOne({
        _id: addressId,
        userId: user._id
    });

    if(!address) {
        return res.status(404).json({
            message: "Address not found",
        });
    }

    const getDistanceKm = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number => {
    const R = 6371;
    const dLat = ((lat2 - lat1)*Math.PI/180);
    const dLon = ((lon2 - lon1)*Math.PI/180);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos((lat1*Math.PI/180)) * Math.cos((lat2*Math.PI/180)) *
              Math.sin(dLon/2) * Math.sin(dLon/2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return +(R * c).toFixed(2);
  }

    const cartItems = await Cart.find({ userId: user._id })
    .populate<{itemId: IMenuItem}>("itemId")
    .populate<{restaurantId: IRestaurant}>("restaurantId")

    if (cartItems.length === 0) {
        return res.status(400).json({
            message: "Cart is empty"
        })
    }

    const firstCartItem = cartItems[0];

    if (!firstCartItem || !firstCartItem.restaurantId) {
        return res.status(400).json({
           message: "Invalid cart Data",
        });
    }

    const restaurantId = firstCartItem.restaurantId._id;
    const restaurant = await Restaurant.findById(restaurantId);

    if (!restaurant) {
        return res.status(404).json({
            message: "Restaurant not found with this id",
        });
    }

    if (!restaurant.isOpen) {
        return res.status(404).json({
            message: "Sorry this restaurant is closed now",
        });
    }

     const distance = getDistanceKm(
             address.location.coordinates[1],
             address.location.coordinates[0],
             restaurant.autoLocation.coordinates[1],
             restaurant.autoLocation.coordinates[0]
          );
  
      const MAX_DELIVERY_DISTANCE_KM = Number(process.env.MAX_DELIVERY_DISTANCE_KM) || 100;
      if (distance > MAX_DELIVERY_DISTANCE_KM) {
          return res.status(400).json({
              message: `Delivery address is too far from the restaurant. Maximum allowed delivery distance is ${MAX_DELIVERY_DISTANCE_KM} km (Current: ${distance} km).`
          });
      }
  
    let subtotal = 0;

    const orderItems = cartItems.map((cart) => {
        const item = cart.itemId;
        if(!item) {
            throw new Error("Invalid cart item")
        }

        const itemTotal = item.price * cart.quantity;

        subtotal += itemTotal;

        return {
            itemId: item._id.toString(),
            name: item.name,
            price: item.price,
            quantity: cart.quantity,
            image: item.image || "",
        };
    });

    const deliveryFee = subtotal < 250 ? 49 : 0;
    const platformFee = 7;
    
    let discountAmount = 0;
    let appliedCoupon = null;

    if (couponCode) {
        const normalizedCode = couponCode.toUpperCase();
        const couponData = await Coupon.findOne({ code: normalizedCode, isActive: true });

        if (couponData && subtotal >= couponData.minOrderValue) {
            // Additional safety checks just like validation
            let isValid = true;
            if (couponData.usedCount >= couponData.usageLimit) isValid = false;
            if (couponData.expiresAt && new Date() > couponData.expiresAt) isValid = false;
            if (couponData.firstOrderOnly) {
                const prevOrder = await Order.findOne({ userId: user._id });
                if (prevOrder) isValid = false;
            }

            if (isValid) {
                if (couponData.type === "PERCENT") {
                    const mathDiscount = Math.floor((subtotal * couponData.value) / 100);
                    discountAmount = couponData.maxDiscount ? Math.min(mathDiscount, couponData.maxDiscount) : mathDiscount;
                } else if (couponData.type === "FIXED") {
                    discountAmount = couponData.value;
                } else if (couponData.type === "FREE_DELIVERY") {
                    discountAmount = deliveryFee;
                }

                // Prevent discount from being more than the subtotal + delivery
                discountAmount = Math.min(discountAmount, subtotal + deliveryFee);
                appliedCoupon = normalizedCode;

                // Increment used count
                couponData.usedCount += 1;
                await couponData.save();
            }
        }
    }

    const totalAmount = subtotal + deliveryFee + platformFee - discountAmount;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const [longitude, latitude] = address.location.coordinates;

    const riderAmount = Math.ceil(distance) * 17;

    const order = await Order.create({
        userId: user._id.toString(),
        customerName: user.name,
        customerImage: user.image,
        restaurantId: restaurant._id.toString(),
        restaurantName: restaurant.name,
        riderId: null,
        distance,
        riderAmount,
        items: orderItems,
        subtotal,
        deliveryFee, platformFee,
        couponCode: appliedCoupon,
        discountAmount,
        totalAmount,
        addressId: address._id.toString(),
        deliveryAddress: {
            formattedAddress: address.formattedAddress,
            mobile: address.mobile,
            latitude,
            longitude
        },

        paymentMethod,
        paymentStatus: "pending",
        status: "placed",
        expiresAt,
    });


    res.json({
        message: "Order created successfully",
        orderId: order._id.toString(),
        amount: totalAmount,
    });
});


export const fetchOrderForPayment = TryCatch(async(req, res) => {
    if (req.headers["x-internal-key"]!== process.env.INTERNAL_SERVICE_KEY) {
        return res.status(403).json({
            message: "Forbidden",
        });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
        return res.status(404).json({
            message: "Order not found",
        });
    }

    if (order.paymentStatus !== "pending") {
        return res.status(400).json({
            message: "Order payment already processed",
        });
    }

    res.json({
        orderId: order._id,
        amount: order.totalAmount,
        currency: "INR",
    });  
});


export const fetchRestaurantOrders = TryCatch(async(req: AuthenticatedRequest, res) => {
    const user = req.user;

    const { restaurantId } = req.params;

    if(!user) {
        return res.status(401).json({
            message: "Unauthorized",
        });
    }

    if (!restaurantId) {
        return res.status(400).json({
            message: "Restaurant ID is required",
        });
    }

    const limit = req.query.limit ? Number(req.query.limit) : 0;

    const orders = await Order.find({ 
        restaurantId: restaurantId as string, 
        paymentStatus: "paid"
        }).sort({ createdAt: -1 }).limit(limit);

        return res.json({
        success: true,
        count: orders.length,
        orders,
        })
  }
);

const ALLOWED_STATUSES = ["accepted", "preparing", "ready_for_rider"] as const;


export const updateOrderStatus = TryCatch(async(req: AuthenticatedRequest, res) => {
    const user = req.user;

    const {orderId} = req.params;
    const {status} = req.body;

    if(!user) {
        return res.status(401).json({
            message: "Unauthorized",
        });
    }

    if(!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({
            message: "Invalid order status",
        });
    }

    const order = await Order.findById(orderId);

    if(!order) {
    return res.status(404).json({
        message: "Order not found",
      });
    }

    if(order.paymentStatus !== "paid") {
        return res.status(404).json({
            message: "Order not completed"
        });
   }

    const restaurant = await Restaurant.findById(order.restaurantId);

    if(!restaurant) {
        return res.status(404).json({
            message: "Restaurant not found",
        });
    }

    if(restaurant.ownerId !== user._id.toString()) {
        return res.status(401).json({
            message: "You are not allowed to update this order",
        });  
    }

    order.status = status;
    await order.save();

    try {
        await evaluateSmartOperations(order.restaurantId.toString());
    } catch (smartErr) {
        console.error("Failed to run smart operations evaluation:", smartErr);
    }

    // Notify user via realtime service (non-critical — don't fail the request)
    try {
        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`, {
            event:  "order:update",
            room: `user:${order.userId}`,
            payload: {
                orderId: order._id,
                status: order.status,
            },
        },{
            headers: {
                 "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
            },
           }
        );
        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`, {
            event:  `restaurant:${order.restaurantId}:analytics-update`,
            room: `restaurant:${order.restaurantId}`,
            payload: {
                orderId: order._id,
                status: order.status,
            },
        },{
            headers: {
                 "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
            },
           }
        );
        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`, {
            event:  "order:update",
            room: `restaurant:${order.restaurantId}`,
            payload: {
                orderId: order._id,
                status: order.status,
            },
        },{
            headers: {
                 "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
            },
           }
        );
    } catch (emitErr) {
        console.error("Failed to emit order:update to realtime service:", (emitErr as any)?.message);
    }


    // now assign riders
    if(status === "ready_for_rider") {
        console.log("Publishing Order ready for rider event for order",order._id);
        
        try {
            await publishEvent("ORDER_READY_FOR_RIDER", {
                orderId: order._id.toString(),
                restaurantId: restaurant._id.toString(),
                location: restaurant.autoLocation,
                userId: order.userId.toString(),
            });
            console.log("Event Published successfully");
        } catch (pubErr) {
            console.error("Failed to publish ORDER_READY_FOR_RIDER event:", (pubErr as any)?.message);
        }
        
    }

    res.json({
        message: "order status updated successfully",
        order,
    });

  }
);


export const getMyOrders = TryCatch(async (req: AuthenticatedRequest, res) => {

    if(!req.user) {
        return res.status(401).json({
            message: "Unauthorized",
        });
    }

    const order = await Order.find({
        userId: req.user._id.toString(),
        paymentStatus: "paid",
    }).sort({ createdAt: -1 });

    res.json({ success: true, orders: order, order });
});


export const fecthSingleOrder = TryCatch(async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
        return res.status(401).json({
            message: "Unauthorized",
        });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
        return res.status(404).json({
            message: "Order not found",
        });
    }    

    if (order.userId !== req.user._id.toString()) {
        return res.status(401).json({
            message: "You are not allowed to view this order",
        });
    }

    res.json({ order });

});


export const assignRiderToOrder = TryCatch(async (req, res) => {
      if (req.headers["x-internal-key"]!== process.env.INTERNAL_SERVICE_KEY) {
        return res.status(403).json({
            message: "Forbidden",
        });
    }
   
    const { orderId, riderId, riderName, riderImage, riderPhone } = req.body;

    const orderAvailable = await Order.findOne({ riderId, status: { $ne: "delivered" }});

    if(orderAvailable){
        return res.status(400).json({
            message: "You already have an order"
        });
    }

    const order = await Order.findById(orderId);

    if (order?.riderId !== null) {
        return res.status(400).json({
            message: "Order Already taken",
        });
    }

    const orderUpdated = await Order.findOneAndUpdate(
        {_id: orderId, riderId: null},
        {
            riderId,
            riderName,
            riderImage,
            riderPhone,
            status: "rider_assigned",
        },
        { new:  true }
    );

    // Notify via realtime (non-critical)
    try {
        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`,
        {
            event:  "order:rider_assigned",
            room: `user:${order.userId}`,
            payload: order,
        },
        {
            headers: {
                 "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
            },
           }
        );

        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`,
        {
            event:  "order:rider_assigned",
            room: `restaurant:${order.restaurantId}`,
            payload: order,
        },
        {
            headers: {
                 "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
            },
           }
        );
    } catch (emitErr) {
        console.error("Failed to emit rider_assigned to realtime service:", (emitErr as any)?.message);
    }

    res.json({
        message: "Rider Assigned Successfully",
        success: true,
        order: orderUpdated
    });
});


export const getCurrentOrderForRider = TryCatch(async (req, res) => {
      if (req.headers["x-internal-key"] !== process.env.INTERNAL_SERVICE_KEY) {
        return res.status(403).json({
            message: "Forbidden",
        });
    }
 
       const riderId = req.query.riderId;
       
       if(!riderId || typeof riderId !== "string") {
        return res.status(400).json({
            message: "Rider is is required",
        });
       }

       const order = await Order.findOne({
        riderId,
        status: { $ne: "delivered" },
       }).populate("restaurantId");
 
       if (!order) {
        return res.status(404).json({
            message: "Order not found",
        });
       }
       res.json(order);
});



export const updateOrderStatusRider = TryCatch(async (req, res) => {
     if (req.headers["x-internal-key"] !== process.env.INTERNAL_SERVICE_KEY) {
        return res.status(403).json({
            message: "Forbidden",
        });
    }

    const { orderId } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
        return res.status(404).json({
            message: "Order not found",
        });
    }

    if(order.status === "rider_assigned") {
        order.status = "picked_up";

        await order.save();

        try {
            await evaluateSmartOperations(order.restaurantId.toString());
        } catch (smartErr) {
            console.error("Failed to run smart operations evaluation:", smartErr);
        }

    try {
        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`,
            {
                event:  "order:rider_assigned",
                room: `restaurant:${order.restaurantId}`,
                payload: order,
            },
            {
                headers: {
                    "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                },
            }
         );

        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`,
            {
                event:  "order:update",
                room: `user:${order.userId}`,
                payload: order,
            },
            {
                headers: {
                    "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                },
            }
          );

        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`,
            {
                event:  `restaurant:${order.restaurantId}:analytics-update`,
                room: `restaurant:${order.restaurantId}`,
                payload: order,
            },
            {
                headers: {
                    "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                },
            }
          );
    } catch (emitErr) {
        console.error("Failed to emit picked_up to realtime service:", (emitErr as any)?.message);
    }

     return res.json({
        message: "Order updated successfully"
     })

    } 

    if (order.status === "picked_up") {
          order.status = "delivered";

          await order.save();

          try {
              await evaluateSmartOperations(order.restaurantId.toString());
          } catch (smartErr) {
              console.error("Failed to run smart operations evaluation:", smartErr);
          }

    try {
        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`,
            {
                event:  "order:update",
                room: `restaurant:${order.restaurantId}`,
                payload: order,
            },
            {
                headers: {
                    "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                },
            }
         );

        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`,
            {
                event:  "order:update",
                room: `user:${order.userId}`,
                payload: order,
            },
            {
                headers: {
                    "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                },
            }
          );

        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`,
            {
                event:  `restaurant:${order.restaurantId}:analytics-update`,
                room: `restaurant:${order.restaurantId}`,
                payload: order,
            },
            {
                headers: {
                    "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                },
            }
          );
    } catch (emitErr) {
        console.error("Failed to emit delivered to realtime service:", (emitErr as any)?.message);
    }

     return res.json({
        message: "Order updated successfully"
     })


    }

});


// ── Analytics Endpoint: Comprehensive Restaurant Performance Data ──
export const getRestaurantAnalytics = TryCatch(async(req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { restaurantId } = req.params;
    const { lat, lng } = req.query;

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant || restaurant.ownerId !== user._id.toString()) {
        return res.status(403).json({ message: "Unauthorized restaurant access" });
    }

    // Fetch all paid orders
    const orders = await Order.find({ 
        restaurantId: restaurantId as string, 
        paymentStatus: "paid"
    }).sort({ createdAt: -1 });

    // Calculate analytics
    const totalOrders = orders.length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const todayOrders = orders.filter(o => new Date(o.createdAt) >= todayStart);
    const todayRevenue = todayOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    const totalSales = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    const averageOrderValue = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;

    const acceptanceRate = totalOrders > 0 
        ? Math.round(((totalOrders - orders.filter(o => o.status === "cancelled").length) / totalOrders) * 100)
        : 100;

    const activeOrders = orders.filter(o => !["delivered", "cancelled"].includes(o.status)).length;
    const estimatedPrepTime = activeOrders > 5 ? 45 : activeOrders > 2 ? 35 : 25;
    const kitchenLoad = activeOrders > 5 ? "⚠️ Overloaded" : activeOrders > 2 ? "Moderate" : "Light";

    // Health Score
    const healthScore = Math.max(50, Math.min(100, 100 - (orders.filter(o => o.status === "cancelled").length / Math.max(1, totalOrders) * 100)));

    // 7-Day chart data
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const chartData = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toDateString();
        const dayRevenue = orders
            .filter(o => new Date(o.createdAt).toDateString() === dateStr)
            .reduce((sum, o) => sum + o.totalAmount, 0);
        
        chartData.push({
            day: days[d.getDay()],
            date: d.toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
            amount: dayRevenue
        });
    }

    // Item Craze (Trending Items)
    const itemCounts: Record<string, { count: number; revenue: number }> = {};
    orders.forEach(o => {
        if (o.status !== "cancelled" && o.items) {
            o.items.forEach((item: any) => {
                const name = item.name || "Unknown Item";
                if (!itemCounts[name]) itemCounts[name] = { count: 0, revenue: 0 };
                itemCounts[name]!.count += (item.quantity || 1);
                itemCounts[name]!.revenue += ((item.price || 0) * (item.quantity || 1));
            });
        }
    });
    
    const trendingItems = Object.entries(itemCounts)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([name, data]) => ({ name, sales: data.count, revenue: data.revenue }));

    // AI Recommendations
    const recommendations = [];
    
    if (acceptanceRate < 80) {
        recommendations.push({
            id: "low_acceptance",
            type: "alert",
            title: "Low Acceptance Rate",
            description: `Your acceptance rate is ${acceptanceRate}%. Improve by optimizing prep time and inventory.`,
            impact: "high"
        });
    }

    if (activeOrders > 5) {
        recommendations.push({
            id: "high_load",
            type: "alert",
            title: "High Kitchen Load",
            description: `${activeOrders} active orders detected. Consider increasing prep staff or adjusting to "accepting only" mode.`,
            impact: "high"
        });
    }

    if (todayRevenue > averageOrderValue * 10) {
        recommendations.push({
            id: "strong_sales",
            type: "opportunity",
            title: "Strong Sales Today",
            description: `Today's revenue is running 50% above average! Maintain momentum and ensure quality.`,
            impact: "medium"
        });
    }

    if (averageOrderValue < 300) {
        recommendations.push({
            id: "low_aov",
            type: "insight",
            title: "Increase Average Order Value",
            description: `Current AOV is ₹${averageOrderValue}. Create combo offers to increase basket size.`,
            impact: "medium"
        });
    }

    res.json({
        success: true,
        analytics: {
            totalOrders,
            todayRevenue,
            todayOrders: todayOrders.length,
            averageOrderValue,
            acceptanceRate,
            healthScore,
            kitchenLoad,
            estimatedPrepTime,
            activeOrders,
            chartData,
            trendingItems
        },
        recommendations,
        restaurantLocation: restaurant.autoLocation ? {
            lat: restaurant.autoLocation.coordinates[1],
            lng: restaurant.autoLocation.coordinates[0]
        } : null
    });
});export const rateRestaurant = TryCatch(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const { orderId } = req.params;
    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== user._id.toString()) return res.status(401).json({ message: "Unauthorized" });

    order.restaurantRating = rating;
    order.restaurantFeedback = feedback;
    await order.save();

      try {
          await axios.post("http://localhost:5004/api/v1/internal/emit", {
              event: "order:rated:restaurant",
              room: `restaurant:${order.restaurantId}`,
              payload: order
          }, {
              headers: { "x-internal-key": process.env.INTERNAL_SERVICE_KEY }
          });

            // Emit to global feed
            await axios.post("http://localhost:5004/api/v1/internal/emit", {
                event: "feed:new_review",
                room: "global",
                payload: {
                    _id: order._id,
                    customerName: user.name || "Food Lover",
                    customerImage: user.image || "",
                    location: order.deliveryAddress?.formattedAddress || "Unknown Location",
                    restaurantName: order.restaurantName,
                    restaurantRating: order.restaurantRating,
                    restaurantFeedback: order.restaurantFeedback,
                    riderName: order.riderName || "Rider",
                    riderImage: order.riderImage || "",
                    riderRating: order.riderRating,
                    riderFeedback: order.riderFeedback,
                    items: order.items,
                    createdAt: new Date()
                }
            }, {
              headers: { "x-internal-key": process.env.INTERNAL_SERVICE_KEY }
          });
      } catch (err) {
          console.error("Failed to emit rating to restaurant", err);
      }

    res.json({ success: true, message: "Restaurant rated successfully", order });
});

export const rateRider = TryCatch(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const { orderId } = req.params;
    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== user._id.toString()) return res.status(401).json({ message: "Unauthorized" });

    order.riderRating = rating;
    order.riderFeedback = feedback;
    await order.save();

      try {
          await axios.post("http://localhost:5004/api/v1/internal/emit", {
              event: "order:rated:rider",
              room: `rider:${order.riderId}`,
              payload: order
          }, {
              headers: { "x-internal-key": process.env.INTERNAL_SERVICE_KEY }
          });

            // Emit to global feed
            await axios.post("http://localhost:5004/api/v1/internal/emit", {
                event: "feed:new_review",
                room: "global",
                payload: {
                    _id: order._id,
                    customerName: user.name || "Food Lover",
                    customerImage: user.image || "",
                    location: order.deliveryAddress?.formattedAddress || "Unknown Location",
                    restaurantName: order.restaurantName,
                    restaurantRating: order.restaurantRating,
                    restaurantFeedback: order.restaurantFeedback,
                    riderName: order.riderName || "Rider",
                    riderImage: order.riderImage || "",
                    riderRating: order.riderRating,
                    riderFeedback: order.riderFeedback,
                    items: order.items,
                    createdAt: new Date()
                }
            }, {
              headers: { "x-internal-key": process.env.INTERNAL_SERVICE_KEY }
          });
      } catch (err) {
          console.error("Failed to emit rating to rider", err);
      }

    res.json({ success: true, message: "Rider rated successfully", order });
});
export const getRiderAnalytics = TryCatch(async (req: AuthenticatedRequest, res) => {
    const { riderId } = req.params;
    
    // Fetch completed orders for this rider
    const orders = await Order.find({
        riderId,
        status: "delivered",
        riderRating: { $exists: true }
    } as any).sort({ createdAt: -1 });

    const totalRatings = orders.length;
    const averageRating = totalRatings > 0 
        ? orders.reduce((sum, o) => sum + (o.riderRating || 0), 0) / totalRatings 
        : 0;

    const recentFeedback = orders
        .filter(o => o.riderFeedback)
        .slice(0, 10)
        .map(o => ({
            rating: o.riderRating,
            feedback: o.riderFeedback,
            date: o.createdAt
        }));

    res.json({
        success: true,
        totalRatings,
        averageRating: averageRating.toFixed(1),
        recentFeedback
    });
});

export const getLiveFeed = TryCatch(async (req: Request, res) => {
    // Fetch last 20 orders with a rating
    const orders = await Order.find({
        $or: [
            { restaurantRating: { $exists: true } },
            { riderRating: { $exists: true } }
        ]
    })
    .sort({ updatedAt: -1 })
    .limit(20);

    const feedItems = orders.map(order => ({
        _id: order._id,
        customerName: order.customerName || "Food Lover",
        customerImage: order.customerImage || "",
        location: order.deliveryAddress?.formattedAddress || "Unknown Location",
        restaurantName: order.restaurantName,
        restaurantRating: order.restaurantRating,
        restaurantFeedback: order.restaurantFeedback,
        riderName: order.riderName || "Rider",
        riderImage: order.riderImage || "",
        riderRating: order.riderRating,
        riderFeedback: order.riderFeedback,
        items: order.items,
        createdAt: order.updatedAt
    }));

    res.json({
        success: true,
        feed: feedItems
    });
});
