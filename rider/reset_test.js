import mongoose from "mongoose";

const MONGO_URI = "mongodb+srv://sahityaghosh350_db_user:kL8lT9hrpakcSm30@clusterzomato.ddxoncr.mongodb.net/?appName=Clusterzomato";

async function run() {
  await mongoose.connect(MONGO_URI, { dbName: "Zomato_Clone" });
  console.log("Connected to database Zomato_Clone");

  // 1. Find user by role "rider"
  const user = await mongoose.connection.db.collection("users").findOne({ role: "rider" });
  if (!user) {
    console.error("No rider user found!");
    await mongoose.disconnect();
    return;
  }

  // 2. Delete rider profile
  const deleteResult = await mongoose.connection.db.collection("riders").deleteOne({ userId: user._id.toString() });
  console.log(`Deleted rider profile: matched ${deleteResult.deletedCount} document(s)`);

  // 3. Reset active orders
  const resetResult = await mongoose.connection.db.collection("orders").updateMany(
    { riderId: { $ne: null } },
    {
      $set: {
        riderId: null,
        riderName: null,
        riderPhone: null,
        status: "ready_for_rider"
      }
    }
  );
  console.log(`Reset active orders: matched ${resetResult.matchedCount} order(s), modified ${resetResult.modifiedCount} order(s)`);

  await mongoose.disconnect();
  console.log("Database reset completed successfully!");
}

run().catch(console.error);
