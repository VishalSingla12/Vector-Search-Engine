import sys
import os
import sqlite3
import json
import time

sys.path.append(os.path.abspath("python"))
from vecdb.embedder import embedder

def reindex_all():
    db_path = os.path.join("data", "knowledge_base", "knowledge_base_meta.db")
    if not os.path.exists(db_path):
        print(f"Database {db_path} does not exist.")
        return

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT id, title, content FROM metadata")
    rows = cur.fetchall()
    print(f"[Migration] Found {len(rows)} rows to re-embed with FastEmbed neural pipeline...")
    t0 = time.time()

    batch_size = 16
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i+batch_size]
        doc_ids = [c[0] for c in chunk]
        texts = [(c[1] or "") + " " + (c[2] or "") for c in chunk]
        vectors = embedder.embed_batch(texts)
        for doc_id, vec in zip(doc_ids, vectors):
            cur.execute("UPDATE metadata SET vector_json = ? WHERE id = ?", (json.dumps(vec), doc_id))
        conn.commit()
        print(f"[Migration] Re-embedded {min(i+batch_size, len(rows))}/{len(rows)} in {time.time()-t0:.2f}s")

    conn.close()
    print(f"[Migration] Successfully re-embedded all {len(rows)} items in {time.time()-t0:.2f}s!")

if __name__ == "__main__":
    reindex_all()
