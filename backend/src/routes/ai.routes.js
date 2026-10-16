const express = require("express");
const {
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
} = require("../controllers/ai.controller.js");

const router = express.Router();

router.post("/chat/stream", streamChat);

router.get("/conversations", listConversations);
router.post("/conversations", createConversation);
router.get("/conversations/:id", getConversation);
router.patch("/conversations/:id", renameConversation);
router.delete("/conversations/:id", deleteConversation);

router.get("/memory", getMemory);
router.post("/memory", addMemoryItem);
router.delete("/memory/:id", deleteMemoryItem);
router.delete("/memory", clearMemory);

router.post("/feedback", sendFeedback);

module.exports = router;