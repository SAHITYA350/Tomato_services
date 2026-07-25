import mongoose from 'mongoose';
const uri = 'mongodb+srv://sahityaghosh350_db_user:kL8lT9hrpakcSm30@clusterzomato.ddxoncr.mongodb.net/?appName=Clusterzomato';
async function fix() {
    await mongoose.connect(uri);
    const dbAuth = mongoose.connection.useDb('auth');
    const dbRest = mongoose.connection.useDb('restaurant');
    const users = await dbAuth.collection('users').find({}).toArray();
    const userMap = {};
    users.forEach(u => userMap[u._id.toString()] = u);
    const orders = await dbRest.collection('orders').find({}).toArray();
    let updated = 0;
    for (const o of orders) {
        if (!o.customerName || o.customerName === 'Food Lover' || o.customerName === 'Foodie') {
            const u = userMap[o.userId];
            if (u) {
                await dbRest.collection('orders').updateOne({ _id: o._id }, {
                    $set: { customerName: u.name, customerImage: u.image || '' }
                });
                updated++;
            }
        }
    }
    console.log('Updated ' + updated + ' orders');
    process.exit(0);
}
fix();
