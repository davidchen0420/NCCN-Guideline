"""Dense retrieval with MedCPT (NCBI; query and article encoders), run locally on CPU, and
fused with BM25 by reciprocal rank fusion. Chunk embeddings are cached next to the chunks.
"""
import hashlib
import json
from pathlib import Path

import numpy as np

QUERY_MODEL = "ncbi/MedCPT-Query-Encoder"
ARTICLE_MODEL = "ncbi/MedCPT-Article-Encoder"


class MedCPT:
    def __init__(self):
        import torch
        from transformers import AutoModel, AutoTokenizer

        self.torch = torch
        self.q_tok = AutoTokenizer.from_pretrained(QUERY_MODEL)
        self.q_model = AutoModel.from_pretrained(QUERY_MODEL).eval()
        self.a_tok = AutoTokenizer.from_pretrained(ARTICLE_MODEL)
        self.a_model = AutoModel.from_pretrained(ARTICLE_MODEL).eval()

    def encode_chunks(self, chunks, batch=16):
        out = []
        with self.torch.no_grad():
            for i in range(0, len(chunks), batch):
                pairs = [[c["page"], c["text"]] for c in chunks[i:i + batch]]
                enc = self.a_tok(pairs, truncation=True, padding=True, return_tensors="pt", max_length=512)
                out.append(self.a_model(**enc).last_hidden_state[:, 0, :].numpy())
        return np.vstack(out)

    def encode_query(self, query):
        with self.torch.no_grad():
            enc = self.q_tok([query], truncation=True, padding=True, return_tensors="pt", max_length=64)
            return self.q_model(**enc).last_hidden_state[:, 0, :].numpy()[0]


def chunk_embeddings(chunks, cache_dir, model):
    key = hashlib.sha1(json.dumps([c["text"] for c in chunks]).encode()).hexdigest()[:12]
    path = Path(cache_dir) / f"medcpt_{key}.npy"
    if path.exists():
        return np.load(path)
    emb = model.encode_chunks(chunks)
    np.save(path, emb)
    return emb


def rrf(rankings, k=60):
    """Reciprocal rank fusion of several ranked lists of indices."""
    scores = {}
    for ranking in rankings:
        for rank, idx in enumerate(ranking):
            scores[idx] = scores.get(idx, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores, key=lambda i: -scores[i])
