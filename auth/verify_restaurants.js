import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("MONGO_URI not found in env");
  process.exit(1);
}

async function run() {
  try {
    await mongoose.connect(MONGO_URI, {
      dbName: "Zomato_Clone",
    });
    console.log("Connected to DB");

    const res = await mongoose.connection.db.collection("restaurants").updateMany(
      {},
      { $set: { isVerified: true } }
    );
    console.log("Verified all restaurants. Update result:", res);

    const restaurants = await mongoose.connection.db.collection("restaurants").find({}).toArray();
    console.log("Current Restaurants in DB:");
    console.log(JSON.stringify(restaurants, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
