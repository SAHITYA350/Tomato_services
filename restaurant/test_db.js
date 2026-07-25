import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
    console.log("Connecting to MongoDB with URI:", process.env.MONGO_URI);
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            dbName: "Zomato_Clone",
            serverSelectionTimeoutMS: 5000 // 5 seconds timeout
        });
        console.log("SUCCESS: Connected to database!");
        
        // Count restaurants
        const count = await mongoose.connection.db.collection('restaurants').countDocuments();
        console.log("Number of documents in restaurants:", count);
        
        await mongoose.disconnect();
    } catch (err) {
        console.error("FAILED to connect to database!");
        console.error(err);
    }
}

test();
