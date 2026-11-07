const {
    streamAIResponse,
    extractFacts,
    generateTitle
} = require("../services/ai.service.js");
const memory = require("../services/memory.service.js");
const { cleanDocuments } = require("../services/documents.service.js");

const HISTORY_LIMIT = 10;
const MAX_MESSAGE_CHARS = 8000;
const MAX_IMAGES = 3;
const MAX_IMAGE_CHARS = 1500000;
const MAX_THUMB_CHARS = 80000;
const THUMB_PREFIX = "data:image/jpeg;base64,";
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

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

const cleanImages = (raw) => {
    if (raw === undefined || raw === null) {
        return [];
    }

    if (!Array.isArray(raw) || raw.length > MAX_IMAGES) {
        return null;
    }

    const cleaned = [];

    for (const item of raw) {
        if (
            !item ||
            item.mimeType !== "image/jpeg" ||
            typeof item.data !== "string" ||
            typeof item.thumb !== "string"
        ) {
            return null;
        }

        if (
            item.data.length === 0 ||
            item.data.length > MAX_IMAGE_CHARS ||
            !BASE64_PATTERN.test(item.data)
        ) {
            return null;
        }

        if (
            !item.thumb.startsWith(THUMB_PREFIX) ||
            item.thumb.length > MAX_THUMB_CHARS ||
            !BASE64_PATTERN.test(item.thumb.slice(THUMB_PREFIX.length))
        ) {
            return null;
        }

        const head = Buffer.from(item.data.slice(0, 8), "base64");

        if (head[0] !== 0xff || head[1] !== 0xd8) {
            return null;
        }

        cleaned.push({
            mimeType: "image/jpeg",
            data: item.data,
            thumb: item.thumb
        });
    }

    return cleaned;
};

const streamChat = async (req, res) => {
    try {
        const ownerId = req.ownerId;
        const text = String(req.body.message || "").trim();
        const regenerate = Boolean(req.body.regenerate);
        const requestedId = req.body.conversationId || null;
        const images = regenerate ? [] : cleanImages(req.body.images);

        if (images === null) {
            return res.status(400).json({
                success: false,
                message: "One of the images could not be accepted. Try a smaller image."
            });
        }

        const cleanedDocuments = regenerate
            ? { ok: true, documents: [] }
            : await cleanDocuments(req.body.documents);

        if (!cleanedDocuments.ok) {
            return res.status(400).json({
                success: false,
                message: cleanedDocuments.message
            });
        }

        const documents = cleanedDocuments.documents;

        let conversation = requestedId
            ? await memory.getConversation(ownerId, requestedId)
            : null;

        if (requestedId && !conversation) {
            return res.status(404).json({
                success: false,
                message: "Conversation not found"
            });
        }

        if (!regenerate && !text && images.length === 0 && documents.length === 0) {
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
        let promptImages = images;
        let promptDocuments = documents;
        let userMessage = null;

        if (regenerate) {
            const prepared = await memory.prepareRegeneration(ownerId, conversation.id);

            if (!prepared) {
                return res.status(400).json({
                    success: false,
                    message: "Nothing to regenerate"
                });
            }

            prompt = prepared.text;
            promptImages = prepared.images;
            promptDocuments = prepared.documents;
        } else {
            if (!conversation) {
                conversation = await memory.createConversation(ownerId);
            }

            userMessage = await memory.addMessage(
                ownerId,
                conversation.id,
                "user",
                text,
                { images, documents }
            );
        }

        const conversationId = conversation.id;
        const needsTitle = !regenerate && conversation.title === memory.DEFAULT_TITLE;

        const history = await memory.getHistory(ownerId, conversationId, HISTORY_LIMIT);

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
                images: promptImages,
                documents: promptDocuments,
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
            const fallback = text
                ? text.length > 40
                    ? `${text.slice(0, 40).trim()}...`
                    : text
                : documents.length > 0
                    ? documents[0].name.slice(0, 40)
                    : "Image question";

            await memory.renameConversation(ownerId, conversationId, fallback);

            if (aiMessage && !failed && text) {
                generateTitle(text, reply)
                    .then(async (title) => {
                        if (title) {
                            await memory.renameConversation(ownerId, conversationId, title);
                        }
                    })
                    .catch((error) => console.error("Title error:", error));
            }
        }

        if (!regenerate && !failed && text) {
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