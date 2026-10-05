import { useState } from "react";
import "./App.css";

function App() {
  const [message, setMessage] = useState("");

  const [messages, setMessages] = useState([
    {
      role: "ai",
      text: "Hello! I am Caleb AI. How can I help you today?",
    },
  ]);

  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    const trimmedMessage = message.trim();

    if (!trimmedMessage || loading) return;

    const userMessage = {
      role: "user",
      text: trimmedMessage,
    };

    // Add user's message to the screen
    setMessages((previousMessages) => [
      ...previousMessages,
      userMessage,
    ]);

    setMessage("");
    setLoading(true);

    try {
      const response = await fetch(
        "http://localhost:5000/api/ai/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            message: trimmedMessage,
            history: messages,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Failed to get AI response"
        );
      }

      const aiMessage = {
        role: "ai",
        text: data.reply,
      };

      // Add AI response to the conversation
      setMessages((previousMessages) => [
        ...previousMessages,
        aiMessage,
      ]);

    } catch (error) {
      console.error("Chat error:", error);

      setMessages((previousMessages) => [
        ...previousMessages,
        {
          role: "ai",
          text: "Sorry, I could not connect to Caleb AI right now.",
        },
      ]);

    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="chat-container">

        <header className="chat-header">
          <div>
            <h1>Caleb AI</h1>
            <p>Your personal AI assistant</p>
          </div>

          <div className="status">
            <span className="status-dot"></span>
            Online
          </div>
        </header>

        <main className="messages">

          {messages.map((item, index) => (
            <div
              key={index}
              className={`message-row ${item.role}`}
            >
              <div className="message">
                {item.text}
              </div>
            </div>
          ))}

          {loading && (
            <div className="message-row ai">
              <div className="message">
                Caleb AI is thinking...
              </div>
            </div>
          )}

        </main>

        <div className="input-area">

          <input
            type="text"
            placeholder="Ask Caleb AI anything..."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                sendMessage();
              }
            }}
            disabled={loading}
          />

          <button
            onClick={sendMessage}
            disabled={loading}
          >
            {loading ? "Thinking..." : "Send"}
          </button>

        </div>

      </div>
    </div>
  );
}

export default App;