const { generateAIResponse } = require("../services/ai.service.js");

const chatWithAI = async (req, res) => {
    try {
        const { message, history = [] } = req.body;

        if (!message) {
            return res.status(400).json({
                success: false,
                message: "Message is required"
            });
        }

        const reply = await generateAIResponse(message, history);

        res.json({
            success: true,
            reply
        });

    } catch (error) {
        console.error("AI Error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to generate AI response"
        });
    }
};

module.exports = {
    chatWithAI
};