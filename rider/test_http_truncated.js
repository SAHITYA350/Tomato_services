import mongoose from "mongoose";
import axios from "axios";

const MONGO_URI = "mongodb+srv://sahityaghosh350_db_user:kL8lT9hrpakcSm30@clusterzomato.ddxoncr.mongodb.net/?appName=Clusterzomato";
const RESTAURANT_SERVICE = "http://localhost:5001";
const INTERNAL_KEY = "jdfienf1234567@@@@";

async function run() {
  await mongoose.connect(MONGO_URI, { dbName: "Zomato_Clone" });
  console.log("Connected to database");

  const orderColl = mongoose.connection.db.collection("orders");
  const testOrder = {
    userId: "test-user-id",
    restaurantId: "test-restaurant-id",
    restaurantName: "Test Restaurant",
    riderId: "test-rider-id",
    distance: 2.5,
    riderAmount: 50,
    items: [],
    subtotal: 100,
    deliveryFee: 49,
    platformFee: 7,
    totalAmount: 156,
    addressId: "test-address-id",
    deliveryAddress: {
      formattedAddress: "Test Address",
      mobile: 1234567890,
      latitude: 0,
      longitude: 0
    },
    paymentMethod: "stripe",
    paymentStatus: "paid",
    status: "rider_assigned",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const insertResult = await orderColl.insertOne(testOrder);
  const orderId = insertResult.insertedId.toString();
  console.log("Created test order with ID:", orderId, "status:", testOrder.status);

  try {
    console.log("Calling restaurant service status update endpoint...");
    const response = await axios.put(`${RESTAURANT_SERVICE}/api/order/update/status/rider`, {
      orderId: orderId
    }, {
      headers: {
        "x-internal-key": INTERNAL_KEY
      }
    });

    console.log("Restaurant response status:", response.status);
    console.log("Restaurant response data:", response.data);

    const orderDoc = await orderColl.findOne({ _id: insertResult.insertedId });
    console.log("Order status after update 1:", orderDoc.status);

  } catch (error) {
    console.error("Request failed:", error.response ? error.response.data : error.message);
  } finally {
    await orderColl.deleteOne({ _id: insertResult.insertedId });
    console.log("Cleaned up test order");
  }

  await mongoose.disconnect();
}

run().catch(console.error);
