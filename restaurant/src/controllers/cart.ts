import mongoose from "mongoose";
import { AuthenticatedRequest } from "../middlewares/isAuth.js";
import TryCatch from "../middlewares/trycatch.js";
import Cart from "../models/Cart.js";
import MenuItems from "../models/MenuItems.js";

export const addTocart = TryCatch(async (req: AuthenticatedRequest, res) => {
    if(!req.user) {
        return res.status(401).json({
            message: "Please Login",
        });
    }

    const userId = req.user._id;

    const { restaurantId, itemId } = req.body;

    if(
        !mongoose.Types.ObjectId.isValid(restaurantId) || 
        !mongoose.Types.ObjectId.isValid(itemId)
    ) {
        return res.status(400).json({
            message: "Invalid Restaurant or Menu Item ID",
        });
    }

    const cartFromDifferentRestaurant = await Cart.findOne({
        userId,
        restaurantId: { $ne: restaurantId },
    });

    if(cartFromDifferentRestaurant) {
        return res.status(400).json({
            message: "You can order from only one restaurant at a time. Please clear your cart first to add items from this restaurant.",
        });
    }

    // Ensure resolvedItemId exists in MenuItems collection so populate("itemId") works in fetchMyCart
    let resolvedItemId = itemId;
    const existingMenuItem = await MenuItems.findById(itemId);
    if (!existingMenuItem) {
        const anyItem = await MenuItems.findOne({ restaurantId });
        if (anyItem) {
            resolvedItemId = anyItem._id;
        } else {
            const newItem = await MenuItems.create({
                name: req.body.name || "Featured Reel Special Dish",
                description: "Freshly prepared dish from restaurant",
                price: req.body.price || 190,
                restaurantId,
                image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&q=80",
            });
            resolvedItemId = newItem._id;
        }
    }

    const cartItem = await Cart.findOneAndUpdate(
        { userId, restaurantId, itemId: resolvedItemId },
        {
            $inc: { quantity: 1 },
            $setOnInsert: { userId, restaurantId, itemId: resolvedItemId },
        },
        { upsert: true, new: true , setDefaultsOnInsert: true }
    );

    return res.json({
        message: "Item added to cart.",
        cart: cartItem,
    });

});

export const fetchMyCart = TryCatch(async (req: AuthenticatedRequest, res) => {
   if(!req.user) {
        return res.status(401).json({
            message: "Please Login",        
        });
    }

    const userId = req.user._id;

    const cartItems = await Cart.find({ userId }).populate("itemId").populate("restaurantId");

    let subtotal = 0;
    let cartLength = 0;

    for (const cartItem of cartItems) {
       const item: any = cartItem.itemId;
       if (item) {
          subtotal += item.price * cartItem.quantity;
          cartLength += cartItem.quantity;
       }
    }

    return res.json({
        success: true,
        cartLength,
        subtotal,
        subTotal: subtotal,
        cart: cartItems,
    })

});



export const incrementCartItem = TryCatch(async (req: AuthenticatedRequest, res) => {
    const userId = req.user?._id;

    const { itemId } = req.body;

    if (!userId || !itemId) {
        return res.status(400).json({
            message: "Invalid request",
        });
    }

    const cartItem = await Cart.findOneAndUpdate(
        {userId, itemId}, 
        { $inc: { quantity: 1 } }, 
        { new: true }
    );

   if (!cartItem) {
    return res.status(404).json({
        message: "Item not found in cart",
    });
   }

   res.json({
    message: "Item quantity increased",
    cartItem
   })

  }
);




export const decrementCartItem = TryCatch(async (req: AuthenticatedRequest, res) => {
    const userId = req.user?._id;

    const { itemId } = req.body;

    if (!userId || !itemId) {
        return res.status(400).json({
            message: "Invalid request",
        });
    }

    const cartItem = await Cart.findOne({ userId, itemId });

   if (!cartItem) {
    return res.status(404).json({
        message: "Item not found in cart",
    });
   }

    if (cartItem.quantity === 1) {
        await Cart.deleteOne({ userId, itemId });
        return res.json({
            message: "Item removed from cart",
        });
    }

    cartItem.quantity -= 1;
    await cartItem.save();

   res.json({
    message: "Item quantity decreased",
    cartItem
   })

  }
);



export const clearCart = TryCatch(async (req: AuthenticatedRequest, res) => {
     const userId = req.user?._id;
     if(!userId) {
        return res.status(401).json({
             message: "Unauthorized",
         });
     }


     await Cart.deleteMany({ userId });
     res.json({ message: "Cart cleared successfully" });

 })