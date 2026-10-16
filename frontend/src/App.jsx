import { useState, useEffect, useRef } from "react";
import "./App.css";
import Markdown from "./Markdown.jsx";
import {
  MicIcon,
  SendIcon,
  StopIcon,
  ThumbIcon,
  CopyIcon,
  CheckIcon,
  RefreshIcon,
  SpeakerIcon,
  PlusIcon,
  MenuIcon,
  TrashIcon,
  PencilIcon,
  MemoryIcon,
  SunIcon,
  MoonIcon,
  CloseIcon,
} from "./icons.jsx";

const SUGGESTIONS = [
  "Help me write a Python script",
  "Explain quantum computing simply",
  "Plan a 3-day trip to Tokyo",
  "What is happening in the world today?",
];

const GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Older"];

function groupLabel(dateString) {
  if (!dateString) return "Older";
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Previous 7 days";
  return "Older";
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState("dark");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");
  const [showMemory, setShowMemory] = useState(false);
  const [facts, setFacts] = useState([]);
  const [newFact, setNewFact] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [speakingId, setSpeakingId] = useState(null);
  const [listening, setListening] = useState(false);

  const messagesRef = useRef(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const stickRef = useRef(true);
  const utteranceRef = useRef(null);
  const abortControllerRef = useRef(null);

  const showNotice = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 3000);
  };

  const request = async (url, options = {}) => {
    const res = await fetch(`http://localhost:5000/api${url}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) throw new Error("API request failed");
    return res.json();
  };

  // Load conversation list and memory facts on load
  useEffect(() => {
    request("/conversations")
      .then((data) => {
        if (data.success && data.conversations) {
          setConversations(data.conversations);
        }
      })
      .catch((err) => console.error("Failed to load conversations", err));

    request("/memory")
      .then((data) => {
        if (data.success && data.facts) {
          setFacts(data.facts);
        }
      })
      .catch((err) => console.error("Failed to load memory", err));
  }, []);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (stickRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, status]);

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setStatus("");
  };

  const stopSpeaking = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setSpeakingId(null);
  };

  const speak = (item) => {
    if (!window.speechSynthesis) return;
    if (speakingId === item.id) {
      stopSpeaking();
      return;
    }
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(item.text);
    const finish = () => {
      utteranceRef.current = null;
      setSpeakingId(null);
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    utteranceRef.current = utterance;
    setSpeakingId(item.id);
    window.speechSynthesis.speak(utterance);
  };

  const closeSidebarOnMobile = () => {
    if (window.innerWidth <= 800) setSidebarOpen(false);
  };

  const startNewChat = () => {
    stopGeneration();
    stopSpeaking();
    setActiveId(null);
    setMessages([]);
    stickRef.current = true;
    textareaRef.current?.focus();
    closeSidebarOnMobile();
  };

  const openConversation = async (id) => {
    if (id === activeId) {
      closeSidebarOnMobile();
      return;
    }

    stopGeneration();
    stopSpeaking();

    try {
      const data = await request(`/conversations/${id}`);
      if (data.success && data.conversation) {
        setActiveId(id);
        setMessages(data.conversation.messages);
        stickRef.current = true;
      }
    } catch (error) {
      console.error("Open error:", error);
      showNotice("Could not open that chat.");
    }

    closeSidebarOnMobile();
  };

  const renameConversation = async (conversation) => {
    const title = window.prompt("Rename chat", conversation.title);
    if (!title || !title.trim()) return;

    try {
      await request(`/conversations/${conversation.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.trim() }),
      });

      setConversations((previous) =>
        previous.map((item) =>
          item.id === conversation.id ? { ...item, title: title.trim() } : item
        )
      );
    } catch (error) {
      console.error("Rename error:", error);
      showNotice("Could not rename the chat.");
    }
  };

  const deleteConversation = async (conversation) => {
    if (!window.confirm(`Delete "${conversation.title}"?`)) return;

    try {
      await request(`/conversations/${conversation.id}`, { method: "DELETE" });

      if (conversation.id === activeId) {
        stopGeneration();
        stopSpeaking();
        setActiveId(null);
        setMessages([]);
      }

      setConversations((previous) =>
        previous.filter((item) => item.id !== conversation.id)
      );
    } catch (error) {
      console.error("Delete error:", error);
      showNotice("Could not delete the chat.");
    }
  };

  const addFact = async () => {
    const text = newFact.trim();
    if (!text) return;

    try {
      const data = await request("/memory", {
        method: "POST",
        body: JSON.stringify({ text }),
      });

      if (data.success) {
        setFacts(data.facts);
        setNewFact("");
      }
    } catch (error) {
      console.error("Add memory error:", error);
      showNotice("Could not save that memory.");
    }
  };

  const deleteFact = async (id) => {
    try {
      await request(`/memory/${id}`, { method: "DELETE" });
      setFacts((previous) => previous.filter((fact) => fact.id !== id));
    } catch (error) {
      console.error("Delete memory error:", error);
      showNotice("Could not delete that memory.");
    }
  };

  const clearMemory = async () => {
    if (!window.confirm("Delete everything Caleb AI remembers about you?")) return;

    try {
      await request("/memory", { method: "DELETE" });
      setFacts([]);
    } catch (error) {
      console.error("Clear memory error:", error);
      showNotice("Could not clear memory.");
    }
  };

  const pickSuggestion = (text) => {
    setInput(text);
    textareaRef.current?.focus();
  };

  const copyMessage = async (item) => {
    try {
      await navigator.clipboard.writeText(item.text);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (err) {
      console.error("Copy failed", err);
    }
  };

  const giveFeedback = async (item, rating) => {
    try {
      await request("/feedback", {
        method: "POST",
        body: JSON.stringify({
          conversationId: activeId,
          messageId: item.id,
          rating,
        }),
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, feedback: rating } : m))
      );
    } catch (err) {
      console.error("Feedback error", err);
    }
  };

  const startListening = () => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      showNotice("Speech recognition is not supported in this browser.");
      return;
    }
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognition.start();
  };

  const stopListening = () => {
    setListening(false);
  };

  const sendMessage = async (isRegenerate = false, overrideText = null) => {
    const textToSend = overrideText !== null ? overrideText : input;
    if ((!textToSend.trim() && !isRegenerate) || loading) return;

    if (!isRegenerate) {
      setInput("");
    }

    setLoading(true);
    setStatus("Connecting...");

    const tempUserMsgId = Date.now();
    const tempAiMsgId = Date.now() + 1;

    if (!isRegenerate) {
      setMessages((prev) => [
        ...prev,
        { id: tempUserMsgId, role: "user", text: textToSend },
      ]);
    }

    setMessages((prev) => [
      ...prev,
      { id: tempAiMsgId, role: "ai", text: "", sources: [] },
    ]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("http://localhost:5000/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          conversationId: activeId,
          text: textToSend,
          regenerate: isRegenerate,
        }),
      });

      if (!response.ok) throw new Error("Stream connection failed");

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          try {
            const eventData = JSON.parse(trimmed.replace(/^data:\s*/, ""));

            if (eventData.type === "meta") {
              setActiveId(eventData.conversationId);
              request("/conversations").then((d) => {
                if (d.success) setConversations(d.conversations);
              });
            } else if (eventData.type === "status") {
              setStatus(eventData.text);
            } else if (eventData.type === "token") {
              setStatus("");
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === tempAiMsgId
                    ? { ...msg, text: msg.text + eventData.text }
                    : msg
                )
              );
            } else if (eventData.type === "sources") {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === tempAiMsgId
                    ? { ...msg, sources: eventData.sources }
                    : msg
                )
              );
            } else if (eventData.type === "done") {
              if (eventData.message) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === tempAiMsgId ? { ...eventData.message } : msg
                  )
                );
              }
              // Refresh facts panel in case memory facts were auto-extracted
              request("/memory").then((d) => {
                if (d.success) setFacts(d.facts);
              });
            }
          } catch (e) {
            console.error("SSE parse error", e);
          }
        }
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("Send message error:", error);
        showNotice("Failed to get response from Caleb AI.");
      }
    } finally {
      setLoading(false);
      setStatus("");
      abortControllerRef.current = null;
    }
  };

  const regenerate = () => {
    if (loading || !activeId) return;
    setMessages((prev) => {
      const copy = [...prev];
      if (copy.length > 0 && copy[copy.length - 1].role === "ai") {
        copy.pop();
      }
      return copy;
    });
    sendMessage(true, "");
  };

  const handleScroll = () => {
    if (!messagesRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesRef.current;
    stickRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const filtered = conversations.filter((item) =>
    item.title.toLowerCase().includes(search.trim().toLowerCase())
  );

  const groups = GROUP_ORDER.map((label) => ({
    label,
    items: filtered.filter((item) => groupLabel(item.updatedAt) === label),
  })).filter((group) => group.items.length > 0);

  const activeTitle =
    conversations.find((item) => item.id === activeId)?.title || "New chat";

  return (
    <div className={`app ${theme}`}>
      {sidebarOpen && (
        <div className="backdrop" onClick={() => setSidebarOpen(false)}></div>
      )}

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <button className="new-chat" onClick={startNewChat}>
            <PlusIcon /> New chat
          </button>

          <input
            className="sidebar-search"
            type="text"
            placeholder="Search chats"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <nav className="conversation-list">
          {conversations.length === 0 && (
            <p className="sidebar-empty">No chats yet. Start one below.</p>
          )}

          {conversations.length > 0 && groups.length === 0 && (
            <p className="sidebar-empty">No chats match your search.</p>
          )}

          {groups.map((group) => (
            <div key={group.label} className="conversation-group">
              <h3>{group.label}</h3>

              {group.items.map((conversation) => (
                <div
                  key={conversation.id}
                  className={`conversation-item ${
                    conversation.id === activeId ? "active" : ""
                  }`}
                  onClick={() => openConversation(conversation.id)}
                >
                  <span className="conversation-title">{conversation.title}</span>

                  <span className="conversation-actions">
                    <button
                      title="Rename"
                      onClick={(event) => {
                        event.stopPropagation();
                        renameConversation(conversation);
                      }}
                    >
                      <PencilIcon size={14} />
                    </button>
                    <button
                      title="Delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteConversation(conversation);
                      }}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <section className="chat">
        <header className="chat-header">
          <div className="header-left">
            <button
              className="ghost-button"
              onClick={() => setSidebarOpen((open) => !open)}
              title="Toggle sidebar"
            >
              <MenuIcon />
            </button>

            <div className="header-title">
              <h1>{activeTitle}</h1>
              <p>Caleb AI</p>
            </div>
          </div>

          <div className="header-actions">
            <button className="header-button" onClick={() => setShowMemory(true)}>
              <MemoryIcon size={16} /> Memory ({facts.length})
            </button>

            <button
              className="ghost-button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              title="Switch theme"
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </header>

        <main className="messages" ref={messagesRef} onScroll={handleScroll}>
          <div className="thread">
            {messages.length === 0 && (
              <div className="welcome">
                <h2>Hello, I am Caleb AI</h2>
                <p>
                  Ask me about your studies, code, writing, plans or what is
                  happening in the world today. Type or tap the mic to talk.
                </p>

                <div className="suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button key={suggestion} onClick={() => pickSuggestion(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((item, index) => {
              const isLast = index === messages.length - 1;
              const streaming = loading && isLast && item.role === "ai";

              return (
                <div key={item.id} className={`message-row ${item.role}`}>
                  <div className="message-wrap">
                    <div className="message">
                      {item.role === "ai" ? (
                        item.text ? (
                          <Markdown text={item.text} />
                        ) : (
                          <div className="typing">
                            <span></span>
                            <span></span>
                            <span></span>
                            {status && <em>{status}</em>}
                          </div>
                        )
                      ) : (
                        <span className="plain-text">{item.text}</span>
                      )}
                    </div>

                    {item.role === "ai" && item.sources && item.sources.length > 0 && (
                      <div className="sources">
                        {item.sources.map((source, sourceIndex) => (
                          <a
                            key={sourceIndex}
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={source.title}
                          >
                            {hostname(source.url)}
                          </a>
                        ))}
                      </div>
                    )}

                    {item.role === "ai" && item.text && !streaming && (
                      <div className="actions">
                        <button onClick={() => copyMessage(item)} title="Copy">
                          {copiedId === item.id ? <CheckIcon /> : <CopyIcon />}
                        </button>

                        <button
                          className={speakingId === item.id ? "active" : ""}
                          onClick={() => speak(item)}
                          title="Read aloud"
                        >
                          <SpeakerIcon />
                        </button>

                        {!item.local && (
                          <>
                            <button
                              className={item.feedback === "up" ? "active" : ""}
                              onClick={() => giveFeedback(item, "up")}
                              title="Good response"
                            >
                              <ThumbIcon />
                            </button>

                            <button
                              className={item.feedback === "down" ? "active" : ""}
                              onClick={() => giveFeedback(item, "down")}
                              title="Bad response"
                            >
                              <ThumbIcon down />
                            </button>
                          </>
                        )}

                        {isLast && !loading && !item.local && (
                          <button onClick={regenerate} title="Regenerate response">
                            <RefreshIcon />
                          </button>
                        )}

                        {item.stopped && <span className="stopped">Stopped</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            <div ref={bottomRef}></div>
          </div>
        </main>

        {notice && <div className="notice">{notice}</div>}

        <div className="composer">
          <div className="composer-box">
            <button
              className={`icon-button mic ${listening ? "listening" : ""}`}
              onClick={listening ? stopListening : startListening}
              title={listening ? "Stop listening" : "Speak"}
            >
              <MicIcon />
            </button>

            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={
                listening
                  ? "Listening..."
                  : loading
                  ? "Caleb AI is replying. You can keep typing..."
                  : "Ask Caleb AI anything..."
              }
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
            />

            {loading && (
              <button
                className="icon-button stop"
                onClick={stopGeneration}
                title="Stop generating"
              >
                <StopIcon />
              </button>
            )}

            <button
              className="icon-button send"
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              title={loading ? "Wait for the reply to finish" : "Send"}
            >
              <SendIcon />
            </button>
          </div>

          <p className="composer-hint">
            {loading
              ? "Send unlocks when the reply finishes. Your draft is safe."
              : "Enter to send, Shift+Enter for a new line"}
          </p>
        </div>

        {showMemory && (
          <aside className="memory-panel">
            <div className="memory-header">
              <h2>What I remember</h2>
              <button className="ghost-button" onClick={() => setShowMemory(false)}>
                <CloseIcon />
              </button>
            </div>

            <div className="memory-add">
              <input
                type="text"
                placeholder="Add something to remember"
                value={newFact}
                onChange={(event) => setNewFact(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addFact();
                }}
              />
              <button onClick={addFact} disabled={!newFact.trim()}>
                Add
              </button>
            </div>

            <div className="memory-list">
              {facts.length === 0 && (
                <p className="memory-empty">
                  Nothing yet. Tell me about yourself, your studies or your
                  projects and I will remember it.
                </p>
              )}

              {facts.map((fact) => (
                <div key={fact.id} className="memory-item">
                  <span>{fact.text}</span>
                  <button onClick={() => deleteFact(fact.id)} title="Forget this">
                    <CloseIcon size={14} />
                  </button>
                </div>
              ))}
            </div>

            {facts.length > 0 && (
              <button className="memory-clear" onClick={clearMemory}>
                Forget everything
              </button>
            )}
          </aside>
        )}
      </section>
    </div>
  );
}