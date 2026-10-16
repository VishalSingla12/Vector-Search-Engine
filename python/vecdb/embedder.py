import numpy as np
import re
from typing import List, Optional

class TextEmbeddingPipeline:
    """
    Production dense semantic embedding pipeline.
    Primary engine: ONNX-quantized FastEmbed (BAAI/bge-small-en-v1.5) producing 384-dim normalized vectors.
    Fallback engine: Subword n-gram TF-IDF projection with unit normalization if offline.
    """
    def __init__(self, dim: int = 384):
        self.dim = dim
        self._model = None
        self._engine_name = "fastembed"
        
        # Try initializing FastEmbed
        try:
            from fastembed import TextEmbedding
            # BAAI/bge-small-en-v1.5 is a leading 384-dim semantic retrieval model
            self._model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
            self._engine_name = "bge-small-en-v1.5 (fastembed)"
            print(f"[Embedder] Successfully loaded FastEmbed neural model: {self._engine_name}")
        except Exception as e:
            print(f"[Embedder] FastEmbed initialization warning: {e}. Falling back to high-res projection.")
            self._init_fallback()

    def _init_fallback(self):
        self._engine_name = "sparse-dense-fallback"
        rng = np.random.RandomState(42)
        self.vocab_size = 8192
        self.projection = rng.randn(self.vocab_size, self.dim).astype(np.float32)
        self.projection /= np.linalg.norm(self.projection, axis=0, keepdims=True)

    def _fallback_embed(self, text: str) -> List[float]:
        text_lower = text.lower()
        words = re.findall(r'\b[a-z0-9_-]+\b', text_lower)
        tokens = []
        for word in words:
            h = (hash(word) % self.vocab_size + self.vocab_size) % self.vocab_size
            tokens.append(h)
            if len(word) >= 3:
                for i in range(len(word) - 2):
                    ngram = word[i:i+3]
                    nh = (hash(ngram) % self.vocab_size + self.vocab_size) % self.vocab_size
                    tokens.append(nh)
        if not tokens:
            vec = np.zeros(self.dim, dtype=np.float32)
            vec[0] = 1.0
            return vec.tolist()
        
        counts = np.bincount(tokens, minlength=self.vocab_size).astype(np.float32)
        nonzero_mask = counts > 0
        counts[nonzero_mask] = 1.0 + np.log(counts[nonzero_mask])
        dense_vec = counts @ self.projection
        norm = np.linalg.norm(dense_vec)
        if norm > 0:
            dense_vec /= norm
        return dense_vec.astype(np.float32).tolist()

    def embed_text(self, text: str) -> List[float]:
        if not text or not text.strip():
            vec = [0.0] * self.dim
            vec[0] = 1.0
            return vec
        
        if self._model is not None:
            try:
                # fastembed returns generator of ndarray
                gen = self._model.embed([text])
                for v in gen:
                    arr = np.array(v, dtype=np.float32)
                    norm = np.linalg.norm(arr)
                    if norm > 0:
                        arr = arr / norm
                    return arr.tolist()
            except Exception as e:
                print(f"[Embedder] Error during neural embedding: {e}, falling back")
                return self._fallback_embed(text)
        
        return self._fallback_embed(text)

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        if self._model is not None:
            try:
                gen = self._model.embed(texts)
                results = []
                for v in gen:
                    arr = np.array(v, dtype=np.float32)
                    norm = np.linalg.norm(arr)
                    if norm > 0:
                        arr = arr / norm
                    results.append(arr.tolist())
                return results
            except Exception as e:
                print(f"[Embedder] Error in batch embed: {e}, falling back")
                return [self._fallback_embed(t) for t in texts]
        return [self._fallback_embed(t) for t in texts]

# Singleton instance
embedder = TextEmbeddingPipeline(dim=384)
