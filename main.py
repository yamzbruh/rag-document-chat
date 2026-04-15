import os
from contextlib import asynccontextmanager
from typing import Any

import dotenv

dotenv.load_dotenv()

import uvicorn
from anthropic import Anthropic
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
from supabase import create_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    missing = [
        k
        for k in ("SUPABASE_URL", "SUPABASE_KEY", "ANTHROPIC_API_KEY")
        if not os.environ.get(k)
    ]
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")

    app.state.embed_model = SentenceTransformer("all-MiniLM-L6-v2")
    app.state.supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_KEY"],
    )
    app.state.anthropic = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    yield


app = FastAPI(title="RAG document chat", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1)


class ChatResponse(BaseModel):
    answer: str
    sources: list[dict[str, Any]]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
def chat(body: ChatRequest, request: Request) -> ChatResponse:
    embed_model: SentenceTransformer = request.app.state.embed_model
    sb = request.app.state.supabase
    anthropic_client: Anthropic = request.app.state.anthropic

    embedding = embed_model.encode(body.question).tolist()

    try:
        result = sb.rpc(
            "match_documents",
            {
                "query_embedding": embedding,
                "match_threshold": 0.3,
                "match_count": 5,
            },
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Supabase match_documents failed: {e}") from e

    rows = result.data or []
    context_parts: list[str] = []
    sources: list[dict[str, Any]] = []

    for row in rows:
        if isinstance(row, dict):
            text = row.get("content")
            if text:
                context_parts.append(str(text))
            meta = row.get("metadata")
            if isinstance(meta, dict):
                sources.append(meta)
        else:
            context_parts.append(str(row))

    chunks = "\n\n".join(context_parts)

    prompt = (
        "Answer the question based on the following context. "
        "If the answer is not in the context, say so.\n\n"
        f"Context: {chunks}\n\n"
        f"Question: {body.question}"
    )

    try:
        message = anthropic_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Claude request failed: {e}") from e

    if not message.content:
        raise HTTPException(status_code=502, detail="Empty response from Claude")

    answer_parts: list[str] = []
    for block in message.content:
        if getattr(block, "type", None) == "text" and hasattr(block, "text"):
            answer_parts.append(block.text)
    answer = "".join(answer_parts) if answer_parts else str(message.content[0])

    return ChatResponse(answer=answer, sources=sources)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
