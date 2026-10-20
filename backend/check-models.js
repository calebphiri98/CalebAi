require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const models = process.argv.slice(2);

const TOOL = {
    name: "search_web",
    description: "Search the web for current information.",
    parametersJsonSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"]
    }
};

const check = async (model) => {
    const started = Date.now();

    const stream = await ai.models.generateContentStream({
        model,
        config: {
            systemInstruction: "You are Caleb AI. Answer briefly.",
            tools: [{ functionDeclarations: [TOOL] }]
        },
        contents: "hie"
    });

    let first = null;

    for await (const chunk of stream) {
        const candidate = chunk.candidates && chunk.candidates[0];
        const parts = (candidate && candidate.content && candidate.content.parts) || [];

        if (first === null && parts.some((part) => part.text && !part.thought)) {
            first = Date.now() - started;
        }
    }

    return first;
};

const main = async () => {
    if (models.length === 0) {
        console.log("Usage: node check-models.js model-one model-two");
        return;
    }

    for (const model of models) {
        try {
            const first = await check(model);
            console.log(first === null ? `${model}: no text returned` : `${model}: OK, first token ${first} ms`);
        } catch (error) {
            console.log(`${model}: FAILED ${error.status || ""} ${String(error.message).slice(0, 100)}`);
        }
    }
};

main();