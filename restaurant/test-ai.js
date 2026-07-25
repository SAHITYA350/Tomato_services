import { ChatGroq } from "@langchain/groq";
import { tool } from "@langchain/core/tools";
import { StateGraph, END, START } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import * as dotenv from "dotenv";
dotenv.config();
async function runTest() {
    try {
        console.log("Triggering TypeScript LangGraph Agent...");
        const scrapeDashboard = tool(async () => {
            return `DASHBOARD SCRAPE SUCCESS:\nActive/Pending Orders Count: 0`;
        }, {
            name: "scrape_dashboard",
            description: "Scrape the seller dashboard to fetch real-time order statistics, active, passive, pending, complete, numbers, quantity, price, and item names.",
            schema: z.object({})
        });
        const tools = [scrapeDashboard];
        const toolNode = new ToolNode(tools);
        const llm = new ChatGroq({
            apiKey: process.env.GROQ_API_KEY,
            model: "llama-3.1-8b-instant"
        });
        const llmWithTools = llm.bindTools(tools);
        const chatbot = async (state) => {
            const response = await llmWithTools.invoke(state.messages);
            return { messages: [response] };
        };
        const workflow = new StateGraph({
            channels: {
                messages: {
                    value: (x, y) => x.concat(y),
                    default: () => []
                }
            }
        })
            .addNode("chatbot", chatbot)
            .addNode("tools", toolNode)
            .addEdge(START, "chatbot")
            .addConditionalEdges("chatbot", (state) => {
            const lastMessage = state.messages[state.messages.length - 1];
            if (lastMessage.tool_calls?.length > 0)
                return "tools";
            return END;
        })
            .addEdge("tools", "chatbot");
        const graph = workflow.compile();
        const sysMsg = new SystemMessage(`You are Tomato OS AI Partner Companion, an advanced intelligence assistant for Zomato Sellers.
Use the scrape_dashboard tool to check for active/pending orders if the user asks about them. The restaurant_id is "test".`);
        const messages = [sysMsg, new HumanMessage("search local best trending food")];
        const finalState = await graph.invoke({ messages });
        const aiResponseText = finalState.messages[finalState.messages.length - 1].content;
        console.log("LangGraph AI Response:", aiResponseText);
    }
    catch (err) {
        console.error("LangGraph Agent failed. Error:", err.message || err);
    }
}
runTest();
