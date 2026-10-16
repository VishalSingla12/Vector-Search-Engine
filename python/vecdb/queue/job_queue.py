import sqlite3
import time
import json
import threading
from typing import Dict, Any, List, Optional

class JobQueue:
    def __init__(self, db_path: str = "data/jobs.db"):
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self):
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ingestion_jobs (
                    job_id TEXT PRIMARY KEY,
                    filename TEXT,
                    filesize INTEGER,
                    collection TEXT,
                    status TEXT,
                    chunks_processed INTEGER,
                    chunks_total INTEGER,
                    throughput_cps REAL,
                    error_message TEXT,
                    created_at REAL,
                    updated_at REAL
                )
            """)
            conn.commit()
            conn.close()

    def create_job(self, job_id: str, filename: str, filesize: int, collection: str) -> Dict[str, Any]:
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            now = time.time()
            cur.execute("""
                INSERT OR REPLACE INTO ingestion_jobs 
                (job_id, filename, filesize, collection, status, chunks_processed, chunks_total, throughput_cps, error_message, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'QUEUED', 0, 0, 0.0, '', ?, ?)
            """, (job_id, filename, filesize, collection, now, now))
            conn.commit()
            conn.close()
        return self.get_job(job_id)

    def update_progress(self, job_id: str, status: str, processed: int, total: int = 0, throughput: float = 0.0, error: str = ""):
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            now = time.time()
            cur.execute("""
                UPDATE ingestion_jobs 
                SET status = ?, chunks_processed = ?, chunks_total = MAX(chunks_total, ?), throughput_cps = ?, error_message = ?, updated_at = ?
                WHERE job_id = ?
            """, (status, processed, total, throughput, error, now, job_id))
            conn.commit()
            conn.close()

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute("SELECT job_id, filename, filesize, collection, status, chunks_processed, chunks_total, throughput_cps, error_message, created_at, updated_at FROM ingestion_jobs WHERE job_id = ?", (job_id,))
        row = cur.fetchone()
        conn.close()
        if not row:
            return None
        return {
            "job_id": row[0],
            "filename": row[1],
            "filesize": row[2],
            "collection": row[3],
            "status": row[4],
            "chunks_processed": row[5],
            "chunks_total": row[6],
            "throughput_cps": row[7],
            "error_message": row[8],
            "created_at": row[9],
            "updated_at": row[10]
        }

    def list_jobs(self, limit: int = 50) -> List[Dict[str, Any]]:
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute("""
            SELECT job_id, filename, filesize, collection, status, chunks_processed, chunks_total, throughput_cps, error_message, created_at, updated_at 
            FROM ingestion_jobs 
            ORDER BY created_at DESC LIMIT ?
        """, (limit,))
        rows = cur.fetchall()
        conn.close()
        jobs = []
        for row in rows:
            jobs.append({
                "job_id": row[0],
                "filename": row[1],
                "filesize": row[2],
                "collection": row[3],
                "status": row[4],
                "chunks_processed": row[5],
                "chunks_total": row[6],
                "throughput_cps": row[7],
                "error_message": row[8],
                "created_at": row[9],
                "updated_at": row[10]
            })
        return jobs

    def delete_jobs_by_filename(self, filename: str):
        import re
        clean_target = filename.lower().strip()
        clean_no_ext = os.path.splitext(clean_target)[0]
        space_no_ext = clean_no_ext.replace('_', ' ').replace('-', ' ')
        sub_name = re.sub(r'^\d+[\.\-_ ]+', '', clean_no_ext).strip()
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            cur.execute("""
                DELETE FROM ingestion_jobs 
                WHERE LOWER(filename) LIKE ? 
                   OR LOWER(filename) LIKE ? 
                   OR LOWER(filename) LIKE ?
                   OR LOWER(filename) LIKE ?
            """, (f"%{clean_target}%", f"%{clean_no_ext}%", f"%{space_no_ext}%", f"%{sub_name}%"))
            conn.commit()
            conn.close()

    def delete_job_by_id(self, job_id: str):
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            cur.execute("DELETE FROM ingestion_jobs WHERE job_id = ?", (job_id,))
            conn.commit()
            conn.close()

    def clear_all(self):
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            cur.execute("DELETE FROM ingestion_jobs")
            conn.commit()
            conn.close()

# Global shared job queue
job_queue = JobQueue("data/jobs.db")
