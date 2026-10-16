require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const models = process.argv.slice(2);
const RUNS = 4;

const timeOnce = async (model) => {
    const started = Date.now();

    const stream = await ai.models.generateContentStream({
        model,
        contents: "hie"
    });

    let first = null;

    for await (const chunk of stream) {
        if (first === null && chunk.text) {
            first = Date.now() - started;
        }
    }

    return first;
};

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

const main = async () => {
    if (models.length === 0) {
        console.log("Usage: node latency-test.js model-one model-two");
        return;
    }

    for (const model of models) {
        const times = [];
        let failures = 0;
        let lastError = "";

        for (let run = 1; run <= RUNS; run += 1) {
            try {
                const first = await timeOnce(model);

                if (first !== null) {
                    times.push(first);
                }
            } catch (error) {
                failures += 1;
                lastError = `${error.status || ""} ${String(error.message).slice(0, 90)}`;
            }
        }

        const summary = times.length
            ? `median ${median(times)} ms | all: ${times.join(", ")} ms`
            : "no successful runs";

        console.log(`${model}: ${summary} | failures: ${failures}${failures ? ` (${lastError})` : ""}`);
    }
};

main();