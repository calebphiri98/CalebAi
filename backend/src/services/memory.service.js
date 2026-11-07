const { randomUUID } = require("crypto");
const { query } = require("./db.js");

const DEFAULT_TITLE = "New chat";
const FACT_LIMIT = 100;
const HISTORY_IMAGE_CAP = 4;
const HISTORY_DOCUMENT_CAP = 2;
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value) => UUID_PATTERN.test(String(value || ""));

const toConversation = (row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
});

const toMessage = (row, images = [], documents = []) => {
    const message = {
        id: row.id,
        role: row.role,
        text: row.text,
        feedback: row.feedback,
        createdAt: row.created_at.toISOString()
    };

    if (row.role === "user") {
        message.images = images;
        message.documents = documents;
    }

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

const loadThumbs = async (messageIds) => {
    const map = new Map();

    if (messageIds.length === 0) {
        return map;
    }

    const result = await query(
        `SELECT id, message_id, thumb
         FROM caleb_message_images
         WHERE message_id = ANY($1::uuid[])
         ORDER BY message_id, position`,
        [messageIds]
    );

    result.rows.forEach((row) => {
        const list = map.get(row.message_id) || [];
        list.push({ id: row.id, thumb: row.thumb });
        map.set(row.message_id, list);
    });

    return map;
};

const loadFullImages = async (messageIds) => {
    const map = new Map();

    if (messageIds.length === 0) {
        return map;
    }

    const result = await query(
        `SELECT message_id, mime_type, data
         FROM caleb_message_images
         WHERE message_id = ANY($1::uuid[])
         ORDER BY message_id, position`,
        [messageIds]
    );

    result.rows.forEach((row) => {
        const list = map.get(row.message_id) || [];
        list.push({ mimeType: row.mime_type, data: row.data.toString("base64") });
        map.set(row.message_id, list);
    });

    return map;
};

const loadDocumentChips = async (messageIds) => {
    const map = new Map();

    if (messageIds.length === 0) {
        return map;
    }

    const result = await query(
        `SELECT id, message_id, name, kind, size, truncated
         FROM caleb_message_documents
         WHERE message_id = ANY($1::uuid[])
         ORDER BY message_id, position`,
        [messageIds]
    );

    result.rows.forEach((row) => {
        const list = map.get(row.message_id) || [];
        list.push({
            id: row.id,
            name: row.name,
            kind: row.kind,
            size: row.size,
            truncated: row.truncated
        });
        map.set(row.message_id, list);
    });

    return map;
};

const loadFullDocuments = async (messageIds) => {
    const map = new Map();

    if (messageIds.length === 0) {
        return map;
    }

    const result = await query(
        `SELECT message_id, name, mime_type, data, content, truncated
         FROM caleb_message_documents
         WHERE message_id = ANY($1::uuid[])
         ORDER BY message_id, position`,
        [messageIds]
    );

    result.rows.forEach((row) => {
        const list = map.get(row.message_id) || [];
        list.push({
            name: row.name,
            mimeType: row.mime_type,
            data: row.data ? row.data.toString("base64") : null,
            text: row.content,
            truncated: row.truncated
        });
        map.set(row.message_id, list);
    });

    return map;
};

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

    const userIds = messages.rows.filter((row) => row.role === "user").map((row) => row.id);

    const thumbs = await loadThumbs(userIds);
    const chips = await loadDocumentChips(userIds);

    return {
        ...toConversation(found.rows[0]),
        messages: messages.rows.map((row) =>
            toMessage(row, thumbs.get(row.id) || [], chips.get(row.id) || [])
        )
    };
};

const getHistory = async (ownerId, conversationId, limit) => {
    if (!isUuid(conversationId)) {
        return [];
    }

    const result = await query(
        `SELECT m.id, m.role, m.text
         FROM caleb_messages m
         JOIN caleb_conversations c ON c.id = m.conversation_id
         WHERE m.conversation_id = $1 AND c.owner_id = $2
         ORDER BY m.seq DESC
         LIMIT $3`,
        [conversationId, ownerId, limit + 1]
    );

    const rows = result.rows.slice(1).reverse();
    const userIds = rows.filter((row) => row.role === "user").map((row) => row.id);

    const counts = new Map();

    if (userIds.length > 0) {
        const counted = await query(
            `SELECT message_id, COUNT(*)::int AS total
             FROM caleb_message_images
             WHERE message_id = ANY($1::uuid[])
             GROUP BY message_id`,
            [userIds]
        );

        counted.rows.forEach((row) => counts.set(row.message_id, row.total));
    }

    const chosen = [];
    let used = 0;

    for (let index = rows.length - 1; index >= 0; index -= 1) {
        const total = counts.get(rows[index].id) || 0;

        if (total > 0 && used + total <= HISTORY_IMAGE_CAP) {
            chosen.push(rows[index].id);
            used += total;
        }
    }

    const images = await loadFullImages(chosen);

    const docCounts = new Map();

    if (userIds.length > 0) {
        const countedDocs = await query(
            `SELECT message_id, COUNT(*)::int AS total
             FROM caleb_message_documents
             WHERE message_id = ANY($1::uuid[])
             GROUP BY message_id`,
            [userIds]
        );

        countedDocs.rows.forEach((row) => docCounts.set(row.message_id, row.total));
    }

    const chosenDocs = [];
    let usedDocs = 0;

    for (let index = rows.length - 1; index >= 0; index -= 1) {
        const total = docCounts.get(rows[index].id) || 0;

        if (total > 0 && usedDocs + total <= HISTORY_DOCUMENT_CAP) {
            chosenDocs.push(rows[index].id);
            usedDocs += total;
        }
    }

    const documents = await loadFullDocuments(chosenDocs);

    return rows.map((row) => {
        const attached = images.get(row.id) || [];
        const attachedDocs = documents.get(row.id) || [];
        const hadImages = (counts.get(row.id) || 0) > 0;
        const hadDocs = (docCounts.get(row.id) || 0) > 0;
        let text = row.text;

        if (!text && hadImages && attached.length === 0) {
            text = "[An earlier image is no longer shown]";
        }

        if (hadDocs && attachedDocs.length === 0) {
            text = `${text ? `${text}\n` : ""}[An earlier document is no longer shown]`;
        }

        return { role: row.role, text, images: attached, documents: attachedDocs };
    });
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

    const row = result.rows[0];
    const stored = [];

    if (role === "user" && Array.isArray(extra.images)) {
        for (let index = 0; index < extra.images.length; index += 1) {
            const image = extra.images[index];
            const imageId = randomUUID();

            await query(
                `INSERT INTO caleb_message_images (id, message_id, mime_type, data, thumb, position)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    imageId,
                    row.id,
                    image.mimeType,
                    Buffer.from(image.data, "base64"),
                    image.thumb,
                    index
                ]
            );

            stored.push({ id: imageId, thumb: image.thumb });
        }
    }

    const storedDocs = [];

    if (role === "user" && Array.isArray(extra.documents)) {
        for (let index = 0; index < extra.documents.length; index += 1) {
            const doc = extra.documents[index];
            const docId = randomUUID();

            await query(
                `INSERT INTO caleb_message_documents
                    (id, message_id, name, kind, mime_type, size, data, content, truncated, position)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    docId,
                    row.id,
                    doc.name,
                    doc.extension,
                    doc.mimeType,
                    doc.size,
                    doc.data ? Buffer.from(doc.data, "base64") : null,
                    doc.text,
                    Boolean(doc.truncated),
                    index
                ]
            );

            storedDocs.push({
                id: docId,
                name: doc.name,
                kind: doc.extension,
                size: doc.size,
                truncated: Boolean(doc.truncated)
            });
        }
    }

    return toMessage(row, stored, storedDocs);
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
        `SELECT id, role, text FROM caleb_messages
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

    const images = await loadFullImages([last.rows[0].id]);
    const documents = await loadFullDocuments([last.rows[0].id]);

    return {
        text: last.rows[0].text,
        images: images.get(last.rows[0].id) || [],
        documents: documents.get(last.rows[0].id) || []
    };
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
    getHistory,
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