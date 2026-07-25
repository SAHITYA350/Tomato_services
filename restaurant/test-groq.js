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
        const scrapeDashboard = tool(async () => "DASH", {
            name: "scrape_dashboard",
            description: "Scrape dashboard",
            schema: z.object({})
        });

        const tavilySearch = tool(async ({ query }) => "SEARCH", {
            name: "search_web",
            description: "Search web",
            schema: z.object({ query: z.string() })
        });

        const scrapeWebsite = tool(async ({ url }) => "URL", {
            name: "scrape_website",
            description: "Scrape URL",
            schema: z.object({ url: z.string() })
        });

        const tools = [scrapeDashboard, tavilySearch, scrapeWebsite];
        const toolNode = new ToolNode(tools);
        
        const llm = new ChatGroq({
            apiKey: process.env.GROQ_API_KEY,
            model: "llama-3.3-70b-versatile"
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
            if (lastMessage.tool_calls?.length > 0) return "tools";
            return END;
        })
        .addEdge("tools", "chatbot");
        
        const graph = workflow.compile();
        
        const sysMsg = new SystemMessage("You have search_web. Use it if asked about trends.");
        const messages = [sysMsg, new HumanMessage("search local best trending food")];

        const finalState = await graph.invoke({ messages });
        console.log("Response:", finalState.messages[finalState.messages.length - 1].content);

    } catch (err) {
        console.error("Error:", err.message || err);
        if (err.response) {
            console.error(err.response.data);
        }
    }
}
runTest();
