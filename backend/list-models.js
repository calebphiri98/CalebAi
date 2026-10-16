require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const main = async () => {
    const pager = await ai.models.list();

    for await (const model of pager) {
        const actions = model.supportedActions || [];

        if (actions.includes("generateContent")) {
            console.log(model.name);
        }
    }
};

main().catch((error) => console.error("List failed:", error.message));