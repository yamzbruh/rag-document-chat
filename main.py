import io
import os
from contextlib import asynccontextmanager
from typing import Any

import dotenv

dotenv.load_dotenv()

import PyPDF2
import uvicorn
from anthropic import Anthropic
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
from supabase import create_client

from ingest import chunk_text


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


class UploadResponse(BaseModel):
    message: str
    chunks_stored: int
    filename: str


class DebugResponse(BaseModel):
    count: int
    sample_content: list[str]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/debug", response_model=DebugResponse)
def debug(request: Request) -> DebugResponse:
    sb = request.app.state.supabase
    try:
        count_res = sb.table("documents").select("content", count="exact").limit(1).execute()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Supabase count failed: {e}") from e

    total = getattr(count_res, "count", None)
    if total is None:
        total = len(count_res.data or [])

    try:
        sample_res = sb.table("documents").select("content").limit(3).execute()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Supabase sample query failed: {e}") from e

    sample_content: list[str] = []
    for row in sample_res.data or []:
        if isinstance(row, dict) and row.get("content") is not None:
            sample_content.append(str(row["content"]))

    return DebugResponse(count=int(total), sample_content=sample_content)


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
                "match_threshold": 0.1,
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


@app.post("/upload", response_model=UploadResponse)
async def upload_pdf(
    request: Request,
    file: UploadFile = File(...),
) -> UploadResponse:
    filename = os.path.basename(file.filename or "upload.pdf")
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are accepted.",
        )

    raw = await file.read()
    if not raw.startswith(b"%PDF"):
        raise HTTPException(
            status_code=400,
            detail="File does not appear to be a valid PDF.",
        )

    embed_model: SentenceTransformer = request.app.state.embed_model
    sb = request.app.state.supabase

    try:
        reader = PyPDF2.PdfReader(io.BytesIO(raw))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}") from e

    chunks_stored = 0

    for page_index in range(len(reader.pages)):
        page_number = page_index + 1
        page = reader.pages[page_index]
        text = page.extract_text() or ""
        for chunk in chunk_text(text):
            embedding = embed_model.encode(chunk).tolist()
            row = {
                "content": chunk,
                "embedding": embedding,
                "metadata": {"source": filename, "page": page_number},
            }
            try:
                sb.table("documents").insert(row).execute()
            except Exception as e:
                raise HTTPException(
                    status_code=502,
                    detail=f"Supabase insert failed: {e}",
                ) from e
            chunks_stored += 1

    return UploadResponse(
        message="success",
        chunks_stored=chunks_stored,
        filename=filename,
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
