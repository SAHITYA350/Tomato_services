import axios from "axios";
import { AuthenticatedRequest } from "../middlewares/isAuth.js";
import TryCatch from "../middlewares/trycatch.js";
import Restaurant from "../models/Restaurant.js";
import getBuffer from "../config/datauri.js";
import MenuItems from "../models/MenuItems.js";
import { redisClient } from "../config/redis.js";
export const addMenuItem = TryCatch(async (req: AuthenticatedRequest, res) => {
  if(!req.user) {
    return res.status(401).json({
        message: "Please Login",
    })
  }

  const restaurant = await Restaurant.findOne({ ownerId: req.user._id });

  if(!restaurant) {
    return res.status(404).json({
        message: "No Restaurant found"
     });
  }

  const { name, description, price } = req.body;

  if(!name || !price) {
    return res.status(400).json({
        message: "Name and Price are required",
    })
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
        console.error("Image upload failed in addItem:", error.response?.data || error.message);
        return res.status(500).json({
            message: `Error uploading image to service: ${error.response?.data?.message || error.message}`,
        });
    }
   
    const item = await MenuItems.create({
        name,
        description,
        price,
        restaurantId: restaurant._id,
        image: uploadResult.url,
    })

    try {
        await redisClient.del(`menu:${restaurant._id}`);
    } catch (err) {}

    res.json({
        message: "Menu Item added successfully",
        item,
    });

});


export const getAllItems = TryCatch(async (req: AuthenticatedRequest, res) => {
    const {id} = req.params;
    if(!id) {
        return res.status(400).json({
            message: "Id is required",
        });
    }

    const cacheKey = `menu:${id}`;
    try {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));
    } catch(err) {}

    const items = await MenuItems.find({ restaurantId: id });
    
    try {
        await redisClient.set(cacheKey, JSON.stringify(items), "EX", 600); // 10 minutes cache
    } catch (err) {}

    res.json(items);
});



export const deleteMenuItem = TryCatch(async (req: AuthenticatedRequest, res) => {

     if(!req.user) {
    return res.status(401).json({
        message: "Please Login",
    })
  }

  const {itemId} = req.params;
    if(!itemId) {
        return res.status(400).json({
            message: "Id is required",
        });
    }

    const item = await MenuItems.findById(itemId);
    
    if (!item){
        return res.status(404).json({
            message: "No item found",
        });
     }

    const restaurant = await Restaurant.findOne({
        _id: item.restaurantId,
        ownerId: req.user._id,
    });

    if(!restaurant) {
       return res.status(404).json({
            message: "No restaurant found",
        });
    }

    await item.deleteOne();

    try {
        await redisClient.del(`menu:${item.restaurantId}`);
    } catch (err) {}

    res.json({
        message: "Menu Item deleted successfully"
    });

   }
);



export const toggleMenuItemAvailability = TryCatch(async (req: AuthenticatedRequest, res) => {
     
    if(!req.user) {
    return res.status(401).json({
        message: "Please Login",
    })
  }

  const {itemId} = req.params;
    if(!itemId) {
        return res.status(400).json({
            message: "Id is required",
        });
    }

    const item = await MenuItems.findById(itemId);
    
    if (!item){
        return res.status(404).json({
            message: "No item found",
        });
     }

    const restaurant = await Restaurant.findOne({
        _id: item.restaurantId,
        ownerId: req.user._id,
    });

    if(!restaurant) {
       return res.status(404).json({
            message: "No restaurant found",
        });
    }  

    item.isAvailable = !item.isAvailable;
    await item.save();

    try {
        await redisClient.del(`menu:${item.restaurantId}`);
    } catch (err) {}

    // Notify via realtime (non-critical)
    try {
        await axios.post(`${process.env.REALTIME_SERVICE}/api/v1/internal/emit`, {
            event: "item:status",
            room: "global",
            payload: {
                itemId: item._id.toString(),
                restaurantId: item.restaurantId.toString(),
                isAvailable: item.isAvailable,
            },
        }, {
            headers: {
                 "x-internal-key": process.env.INTERNAL_SERVICE_KEY,
            },
        });
    } catch (emitErr) {
        console.error("Failed to emit item:status to realtime service:", (emitErr as any)?.message);
    }

    res.json({
        message: `Item marked as ${
        item.isAvailable ? "available" : "unavailable"
        }`,
        item,
    });

});