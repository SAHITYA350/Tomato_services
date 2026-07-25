import jwt from 'jsonwebtoken';
import axios from 'axios';

const JWT_SECRET = 'c3eee19449d7e5f0d88871a8c69004e509ab6a6442c697cd5578599c4774908b';

async function main() {
    const payload = {
        user: {
            _id: '66e1ab2c9f82d123456789ab',
            name: 'Sahitya Ghosh',
            email: 'sahitya@example.com',
            image: '',
            role: 'customer',
            restaurantId: ''
        }
    };
    
    const token = jwt.sign(payload, JWT_SECRET);
    console.log("Generated JWT Token:", token);

    try {
        console.log("Querying http://localhost:5001/api/cart/all...");
        const res = await axios.get("http://localhost:5001/api/cart/all", {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        console.log("Response status:", res.status);
        console.log("Response data:", JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.error("Request failed!");
        console.error(err);
    }
}

main();
