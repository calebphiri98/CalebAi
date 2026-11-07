const { randomUUID } = require("crypto");
const { query } = require("./db.js");

const DEFAULT_TITLE = "New chat";
const FACT_LIMIT = 100;
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value) => UUID_PATTERN.test(String(value || ""));

const toConversation = (row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
});

const toMessage = (row) => {
    const message = {
        id: row.id,
        role: row.role,
        text: row.text,
        feedback: row.feedback,
        createdAt: row.created_at.toISOString()
    };

    if (row.role === "ai") {
        message.sources = row.sources || [];
        message.stopped = row.stopped;
    }

    return message;
};

const toFact = (row) => ({
    id: row.id,
    text: row.text,
    createdAt: row.created_at.toISOString()
});

const listConversations = async (ownerId) => {
    const result = await query(
        `SELECT c.id, c.title, c.created_at, c.updated_at,
                (SELECT COUNT(*) FROM caleb_messages m WHERE m.conversation_id = c.id) AS message_count
         FROM caleb_conversations c
         WHERE c.owner_id = $1
         ORDER BY c.updated_at DESC
         LIMIT 200`,
        [ownerId]
    );

    return result.rows.map((row) => ({
        ...toConversation(row),
        messageCount: Number(row.message_count)
    }));
};

const createConversation = async (ownerId, title = DEFAULT_TITLE) => {
    const result = await query(
        `INSERT INTO caleb_conversations (id, owner_id, title)
         VALUES ($1, $2, $3)
         RETURNING id, title, created_at, updated_at`,
        [randomUUID(), ownerId, title]
    );

    return { ...toConversation(result.rows[0]), messages: [] };
};

const getConversation = async (ownerId, id) => {
    if (!isUuid(id)) {
        return null;
    }

    const found = await query(
        `SELECT id, title, created_at, updated_at
         FROM caleb_conversations
         WHERE id = $1 AND owner_id = $2`,
        [id, ownerId]
    );

    if (found.rows.length === 0) {
        return null;
    }

    const messages = await query(
        `SELECT id, role, text, feedback, sources, stopped, created_at
         FROM caleb_messages
         WHERE conversation_id = $1
         ORDER BY seq`,
        [id]
    );

    return {
        ...toConversation(found.rows[0]),
        messages: messages.rows.map(toMessage)
    };
};

const renameConversation = async (ownerId, id, title) => {
    if (!isUuid(id)) {
        return null;
    }

    const result = await query(
        `UPDATE caleb_conversations
         SET title = $3
         WHERE id = $1 AND owner_id = $2
         RETURNING id, title, created_at, updated_at`,
        [id, ownerId, title]
    );

    return result.rows.length > 0 ? toConversation(result.rows[0]) : null;
};

const deleteConversation = async (ownerId, id) => {
    if (!isUuid(id)) {
        return false;
    }

    const result = await query(
        `DELETE FROM caleb_conversations
         WHERE id = $1 AND owner_id = $2
         RETURNING id`,
        [id, ownerId]
    );

    return result.rows.length > 0;
};

const addMessage = async (ownerId, conversationId, role, text, extra = {}) => {
    if (!isUuid(conversationId)) {
        return null;
    }

    const touched = await query(
        `UPDATE caleb_conversations
         SET updated_at = now()
         WHERE id = $1 AND owner_id = $2
         RETURNING id`,
        [conversationId, ownerId]
    );

    if (touched.rows.length === 0) {
        return null;
    }

    const sources = role === "ai" ? JSON.stringify(extra.sources || []) : null;

    const result = await query(
        `INSERT INTO caleb_messages (id, conversation_id, role, text, sources, stopped)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING id, role, text, feedback, sources, stopped, created_at`,
        [randomUUID(), conversationId, role, text, sources, Boolean(extra.stopped)]
    );

    return toMessage(result.rows[0]);
};

const prepareRegeneration = async (ownerId, conversationId) => {
    if (!isUuid(conversationId)) {
        return null;
    }

    const owned = await query(
        `SELECT id FROM caleb_conversations WHERE id = $1 AND owner_id = $2`,
        [conversationId, ownerId]
    );

    if (owned.rows.length === 0) {
        return null;
    }

    await query(
        `DELETE FROM caleb_messages
         WHERE conversation_id = $1
           AND seq > COALESCE(
               (SELECT MAX(seq) FROM caleb_messages
                WHERE conversation_id = $1 AND role = 'user'),
               0
           )`,
        [conversationId]
    );

    const last = await query(
        `SELECT role, text FROM caleb_messages
         WHERE conversation_id = $1
         ORDER BY seq DESC
         LIMIT 1`,
        [conversationId]
    );

    if (last.rows.length === 0 || last.rows[0].role !== "user") {
        return null;
    }

    await query(
        `UPDATE caleb_conversations SET updated_at = now() WHERE id = $1`,
        [conversationId]
    );

    return last.rows[0].text;
};

const setFeedback = async (ownerId, conversationId, messageId, rating) => {
    if (!isUuid(conversationId) || !isUuid(messageId)) {
        return null;
    }

    const result = await query(
        `UPDATE caleb_messages m
         SET feedback = $3
         FROM caleb_conversations c
         WHERE m.id = $1
           AND m.conversation_id = c.id
           AND c.id = $2
           AND c.owner_id = $4
         RETURNING m.id`,
        [messageId, conversationId, rating, ownerId]
    );

    return result.rows.length > 0 ? { id: messageId, feedback: rating } : null;
};

const getFacts = async (ownerId) => {
    const result = await query(
        `SELECT id, text, created_at
         FROM caleb_facts
         WHERE owner_id = $1
         ORDER BY seq`,
        [ownerId]
    );

    return result.rows.map(toFact);
};

const addFacts = async (ownerId, newFacts) => {
    const existing = await getFacts(ownerId);
    const known = new Set(existing.map((fact) => fact.text.toLowerCase()));
    let count = existing.length;

    for (const raw of newFacts) {
        const text = String(raw || "").trim().slice(0, 200);
        const key = text.toLowerCase();

        if (!text || known.has(key) || count >= FACT_LIMIT) {
            continue;
        }

        known.add(key);
        count += 1;

        await query(
            `INSERT INTO caleb_facts (id, owner_id, text) VALUES ($1, $2, $3)`,
            [randomUUID(), ownerId, text]
        );
    }

    return getFacts(ownerId);
};

const deleteFact = async (ownerId, factId) => {
    if (!isUuid(factId)) {
        return;
    }

    await query(
        `DELETE FROM caleb_facts WHERE id = $1 AND owner_id = $2`,
        [factId, ownerId]
    );
};

const clearFacts = async (ownerId) => {
    await query(`DELETE FROM caleb_facts WHERE owner_id = $1`, [ownerId]);
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