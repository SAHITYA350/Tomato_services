import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./dist/model/User.js"; // note: since the codebase compiles to JS in dist

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

    const users = await mongoose.connection.db.collection("users").find({}).toArray();
    console.log("Current Users in DB:");
    console.log(JSON.stringify(users, null, 2));

    // If an email argument is passed, make that user admin
    const emailToMakeAdmin = process.argv[2];
    if (emailToMakeAdmin) {
      const res = await mongoose.connection.db.collection("users").updateOne(
        { email: emailToMakeAdmin },
        { $set: { role: "admin" } }
      );
      console.log(`Update result for ${emailToMakeAdmin}:`, res);
      const updatedUser = await mongoose.connection.db.collection("users").findOne({ email: emailToMakeAdmin });
      console.log("Updated User:", updatedUser);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
