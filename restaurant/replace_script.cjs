const fs = require('fs');

const file = 'src/controllers/ai.ts';
let code = fs.readFileSync(file, 'utf-8');

const startTag = '// 5. Query LLM via LangGraph Agent & Web Scraping';
const endTag = '// Helper to extract JSON from markdown or conversational wrappers';

const startIdx = code.indexOf(startTag);
const endIdx = code.indexOf(endTag);

if (startIdx !== -1 && endIdx !== -1) {
    const replacement = `// 5. Query LLM via Native Node.js LangGraph Agent & Web Scraping
    let aiResponseText = "";
    let lastGroqError = "";
    try {
        console.log("Triggering TypeScript LangGraph Agent for web scraping and AI inference...");
        
        // Define Scrape Tool
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

        const tools = [scrapeDashboard];
        const toolNode = new ToolNode(tools);
        
        if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY environment variable is required");
        
        const llm = new ChatGroq({
            apiKey: process.env.GROQ_API_KEY,
            model: "llama-3.1-8b-instant"
        });
        
        const llmWithTools = llm.bindTools(tools);
        
        const chatbot = async (state: any) => {
            const response = await llmWithTools.invoke(state.messages);
            return { messages: [response] };
        };
        
        const workflow = new StateGraph({
            channels: {
                messages: {
                    value: (x: any, y: any) => x.concat(y),
                    default: () => []
                }
            }
        })
        .addNode("chatbot", chatbot)
        .addNode("tools", toolNode)
        .addEdge(START, "chatbot")
        .addConditionalEdges("chatbot", (state: any) => {
            const lastMessage = state.messages[state.messages.length - 1];
            if (lastMessage.tool_calls?.length > 0) return "tools";
            return END;
        })
        .addEdge("tools", "chatbot");
        
        const graph = workflow.compile();
        
        const sysMsg = new SystemMessage(\`You are Tomato OS AI Partner Companion, an advanced intelligence assistant for Zomato Sellers.
Use the scrape_dashboard tool to check for active/pending orders if the user asks about them. The restaurant_id is "\${restaurant?._id}".

MANDATORY JSON FORMAT FOR ORDER/RIDER/SALES INQUIRIES:
If the user's query is about active orders, pending orders, completed/delivered/cancelled orders, rider details, delivery status, or sales reports, you MUST respond ONLY with a raw JSON object string adhering strictly to the JSON schema below. DO NOT wrap the JSON in markdown code blocks.
If the query is NOT about those topics, reply with normal conversational markdown.

JSON Schema:
{
  "query_language": "Detected language code (e.g., 'en', 'bn', 'hi')",
  "summary": "Short, encouraging summary of active/pending orders and operations in the user's language.",
  "active_orders_count": 0,
  "orders": [
    {
      "order_id": "String (e.g. #383c69 or the last 6 characters of the database order ID)",
      "status": "String (e.g. Placed, Accepted, Preparing, Ready for Rider, Rider Assigned, Picked Up, Delivered, Cancelled in user's language)",
      "items": [
        {
          "name": "String (item name)",
          "quantity": 1,
          "unit_price": 100,
          "total_price": 100
        }
      ],
      "order_total": 100,
      "rider": {
        "name": "String (rider name or 'Not Assigned')",
        "phone": "String (rider phone or 'N/A')",
        "vehicle_type": "String (e.g. Electric Bicycle, Motorcycle, Bicycle, or 'Unknown')",
        "rider_image_url": "String (if rider is assigned, use 'https://avatar.iran.liara.run/public/54', otherwise '')",
        "rider_description": {
          "appearance": "String (visual description of rider based on metadata, or 'description unavailable')",
          "clothing": "String (clothing description of rider based on metadata, or 'description unavailable')",
          "vehicle": "String (vehicle details or 'Unknown')",
          "delivery_partner": "String (delivery partner name or 'Unknown')",
          "confidence_note": "String (confidence note, e.g. 'No rider metadata provided.')"
        }
      },
      "estimated_delivery_time": "String (e.g. '25 mins' or 'N/A')",
      "tracking_status": "String (Brief tracking status update in the user's language)"
    }
  ],
  "insights": [
    "Actionable business/operational insights based on current orders, sales, or trends in the user's language."
  ]
}

Keep formatting consistent. Never output anything else when JSON is required. Ensure quantity and prices are numbers, not strings.\`);

        const messages: any[] = [sysMsg];
        const recentHistory = history.slice(-6);
        for (const msg of recentHistory) {
            if (msg.role === "user") messages.push(new HumanMessage(msg.content));
            else messages.push(new AIMessage(msg.content));
        }
        messages.push(new HumanMessage(userMessage));

        const finalState = await graph.invoke({ messages });
        aiResponseText = finalState.messages[finalState.messages.length - 1].content;
        
        console.log("LangGraph AI Response generated in TypeScript.");

    } catch (err: any) {
        lastGroqError = err.message || err;
        console.warn("LangGraph Agent failed. Error:", lastGroqError);
        return res.status(500).json({
            message: "AI agent temporarily unavailable. Please try again later.",
            error: lastGroqError
        });
    }

    `;
    
    code = code.substring(0, startIdx) + replacement + code.substring(endIdx);
    fs.writeFileSync(file, code, 'utf-8');
    console.log("Done refactoring ai.ts!");
} else {
    console.log("Error: Could not find start/end tags.");
}
