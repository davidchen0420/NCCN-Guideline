"""Layer B: chunk the Principles pages (e.g. PROS-A..N) and the Discussion (MS-*) and index them
with BM25 so each graph node can pull its supporting text."""
import re

from rank_bm25 import BM25Okapi

TOKEN_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)?")


def tokenize(text):
    return TOKEN_RE.findall(text.lower())


def _discussion_label(page):
    for line in reversed(page.get_text().strip().splitlines()):
        m = re.fullmatch(r"\s*(MS-\d+)\s*", line)
        if m:
            return m.group(1)
    return None


def _is_reference_list(page):
    lines = [l for l in page.get_text().splitlines() if l.strip()]
    numbered = sum(bool(re.match(r"\s*\d{1,4}\.\s", l)) for l in lines)
    links = page.get_text().count("http")
    return links >= 5 or numbered > 0.3 * len(lines)


def build_chunks(spec, max_words=220):
    """Paragraph-level chunks of principles and discussion pages, tagged with their page code.
    (Superseded by fulltext.chunk_pages, which covers every page kind.)"""
    chunks = []
    for i, page in enumerate(spec.doc):
        code = spec.ids.get(i)
        if spec.kind(i) == "principles":
            source = "principles"
        elif spec.kind(i) == "discussion":
            code, source = _discussion_label(page) or f"MS-p{i + 1}", "discussion"
            if _is_reference_list(page):
                continue
        else:
            continue
        buf = []
        for block in page.get_text("blocks"):
            y0, text = block[1], block[4].strip()
            if y0 < 85 or y0 > 560 or not text or text.count("et al.") >= 2:
                continue  # skip headers/footers and reference lists
            buf.append(re.sub(r"\s+", " ", text))
            if sum(len(b.split()) for b in buf) >= max_words:
                chunks.append({"source": source, "page": code, "text": " ".join(buf)})
                buf = []
        if buf:
            chunks.append({"source": source, "page": code, "text": " ".join(buf)})
    for n, chunk in enumerate(chunks):
        chunk["id"] = f"c{n}"
    return chunks


class Retriever:
    """BM25 retrieval; with `dense_cache` set (and MedCPT available), BM25 and MedCPT
    rankings are fused by reciprocal rank fusion (hybrid search)."""

    def __init__(self, chunks, dense_cache=None):
        self.chunks = chunks
        self.bm25 = BM25Okapi([tokenize(c["text"]) for c in chunks])
        self.dense = None
        if dense_cache:
            from .dense import MedCPT, chunk_embeddings

            self.dense = MedCPT()
            self.emb = chunk_embeddings(chunks, dense_cache, self.dense)

    def search(self, query, k=5, pages=None):
        """Top-k chunks; `pages` restricts to page-code prefixes (node-scoped retrieval)."""
        scores = self.bm25.get_scores(tokenize(query))
        ranked = sorted(range(len(scores)), key=lambda i: -scores[i])
        if self.dense is not None:
            from .dense import rrf

            sims = self.emb @ self.dense.encode_query(query)
            ranked = rrf([ranked[:200], sorted(range(len(sims)), key=lambda i: -sims[i])[:200]])
        out = []
        for i in ranked:
            chunk = self.chunks[i]
            if pages and not any(chunk["page"].startswith(p) for p in pages):
                continue
            out.append({**chunk, "score": float(scores[i])})
            if len(out) == k:
                break
        return out
