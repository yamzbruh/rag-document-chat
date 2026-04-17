"use client";

import { useRef, useState } from "react";

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

    const CHAT_URL = "https://rag-document-chat-production-149e.up.railway.app/chat";
    const UPLOAD_URL = "https://rag-document-chat-production-149e.up.railway.app/upload";

function isPdfFile(file: File): boolean {
  if (!file.name.toLowerCase().endsWith(".pdf")) return false;
  const t = file.type;
  return (
    t === "application/pdf" ||
    t === "application/x-pdf" ||
    t === "application/octet-stream" ||
    t === ""
  );
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function setPdfSelection(file: File | null) {
    setUploadSuccess(null);
    setUploadError(null);
    if (!file) {
      setPendingFile(null);
      return;
    }
    if (!isPdfFile(file)) {
      setUploadError("Please choose a PDF file only.");
      setPendingFile(null);
      return;
    }
    setPendingFile(file);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPdfSelection(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    setPdfSelection(file);
  }

  async function handleUploadProcess() {
    if (!pendingFile || uploading || loading) return;
    setUploading(true);
    setUploadSuccess(null);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", pendingFile);

    try {
      const res = await fetch(UPLOAD_URL, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `Upload failed (${res.status})`);
      }

      const data: { message?: string; chunks_stored?: number; filename?: string } =
        await res.json();
      const name = data.filename ?? pendingFile.name;
      const n = data.chunks_stored ?? 0;
      setMessages([]);
      setUploadSuccess(
        `${name} uploaded — ${n} chunks stored. Ready to chat!`
      );
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Upload failed. Please try again."
      );
    } finally {
      setUploading(false);
    }
  }

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
        <section className="mb-4 shrink-0 space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={handleFileInputChange}
          />

          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
              dragOver
                ? "border-teal-500 bg-teal-950/30"
                : "border-zinc-600 bg-zinc-950/50 hover:border-zinc-500"
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <p className="text-sm text-zinc-400">
              Drag and drop a PDF here, or use the button below
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-600"
            >
              Upload PDF
            </button>
          </div>

          {pendingFile && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="truncate text-sm text-zinc-300">
                Selected: <span className="font-medium">{pendingFile.name}</span>
              </p>
              <button
                type="button"
                onClick={handleUploadProcess}
                disabled={uploading || loading}
                className="shrink-0 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Upload &amp; Process
              </button>
            </div>
          )}

          {uploading && (
            <p className="text-center text-sm text-zinc-400">
              Processing PDF...
            </p>
          )}

          {uploadSuccess && (
            <p className="rounded-lg border border-emerald-800/80 bg-emerald-950/50 px-3 py-2 text-center text-sm text-emerald-300">
              {uploadSuccess}
            </p>
          )}

          {uploadError && (
            <p className="rounded-lg border border-red-900/80 bg-red-950/50 px-3 py-2 text-center text-sm text-red-300">
              {uploadError}
            </p>
          )}
        </section>

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
                disabled={loading || uploading}
                className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none ring-teal-500/30 focus:border-teal-600 focus:ring-2 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || uploading || !input.trim()}
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
