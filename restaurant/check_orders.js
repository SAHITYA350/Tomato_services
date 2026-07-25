import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const OrderSchema = new mongoose.Schema({}, { strict: false });
const Order = mongoose.model("Order", OrderSchema);

const RestaurantSchema = new mongoose.Schema({}, { strict: false });
const Restaurant = mongoose.model("Restaurant", RestaurantSchema);

async function check() {
    try {
        await mongoose.connect(process.env.MONGO_URI, { dbName: "Zomato_Clone" });
        console.log("Connected to MongoDB Zomato_Clone!");

        const restaurants = await Restaurant.find({});
        console.log("\n--- Restaurants in Zomato_Clone ---");
        restaurants.forEach(r => {
            console.log(`Name: "${r.get('name')}", ID: ${r._id}, OwnerID: ${r.get('ownerId')}`);
        });

        const orders = await Order.find({});
        console.log("\n--- Orders in Zomato_Clone ---");
        console.log(`Total orders: ${orders.length}`);
        orders.forEach(o => {
            console.log(`Order ID: ${o._id}, Restaurant: "${o.get('restaurantName')}" (ID: ${o.get('restaurantId')}), Status: ${o.get('status')}, PaymentStatus: ${o.get('paymentStatus')}`);
        });

        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

check();
