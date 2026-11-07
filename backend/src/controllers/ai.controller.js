const {
    streamAIResponse,
    extractFacts,
    generateTitle
} = require("../services/ai.service.js");
const memory = require("../services/memory.service.js");

const HISTORY_LIMIT = 10;
const MAX_MESSAGE_CHARS = 8000;

const sendEvent = (res, payload) => {
    if (res.writableEnded || res.destroyed) {
        return;
    }

    res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const safe = (handler) => async (req, res) => {
    try {
        await handler(req, res);
    } catch (error) {
        console.error("Request error:", error.message);

        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: "Something went wrong. Please try again."
            });
        }
    }
};

const streamChat = async (req, res) => {
    try {
        const ownerId = req.ownerId;
        const text = String(req.body.message || "").trim();
        const regenerate = Boolean(req.body.regenerate);
        const requestedId = req.body.conversationId || null;

        let conversation = requestedId
            ? await memory.getConversation(ownerId, requestedId)
            : null;

        if (requestedId && !conversation) {
            return res.status(404).json({
                success: false,
                message: "Conversation not found"
            });
        }

        if (!regenerate && !text) {
            return res.status(400).json({
                success: false,
                message: "Message is required"
            });
        }

        if (text.length > MAX_MESSAGE_CHARS) {
            return res.status(400).json({
                success: false,
                message: `Message is too long. The limit is ${MAX_MESSAGE_CHARS} characters.`
            });
        }

        if (regenerate && !conversation) {
            return res.status(400).json({
                success: false,
                message: "Nothing to regenerate"
            });
        }

        let prompt = text;
        let userMessage = null;

        if (regenerate) {
            prompt = await memory.prepareRegeneration(ownerId, conversation.id);

            if (!prompt) {
                return res.status(400).json({
                    success: false,
                    message: "Nothing to regenerate"
                });
            }
        } else {
            if (!conversation) {
                conversation = await memory.createConversation(ownerId);
            }

            userMessage = await memory.addMessage(
                ownerId,
                conversation.id,
                "user",
                text
            );
        }

        const conversationId = conversation.id;
        const needsTitle = !regenerate && conversation.title === memory.DEFAULT_TITLE;

        const saved = await memory.getConversation(ownerId, conversationId);

        const history = saved.messages
            .slice(0, -1)
            .slice(-HISTORY_LIMIT)
            .map(({ role, text: messageText }) => ({ role, text: messageText }));

        const facts = (await memory.getFacts(ownerId)).map((fact) => fact.text);

        res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
        });

        res.flushHeaders();

        const controller = new AbortController();

        res.on("close", () => {
            if (!res.writableFinished) {
                controller.abort();
            }
        });

        sendEvent(res, { type: "meta", conversationId, userMessage });

        let reply = "";
        let sources = [];
        let failed = false;

        try {
            for await (const event of streamAIResponse({
                message: prompt,
                history,
                facts,
                signal: controller.signal
            })) {
                if (event.type === "token") {
                    reply += event.text;
                }

                if (event.type === "sources") {
                    sources = event.sources;
                }

                sendEvent(res, event);
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                failed = true;
                console.error("AI Error:", error.status || "", String(error.message).slice(0, 160));

                let friendly = "Failed to generate AI response";

                if (error.status === 429) {
                    friendly = "Caleb AI is getting a lot of requests right now. Please try again in a minute.";
                } else if (error.status === 503) {
                    friendly = "Caleb AI is very busy right now. Please try again in a moment.";
                }

                sendEvent(res, { type: "error", message: friendly });
            }
        }

        const stopped = controller.signal.aborted;
        let aiMessage = null;

        if (reply.trim()) {
            try {
                aiMessage = await memory.addMessage(
                    ownerId,
                    conversationId,
                    "ai",
                    reply,
                    { sources, stopped }
                );
            } catch (error) {
                console.error("Save reply error:", error.message);
            }
        }

        sendEvent(res, { type: "done", message: aiMessage });
        res.end();

        if (needsTitle) {
            const fallback = text.length > 40 ? `${text.slice(0, 40).trim()}...` : text;
            await memory.renameConversation(ownerId, conversationId, fallback);

            if (aiMessage && !failed) {
                generateTitle(text, reply)
                    .then(async (title) => {
                        if (title) {
                            await memory.renameConversation(ownerId, conversationId, title);
                        }
                    })
                    .catch((error) => console.error("Title error:", error));
            }
        }

        if (!regenerate && !failed) {
            extractFacts(text, facts)
                .then(async (newFacts) => {
                    if (newFacts.length > 0) {
                        await memory.addFacts(ownerId, newFacts);
                    }
                })
                .catch((error) => console.error("Memory error:", error));
        }
    } catch (error) {
        console.error("Stream error:", error);

        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: "Failed to generate AI response"
            });
        } else if (!res.writableEnded) {
            res.end();
        }
    }
};

const listConversations = async (req, res) => {
    res.json({
        success: true,
        conversations: await memory.listConversations(req.ownerId)
    });
};

const createConversation = async (req, res) => {
    res.json({
        success: true,
        conversation: await memory.createConversation(req.ownerId)
    });
};

const getConversation = async (req, res) => {
    const conversation = await memory.getConversation(req.ownerId, req.params.id);

    if (!conversation) {
        return res.status(404).json({
            success: false,
            message: "Conversation not found"
        });
    }

    res.json({ success: true, conversation });
};

const renameConversation = async (req, res) => {
    const title = String(req.body.title || "").trim().slice(0, 80);

    if (!title) {
        return res.status(400).json({
            success: false,
            message: "Title is required"
        });
    }

    const updated = await memory.renameConversation(req.ownerId, req.params.id, title);

    if (!updated) {
        return res.status(404).json({
            success: false,
            message: "Conversation not found"
        });
    }

    res.json({ success: true, conversation: updated });
};

const deleteConversation = async (req, res) => {
    const removed = await memory.deleteConversation(req.ownerId, req.params.id);

    if (!removed) {
        return res.status(404).json({
            success: false,
            message: "Conversation not found"
        });
    }

    res.json({ success: true });
};

const getMemory = async (req, res) => {
    res.json({
        success: true,
        facts: await memory.getFacts(req.ownerId)
    });
};

const addMemoryItem = async (req, res) => {
    const text = String(req.body.text || "").trim().slice(0, 200);

    if (!text) {
        return res.status(400).json({
            success: false,
            message: "Text is required"
        });
    }

    res.json({
        success: true,
        facts: await memory.addFacts(req.ownerId, [text])
    });
};

const deleteMemoryItem = async (req, res) => {
    await memory.deleteFact(req.ownerId, req.params.id);
    res.json({ success: true });
};

const clearMemory = async (req, res) => {
    await memory.clearFacts(req.ownerId);
    res.json({ success: true });
};

const sendFeedback = async (req, res) => {
    const { conversationId, messageId, rating } = req.body;

    if (!conversationId || !messageId || ![null, "up", "down"].includes(rating)) {
        return res.status(400).json({
            success: false,
            message: "conversationId, messageId and a valid rating are required"
        });
    }

    const updated = await memory.setFeedback(
        req.ownerId,
        conversationId,
        messageId,
        rating
    );

    if (!updated) {
        return res.status(404).json({
            success: false,
            message: "Message not found"
        });
    }

    res.json({ success: true });
};

module.exports = {
    streamChat,
    listConversations: safe(listConversations),
    createConversation: safe(createConversation),
    getConversation: safe(getConversation),
    renameConversation: safe(renameConversation),
    deleteConversation: safe(deleteConversation),
    getMemory: safe(getMemory),
    addMemoryItem: safe(addMemoryItem),
    deleteMemoryItem: safe(deleteMemoryItem),
    clearMemory: safe(clearMemory),
    sendFeedback: safe(sendFeedback)
};