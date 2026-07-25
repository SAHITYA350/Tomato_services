import axios from "axios";
import { Response } from "express";
import getBuffer from "../config/datauri.js";
import { AuthenticatedRequest } from "../middlewares/isAuth.js";
import TryCatch from "../middlewares/trycatch.js";
import Restaurant from "../models/Restaurant.js";
import Order from "../models/Order.js";
import jwt, { JwtPayload } from "jsonwebtoken";
import dotenv from "dotenv";
import { redisClient } from "../config/redis.js";
dotenv.config();

export const addRestaurant = TryCatch(async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user;
    if(!user) {
        return res.status(401).json({message: "Unauthorized, Please Login."});
    }

    const existingRestaurant = await Restaurant.findOne({
        ownerId: user._id,
    });

    if(existingRestaurant) {
        return res.status(400).json({message: "Your restaurant already exists."});
    }

    const { name, description, latitude, longitude, formattedAddress, phone } = req.body;

    if (!name || !latitude || !longitude) {
        return res.status(400).json({
            message: "Please provide all the required fields.",
        });
    }

    const file = req.file;
    if (!file) {
        return res.status(400).json({
            message: "Please provide image.",
        });
    }

    const fileBuffer = getBuffer(file);

    if (!fileBuffer?.content) {
        return res.status(500).json({
            message: "Error while uploading image.",
        });
    }

    let uploadResult;
    try {
        const response = await axios.post(`${process.env.UTILS_SERVICE}/api/upload`, {
            buffer: fileBuffer.content,
        });
        uploadResult = response.data;
    } catch (error: any) {
        console.error("Image upload failed in addRestaurant:", error.response?.data || error.message);
        return res.status(500).json({
            message: `Error uploading image to service: ${error.response?.data?.message || error.message}`,
        });
    }

    const restaurant = await Restaurant.create({
        name,
        description,
        phone,
        image: uploadResult.url,
        ownerId: user._id,
        autoLocation: {
            type: "Point",
            coordinates: [Number(longitude), Number(latitude)],
            formattedAddress,
        },
        isVerified: false,
    });

    return res.status(201).json({
        message: "Restaurant created successfully.",
        restaurant,
    });
});


export const fetchMyRestaurant = TryCatch(async (req:AuthenticatedRequest, res:Response) => {
    if(!req.user) {
        return res.status(401).json({message: "Unauthorized, Please Login."});
    }

    const restaurant = await Restaurant.findOne({ ownerId: req.user._id })

    if(!restaurant) {
                return res.status(400).json({message: "No Restaurant found."});
    }

    if(!req.user.restaurantId) {
         const token = jwt.sign(
          {
            user: {
                ...req.user,
                restaurantId: restaurant._id
            },
          },
           process.env.JWT_SECRET as string, {
           expiresIn: "15d"
          }
        );
        return res.status(200).json({
            message: "Restaurant fetched successfully.",
            restaurant,
            token
        });
    }

   res.json({ restaurant });

  }
);



export const updateStatusRestaurant = TryCatch(async (req:AuthenticatedRequest, res:Response) => {
    if(!req.user) {
        return res.status(403).json({
            message: "Please login",
        });
    }

    const {status} = req.body;
    if(typeof status !== "boolean") {
        return res.status(400).json({
            message: "Status must be a boolean value.",
        });
    }

    const restaurant = await Restaurant.findOneAndUpdate(
        {
            ownerId: req.user._id,
        },
        { isOpen: status },
        { new: true } 
    );

    if(!restaurant) {
      return res.status(404).json({message: "Restaurant not found."});  
    }

    // Notify via realtime (non-critical)
    try {
        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`, {
            event: "restaurant:status",
            room: "global",
            payload: {
                restaurantId: restaurant._id.toString(),
                isOpen: restaurant.isOpen,
            },
        }, {
            headers: {
                 "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
            },
        });
    } catch (emitErr) {
        console.error("Failed to emit restaurant:status to realtime service:", (emitErr as any)?.message);
    }

    res.json({
        message: `Restaurant ${status ? "opened" : "closed"}.`,
        restaurant,
    });
  }
);



export const updateRestaurant = TryCatch(async(req: AuthenticatedRequest, res: Response) => {
  
    if(!req.user) {
        return res.status(403).json({
            message: "Please login",
        });
    }

    const { name, description } = req.body;
    const updateData: any = { name, description };

    if (req.file) {
        const fileBuffer = getBuffer(req.file);
        if (fileBuffer?.content) {
            try {
                const response = await axios.post(`${process.env.UTILS_SERVICE}/api/upload`, {
                    buffer: fileBuffer.content,
                });
                updateData.image = response.data.url;
            } catch (error: any) {
                console.error("Image upload failed in updateRestaurant:", error.response?.data || error.message);
                return res.status(500).json({
                    message: `Error uploading image to service: ${error.response?.data?.message || error.message}`,
                });
            }
        }
    }
  
    const restaurant = await Restaurant.findOneAndUpdate(
        {ownerId: req.user._id},
        updateData,
        { new: true }
    )

    if(!restaurant) {
      return res.status(404).json({message: "Restaurant not found."});  
    }

    try {
        await redisClient.del(`restaurant:${restaurant._id}`);
        // For nearby cache we could flushall or let TTL handle it. 
        // TTL is 5m, so it's acceptable for nearby search to be slightly stale.
    } catch(err) {}

    res.json({
        message: "Restaurant updated successfully.",
        restaurant,
    });
      
})



export const getNearbyRestaurant = TryCatch(async (req, res) => {
     const { latitude, longitude, radius = 500000, search = "" } = req.query; // 500km radius for testing

     if(!latitude || !longitude) {
        return res.status(400).json({
            message: "Latitude and longitude are required.",
        });
      }

    // Attempt to fetch from Redis Cache
    const latGrid = Number(latitude).toFixed(2);
    const lngGrid = Number(longitude).toFixed(2);
    const searchSafe = String(search).toLowerCase().trim();
    const cacheKey = `restaurants:nearby:${latGrid}:${lngGrid}:${radius}:${searchSafe}`;
    
    try {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));
    } catch (err) {
        // Ignore cache errors to fallback to DB
    }

    const query: any = {}

    if(search && typeof search === "string"){
         query.name = { $regex: search , $options : "i"}
    }

    const restaurants = await Restaurant.aggregate([
        {
         $geoNear: {
            near: {
                type: "Point", 
                coordinates : [Number(longitude), Number(latitude)]
            },
            distanceField: "distance",
            maxDistance: Number(radius),
            spherical: true,
            query
        }
      }, 
      {
         $sort: {
            isOpen: -1,
            distance: 1
         }
      },
      {
        $addFields: {
            distanceKm: {
                $round : [{$divide: ["$distance", 1000]}, 2],
           },
         },
       },
    ]);

    const responseData = {
        success: true,
        count: restaurants.length,
        restaurants,
    };

    try {
        // Cache for 5 minutes (300s)
        await redisClient.set(cacheKey, JSON.stringify(responseData), "EX", 300);
    } catch (err) { }

    res.json(responseData);
});



export const fetchSingleRestaurant = TryCatch(async (req, res) => {
    const cacheKey = `restaurant:${req.params.id}`;
    
    try {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));
    } catch (err) {}

    const restaurant = await Restaurant.findById(req.params.id);
    
    if (restaurant) {
        try {
            await redisClient.set(cacheKey, JSON.stringify(restaurant), "EX", 600); // 10 minutes
        } catch (err) {}
    }
    
    res.json(restaurant);
});

export const evaluateSmartOperations = async (restaurantId: string) => {
    try {
        const restaurant = await Restaurant.findById(restaurantId);
        if (!restaurant || !restaurant.isSmartMode) return;

        // Fetch active orders (non-final statuses)
        const activeOrdersCount = await Order.countDocuments({
            restaurantId,
            status: { $in: ["placed", "accepted", "preparing", "ready_for_rider", "rider_assigned", "picked_up"] }
        });

        let shouldClose = false;
        let reason = "";

        if (activeOrdersCount > 5) {
            shouldClose = true;
            reason = `Kitchen overloaded (${activeOrdersCount} active orders, threshold is 5)`;
        }

        // Auto close if kitchen overloaded and currently open
        if (shouldClose && restaurant.isOpen) {
            restaurant.isOpen = false;
            await restaurant.save();
            console.log(`[Smart Auto Mode] Auto-closed restaurant ${restaurant.name} due to: ${reason}`);

            // Emit to realtime service
            try {
                await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`, {
                    event: "restaurant:status",
                    room: "global",
                    payload: {
                        restaurantId: restaurant._id.toString(),
                        isOpen: false,
                        smartReason: reason
                    },
                }, {
                    headers: {
                         "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                    },
                });
            } catch (emitErr) {
                console.error("Failed to emit smart status to realtime service:", (emitErr as any)?.message);
            }
        }
        // Auto open if operational parameters normal and was closed
        else if (!shouldClose && !restaurant.isOpen) {
            restaurant.isOpen = true;
            await restaurant.save();
            console.log(`[Smart Auto Mode] Auto-opened restaurant ${restaurant.name} (Kitchen load resolved: ${activeOrdersCount} active orders)`);

            // Emit to realtime service
            try {
                await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`, {
                    event: "restaurant:status",
                    room: "global",
                    payload: {
                        restaurantId: restaurant._id.toString(),
                        isOpen: true,
                        smartReason: "Kitchen load resolved"
                    },
                }, {
                    headers: {
                         "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
                    },
                });
            } catch (emitErr) {
                console.error("Failed to emit smart status to realtime service:", (emitErr as any)?.message);
            }
        }
    } catch (error) {
        console.error("Error in evaluateSmartOperations:", error);
    }
};

export const updateSmartModeRestaurant = TryCatch(async (req: AuthenticatedRequest, res: Response) => {
    if(!req.user) {
        return res.status(403).json({
            message: "Please login",
        });
    }

    const { isSmartMode } = req.body;
    if(typeof isSmartMode !== "boolean") {
        return res.status(400).json({
            message: "isSmartMode must be a boolean value.",
        });
    }

    const restaurant = await Restaurant.findOneAndUpdate(
        { ownerId: req.user._id },
        { isSmartMode },
        { new: true }
    );

    if(!restaurant) {
      return res.status(404).json({message: "Restaurant not found."});  
    }

    // Evaluate operations immediately when toggling on
    if (isSmartMode) {
        await evaluateSmartOperations(restaurant._id.toString());
    }

    // Fetch the updated state of restaurant after potentially auto-opening/closing
    const updatedRestaurant = await Restaurant.findById(restaurant._id);

    res.json({
        message: `Smart Auto Mode ${isSmartMode ? "enabled" : "disabled"}.`,
        restaurant: updatedRestaurant,
    });
});

export const getTrendingItems = TryCatch(async (req, res) => {
    const cacheKey = "trending:items";
    try {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));
    } catch (e) {}

    const trending = [
        { id: "1", name: "Butter Chicken", price: 299, image: "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500" },
        { id: "2", name: "Chicken Biryani", price: 199, image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=500" },
        { id: "3", name: "Paneer Tikka", price: 249, image: "https://images.unsplash.com/photo-1567188040759-bf8d7febe1ce?w=500" },
        { id: "4", name: "Masala Dosa", price: 99, image: "https://images.unsplash.com/photo-1668236543090-82eba5ee5976?w=500" },
        { id: "5", name: "Chocolate Brownie", price: 120, image: "https://images.unsplash.com/photo-1606890737304-57a1ca8a5b62?w=500" }
    ];

    try {
        await redisClient.set(cacheKey, JSON.stringify(trending), "EX", 300);
    } catch(e) {}
    
    res.json(trending);
});

export const getSearchAutocomplete = TryCatch(async (req, res) => {
    const query = req.query.q as string || "";
    if (!query) return res.json([]);
    
    const cacheKey = `autocomplete:${query.toLowerCase().trim()}`;
    try {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));
    } catch (e) {}

    const items = ["Pizza", "Pasta", "Paneer Butter Masala", "Burger", "Biryani", "Rolls", "Momos", "Noodles", "Manchurian", "Butter Chicken", "Dosa", "Idli", "Samosa", "Ice Cream"];
    const suggestions = items.filter(i => i.toLowerCase().includes(query.toLowerCase().trim()));

    try {
        await redisClient.set(cacheKey, JSON.stringify(suggestions), "EX", 300);
    } catch(e) {}

    res.json(suggestions);
});