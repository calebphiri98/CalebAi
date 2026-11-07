const MAX_DOCUMENTS = 2;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil((MAX_FILE_BYTES * 4) / 3) + 8;
const MAX_TEXT_CHARS = 60000;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const LEGACY_EXTENSIONS = new Set(["doc", "ppt", "xls"]);

const TYPES = {
    pdf: { mode: "pdf", mime: "application/pdf" },
    docx: {
        mode: "office",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
    pptx: {
        mode: "office",
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    },
    xlsx: {
        mode: "office",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    txt: { mode: "text", mime: "text/plain" },
    md: { mode: "text", mime: "text/markdown" },
    csv: { mode: "text", mime: "text/csv" },
    json: { mode: "text", mime: "application/json" }
};

const SUPPORTED_LABEL = "PDF, DOCX, PPTX, XLSX, TXT, MD, CSV or JSON";

const fail = (message) => ({ ok: false, message });

const safeName = (value) => {
    const cleaned = String(value || "")
        .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
        .trim();

    return (cleaned.length > 120 ? cleaned.slice(-120) : cleaned) || "document";
};

const extensionOf = (name) => {
    const match = /\.([A-Za-z0-9]+)$/.exec(name);

    return match ? match[1].toLowerCase() : "";
};

const isZip = (buffer) =>
    buffer.length > 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;

const isPdf = (buffer) => buffer.subarray(0, 1024).includes("%PDF-");

const tidy = (text) =>
    String(text || "")
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

const extractOffice = async (buffer) => {
    const parser = await import("officeparser");
    const ast = await parser.parseOffice(buffer);
    const result = await ast.to("text");

    return String(result && result.value ? result.value : "");
};

const cleanOne = async (item) => {
    if (!item || typeof item.name !== "string" || typeof item.data !== "string") {
        return fail("One of the files could not be accepted.");
    }

    const name = safeName(item.name);
    const extension = extensionOf(name);

    if (LEGACY_EXTENSIONS.has(extension)) {
        return fail(`"${name}" is an old Office format. Please save it as PDF or DOCX and try again.`);
    }

    const type = TYPES[extension];

    if (!type) {
        return fail(`"${name}" is not a supported file type. Use ${SUPPORTED_LABEL}.`);
    }

    if (item.data.length === 0 || item.data.length > MAX_BASE64_CHARS) {
        return fail(`"${name}" is too large. The limit is ${MAX_FILE_BYTES / (1024 * 1024)} MB.`);
    }

    if (item.data.length % 4 !== 0 || !BASE64_PATTERN.test(item.data)) {
        return fail(`"${name}" could not be read as a valid file.`);
    }

    const buffer = Buffer.from(item.data, "base64");

    if (buffer.length === 0 || buffer.length > MAX_FILE_BYTES) {
        return fail(`"${name}" is too large. The limit is ${MAX_FILE_BYTES / (1024 * 1024)} MB.`);
    }

    const base = {
        name,
        extension,
        mimeType: type.mime,
        size: buffer.length,
        data: null,
        text: null,
        truncated: false
    };

    if (type.mode === "pdf") {
        if (!isPdf(buffer)) {
            return fail(`"${name}" does not look like a valid PDF.`);
        }

        return { ok: true, document: { ...base, data: item.data } };
    }

    let text = "";

    if (type.mode === "office") {
        if (!isZip(buffer)) {
            return fail(`"${name}" does not look like a valid ${extension.toUpperCase()} file.`);
        }

        try {
            text = tidy(await extractOffice(buffer));
        } catch (error) {
            console.error("Document extraction error:", String(error.message).slice(0, 160));
            return fail(`"${name}" could not be read. Try saving it again or exporting it as PDF.`);
        }
    } else {
        if (buffer.subarray(0, 4096).includes(0)) {
            return fail(`"${name}" does not look like a text file.`);
        }

        text = tidy(buffer.toString("utf8"));
    }

    if (!text) {
        return fail(`"${name}" has no readable text.`);
    }

    let truncated = false;

    if (text.length > MAX_TEXT_CHARS) {
        text = text.slice(0, MAX_TEXT_CHARS);
        truncated = true;
    }

    return { ok: true, document: { ...base, text, truncated } };
};

const cleanDocuments = async (raw) => {
    if (raw === undefined || raw === null) {
        return { ok: true, documents: [] };
    }

    if (!Array.isArray(raw)) {
        return fail("One of the files could not be accepted.");
    }

    if (raw.length > MAX_DOCUMENTS) {
        return fail(`You can attach up to ${MAX_DOCUMENTS} documents.`);
    }

    const documents = [];

    for (const item of raw) {
        const result = await cleanOne(item);

        if (!result.ok) {
            return result;
        }

        documents.push(result.document);
    }

    return { ok: true, documents };
};

module.exports = {
    MAX_DOCUMENTS,
    MAX_FILE_BYTES,
    MAX_TEXT_CHARS,
    cleanDocuments
};