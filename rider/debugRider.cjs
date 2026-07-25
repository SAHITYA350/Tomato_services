const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://sahityaghosh350_db_user:kL8lT9hrpakcSm30@clusterzomato.ddxoncr.mongodb.net/?appName=Clusterzomato', {dbName: 'Zomato_Clone'}).then(async () => {
    const r = await mongoose.connection.db.collection('riders').findOne({ _id: new mongoose.Types.ObjectId('6a4d42c19c02af96215a6220') });
    console.log('coords:', JSON.stringify(r.location.coordinates));
    console.log('Expected: [85.5979,20.6629]');
    console.log('Match:', JSON.stringify(r.location.coordinates) === '[85.5979,20.6629]' ? 'YES ✅' : 'NO ❌ - SOMETHING OVERWROTE IT');
    process.exit(0);
});
