const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://sahityaghosh350_db_user:kL8lT9hrpakcSm30@clusterzomato.ddxoncr.mongodb.net/?appName=Clusterzomato', {dbName: 'Zomato_Clone'}).then(() => {
    mongoose.connection.db.collection('riders').updateMany({}, { $set: { 'location.coordinates': [85.5979, 20.6629], isAvailable: true } }).then(r => {
        console.log('Updated:', r.modifiedCount);
        process.exit(0);
    });
});
