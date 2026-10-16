export const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const JSON_HEADERS = { "Content-Type": "application/json" };

export const request = async (path, options = {}) => {
  const response = await fetch(`${API}${path}`, {
    headers: JSON_HEADERS,
    ...options,
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
    headers: JSON_HEADERS,
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