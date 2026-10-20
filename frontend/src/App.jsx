import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "./Markdown.jsx";
import { request, streamChat } from "./api.js";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  MemoryIcon,
  MenuIcon,
  MicIcon,
  MoonIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SendIcon,
  SpeakerIcon,
  StopIcon,
  SunIcon,
  ThumbIcon,
  TrashIcon,
} from "./icons.jsx";
import "./App.css";

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

const SUGGESTIONS = [
  "Help me plan my study week",
  "Explain a difficult concept in simple terms",
  "Give me honest feedback on this: ",
  "Help me debug my code",
];

const GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Older"];

const groupLabel = (iso) => {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const days = Math.round(
    (startOfToday - new Date(iso).setHours(0, 0, 0, 0)) / 86400000
  );

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "Previous 7 days";
  return "Older";
};

const hostname = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (error) {
    console.error("URL error:", error);
    return url;
  }
};

const plainText = (text) =>
  text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#`>~|]/g, "");

const dropTrailingAi = (list) => {
  const copy = [...list];

  while (copy.length > 0 && copy[copy.length - 1].role === "ai") {
    copy.pop();
  }

  return copy;
};

const getInitialTheme = () => {
  try {
    const saved = localStorage.getItem("caleb-ai-theme");

    if (saved === "light" || saved === "dark") return saved;
  } catch (error) {
    console.error("Theme error:", error);
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

function App() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [facts, setFacts] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [listening, setListening] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [showMemory, setShowMemory] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 800);
  const [search, setSearch] = useState("");
  const [newFact, setNewFact] = useState("");
  const [notice, setNotice] = useState("");
  const [theme, setTheme] = useState(getInitialTheme);

  const messagesRef = useRef(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const recognitionRef = useRef(null);
  const baseTextRef = useRef("");
  const abortRef = useRef(null);
  const stickRef = useRef(true);
  const loadingRef = useRef(false);
  const activeIdRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const utteranceRef = useRef(null);

  const showNotice = useCallback((text) => {
    setNotice(text);
    clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 4500);
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const data = await request("/conversations");
      setConversations(data.conversations);
    } catch (error) {
      console.error("Conversations error:", error);
    }
  }, []);

  const refreshMemory = useCallback(async () => {
    try {
      const data = await request("/memory");
      setFacts(data.facts);
    } catch (error) {
      console.error("Memory error:", error);
    }
  }, []);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;

    try {
      localStorage.setItem("caleb-ai-theme", theme);
    } catch (error) {
      console.error("Theme error:", error);
    }
  }, [theme]);

  useEffect(() => {
    const init = async () => {
      try {
        const [list, memory] = await Promise.all([
          request("/conversations"),
          request("/memory"),
        ]);

        setConversations(list.conversations);
        setFacts(memory.facts);

        if (list.conversations.length > 0) {
          const first = list.conversations[0];
          const data = await request(`/conversations/${first.id}`);

          setActiveId(first.id);
          setMessages(data.conversation.messages);
        }
      } catch (error) {
        console.error("Load error:", error);
        showNotice("You might be experiencing poor or slow network?");
      }
    };

    init();
  }, [showNotice]);

  useEffect(() => {
    if (stickRef.current) {
      bottomRef.current?.scrollIntoView({
        behavior: loading ? "auto" : "smooth",
      });
    }
  }, [messages, status, loading]);

  useEffect(() => {
    const element = textareaRef.current;

    if (!element) return;

    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [input]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const handleScroll = () => {
    const element = messagesRef.current;

    if (!element) return;

    stickRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 140;
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
  };

  const stopSpeaking = () => {
    utteranceRef.current = null;
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
  };

  const startListening = () => {
    if (!SpeechRecognition) {
      showNotice("Voice input is not supported in this browser. Use Chrome or Edge.");
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;

    baseTextRef.current = input.trim() ? `${input.trim()} ` : "";

    recognition.onresult = (event) => {
      let transcript = "";

      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }

      setInput(baseTextRef.current + transcript);
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        showNotice("Microphone access was blocked. Allow it in your browser settings.");
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        showNotice(`Voice input error: ${event.error}`);
      }

      setListening(false);
    };

    recognition.onend = () => setListening(false);

    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  const streamReply = async ({ text, regenerate = false }) => {
    const controller = new AbortController();
    const stamp = Date.now();
    const draftId = `draft-${stamp}`;
    const localUserId = `local-${stamp}`;
    let conversationId = activeId;

    abortRef.current = controller;
    stickRef.current = true;
    setLoading(true);
    setStatus("");

    setMessages((previous) => {
      const base = regenerate ? dropTrailingAi(previous) : previous;
      const added = [];

      if (!regenerate) {
        added.push({
          id: localUserId,
          role: "user",
          text,
          feedback: null,
          local: true,
        });
      }

      added.push({
        id: draftId,
        role: "ai",
        text: "",
        feedback: null,
        local: true,
        sources: [],
      });

      return [...base, ...added];
    });

    const updateDraft = (change) => {
      setMessages((previous) =>
        previous.map((item) =>
          item.id === draftId ? { ...item, ...change(item) } : item
        )
      );
    };

    try {
      await streamChat({
        body: { conversationId, message: text, regenerate },
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "meta") {
            conversationId = event.conversationId;
            setActiveId(event.conversationId);

            if (event.userMessage) {
              setMessages((previous) =>
                previous.map((item) =>
                  item.id === localUserId ? event.userMessage : item
                )
              );
            }

            refreshConversations();
          } else if (event.type === "status") {
            setStatus(event.text);
          } else if (event.type === "sources") {
            updateDraft(() => ({ sources: event.sources }));
          } else if (event.type === "token") {
            setStatus("");
            updateDraft((item) => ({ text: item.text + event.text }));
          } else if (event.type === "error") {
            showNotice(event.message);
          } else if (event.type === "done") {
            setMessages((previous) =>
              event.message
                ? previous.map((item) =>
                    item.id === draftId ? event.message : item
                  )
                : previous.filter((item) => item.id !== draftId || item.text)
            );
          }
        },
      });
    } catch (error) {
      if (error.name === "AbortError") {
        setMessages((previous) =>
          previous
            .filter((item) => item.id !== draftId || item.text)
            .map((item) =>
              item.id === draftId ? { ...item, stopped: true } : item
            )
        );

        const savedId = conversationId;

        if (savedId) {
          setTimeout(async () => {
            if (loadingRef.current || activeIdRef.current !== savedId) return;

            try {
              const data = await request(`/conversations/${savedId}`);
              setMessages(data.conversation.messages);
            } catch (reloadError) {
              console.error("Reload error:", reloadError);
            }
          }, 700);
        }
      } else {
        console.error("Chat error:", error);

        showNotice(
          error.message === "Failed to fetch"
            ? "Could not reach Caleb AI. Is the backend running?"
            : error.message
        );

        setMessages((previous) =>
          previous.filter((item) => item.id !== draftId || item.text)
        );
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
        setStatus("");
      }

      refreshConversations();
      setTimeout(refreshConversations, 3500);
      setTimeout(refreshMemory, 4500);
    }
  };

  const sendMessage = () => {
    const text = input.trim();

    if (!text || loading) return;

    if (listening) stopListening();

    setInput("");
    streamReply({ text });
  };

  const regenerate = () => {
    if (loading || !activeId) return;

    streamReply({ text: "", regenerate: true });
  };

  const pickSuggestion = (text) => {
    setInput(text);
    textareaRef.current?.focus();
  };

  const giveFeedback = async (item, rating) => {
    const next = item.feedback === rating ? null : rating;
    const previousRating = item.feedback;

    setMessages((previous) =>
      previous.map((entry) =>
        entry.id === item.id ? { ...entry, feedback: next } : entry
      )
    );

    try {
      await request("/feedback", {
        method: "POST",
        body: JSON.stringify({
          conversationId: activeId,
          messageId: item.id,
          rating: next,
        }),
      });
    } catch (error) {
      console.error("Feedback error:", error);

      setMessages((previous) =>
        previous.map((entry) =>
          entry.id === item.id ? { ...entry, feedback: previousRating } : entry
        )
      );

      showNotice("Could not save feedback.");
    }
  };

  const copyMessage = async (item) => {
    try {
      await navigator.clipboard.writeText(item.text);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (error) {
      console.error("Copy error:", error);
      showNotice("Could not copy the message.");
    }
  };

  const speak = (item) => {
    if (!("speechSynthesis" in window)) {
      showNotice("Read aloud is not supported in this browser.");
      return;
    }

    if (speakingId === item.id) {
      stopSpeaking();
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(plainText(item.text));

    const finish = () => {
      if (utteranceRef.current === utterance) {
        utteranceRef.current = null;
        setSpeakingId(null);
      }
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

      setActiveId(id);
      setMessages(data.conversation.messages);
      stickRef.current = true;
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

      setFacts(data.facts);
      setNewFact("");
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
    <div className="app">
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
              onClick={sendMessage}
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

export default App;