const fs = require('fs');

const file = 'src/controllers/ai.ts';
let code = fs.readFileSync(file, 'utf-8');

const startTag = '// Define Scrape Tool';
const endTag = 'const tools = [scrapeDashboard];';

const startIdx = code.indexOf(startTag);
const endIdx = code.indexOf(endTag);

if (startIdx !== -1 && endIdx !== -1) {
    const replacement = `// Define Tools
        const scrapeDashboard = tool(async () => {
            try {
                const restId = restaurant?._id?.toString();
                const headers = req.headers.authorization ? { Authorization: req.headers.authorization } : {};
                const res = await axios.get(\`http://localhost:5001/api/order/restaurant/\${restId}\`, { headers, timeout: 10000 });
                const orders = res.data.orders || [];
                
                // Build HTML
                let html = "<html><body><div id='dashboard'>";
                for (const o of orders) {
                    html += \`<div class='order' data-status='\${o.status || "unknown"}'>\`;
                    html += \`<span class='order-id'>\${o._id}</span>\`;
                    html += \`<span class='total'>\${o.totalAmount || 0}</span>\`;
                    html += \`<span class='rider-name'>\${o.riderName || "Not Assigned"}</span>\`;
                    html += \`<span class='rider-phone'>\${o.riderPhone || "N/A"}</span>\`;
                    for (const item of o.items || []) {
                        html += \`<div class='item'><span class='name'>\${item.name}</span><span class='qty'>\${item.quantity}</span><span class='price'>\${item.price}</span></div>\`;
                    }
                    html += "</div>";
                }
                html += "</div></body></html>";
                
                // Parse with Cheerio
                const $ = cheerio.load(html);
                const scraped_data: string[] = [];
                let active_count = 0;
                
                $('.order').each((_, el) => {
                    const status = $(el).attr('data-status') || "unknown";
                    if (status !== "delivered" && status !== "cancelled") {
                        active_count++;
                    }
                    const o_id = $(el).find('.order-id').text();
                    const total = $(el).find('.total').text();
                    const r_name = $(el).find('.rider-name').text();
                    const r_phone = $(el).find('.rider-phone').text();
                    
                    const items: string[] = [];
                    $(el).find('.item').each((_, itemEl) => {
                        const qty = $(itemEl).find('.qty').text();
                        const name = $(itemEl).find('.name').text();
                        const price = $(itemEl).find('.price').text();
                        items.push(\`\${qty}x \${name} (price: \${price})\`);
                    });
                    
                    scraped_data.push(\`Order #\${o_id} | Status: \${status} | Total: \${total} | Rider: \${r_name} (\${r_phone}) | Items: \${items.join(', ')}\`);
                });
                
                return \`DASHBOARD SCRAPE SUCCESS:\\nActive/Pending Orders Count: \${active_count}\\n\` + scraped_data.join("\\n");
            } catch (err: any) {
                return \`Scraping error: \${err.message}\`;
            }
        }, {
            name: "scrape_dashboard",
            description: "Scrape the seller dashboard to fetch real-time order statistics, active, passive, pending, complete, numbers, quantity, price, and item names.",
            schema: z.object({})
        });

        const tavilySearch = tool(async ({ query }: { query: string }) => {
            try {
                if (!process.env.TAVILY_API_KEY) return "Error: TAVILY_API_KEY is missing from environment.";
                const response = await axios.post("https://api.tavily.com/search", {
                    api_key: process.env.TAVILY_API_KEY,
                    query: query,
                    search_depth: "basic",
                    max_results: 3
                });
                const results = response.data.results.map((r: any) => \`Title: \${r.title}\\nURL: \${r.url}\\nContent: \${r.content}\`).join("\\n\\n");
                return \`SEARCH RESULTS:\\n\${results}\`;
            } catch (err: any) {
                return \`Search error: \${err.message}\`;
            }
        }, {
            name: "tavily_search",
            description: "Search the web for current events, food trends, recipes, local information, and general knowledge.",
            schema: z.object({ query: z.string() })
        });

        const scrapeWebsite = tool(async ({ url }: { url: string }) => {
            try {
                const response = await axios.get(url, { timeout: 10000 });
                const $ = cheerio.load(response.data);
                $("script, style, noscript, iframe, img, svg").remove();
                return $.text().replace(/\\s+/g, " ").substring(0, 3000);
            } catch (err: any) {
                return \`Scraping error: \${err.message}\`;
            }
        }, {
            name: "scrape_website",
            description: "Scrape the text content of a specific website URL. Useful for reading articles or recipes found via tavily_search.",
            schema: z.object({ url: z.string() })
        });

        `;
    
    code = code.substring(0, startIdx) + replacement + code.substring(endIdx);
    fs.writeFileSync(file, code, 'utf-8');
    console.log("Done inserting new tools!");
} else {
    console.log("Error: Could not find start/end tags for tools.");
}

// Now replace the system prompt
let code2 = fs.readFileSync(file, 'utf-8');
const promptStartTag = 'CRITICAL INSTRUCTION ON TOOLS:';
const promptEndTag = 'MANDATORY JSON FORMAT FOR ORDER/RIDER/SALES INQUIRIES:';

const pStartIdx = code2.indexOf(promptStartTag);
const pEndIdx = code2.indexOf(promptEndTag);

if (pStartIdx !== -1 && pEndIdx !== -1) {
    const newPrompt = \`CRITICAL INSTRUCTION ON TOOLS:
You have access to the "scrape_dashboard" tool to check Zomato orders. You ALSO have access to "tavily_search" for web searching, and "scrape_website" for reading specific URLs. If a user asks a general question about food trends, local restaurants, or recipes, use tavily_search to find information, and then use scrape_website on the most promising URL to get deeper insights before answering. DO NOT hallucinate tools like <brave_search>.

\`;
    code2 = code2.substring(0, pStartIdx) + newPrompt + code2.substring(pEndIdx);
    
    // Replace the tools array definition which was left behind
    code2 = code2.replace('const tools = [scrapeDashboard];', 'const tools = [scrapeDashboard, tavilySearch, scrapeWebsite];');
    
    fs.writeFileSync(file, code2, 'utf-8');
    console.log("Done updating system prompt and tools array!");
} else {
    console.log("Error: Could not find start/end tags for prompt.");
}
