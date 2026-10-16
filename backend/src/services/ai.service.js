const { GoogleGenAI } = require("@google/genai");
const { searchWeb } = require("./webSearch.service.js");

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

const MODEL = "gemini-3.5-flash-lite";
const TIMEZONE = process.env.TIMEZONE || "Africa/Blantyre";

const SEARCH_KEYWORDS = [
    "current",
    "latest",
    "today",
    "tonight",
    "recent",
    "recently",
    "news",
    "now",
    "this week",
    "this month",
    "this year",
    String(new Date().getFullYear()),
    "who is the current",
    "what is the latest",
    "latest version",
    "recent update",
    "happening today",
    "weather",
    "search the web",
    "look up"
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SEARCH_PATTERN = new RegExp(
    `\\b(${SEARCH_KEYWORDS.map(escapeRegExp).join("|")})\\b`,
    "i"
);

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

const WEB_CONTEXT_INTRO = [
    "LIVE WEB SEARCH RESULTS",
    "",
    "The following information was retrieved from the web for the user's question.",
    "",
    "Use this information as evidence for your answer.",
    "",
    "Important:",
    "- Answer the user's actual question directly.",
    "- Do not respond with a generic greeting.",
    "- Do not ignore the search results.",
    "- Prefer recent and reliable information.",
    "- If different sources disagree, explain the disagreement.",
    "- Do not treat old information as current.",
    "- Do not invent facts that are not supported by the search results."
].join("\n");

const needsWebSearch = (message) => SEARCH_PATTERN.test(message);

const formatDate = () => {
    const stamp = new Date().toLocaleString("en-GB", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: TIMEZONE
    });

    return `\n\nCurrent date and time: ${stamp} (${TIMEZONE}).`;
};

const formatSearchResults = (results) => {
    if (!results || results.length === 0) {
        return "No web search results were found.";
    }

    return results
        .map((result, index) =>
            [
                `SOURCE ${index + 1}`,
                `Title: ${result.title}`,
                `URL: ${result.url}`,
                "Content:",
                String(result.content || "").slice(0, 1500)
            ].join("\n")
        )
        .join("\n\n");
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

async function* streamAIResponse({ message, history = [], facts = [], signal }) {
    const contents = buildContents(message, history);

    let systemInstruction =
        BASE_SYSTEM_INSTRUCTION + formatDate() + formatMemory(facts);

    if (needsWebSearch(message)) {
        yield { type: "status", text: "Searching the web..." };

        try {
            const results = await searchWeb(`${message} as of today`);

            systemInstruction = [
                systemInstruction,
                "",
                WEB_CONTEXT_INTRO,
                "",
                formatSearchResults(results)
            ].join("\n");

            yield {
                type: "sources",
                sources: results.map((result) => ({
                    title: result.title,
                    url: result.url
                }))
            };
        } catch (error) {
            console.error("Web search error:", error);
        }
    }

    yield { type: "status", text: "Thinking..." };

    const stream = await ai.models.generateContentStream({
        model: MODEL,
        config: { systemInstruction, abortSignal: signal },
        contents
    });

    for await (const chunk of stream) {
        if (signal && signal.aborted) {
            break;
        }

        const text = chunk.text;

        if (text) {
            yield { type: "token", text };
        }
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