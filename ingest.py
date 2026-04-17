import os
import sys

import dotenv
import PyPDF2
import supabase
import voyageai


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    text = text.strip()
    if not text:
        return []
    step = chunk_size - overlap
    chunks: list[str] = []
    i = 0
    while i < len(text):
        piece = text[i : i + chunk_size]
        if piece.strip():
            chunks.append(piece)
        i += step
    return chunks


def main() -> None:
    dotenv.load_dotenv()

    if len(sys.argv) < 2:
        print("Usage: python ingest.py <path-to.pdf>", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not os.path.isfile(pdf_path):
        print(f"Error: file not found: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")
    voyage_key = os.getenv("VOYAGE_API_KEY")
    if not supabase_url or not supabase_key:
        print("Error: SUPABASE_URL and SUPABASE_KEY must be set in the environment.", file=sys.stderr)
        sys.exit(1)
    if not voyage_key:
        print("Error: VOYAGE_API_KEY must be set in the environment.", file=sys.stderr)
        sys.exit(1)

    filename = os.path.basename(pdf_path)
    vo = voyageai.Client(api_key=voyage_key)
    sb = supabase.create_client(supabase_url, supabase_key)

    reader = PyPDF2.PdfReader(pdf_path)
    num_pages = len(reader.pages)
    total_inserted = 0

    for page_index in range(num_pages):
        page_number = page_index + 1
        page = reader.pages[page_index]
        text = page.extract_text() or ""
        chunks = chunk_text(text)

        for chunk_i, chunk in enumerate(chunks, start=1):
            result = vo.embed([chunk], model="voyage-3-lite")
            embedding = list(result.embeddings[0])

            row = {
                "content": chunk,
                "embedding": embedding,
                "metadata": {"source": filename, "page": page_number},
            }
            sb.table("documents").insert(row).execute()
            total_inserted += 1
            print(
                f"Chunk {chunk_i}/{len(chunks)} on page {page_number}/{num_pages} "
                f"stored (running total {total_inserted}, {len(embedding)}-dim)."
            )

    print(f"Done. Inserted {total_inserted} row(s) into documents.")


if __name__ == "__main__":
    main()
