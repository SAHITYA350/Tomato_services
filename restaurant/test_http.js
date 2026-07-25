import axios from 'axios';

async function main() {
    try {
        console.log("Testing request to google.com...");
        const res1 = await axios.get("https://google.com", { timeout: 3000 });
        console.log("google.com status:", res1.status);
    } catch (err) {
        console.error("google.com error:", err.message);
    }

    try {
        console.log("Testing request to api.groq.com...");
        const res2 = await axios.get("https://api.groq.com", { timeout: 3000 });
        console.log("api.groq.com status:", res2.status);
    } catch (err) {
        console.error("api.groq.com error:", err.message);
    }
}

main();
