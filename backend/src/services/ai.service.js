const { GoogleGenAI } = require("@google/genai");
const { searchWeb } = require("./webSearch.service.js");

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

const MODEL = "gemini-3.5-flash-lite";
const TIMEZONE = process.env.TIMEZONE || "Africa/Blantyre";
const MAX_TOOL_ROUNDS = 3;

const SEARCH_TOOL = {
    name: "search_web",
    description:
        "Search the web for current or recent information. Use it for news, who currently holds a position, prices, weather, sports results, latest versions, and any fact that may have changed over time.",
    parametersJsonSchema: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "A short, specific web search query."
            }
        },
        required: ["query"]
    }
};

const BASE_SYSTEM_INSTRUCTION = [
    "You are Caleb AI, a personal AI assistant being developed by Caleb.",
    "",
    "Your identity:",
    "- Your name is Caleb AI.",
    "- You are a helpful, intelligent, practical and friendly personal AI assistant.",
    "- When someone asks who you are, introduce yourself as Caleb AI.",
    "- Do not describe yourself as \"Google's AI assistant\" unless specifically asked about the underlying model.",
    "",
    "Your behaviour:",
    "- Be clear and direct.",
    "- Give useful answers rather than unnecessary explanations.",
    "- When the user is learning something, explain concepts step by step.",
    "- When helping with programming, provide practical instructions and explain why each step is needed.",
    "- If you are uncertain about something, say so instead of inventing information.",
    "- Never claim to have performed an action that you have not actually performed.",
    "- Ask for clarification when an important requirement is unclear.",
    "",
    "Conversation:",
    "- Pay close attention to the conversation history provided to you.",
    "- Treat previous user and AI messages as part of the current conversation.",
    "- Resolve pronouns and references using the conversation history whenever possible.",
    "- If the user says \"he\", \"she\", \"they\", \"it\", \"that\", \"this\", or similar words, determine what they refer to from previous messages.",
    "- If the previous message clearly identifies a person or subject, use that information instead of claiming that you have no context.",
    "- Maintain continuity with the conversation.",
    "- Do not unnecessarily say that you lack information when the answer can be determined from the provided conversation history.",
    "",
    "Programming:",
    "- Help with JavaScript, React, Node.js, Python, Java, databases, APIs and other programming technologies.",
    "- When debugging code, identify the problem first, explain the cause, then provide the fix.",
    "- Prefer complete working examples when they are useful.",
    "- Keep beginner-friendly explanations while still being technically correct.",
    "",
    "Student support:",
    "- Help with university assignments, projects, reports, presentations and exam preparation.",
    "- Explain difficult technical concepts in a way that is easy to understand.",
    "- Encourage understanding rather than simply giving answers.",
    "",
    "Feedback and review:",
    "- When the user asks for feedback on their work, be honest, specific and constructive.",
    "- Say what works well, what should be improved and exactly how to improve it.",
    "- Do not give empty praise.",
    "",
    "Daily assistance:",
    "- Help with planning, writing, summarising, decisions, learning and everyday questions.",
    "- When a request is simple, answer briefly. When it is complex, structure the answer.",
    "",
    "Web information:",
    "- When web search results are provided, they are the primary source of information for the current question.",
    "- Directly answer the user's question using the web results.",
    "- Do not greet the user or give a generic introduction when answering a factual question.",
    "- For questions containing words such as \"latest\", \"current\", \"today\", \"now\", or \"recent\", treat the information as time-sensitive.",
    "- Prefer information that is clearly current.",
    "- Compare multiple sources when they disagree.",
    "- Pay attention to publication dates and contextual clues.",
    "- Do not blindly trust a source just because it appears first.",
    "- Never present old information as current.",
    "- If the search results do not provide enough information to answer confidently, clearly say so.",
    "- Do not invent information that is not supported by the search results.",
    "- When using web results, mention the relevant source names when useful.",
    "",
    "Response style:",
    "- Be professional but friendly.",
    "- Do not unnecessarily repeat the user's question.",
    "- Format answers in Markdown.",
    "- Use headings, bullets and tables when they improve clarity.",
    "- Put all code in fenced code blocks with the language name."
].join("\n");

const TOOL_GUIDE = [
    "",
    "",
    "Tools:",
    "- You have one tool, search_web. Use it for anything that may have changed over time, such as current office holders, news, prices, weather, sports and latest versions.",
    "- Do not use it for greetings, general knowledge, explanations, writing or programming help.",
    "- Never invent or call any tool other than search_web."
].join("\n");

const formatDate = () => {
    const stamp = new Date().toLocaleString("en-GB", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: TIMEZONE
    });

    return `\n\nCurrent date and time: ${stamp} (${TIMEZONE}).`;
};

const formatMemory = (facts) => {
    if (!facts || facts.length === 0) {
        return "";
    }

    return [
        "",
        "",
        "THINGS YOU REMEMBER ABOUT THE USER:",
        ...facts.map((fact) => `- ${fact}`),
        "",
        "Use these naturally when they are relevant. Do not list them back unless the user asks what you remember."
    ].join("\n");
};

const buildContents = (message, history) => {
    const turns = [...history, { role: "user", text: message }].filter(
        (turn) => turn.text && turn.text.trim()
    );

    const contents = [];

    turns.forEach((turn) => {
        const role = turn.role === "ai" ? "model" : "user";
        const last = contents[contents.length - 1];

        if (last && last.role === role) {
            last.parts[0].text += `\n\n${turn.text}`;
        } else {
            contents.push({ role, parts: [{ text: turn.text }] });
        }
    });

    while (contents.length > 0 && contents[0].role !== "user") {
        contents.shift();
    }

    return contents;
};

const runSearchCall = async (call, sourceMap) => {
    const query = String((call.args && call.args.query) || "").trim();

    if (call.name !== "search_web" || !query) {
        return { error: "Unknown tool or empty query." };
    }

    try {
        const results = await searchWeb(query);

        results.forEach((result) => {
            if (result.url && !sourceMap.has(result.url)) {
                sourceMap.set(result.url, {
                    title: result.title,
                    url: result.url
                });
            }
        });

        return {
            results: results.map((result) => ({
                title: result.title,
                url: result.url,
                content: String(result.content || "").slice(0, 1500)
            }))
        };
    } catch (error) {
        console.error("Web search error:", error);
        return { error: "Web search failed. Answer from your own knowledge and say that live results were unavailable." };
    }
};

async function* streamAIResponse({ message, history = [], facts = [], signal }) {
    const contents = buildContents(message, history);
    const systemInstruction =
        BASE_SYSTEM_INSTRUCTION + TOOL_GUIDE + formatDate() + formatMemory(facts);

    const sourceMap = new Map();
    let produced = false;

    yield { type: "status", text: "Thinking..." };

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        const config = { systemInstruction, abortSignal: signal };

        if (round < MAX_TOOL_ROUNDS) {
            config.tools = [{ functionDeclarations: [SEARCH_TOOL] }];
        }

        const stream = await ai.models.generateContentStream({
            model: MODEL,
            config,
            contents
        });

        const modelParts = [];
        const calls = [];

        for await (const chunk of stream) {
            if (signal && signal.aborted) {
                return;
            }

            const candidate = chunk.candidates && chunk.candidates[0];
            const parts = (candidate && candidate.content && candidate.content.parts) || [];

            for (const part of parts) {
                modelParts.push(part);

                if (part.functionCall) {
                    calls.push(part.functionCall);
                } else if (part.text && !part.thought) {
                    produced = true;
                    yield { type: "token", text: part.text };
                }
            }
        }

        if (calls.length === 0) {
            break;
        }

        yield { type: "status", text: "Searching the web..." };

        const responseParts = [];

        for (const call of calls) {
            const output = await runSearchCall(call, sourceMap);

            const functionResponse = { name: call.name, response: output };

            if (call.id) {
                functionResponse.id = call.id;
            }

            responseParts.push({ functionResponse });
        }

        contents.push({ role: "model", parts: modelParts });
        contents.push({ role: "user", parts: responseParts });

        yield { type: "sources", sources: Array.from(sourceMap.values()) };
        yield { type: "status", text: "Thinking..." };
    }

    if (!produced) {
        throw new Error("The model returned no text");
    }
}

const extractFacts = async (message, existingFacts = []) => {
    try {
        const prompt = [
            "Extract long-term facts about the user from the message below.",
            "Only include stable personal facts or preferences, such as their name, what they study, projects they work on, skills, goals, tools they use, and how they like answers to be given.",
            "Ignore questions, one-off requests and anything temporary.",
            "Never include passwords, API keys, ID numbers, health details or financial details.",
            "Return a JSON array of short strings written in the third person, for example [\"Studies Computer Science at MUBAS\"].",
            "Return [] if there is nothing worth remembering.",
            "",
            "Already known facts:",
            existingFacts.length
                ? existingFacts.map((fact) => `- ${fact}`).join("\n")
                : "- none",
            "",
            `Message: ${message}`
        ].join("\n");

        const response = await ai.models.generateContent({
            model: MODEL,
            config: { responseMimeType: "application/json" },
            contents: prompt
        });

        const parsed = JSON.parse(response.text ?? "[]");

        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .filter((item) => typeof item === "string" && item.trim())
            .map((item) => item.trim())
            .slice(0, 5);
    } catch (error) {
        console.error("Fact extraction error:", error);
        return [];
    }
};

const generateTitle = async (message, reply) => {
    try {
        const prompt = [
            "Write a short title of at most five words for a conversation that starts like this.",
            "Return only the title, with no quotes and no full stop.",
            "",
            `User: ${message.slice(0, 500)}`,
            `Assistant: ${reply.slice(0, 500)}`
        ].join("\n");

        const response = await ai.models.generateContent({
            model: MODEL,
            contents: prompt
        });

        return (response.text ?? "")
            .replace(/["'*#\n]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 60);
    } catch (error) {
        console.error("Title error:", error);
        return "";
    }
};

module.exports = {
    streamAIResponse,
    extractFacts,
    generateTitle
};