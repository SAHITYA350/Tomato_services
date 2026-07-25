const mongoose = require('mongoose');
const axios = require('axios');

mongoose.connect('mongodb+srv://sahityaghosh350_db_user:kL8lT9hrpakcSm30@clusterzomato.ddxoncr.mongodb.net/?appName=Clusterzomato', {dbName: 'Zomato_Clone'}).then(async () => {
    try {
        const usersCollection = mongoose.connection.db.collection("users");
        const users = await usersCollection.find({ role: 'rider' }).toArray();
        const emails = users.map(u => u.email).filter(Boolean);
        
        console.log("Rider emails:", emails);
        
        if (emails.length === 0) {
            console.log("No emails found.");
            process.exit(0);
        }
        
        const recipients = emails.map(email => ({ email }));
        
        console.log("Testing MailerSend API...");
        
        await axios.post(
            "https://api.mailersend.com/v1/email",
            {
                from: {
                    email: "dispatch@test-ywj2lpn0vmqg7oqz.mlsender.net",
                    name: "Tomato Dispatch"
                },
                to: recipients,
                subject: `Urgent Delivery Request: TEST`,
                html: "<b>Test</b>"
            },
            {
                headers: {
                    "Authorization": `Bearer mlsn.0b541b260d02f398ff53ba27dd8a298c7faf412b09a497cd3030c7075fc9c03c`,
                    "Content-Type": "application/json"
                }
            }
        );
        console.log("MailerSend success!");
        process.exit(0);
    } catch (err) {
        console.error("MailerSend API failed:", JSON.stringify(err?.response?.data, null, 2) || err.message);
        process.exit(1);
    }
});
