export const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const CLIENT_KEY = "caleb-ai-client-id";

let fallbackClientId = null;

const createClientId = () => {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

const getClientId = () => {
  try {
    let id = localStorage.getItem(CLIENT_KEY);

    if (!id) {
      id = createClientId();
      localStorage.setItem(CLIENT_KEY, id);
    }

    return id;
  } catch (error) {
    console.error("Client id error:", error);

    if (!fallbackClientId) {
      fallbackClientId = createClientId();
    }

    return fallbackClientId;
  }
};

const buildHeaders = (extra = {}) => ({
  "Content-Type": "application/json",
  "X-Client-Id": getClientId(),
  ...extra,
});

export const request = async (path, options = {}) => {
  const { headers, ...rest } = options;

  const response = await fetch(`${API}${path}`, {
    ...rest,
    headers: buildHeaders(headers),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Request failed");
  }

  return data;
};

export const streamChat = async ({ body, signal, onEvent }) => {
  const response = await fetch(`${API}/chat/stream`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    let message = "Request failed";

    try {
      const data = await response.json();
      message = data.message || message;
    } catch (error) {
      console.error("Response error:", error);
    }

    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop();

    for (const part of parts) {
      const line = part.split("\n").find((entry) => entry.startsWith("data: "));

      if (line) {
        onEvent(JSON.parse(line.slice(6)));
      }
    }
  }
};