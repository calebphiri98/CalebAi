const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const DEFAULT_TITLE = "New chat";

const now = () => new Date().toISOString();

const emptyStore = () => ({ conversations: [], facts: [] });

const normalise = (parsed) => {
    const store = {
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
        facts: Array.isArray(parsed.facts) ? parsed.facts : []
    };

    if (
        store.conversations.length === 0 &&
        Array.isArray(parsed.messages) &&
        parsed.messages.length > 0
    ) {
        const first = parsed.messages[0];
        const last = parsed.messages[parsed.messages.length - 1];

        store.conversations.push({
            id: randomUUID(),
            title: "Previous chat",
            createdAt: first.createdAt || now(),
            updatedAt: last.createdAt || now(),
            messages: parsed.messages
        });
    }

    return store;
};

const load = () => {
    if (!fs.existsSync(DATA_FILE)) {
        return emptyStore();
    }

    try {
        return normalise(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
    } catch (error) {
        console.error("Memory load error:", error);

        try {
            fs.copyFileSync(DATA_FILE, `${DATA_FILE}.corrupt-${Date.now()}`);
        } catch (copyError) {
            console.error("Backup error:", copyError);
        }

        return emptyStore();
    }
};

const save = (store) => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
};

const findConversation = (store, id) =>
    store.conversations.find((item) => item.id === id);

const summarise = (conversation) => ({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length
});

const listConversations = () =>
    load()
        .conversations.map(summarise)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const createConversation = (title = DEFAULT_TITLE) => {
    const store = load();
    const timestamp = now();

    const conversation = {
        id: randomUUID(),
        title,
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: []
    };

    store.conversations.push(conversation);
    save(store);

    return conversation;
};

const getConversation = (id) => findConversation(load(), id) || null;

const renameConversation = (id, title) => {
    const store = load();
    const conversation = findConversation(store, id);

    if (!conversation) {
        return null;
    }

    conversation.title = title;
    save(store);

    return summarise(conversation);
};

const deleteConversation = (id) => {
    const store = load();
    const before = store.conversations.length;

    store.conversations = store.conversations.filter((item) => item.id !== id);
    save(store);

    return store.conversations.length < before;
};

const addMessage = (conversationId, role, text, extra = {}) => {
    const store = load();
    const conversation = findConversation(store, conversationId);

    if (!conversation) {
        return null;
    }

    const message = {
        id: randomUUID(),
        role,
        text,
        feedback: null,
        createdAt: now(),
        ...extra
    };

    conversation.messages.push(message);
    conversation.updatedAt = now();
    save(store);

    return message;
};

const prepareRegeneration = (conversationId) => {
    const store = load();
    const conversation = findConversation(store, conversationId);

    if (!conversation) {
        return null;
    }

    while (
        conversation.messages.length > 0 &&
        conversation.messages[conversation.messages.length - 1].role === "ai"
    ) {
        conversation.messages.pop();
    }

    const last = conversation.messages[conversation.messages.length - 1];

    if (!last || last.role !== "user") {
        return null;
    }

    conversation.updatedAt = now();
    save(store);

    return last.text;
};

const setFeedback = (conversationId, messageId, rating) => {
    const store = load();
    const conversation = findConversation(store, conversationId);

    if (!conversation) {
        return null;
    }

    const message = conversation.messages.find((item) => item.id === messageId);

    if (!message) {
        return null;
    }

    message.feedback = rating;
    save(store);

    return message;
};

const getFacts = () => load().facts;

const addFacts = (newFacts) => {
    const store = load();
    const known = new Set(store.facts.map((fact) => fact.text.toLowerCase()));

    newFacts.forEach((text) => {
        const key = text.toLowerCase();

        if (!known.has(key)) {
            known.add(key);
            store.facts.push({
                id: randomUUID(),
                text,
                createdAt: now()
            });
        }
    });

    save(store);

    return store.facts;
};

const deleteFact = (factId) => {
    const store = load();
    store.facts = store.facts.filter((fact) => fact.id !== factId);
    save(store);
};

const clearFacts = () => {
    const store = load();
    store.facts = [];
    save(store);
};

module.exports = {
    DEFAULT_TITLE,
    listConversations,
    createConversation,
    getConversation,
    renameConversation,
    deleteConversation,
    addMessage,
    prepareRegeneration,
    setFeedback,
    getFacts,
    addFacts,
    deleteFact,
    clearFacts
};