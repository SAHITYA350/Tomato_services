import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const connStr = process.env.MONGO_URI;

async function printOrders() {
    try {
        await mongoose.connect(connStr, { dbName: "Zomato_Clone" });
        const Order = mongoose.model("Order", new mongoose.Schema({}, { strict: false }));
        const orders = await Order.find({}).sort({ createdAt: -1 });
        console.log("Total Orders:", orders.length);
        orders.forEach(o => {
            console.log(`ID: ${o._id}`);
            console.log(`  Restaurant: ${o.get('restaurantName')}`);
            console.log(`  User ID: ${o.get('userId')}`);
            console.log(`  Total: ${o.get('totalAmount')}`);
            console.log(`  Payment Method: ${o.get('paymentMethod')}`);
            console.log(`  Payment Status: ${o.get('paymentStatus')}`);
            console.log(`  Status: ${o.get('status')}`);
            console.log(`  Created At: ${o.get('createdAt')}`);
            console.log(`  Items:`, JSON.stringify(o.get('items'), null, 2));
        });
        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

printOrders();
