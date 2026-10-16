import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { CheckIcon, CopyIcon } from "./icons.jsx";

const extractText = (node) => {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && node.props && node.props.children) {
    return extractText(node.props.children);
  }
  return "";
};

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);

  const className = (children && children.props && children.props.className) || "";
  const match = /language-([\w-]+)/.exec(className);
  const language = match ? match[1] : "code";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(extractText(children).replace(/\n$/, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Copy error:", error);
    }
  };

  return (
    <div className="code-block">
      <div className="code-header">
        <span>{language}</span>
        <button onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const components = {
  pre: CodeBlock,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  ),
};

function Markdown({ text }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
}

export default Markdown;