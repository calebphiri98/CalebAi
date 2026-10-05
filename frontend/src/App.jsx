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

  const sendMessage = () => {
    if (!message.trim()) return;

    setMessages((previousMessages) => [
      ...previousMessages,
      {
        role: "user",
        text: message,
      },
    ]);

    setMessage("");
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
          />

          <button onClick={sendMessage}>
            Send
          </button>
        </div>

      </div>
    </div>
  );
}

export default App;