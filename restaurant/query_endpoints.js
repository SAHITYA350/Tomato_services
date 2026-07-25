import jwt from 'jsonwebtoken';
import axios from 'axios';

const JWT_SECRET = 'c3eee19449d7e5f0d88871a8c69004e509ab6a6442c697cd5578599c4774908b';

async function testEndpoint(name, url, method = 'get', data = null) {
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

    try {
        console.log(`Querying ${name} (${url})...`);
        const config = {
            headers: {
                Authorization: `Bearer ${token}`
            }
        };
        const res = method === 'post' 
            ? await axios.post(url, data, config)
            : await axios.get(url, config);
        console.log(`${name} SUCCESS:`, res.status, JSON.stringify(res.data).substring(0, 100));
    } catch (err) {
        console.error(`${name} FAILED:`);
        if (err.response) {
            console.error("Status:", err.response.status);
            console.error("Data:", JSON.stringify(err.response.data));
        } else {
            console.error("Error:", err.message);
        }
    }
}

async function main() {
    await testEndpoint('cart/all', 'http://localhost:5001/api/cart/all');
    await testEndpoint('restaurant', 'http://localhost:5001/api/restaurant/all?latitude=22.5726&longitude=88.3639');
    await testEndpoint('campaign/ads', 'http://localhost:5001/api/campaign/ads');
    await testEndpoint('campaign/recommended', 'http://localhost:5001/api/campaign/recommended-items');
    await testEndpoint('order/feed', 'http://localhost:5001/api/order/feed');
}

main();
