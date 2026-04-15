"use client";

import { useState } from "react";

type SourceMeta = {
  source?: string;
  page?: number;
};

type ChatMessage =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      sources?: SourceMeta[];
    };

const CHAT_URL = "http://localhost:8000/chat";

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `Request failed (${res.status})`);
      }

      const data: { answer: string; sources?: SourceMeta[] } = await res.json();
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.answer,
        sources: data.sources ?? [],
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          err instanceof Error
            ? `Something went wrong: ${err.message}`
            : "Something went wrong.",
        sources: [],
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="shrink-0 border-b border-zinc-800 bg-zinc-950/90 px-4 py-6 backdrop-blur sm:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          Document Chat
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Ask questions about your uploaded documents
        </p>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col min-h-0 px-4 py-4 sm:px-6">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            {messages.length === 0 && !loading && (
              <p className="text-center text-sm text-zinc-500">
                Send a message to start chatting with your documents.
              </p>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 shadow-sm">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex justify-start">
                  <div className="max-w-[85%] space-y-2">
                    <div className="rounded-2xl rounded-bl-md border border-teal-900/50 bg-teal-950/80 px-4 py-2.5 text-sm text-teal-50 shadow-sm">
                      {m.content}
                    </div>
                    {m.sources && m.sources.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pl-0.5">
                        {m.sources.map((s, i) => (
                          <span
                            key={`${m.id}-src-${i}`}
                            className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800/80 px-2.5 py-0.5 text-xs text-zinc-300"
                          >
                            {s.source ?? "document"}
                            {s.page != null ? ` · p. ${s.page}` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md border border-teal-900/50 bg-teal-950/60 px-4 py-2.5 text-sm italic text-teal-200/90">
                  Thinking...
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={handleSend}
            className="shrink-0 border-t border-zinc-800 bg-zinc-900/60 p-3 sm:p-4"
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question..."
                disabled={loading}
                className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none ring-teal-500/30 focus:border-teal-600 focus:ring-2 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="shrink-0 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </form>
        </div>
      </main>

      <footer className="shrink-0 border-t border-zinc-800 bg-zinc-950 py-4 text-center text-xs text-zinc-500">
        Created by Eric Chen
      </footer>
    </div>
  );
}
