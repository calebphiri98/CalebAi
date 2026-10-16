const {
    streamAIResponse,
    extractFacts,
    generateTitle
} = require("../services/ai.service.js");
const memory = require("../services/memory.service.js");

const HISTORY_LIMIT = 20;

const sendEvent = (res, payload) => {
    if (res.writableEnded || res.destroyed) {
        return;
    }

    res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const streamChat = async (req, res) => {
    try {
        const text = (req.body.message || "").trim();
        const regenerate = Boolean(req.body.regenerate);
        const requestedId = req.body.conversationId || null;

        let conversation = requestedId ? memory.getConversation(requestedId) : null;

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

        if (regenerate && !conversation) {
            return res.status(400).json({
                success: false,
                message: "Nothing to regenerate"
            });
        }

        let prompt = text;
        let userMessage = null;

        if (regenerate) {
            prompt = memory.prepareRegeneration(conversation.id);

            if (!prompt) {
                return res.status(400).json({
                    success: false,
                    message: "Nothing to regenerate"
                });
            }
        } else {
            if (!conversation) {
                conversation = memory.createConversation();
            }

            userMessage = memory.addMessage(conversation.id, "user", text);
        }

        const conversationId = conversation.id;
        const needsTitle = !regenerate && conversation.title === memory.DEFAULT_TITLE;

        const saved = memory.getConversation(conversationId);

        const history = saved.messages
            .slice(0, -1)
            .slice(-HISTORY_LIMIT)
            .map(({ role, text: messageText }) => ({ role, text: messageText }));

        const facts = memory.getFacts().map((fact) => fact.text);

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
                console.error("AI Error:", error);

                sendEvent(res, {
                    type: "error",
                    message: "Failed to generate AI response"
                });
            }
        }

        const stopped = controller.signal.aborted;
        let aiMessage = null;

        if (reply.trim()) {
            aiMessage = memory.addMessage(conversationId, "ai", reply, {
                sources,
                stopped
            });
        }

        sendEvent(res, { type: "done", message: aiMessage });
        res.end();

        if (needsTitle) {
            const fallback = text.length > 40 ? `${text.slice(0, 40).trim()}...` : text;
            memory.renameConversation(conversationId, fallback);

            if (aiMessage && !failed) {
                generateTitle(text, reply)
                    .then((title) => {
                        if (title) {
                            memory.renameConversation(conversationId, title);
                        }
                    })
                    .catch((error) => console.error("Title error:", error));
            }
        }

        if (!regenerate && !failed) {
            extractFacts(text, facts)
                .then((newFacts) => {
                    if (newFacts.length > 0) {
                        memory.addFacts(newFacts);
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

const listConversations = (req, res) => {
    res.json({
        success: true,
        conversations: memory.listConversations()
    });
};

const createConversation = (req, res) => {
    res.json({
        success: true,
        conversation: memory.createConversation()
    });
};

const getConversation = (req, res) => {
    const conversation = memory.getConversation(req.params.id);

    if (!conversation) {
        return res.status(404).json({
            success: false,
            message: "Conversation not found"
        });
    }

    res.json({ success: true, conversation });
};

const renameConversation = (req, res) => {
    const title = String(req.body.title || "").trim().slice(0, 80);

    if (!title) {
        return res.status(400).json({
            success: false,
            message: "Title is required"
        });
    }

    const updated = memory.renameConversation(req.params.id, title);

    if (!updated) {
        return res.status(404).json({
            success: false,
            message: "Conversation not found"
        });
    }

    res.json({ success: true, conversation: updated });
};

const deleteConversation = (req, res) => {
    const removed = memory.deleteConversation(req.params.id);

    if (!removed) {
        return res.status(404).json({
            success: false,
            message: "Conversation not found"
        });
    }

    res.json({ success: true });
};

const getMemory = (req, res) => {
    res.json({
        success: true,
        facts: memory.getFacts()
    });
};

const addMemoryItem = (req, res) => {
    const text = String(req.body.text || "").trim().slice(0, 200);

    if (!text) {
        return res.status(400).json({
            success: false,
            message: "Text is required"
        });
    }

    res.json({
        success: true,
        facts: memory.addFacts([text])
    });
};

const deleteMemoryItem = (req, res) => {
    memory.deleteFact(req.params.id);
    res.json({ success: true });
};

const clearMemory = (req, res) => {
    memory.clearFacts();
    res.json({ success: true });
};

const sendFeedback = (req, res) => {
    const { conversationId, messageId, rating } = req.body;

    if (!conversationId || !messageId || ![null, "up", "down"].includes(rating)) {
        return res.status(400).json({
            success: false,
            message: "conversationId, messageId and a valid rating are required"
        });
    }

    const updated = memory.setFeedback(conversationId, messageId, rating);

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
    listConversations,
    createConversation,
    getConversation,
    renameConversation,
    deleteConversation,
    getMemory,
    addMemoryItem,
    deleteMemoryItem,
    clearMemory,
    sendFeedback
};