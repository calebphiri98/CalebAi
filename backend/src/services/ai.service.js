const { GoogleGenAI } = require("@google/genai");
const { searchWeb } = require("./webSearch.service.js");

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

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
    "2026",
    "who is the current",
    "what is the latest",
    "latest version",
    "recent update",
    "happening today"
];

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
    "- Use headings, bullets and code blocks when they improve clarity."
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

const needsWebSearch = (message) => {
    const lowerMessage = message.toLowerCase();
    return SEARCH_KEYWORDS.some((keyword) => lowerMessage.includes(keyword));
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
                result.content
            ].join("\n")
        )
        .join("\n\n");
};

const buildContents = (message, history) => {
    const past = history.map((item) => ({
        role: item.role === "ai" ? "model" : "user",
        parts: [
            {
                text: item.text
            }
        ]
    }));

    const conversationContext = [
        "CONVERSATION CONTEXT:",
        "The messages below are previous messages from this conversation.",
        "Use them to understand references such as he, she, they, it, this, that, and similar words.",
        "",
        ...history.map(
            (item) =>
                `${item.role === "ai" ? "Caleb AI" : "User"}: ${item.text}`
        ),
        "",
        `CURRENT USER MESSAGE: ${message}`
    ].join("\n");

    return [
        {
            role: "user",
            parts: [
                {
                    text: conversationContext
                }
            ]
        }
    ];
};


const generateAIResponse = async (message, history = []) => {
    const contents = buildContents(message, history);

    let systemInstruction = BASE_SYSTEM_INSTRUCTION;

    if (needsWebSearch(message)) {
        const searchQuery = `${message} as of today`;
        const searchResults = await searchWeb(searchQuery);
        const webContext = formatSearchResults(searchResults);

        systemInstruction = [
            BASE_SYSTEM_INSTRUCTION,
            "",
            WEB_CONTEXT_INTRO,
            "",
            webContext
        ].join("\n");
    }

    const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        config: { systemInstruction },
        contents
    });

    return response.text ?? "";
};

module.exports = {
    generateAIResponse
};