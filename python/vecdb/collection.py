import os
import json
import sqlite3
import time
import math
import re
import difflib
from collections import Counter
from typing import Dict, Any, List, Optional
import numpy as np
import libvecdb
from vecdb.embedder import embedder

def _clean_glyph_artifacts(text: str) -> str:
    """Normalize extracted text, decode HTML entities, and remove markup/CSS/glyph artifacts."""
    if not text:
        return ""
    import html
    # 1. Deep strip script/style/svg/noscript contents with DOTALL
    t = re.sub(r'<(script|style|svg|noscript)\b.*?</\1>', ' ', text, flags=re.IGNORECASE | re.DOTALL)
    # 2. Convert block tags to line breaks
    t = re.sub(r'<(?:p|div|h[1-6]|li|tr|br|section|article|header|footer|nav|aside)\b[^>]*>', '\n', t, flags=re.IGNORECASE)
    # 3. Strip all remaining HTML/XML tags
    t = re.sub(r'<[^>]+>', ' ', t, flags=re.DOTALL)
    # 4. Decode HTML entities
    t = html.unescape(t)
    # 5. Clean any residual brackets or tags exposed after unescaping
    t = re.sub(r'<[^>]+>', ' ', t)
    # 6. Strip residual CSS declarations like { ... } or @media
    t = re.sub(r'\{[^{}]*\}', ' ', t)
    t = re.sub(r'@[a-zA-Z-]+\s*[^;]*;', ' ', t)
    # 7. Normalize typography and glyphs
    t = t.replace('\ufffd', '-')
    t = t.replace('\x83', ' ')
    t = t.replace('ƒ', ' ')
    t = t.replace('§', ' ')
    t = t.replace('ï', ' ')
    t = re.sub(r'[•\u2022\u2023\u25E6\u2043\u2219]', '•', t)
    t = re.sub(r'[\u2013\u2014\x96\x97]', '-', t)
    t = re.sub(r'#\s*([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)', r'Email: \1', t)
    t = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '', t)
    t = re.sub(r'^\s*\|\s*$', '', t, flags=re.MULTILINE)
    lines = [re.sub(r'[^\S\r\n]+', ' ', l).strip() for l in t.splitlines()]
    cleaned = []
    prev_blank = False
    for l in lines:
        l_lower = l.lower()
        if not l or any(cw in l_lower for cw in ['--panel:', 'stylesheet', 'doctype', '<meta', '<link', 'width=device-width']):
            if not prev_blank:
                cleaned.append("")
                prev_blank = True
        else:
            cleaned.append(l)
            prev_blank = False
    return "\n".join(cleaned).strip()

def _extract_clean_sentences(text: str) -> List[str]:
    """
    Splits passage into clean, well-formed, complete sentences and bullet items.
    Performs paragraph un-wrapping, hyphenated word rejoining, and table/TOC filtering.
    """
    cleaned = _clean_glyph_artifacts(text)
    # Fix hyphenated words broken across line breaks (e.g. "re-\npositioning" -> "repositioning")
    cleaned = re.sub(r'(\w+)-\s*\n\s*([a-z]+)', r'\1\2', cleaned)
    raw_lines = [l.strip() for l in cleaned.splitlines() if l.strip()]

    blocks = []
    curr = []
    for l in raw_lines:
        line_lower = l.lower()
        if any(cw in line_lower for cw in ['@gmail.com', 'linkedin.com', 'github.com', 'phone', 'all rights reserved', '<', '>', '{', '}', ';']):
            continue

        # Drop Table of Contents dot leaders (e.g. ". . . . . . . . . . 14")
        if re.search(r'\.\s*\.\s*\.\s*\.', l):
            if curr:
                blocks.append(' '.join(curr))
                curr = []
            continue

        # Drop Table / Figure captions and legends (e.g. "Table 1: ...", "Figure 2: ...")
        if re.search(r'\b(?:table|figure|fig\.|chart|diagram|box|appendix)\s+\d+[\.:\s\-]', l, re.I):
            if curr:
                blocks.append(' '.join(curr))
                curr = []
            continue

        is_bullet = l.startswith(('•', '-', '*', '–')) or bool(re.match(r'^\d+[\.\)]\s+', l))
        is_header = len(l) < 35 and (not l.endswith(('.', '!', '?')) or l.isupper() or bool(re.match(r'^(?:[0-9]+(?:\.[0-9]+)*\s+)?[A-Z][a-zA-Z0-9\s]{2,30}$', l)))

        if is_bullet or is_header:
            if curr:
                blocks.append(' '.join(curr))
                curr = []
            if is_bullet:
                curr.append(l)
            else:
                blocks.append(l)
            continue

        if curr and curr[-1].endswith(('.', '!', '?')):
            blocks.append(' '.join(curr))
            curr = []
        curr.append(l)

    if curr:
        blocks.append(' '.join(curr))

    sentences = []
    seen = set()
    for block in blocks:
        block_clean = block.strip()
        if not block_clean:
            continue

        if block_clean.startswith(('•', '-', '*', '–')):
            item = block_clean.lstrip('•-*– ').strip()
            if len(item) >= 30 and not item.endswith(':'):
                if not item.endswith(('.', '!', '?')):
                    item = item + '.'
                item_lower = item.lower()
                if item_lower not in seen and _is_substantive_sentence(item):
                    seen.add(item_lower)
                    sentences.append(item)
        else:
            sub = re.split(r'(?<=[.!?])\s+(?=[A-Z0-9])', block_clean)
            for s in sub:
                sc = s.strip()
                if len(sc) >= 35 and sc.endswith(('.', '!', '?')) and not sc.endswith(':'):
                    last_word = re.findall(r'[a-zA-Z0-9]+', sc.rstrip('.!?'))[-1].lower() if re.findall(r'[a-zA-Z0-9]+', sc.rstrip('.!?')) else ''
                    if last_word not in {'how', 'to', 'at', 'of', 'for', 'in', 'on', 'with', 'by', 'from', 'that', 'which', 'and', 'or', 'as', 'is', 'are', 'be', 'up', 'the', 'a', 'an'}:
                        sc_lower = sc.lower()
                        if sc_lower not in seen and _is_substantive_sentence(sc):
                            seen.add(sc_lower)
                            sentences.append(sc)
    return sentences

def _is_substantive_sentence(s: str) -> bool:
    """Filters out UI breadcrumbs, diagram captions, table legends, TOC artifacts, and disclaimers."""
    sc = s.strip()
    if len(sc) < 40 or len(sc.split()) < 6:
        return False
    # Filter TOC dot leaders
    if re.search(r'\.\s*\.\s*\.\s*\.', sc):
        return False
    # Filter Table and Figure captions anywhere in sentence
    if re.search(r'\b(?:table|figure|fig\.|chart|diagram|box|appendix)\s+\d+[\.:\s\-]', sc, re.I):
        return False
    # Filter empty meta-disclaimers & negative notes
    if re.search(r'\b(?:has not been implemented yet|contains no measurements|no empirical results|design projections|risk register|likelihood, i = impact)\b', sc, re.I):
        return False
    # Filter navigational artifacts
    if re.match(r'^(?:left|right|top|bottom|figure|fig\.|table|slide|note|source|ref|see|page|chapter)\s*[:\.\-]', sc, re.I):
        return False
    return True

_IS_DEF_PATTERN = re.compile(
    r'\b(?:is an?|was an?|serves as|acts as|aims to|designed to|developed to|built to|features|consists of|engineered to|models|simulates)\b|'
    r'\b(?:sets?\s+out|outlines?|details?|presents?|describes?|specifies?|introduces?|proposes?)\s+(?:the\s+)?(?:design|architecture|framework|implementation|specification|system|model|approach|overview|methodology)\s+of\b|'
    r'\b(?:is|was|serves as)\s+(?:an?|the)\s+[a-zA-Z-]+\s+(?:engine|platform|system|framework|model|architecture|simulation|database|tool)\b',
    re.I
)

def _matches_intent(query_lower: str, keywords: List[str]) -> bool:
    """Typo-tolerant intent matching using substring and SequenceMatcher ratio."""
    tokens = re.findall(r'[a-zA-Z]+', query_lower)
    for token in tokens:
        for kw in keywords:
            if kw in token or token in kw:
                return True
            if len(token) >= 4 and len(kw) >= 4:
                if difflib.SequenceMatcher(None, token, kw).ratio() >= 0.76:
                    return True
    return False

_STOPWORDS = {
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
    'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
    'can', 'couldn', 'd', 'did', 'didn', 'do', 'does', 'doesn', 'doing', 'don', 'down', 'during', 'each',
    'few', 'for', 'from', 'further', 'had', 'hadn', 'has', 'hasn', 'have', 'haven', 'having', 'he', 'her',
    'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'isn', 'it',
    'its', 'itself', 'just', 'll', 'm', 'ma', 'me', 'mightn', 'more', 'most', 'mustn', 'my', 'myself',
    'needn', 'no', 'nor', 'not', 'now', 'o', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our',
    'ours', 'ourselves', 'out', 'over', 'own', 're', 's', 'same', 'shan', 'she', 'should', 'shouldn', 'so',
    'some', 'such', 't', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
    'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 've', 'very', 'was',
    'wasn', 'we', 'were', 'weren', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will',
    'with', 'won', 'wouldn', 'y', 'you', 'your', 'yours', 'yourself', 'yourselves', 'explain', 'tell', 'give'
}

class Collection:
    def __init__(self, name: str, dim: int = 384, index_type: str = "hnsw", metric: str = "cosine", storage_dir: str = "data"):
        self.name = name
        self.dim = dim
        self.index_type = index_type.lower() # "hnsw", "flat", "ivf"
        self.metric_name = metric.lower() # "cosine", "l2", "inner_product"
        self.storage_dir = os.path.join(storage_dir, name)
        os.makedirs(self.storage_dir, exist_ok=True)

        if self.metric_name == "cosine":
            self.metric = libvecdb.MetricType.COSINE
        elif self.metric_name == "inner_product":
            self.metric = libvecdb.MetricType.INNER_PRODUCT
        else:
            self.metric = libvecdb.MetricType.L2

        # Initialize Index
        if self.index_type == "hnsw":
            cfg = libvecdb.HNSWConfig()
            cfg.M = 32
            cfg.M0 = 64
            cfg.efConstruction = 200
            cfg.efSearch = 128
            self.index = libvecdb.HNSWIndex(self.dim, self.metric, cfg)
        elif self.index_type == "ivf":
            self.index = libvecdb.IVFIndex(self.dim, 16, 4, self.metric)
        else:
            self.index = libvecdb.FlatIndex(self.dim, self.metric)

        # WAL and SQLite Metadata Store
        self.wal_path = os.path.join(self.storage_dir, f"{name}.wal")
        self.wal = libvecdb.WriteAheadLog(self.wal_path)

        self.db_path = os.path.join(self.storage_dir, f"{name}_meta.db")
        self._init_sqlite()

        # Query metrics tracking
        self.query_count = 0
        self.latencies_ms = []

        # Warm up & restore index from persisted SQLite metadata on startup
        self._restore_from_storage()

    def _init_sqlite(self):
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS metadata (
                id INTEGER PRIMARY KEY,
                title TEXT,
                content TEXT,
                category TEXT,
                created_at REAL,
                extra_json TEXT,
                vector_json TEXT
            )
        """)
        cur.execute("PRAGMA table_info(metadata)")
        cols = [info[1] for info in cur.fetchall()]
        if "vector_json" not in cols:
            cur.execute("ALTER TABLE metadata ADD COLUMN vector_json TEXT")
        conn.commit()
        conn.close()

    def _restore_from_storage(self):
        """
        Restores vectors from SQLite into the in-memory HNSW/Flat index upon server start.
        """
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute("SELECT id, title, content, vector_json FROM metadata")
        rows = cur.fetchall()
        conn.close()

        loaded_count = 0
        for doc_id, title, content, vec_json in rows:
            if vec_json:
                try:
                    vec = json.loads(vec_json)
                    if len(vec) == self.dim:
                        self.index.add(doc_id, vec)
                        loaded_count += 1
                        continue
                except Exception:
                    pass
            try:
                vec = embedder.embed_text((title or "") + " " + (content or ""))
                self.index.add(doc_id, vec)
                loaded_count += 1
                conn = sqlite3.connect(self.db_path)
                c = conn.cursor()
                c.execute("UPDATE metadata SET vector_json = ? WHERE id = ?", (json.dumps(vec), doc_id))
                conn.commit()
                conn.close()
            except Exception as e:
                print(f"[Collection {self.name}] Failed to restore vector for doc {doc_id}: {e}")

        if loaded_count > 0:
            print(f"[Collection {self.name}] Restored {loaded_count} vectors into memory index from SQLite.")

    def insert(self, doc_id: int, vector: List[float], metadata: Dict[str, Any]):
        if len(vector) != self.dim:
            raise ValueError(f"Vector dim {len(vector)} does not match index dim {self.dim}")

        # 1. Log to WAL
        meta_str = json.dumps(metadata)
        self.wal.log_insert(doc_id, vector, meta_str)

        # 2. Add to C++ index
        self.index.add(doc_id, vector)

        # 3. Save to Metadata DB with vector_json
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute("""
            INSERT OR REPLACE INTO metadata (id, title, content, category, created_at, extra_json, vector_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            doc_id,
            metadata.get("title", ""),
            metadata.get("content", ""),
            metadata.get("category", "general"),
            time.time(),
            meta_str,
            json.dumps(vector)
        ))
        conn.commit()
        conn.close()

    def _synthesize_answer(self, query: str, hits: List[Dict[str, Any]], search_mode: str = 'smart') -> Optional[Dict[str, Any]]:
        """
        Universal, generalized multi-intent answer synthesis engine.
        Handles summary, overview, mechanism, factual QA, and structured profiles for ANY document format.
        Differentiates answers based on search_mode ('smart', 'meaning', 'exact').
        """
        if not hits or not query or not query.strip():
            return None

        q_clean = query.strip()
        q_lower = q_clean.lower()
        q_words = re.findall(r'[a-zA-Z0-9]+', q_lower)
        q_tokens = [w for w in q_words if w not in _STOPWORDS and len(w) >= 2] or q_words

        # Dynamically extract person/entity if specified in query
        target_entity = None
        m_ent = re.search(r'\b(?:of|for|about|who is|contact)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)', q_clean, re.IGNORECASE)
        if m_ent:
            ent_candidate = m_ent.group(1).strip()
            if ent_candidate.lower() not in {'the', 'this', 'that', 'a', 'an', 'project', 'system', 'file', 'paper', 'candidate', 'document', 'dataset', 'code', 'model'}:
                target_entity = ent_candidate.title()

        # Prioritize hits matching target entity if present
        relevant_hits = hits
        if target_entity:
            matched = [h for h in hits if target_entity.lower() in ((h.get('title') or '') + ' ' + (h.get('content') or '')).lower()]
            if matched:
                relevant_hits = matched

        top_hit = relevant_hits[0]
        top_title = top_hit.get('source_file') or top_hit.get('title') or 'Document'
        clean_top_title = re.sub(r'\.[a-zA-Z0-9]+$', '', top_title).replace('_', ' ').replace('-', ' ').strip()
        display_title = " ".join([w.capitalize() if not w.isupper() else w for w in clean_top_title.split() if w])

        # INTENT 1: EDUCATION / DEGREES
        if any(k in q_lower for k in ['education', 'degree', 'college', 'university', 'study', 'qualification', 'bachelor', 'master', 'cgpa', 'school', 'academics']):
            for h in relevant_hits[:4]:
                content = h.get('content', '')
                m = re.search(r'Education\s*[\r\n]+(.*?)(?=(?:\n\s*(?:Projects|Technical Skills|Experience|Skills|Achievements|Coursework)|\Z))', content, re.IGNORECASE | re.DOTALL)
                if m:
                    raw_lines = [_clean_glyph_artifacts(l).strip() for l in m.group(1).splitlines() if len(l.strip()) > 2]
                    clean_lines = [l for l in raw_lines if not any(cw in l.lower() for cw in ['phone', 'email', 'gmail', 'linkedin', 'github', '@', '|'])]
                    if clean_lines:
                        person_label = target_entity or "Candidate"
                        edu_items = []
                        idx = 0
                        while idx < len(clean_lines):
                            cur = clean_lines[idx].lstrip('•-– ')
                            if idx + 1 < len(clean_lines) and any(yr in clean_lines[idx+1] for yr in ['202', '201', '199', 'Aug', 'May', 'June', 'July', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'Sep', 'Oct', 'Nov']):
                                cur = f"{cur} ({clean_lines[idx+1].lstrip('•-– ')})"
                                idx += 2
                            else:
                                idx += 1
                            edu_items.append(f"• {cur}")

                        return {
                            'text': f"**Education Profile ({person_label}):**\n" + "\n".join(edu_items),
                            'source': top_title,
                            'confidence': min(99.0, max(85.0, round(float(top_hit.get('similarity', 0.8) * 100), 1))),
                            'synthesis_type': 'Structured Academic Profile',
                            'mode_label': 'Smart Hybrid' if search_mode == 'smart' else ('Pure Meaning' if search_mode == 'meaning' else 'Exact Keyword')
                        }

        # INTENT 2: SKILLS / TECHNOLOGIES
        if any(k in q_lower for k in ['skill', 'skills', 'technology', 'technologies', 'tech stack', 'framework', 'frameworks', 'tools', 'languages', 'libraries']):
            for h in relevant_hits[:4]:
                content = h.get('content', '')
                m = re.search(r'(?:Technical Skills|Skills)\s*[\r\n]+(.*?)(?=(?:\n\s*(?:Projects|Achievements|Education|Experience)|\Z))', content, re.IGNORECASE | re.DOTALL)
                if m:
                    raw_lines = [_clean_glyph_artifacts(l).strip() for l in m.group(1).splitlines() if len(l.strip()) > 1]
                    formatted_bullets = []
                    for l in raw_lines:
                        if len(l) > 2 and not any(cw in l.lower() for cw in ['@', 'phone', 'linkedin']):
                            formatted_bullets.append(f"• {l.lstrip('•-*– ')}")
                    if formatted_bullets:
                        person_label = target_entity or display_title
                        return {
                            'text': f"**Technical Skills & Tooling ({person_label}):**\n" + "\n".join(formatted_bullets[:8]),
                            'source': top_title,
                            'confidence': min(99.0, max(85.0, round(float(top_hit.get('similarity', 0.8) * 100), 1))),
                            'synthesis_type': 'Technical Skills Matrix',
                            'mode_label': 'Smart Hybrid' if search_mode == 'smart' else ('Pure Meaning' if search_mode == 'meaning' else 'Exact Keyword')
                        }

        # INTENT 3: SUMMARY / OVERVIEW / WHAT IS PROJECT ABOUT
        is_summary_query = any(w in q_lower for w in [
            'summary', 'summarize', 'about', 'overview', 'purpose', 'objective', 'goal',
            'brief', 'synopsis', 'what is', 'what are', 'describe', 'explain', 'background', 'intro'
        ])

        is_how_query = any(w in q_lower for w in [
            'how', 'mechanism', 'operate', 'work', 'working', 'flow', 'pipeline', 'process', 'steps'
        ])

        # Extract sentences from the top hits pool
        hits_pool = relevant_hits[:4]

        candidate_sentences = []
        seen_sents = set()
        exact_phrase = query.lower().strip()
        for rank, h in enumerate(hits_pool):
            sents = _extract_clean_sentences(h.get('content', ''))
            h_weight = 1.0 / (1.0 + rank * 0.25)
            h_dense_sim = float(h.get('dense_similarity', 0.7))
            h_lex_score = float(h.get('lexical_score', 0.3))

            for s_idx, s in enumerate(sents):
                s_clean = s.strip()
                s_norm = s_clean.lower()
                if s_norm in seen_sents:
                    continue
                seen_sents.add(s_norm)

                if not _is_substantive_sentence(s_clean):
                    continue

                s_words = set(re.findall(r'[a-zA-Z0-9]+', s_norm))
                overlap = sum(1 for tok in q_tokens if tok in s_words)

                # Definitional & conceptual markers
                is_def = bool(_IS_DEF_PATTERN.search(s_clean))
                is_cap = bool(re.search(r'\b(?:built|evaluated|achieved|deployed|reduced|scaled|optimized|delivering|recorded|modeled|engineered|supports|matched|solves|computes|dispatches)\b', s_norm))
                has_metric = bool(re.search(r'\b(?:\d+(?:\.\d+)?%\b|\d+(?:\.\d+)?\s*(?:ms|fps|hz|khz|mhz|ghz|kb|mb|gb|tb|km|mi|min|sec|s)\b|\d+x\b|\b\d{2,}\s*(?:vehicles|requests|nodes|calls|queries|operations|params|parameters|layers|records)\b)', s_norm))
                has_exact_phrase = bool(len(exact_phrase) > 5 and exact_phrase in s_norm)

                pos_bonus = 1.8 if (rank == 0 and s_idx < 3) else 1.0

                if search_mode == 'meaning':
                    # Pure Meaning: prioritizes dense semantic conceptual definitions and high-level architectural purpose
                    score = (h_dense_sim * 4.0) + (5.0 if is_def else 0.0) + (2.0 if is_cap else 0.0) + (overlap * 0.5) + (pos_bonus * 1.5)
                elif search_mode == 'exact':
                    # Exact Keyword: prioritizes verbatim keyword frequency, exact phrase presence, and specific metrics
                    score = (overlap * 5.0) + (8.0 if has_exact_phrase else 0.0) + (4.0 if is_def else 0.0) + (3.0 if has_metric else 0.0) + (h_lex_score * 4.0) + (pos_bonus * 1.0)
                else:
                    # Smart Hybrid: balanced synthesis
                    score = (overlap * 2.5 + (5.0 if is_def else 0.0) + (1.8 if is_cap else 0.0) + (2.0 if has_metric else 0.0)) * pos_bonus * h_weight

                candidate_sentences.append({
                    'text': s_clean,
                    'score': score,
                    'is_def': is_def,
                    'is_cap': is_cap,
                    'has_metric': has_metric,
                    'has_exact_phrase': has_exact_phrase,
                    'overlap': overlap
                })

        candidate_sentences.sort(key=lambda x: x['score'], reverse=True)

        if is_summary_query and candidate_sentences:
            if search_mode == 'meaning':
                # Meaning mode: select high-level conceptual definition followed by architectural principles
                def_sents = [c for c in candidate_sentences if c['is_def'] or c['is_cap']]
                primary_summary = def_sents[0]['text'] if def_sents else candidate_sentences[0]['text']
                highlights = []
                for c in candidate_sentences:
                    if c['text'] != primary_summary and len(c['text']) > 30 and (c['is_def'] or c['is_cap']):
                        if not any(difflib.SequenceMatcher(None, c['text'], h).ratio() > 0.50 for h in highlights):
                            highlights.append(c['text'])
                        if len(highlights) >= 2:
                            break
                if not highlights:
                    highlights = [c['text'] for c in candidate_sentences if c['text'] != primary_summary][:2]

                header = f"**AI Conceptual Meaning & Architectural Intent ({display_title}):**"
                sub_header = "**Theoretical & Foundational Principles:**"
                mode_tag = "AI Meaning"

            elif search_mode == 'exact':
                # Exact mode: strictly requires exact keyword overlap in selected quotes
                exact_sents = [c for c in candidate_sentences if c['has_exact_phrase'] or c['overlap'] > 0]
                if exact_sents:
                    primary_summary = f'"{exact_sents[0]["text"]}"'
                    highlights = []
                    for c in exact_sents[1:]:
                        if c['text'] not in primary_summary and len(c['text']) > 24:
                            if not any(difflib.SequenceMatcher(None, c['text'], h.strip('"')).ratio() > 0.50 for h in highlights):
                                highlights.append(f'"{c["text"]}"')
                            if len(highlights) >= 2:
                                break
                else:
                    primary_summary = f'"{candidate_sentences[0]["text"]}"'
                    highlights = [f'"{c["text"]}"' for c in candidate_sentences[1:3]]

                header = f"**Exact Word Matches & Direct Citations ({display_title}):**"
                sub_header = "**Verbatim Passages & Quantitative Citations:**"
                mode_tag = "Exact Words"

            else:
                # Smart Hybrid: balanced executive summary + operational highlights
                def_sents = [c for c in candidate_sentences if c['is_def'] or c['overlap'] > 0]
                primary_summary = def_sents[0]['text'] if def_sents else candidate_sentences[0]['text']
                highlights = []
                for c in candidate_sentences:
                    if c['text'] != primary_summary and len(c['text']) > 28:
                        if not any(difflib.SequenceMatcher(None, c['text'], h).ratio() > 0.50 for h in highlights):
                            highlights.append(c['text'])
                        if len(highlights) >= 3:
                            break

                header = f"**Balanced Executive Summary ({display_title}):**"
                sub_header = "**Key Capabilities & Operational Highlights:**"
                mode_tag = "Balanced (Smart)"

            bullet_lines = "\n".join([f"• {h}" for h in highlights])
            formatted_text = f"{header}\n{primary_summary}\n\n{sub_header}\n{bullet_lines}"
            return {
                'text': formatted_text,
                'source': top_title,
                'confidence': min(98.8, max(82.0, round(float(top_hit.get('similarity', 0.8) * 100), 1))),
                'synthesis_type': 'Executive Summary & Purpose',
                'mode_label': mode_tag
            }

        elif is_how_query and candidate_sentences:
            if search_mode == 'meaning':
                header = f"**Conceptual Mechanics & Pipeline Flow ({display_title}):**"
                sub_header = "**Algorithmic & Theoretical Foundations:**"
                mode_tag = "Pure Meaning (Semantic)"
            elif search_mode == 'exact':
                header = f"**Exact Procedural Match ({display_title}):**"
                sub_header = "**Direct Execution Steps & Code References:**"
                mode_tag = "Exact Keyword (BM25)"
            else:
                header = f"**Operational Mechanics ({display_title}):**"
                sub_header = "**Technical Pipeline & Flow:**"
                mode_tag = "Smart Hybrid"

            how_sents = [c for c in candidate_sentences if re.search(r'\b(?:by|through|using|operates|implements|processes|calculates|flow|layer|vector|algorithm|simulates)\b', c['text'].lower())]
            lead_how = how_sents[0]['text'] if how_sents else candidate_sentences[0]['text']
            mechanisms = []
            for c in (how_sents[1:] + candidate_sentences):
                if c['text'] != lead_how and len(c['text']) > 28:
                    if not any(difflib.SequenceMatcher(None, c['text'], m).ratio() > 0.50 for m in mechanisms):
                        mechanisms.append(c['text'])
                    if len(mechanisms) >= 3:
                        break
            bullet_lines = "\n".join([f"• {m}" for m in mechanisms])
            formatted_text = f"{header}\n{lead_how}\n\n{sub_header}\n{bullet_lines}"
            return {
                'text': formatted_text,
                'source': top_title,
                'confidence': min(98.5, max(80.0, round(float(top_hit.get('similarity', 0.8) * 100), 1))),
                'synthesis_type': 'Operational Mechanics',
                'mode_label': mode_tag
            }

        elif candidate_sentences:
            if search_mode == 'meaning':
                header = f"**Thematic Concept Extraction ({display_title}):**"
                mode_tag = "Pure Meaning (Semantic)"
            elif search_mode == 'exact':
                header = f"**Exact Citation & Direct Evidence ({display_title}):**"
                mode_tag = "Exact Keyword (BM25)"
            else:
                header = f"**Key Finding ({display_title}):**"
                mode_tag = "Smart Hybrid"

            top_sents = []
            for c in candidate_sentences:
                if not any(difflib.SequenceMatcher(None, c['text'], ts).ratio() > 0.55 for ts in top_sents):
                    top_sents.append(c['text'])
                if len(top_sents) >= 3:
                    break

            if len(top_sents) == 1:
                body = top_sents[0]
            else:
                body = top_sents[0] + "\n\n" + "\n".join([f"• {s}" for s in top_sents[1:]])

            return {
                'text': f"{header}\n{body}",
                'source': top_title,
                'confidence': min(98.0, max(75.0, round(float(top_hit.get('similarity', 0.75) * 100), 1))),
                'synthesis_type': 'Direct Fact Extraction',
                'mode_label': mode_tag
            }

        return None

    def search(self, query_vec: List[float], query_text: Optional[str] = None, k: int = 10, ef: int = 64, filter_category: Optional[str] = None, hybrid_alpha: float = 0.5, search_mode: Optional[str] = None) -> Dict[str, Any]:
        """
        Universal hybrid search combining C++ HNSW / Flat vector similarity with BM25 keyword scoring.
        Differentiates between 'smart' (hybrid), 'meaning' (dense semantic), and 'exact' (lexical BM25).
        """
        t0 = time.perf_counter()
        
        # Candidate pool size: wide retrieval to ensure high recall across any query
        pool_size = max(k * 4, 150) if (query_text or filter_category) else k

        if self.index_type == "hnsw":
            raw_results = self.index.search(query_vec, pool_size, ef)
        elif self.index_type == "ivf":
            raw_results = self.index.search(query_vec, pool_size)
        else:
            raw_results = self.index.search(query_vec, pool_size, True)

        latency_ms = (time.perf_counter() - t0) * 1000.0
        self.query_count += 1
        self.latencies_ms.append(latency_ms)
        if len(self.latencies_ms) > 1000:
            self.latencies_ms.pop(0)

        # Resolve effective search mode
        effective_mode = search_mode.lower() if search_mode else ('meaning' if hybrid_alpha >= 0.85 else ('exact' if hybrid_alpha <= 0.25 else 'smart'))

        hits = []
        if raw_results:
            cand_ids = [r.id for r in raw_results]

            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            placeholders = ",".join("?" for _ in cand_ids)
            query_sql = f"SELECT id, title, content, category, created_at, extra_json FROM metadata WHERE id IN ({placeholders})"
            cur.execute(query_sql, cand_ids)
            rows = cur.fetchall()
            conn.close()

            row_map = {r[0]: r for r in rows}
            
            # Prepare query tokens for BM25 keyword scoring
            q_tokens = []
            if query_text:
                raw_toks = re.findall(r'[a-zA-Z0-9]+', query_text.lower())
                q_tokens = [t for t in raw_toks if t not in _STOPWORDS and len(t) >= 2]
                if not q_tokens:
                    q_tokens = raw_toks

            scored_candidates = []
            for res in raw_results:
                if res.id not in row_map:
                    continue
                row = row_map[res.id]
                cat = row[3]
                if filter_category and filter_category.lower() != "all" and cat.lower() != filter_category.lower():
                    continue

                raw_score = res.score
                if self.metric_name == "cosine":
                    vec_similarity = max(0.0, min(1.0, 1.0 - raw_score))
                elif self.metric_name == "inner_product":
                    vec_similarity = max(0.0, min(1.0, -raw_score))
                else:
                    vec_similarity = 1.0 / (1.0 + max(0.0, raw_score))

                # Lexical scoring with exact term & phrase matching
                content_lower = (row[2] or '').lower()
                title_lower = (row[1] or '').lower()
                
                content_tokens = Counter(re.findall(r'[a-zA-Z0-9]+', content_lower)) if q_tokens else Counter()
                title_tokens = set(re.findall(r'[a-zA-Z0-9]+', title_lower)) if q_tokens else set()
                
                content_hits = sum(1 for q in q_tokens if q in content_tokens)
                title_hits = sum(1 for q in q_tokens if q in title_tokens)

                # Mode-differentiated combination score
                if effective_mode == 'meaning':
                    # Pure AI Meaning: 100% semantic dense similarity
                    combined_score = vec_similarity
                    bm25_norm = 0.0
                elif effective_mode == 'exact':
                    # Exact Words: strictly requires exact keyword occurrences in body content
                    if content_hits > 0 or (query_text and len(query_text.strip()) > 4 and query_text.lower().strip() in content_lower):
                        lex_raw = (content_hits * 3.5) + (title_hits * 1.0)
                        for q in q_tokens:
                            if q in content_tokens:
                                lex_raw += math.log(1.0 + content_tokens[q]) * 2.0
                        if query_text and len(query_text.strip()) > 4 and query_text.lower().strip() in content_lower:
                            lex_raw += 8.0
                        bm25_norm = math.tanh(lex_raw / 4.0)
                        combined_score = (0.05 * vec_similarity) + (0.95 * bm25_norm)
                    else:
                        # No content match: severely deprioritize in exact mode
                        bm25_norm = 0.05 * math.tanh(title_hits)
                        combined_score = (0.10 * vec_similarity) + (0.90 * bm25_norm)
                else: # Smart mode (Hybrid)
                    lex_raw = (content_hits * 2.0) + (title_hits * 1.5)
                    for q in q_tokens:
                        if q in content_tokens:
                            lex_raw += math.log(1.0 + content_tokens[q]) * 1.0
                    if query_text and len(query_text.strip()) > 4 and query_text.lower().strip() in content_lower:
                        lex_raw += 4.5
                    bm25_norm = math.tanh(lex_raw / 3.0)
                    combined_score = (0.60 * vec_similarity) + (0.40 * bm25_norm)

                # Generate clean snippet with highlighting
                clean_content = _clean_glyph_artifacts(row[2] or '')
                snippet = clean_content[:300].strip()
                if q_tokens:
                    for qt in q_tokens[:3]:
                        pattern = re.compile(rf'({re.escape(qt)})', re.IGNORECASE)
                        snippet = pattern.sub(r'**\1**', snippet)

                # Parse extra_json to extract source_file
                source_file = None
                if row[5]:
                    try:
                        extra = json.loads(row[5])
                        source_file = extra.get("source_file")
                    except Exception:
                        pass
                if not source_file:
                    m = re.match(r'^(.*?)\s*\[part\s*\d+\]', row[1] or "")
                    if m:
                        source_file = m.group(1).strip()
                    elif (row[1] or "").endswith(('.pdf', '.txt', '.md', '.docx', '.pptx', '.html')):
                        source_file = (row[1] or "").strip()

                file_url = f"/api/files/{source_file}" if source_file else None

                scored_candidates.append({
                    "id": row[0],
                    "title": row[1],
                    "content": clean_content,
                    "snippet": snippet,
                    "category": row[3],
                    "source_file": source_file,
                    "file_url": file_url,
                    "similarity": round(float(combined_score), 4),
                    "dense_similarity": round(float(vec_similarity), 4),
                    "lexical_score": round(float(bm25_norm), 4),
                    "raw_score": round(float(raw_score), 4)
                })

            scored_candidates.sort(key=lambda x: x["similarity"], reverse=True)
            hits = scored_candidates[:k]

        # Synthesize direct answer from top matching content using the resolved search mode
        direct_answer = self._synthesize_answer(query_text or "", hits, search_mode=effective_mode)

        return {
            "query_latency_ms": round(latency_ms, 3),
            "total_matches": len(hits),
            "search_mode": effective_mode,
            "direct_answer": direct_answer,
            "hits": hits
        }

    def delete(self, doc_id: int) -> bool:
        self.wal.log_delete(doc_id)
        idx_removed = self.index.remove(doc_id)
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute("DELETE FROM metadata WHERE id = ?", (doc_id,))
        rows_affected = cur.rowcount
        conn.commit()
        conn.close()
        return idx_removed or rows_affected > 0

    def clear(self) -> bool:
        """Completely purges all vectors and metadata from index, SQLite, and WAL."""
        if self.index_type == "hnsw":
            cfg = libvecdb.HNSWConfig()
            cfg.M = 32
            cfg.M0 = 64
            cfg.efConstruction = 200
            cfg.efSearch = 128
            self.index = libvecdb.HNSWIndex(self.dim, self.metric, cfg)
        elif self.index_type == "ivf":
            self.index = libvecdb.IVFIndex(self.dim, 16, 4, self.metric)
        else:
            self.index = libvecdb.FlatIndex(self.dim, self.metric)

        try:
            del self.wal
            if os.path.exists(self.wal_path):
                os.remove(self.wal_path)
            self.wal = libvecdb.WriteAheadLog(self.wal_path)
        except Exception:
            pass

        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute("DELETE FROM metadata")
        conn.commit()
        cur.execute("VACUUM")
        conn.close()

        self.query_count = 0
        self.latencies_ms = []
        return True

    def stats(self) -> Dict[str, Any]:
        p50 = float(np.percentile(self.latencies_ms, 50)) if self.latencies_ms else 0.0
        p95 = float(np.percentile(self.latencies_ms, 95)) if self.latencies_ms else 0.0
        p99 = float(np.percentile(self.latencies_ms, 99)) if self.latencies_ms else 0.0
        
        level_counts = []
        max_level = 0
        if self.index_type == "hnsw":
            level_counts = self.index.get_level_counts()
            max_level = self.index.get_max_level()

        # Count records in sqlite
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM metadata")
        meta_count = cur.fetchone()[0]
        conn.close()

        # Estimated memory footprint
        bytes_per_vector = self.dim * 4
        if self.index_type == "hnsw":
            bytes_per_vector += 32 * 8 # graph edges
        estimated_mem_mb = (self.index.size() * bytes_per_vector) / (1024 * 1024)

        return {
            "name": self.name,
            "dimension": self.dim,
            "index_type": self.index_type,
            "metric": self.metric_name,
            "vector_count": self.index.size(),
            "metadata_record_count": meta_count,
            "memory_usage_mb": round(estimated_mem_mb, 2),
            "total_queries": self.query_count,
            "latency_p50_ms": round(p50, 3),
            "latency_p95_ms": round(p95, 3),
            "latency_p99_ms": round(p99, 3),
            "hnsw_max_level": max_level,
            "hnsw_level_distribution": level_counts
        }

    def save(self):
        idx_file = os.path.join(self.storage_dir, f"{self.name}.idx")
        self.index.save(idx_file)

    def load(self):
        idx_file = os.path.join(self.storage_dir, f"{self.name}.idx")
        if os.path.exists(idx_file):
            self.index.load(idx_file)
