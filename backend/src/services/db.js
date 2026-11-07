const net = require("net");

if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === "function") {
    net.setDefaultAutoSelectFamilyAttemptTimeout(8000);
}

const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000
});

pool.on("error", (error) => {
    console.error("Database pool error:", error.message);
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS caleb_conversations (
    id UUID PRIMARY KEY,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS caleb_conversations_owner_idx
    ON caleb_conversations (owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS caleb_messages (
    seq BIGSERIAL PRIMARY KEY,
    id UUID NOT NULL UNIQUE,
    conversation_id UUID NOT NULL REFERENCES caleb_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    feedback TEXT,
    sources JSONB,
    stopped BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS caleb_messages_conversation_idx
    ON caleb_messages (conversation_id, seq);
CREATE TABLE IF NOT EXISTS caleb_facts (
    seq BIGSERIAL PRIMARY KEY,
    id UUID NOT NULL UNIQUE,
    owner_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS caleb_facts_owner_idx
    ON caleb_facts (owner_id, seq);
`;

let schemaReady = null;

const ensureSchema = () => {
    if (!schemaReady) {
        schemaReady = pool.query(SCHEMA).catch((error) => {
            schemaReady = null;
            throw error;
        });
    }

    return schemaReady;
};

const query = async (text, params) => {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is missing");
    }

    await ensureSchema();

    return pool.query(text, params);
};

module.exports = { query };