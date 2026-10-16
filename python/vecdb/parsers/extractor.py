import os
import io
import re
import zipfile
import tarfile
import csv
import json
from typing import Generator, Dict, Any, List

def sanitize_path(target_path: str, base_dir: str) -> str:
    """Protect against zip-slip / path traversal attacks"""
    abs_base = os.path.abspath(base_dir)
    abs_target = os.path.abspath(target_path)
    if not abs_target.startswith(abs_base):
        raise ValueError("Malicious archive path traversal detected")
    return abs_target

def extract_text_stream(filename: str, stream_bytes: io.BytesIO) -> Generator[Dict[str, Any], None, None]:
    """
    Zero-limit streaming text extractor.
    Yields chunks/passages one by one with metadata without buffering the entire document in memory.
    """
    ext = os.path.splitext(filename)[1].lower()
    
    # Common text-based formats (excluding rich markup formats handled separately)
    TEXT_EXTENSIONS = {
        '.txt', '.md', '.markdown', '.rst', '.log', '.ini', '.cfg', '.conf',
        '.yaml', '.yml', '.css', '.js', '.jsx', '.ts',
        '.tsx', '.py', '.c', '.cpp', '.hpp', '.h', '.java', '.go', '.rs', '.sql',
        '.sh', '.bat', '.cmd', '.env', '.toml', '.tex'
    }

    # 1. HTML / Web / XML / SVG Documents (Deep tag, script, style, and SVG removal)
    if ext in ['.html', '.htm', '.xhtml', '.xml', '.svg']:
        stream_bytes.seek(0)
        raw_html = stream_bytes.read().decode('utf-8', errors='replace')
        import html
        # Strip script, style, svg, noscript tags and all inner content
        clean = re.sub(r'<(script|style|svg|noscript)\b.*?</\1>', ' ', raw_html, flags=re.I | re.DOTALL)
        # Convert block tags to line breaks
        clean = re.sub(r'<(?:p|div|h[1-6]|li|tr|br|section|article|header|footer|nav|aside)\b[^>]*>', '\n', clean, flags=re.I)
        # Strip all remaining tags
        clean = re.sub(r'<[^>]+>', ' ', clean)
        clean = html.unescape(clean)
        # Strip residual CSS rules like { ... } or @media
        clean = re.sub(r'\{[^{}]*\}', ' ', clean)
        clean = re.sub(r'@[a-zA-Z-]+\s*[^;]*;', ' ', clean)
        # Filter and clean lines
        raw_lines = [re.sub(r'\s+', ' ', l).strip() for l in clean.splitlines()]
        clean_lines = [l for l in raw_lines if len(l) > 15 and not l.startswith(('--', '@')) and not any(cw in l.lower() for cw in ['doctype', 'charset=', 'width=device-width', 'stylesheet'])]
        
        buf = []
        curr_len = 0
        chunk_idx = 0
        for line in clean_lines:
            buf.append(line)
            curr_len += len(line)
            if curr_len >= 800:
                yield {
                    "source": filename,
                    "type": "web_text",
                    "chunk_index": chunk_idx,
                    "text": "\n".join(buf)[:4000]
                }
                buf = []
                curr_len = 0
                chunk_idx += 1
        if buf:
            yield {
                "source": filename,
                "type": "web_text",
                "chunk_index": chunk_idx,
                "text": "\n".join(buf)[:4000]
            }
        return

    # 2. Plain Text / Markdown / Code / Configuration
    if ext in TEXT_EXTENSIONS:
        # Detect or decode utf-8 gracefully
        raw = stream_bytes.read()
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError:
            try:
                text = raw.decode('latin-1')
            except Exception:
                text = raw.decode('utf-8', errors='replace')
        
        # Stream by paragraphs / headings if markdown
        paragraphs = re.split(r'\n\s*\n', text)
        yielded = False
        for idx, para in enumerate(paragraphs):
            para = para.strip()
            if len(para) > 0:
                yielded = True
                yield {
                    "source": filename,
                    "type": ext.lstrip('.'),
                    "chunk_index": idx,
                    "text": para[:4000] # bounded chunk size
                }
        if not yielded and len(text.strip()) > 0:
            yield {
                "source": filename,
                "type": ext.lstrip('.'),
                "chunk_index": 0,
                "text": text.strip()[:4000]
            }
        return

    # 2. PDF Documents (Multi-Engine: PyMuPDF / fitz + pdfplumber for tables + pypdf fallback)
    if ext == '.pdf':
        yielded = False
        raw_pdf_bytes = stream_bytes.read()

        # Engine A: PyMuPDF (fitz) - high-precision text and layout extraction
        try:
            import fitz
            doc = fitz.open(stream=raw_pdf_bytes, filetype="pdf")
            for page_idx in range(len(doc)):
                page = doc[page_idx]
                text = page.get_text("text").strip()
                if text:
                    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
                    for p_idx, para in enumerate(paragraphs):
                        yielded = True
                        yield {
                            "source": filename,
                            "type": "pdf",
                            "page": page_idx + 1,
                            "chunk_index": p_idx,
                            "text": para[:4000]
                        }
            doc.close()
        except Exception:
            pass

        # Engine B: pdfplumber - structured table and form cell extraction (ideal for Voter info, tables)
        if not yielded:
            try:
                import pdfplumber
                with pdfplumber.open(io.BytesIO(raw_pdf_bytes)) as pdf:
                    for page_idx, page in enumerate(pdf.pages):
                        # 1. Try table extraction
                        tables = page.extract_tables()
                        if tables:
                            for t_idx, tbl in enumerate(tables):
                                rows_text = []
                                for row in tbl:
                                    clean_row = [str(c).strip() for c in row if c is not None and str(c).strip()]
                                    if clean_row:
                                        rows_text.append(" | ".join(clean_row))
                                if rows_text:
                                    yielded = True
                                    yield {
                                        "source": filename,
                                        "type": "pdf_table",
                                        "page": page_idx + 1,
                                        "chunk_index": t_idx,
                                        "text": "\n".join(rows_text)[:4000]
                                    }

                        # 2. Extract regular text
                        text = (page.extract_text() or "").strip()
                        if text:
                            for p_idx, para in enumerate(text.split('\n\n')):
                                para = para.strip()
                                if para:
                                    yielded = True
                                    yield {
                                        "source": filename,
                                        "type": "pdf",
                                        "page": page_idx + 1,
                                        "chunk_index": p_idx,
                                        "text": para[:4000]
                                    }
            except Exception:
                pass

        # Engine C: pypdf fallback
        if not yielded:
            try:
                import pypdf
                reader = pypdf.PdfReader(io.BytesIO(raw_pdf_bytes))
                for page_idx, page in enumerate(reader.pages):
                    page_text = (page.extract_text() or "").strip()
                    if page_text:
                        for p_idx, para in enumerate(page_text.split('\n\n')):
                            para = para.strip()
                            if para:
                                yielded = True
                                yield {
                                    "source": filename,
                                    "type": "pdf",
                                    "page": page_idx + 1,
                                    "chunk_index": p_idx,
                                    "text": para[:4000]
                                }
            except Exception:
                pass

        return

    # 3. Microsoft Word (.docx)
    if ext == '.docx':
        try:
            import docx
            doc = docx.Document(stream_bytes)
            for p_idx, p in enumerate(doc.paragraphs):
                text = p.text.strip()
                if len(text) >= 20:
                    yield {
                        "source": filename,
                        "type": "docx",
                        "chunk_index": p_idx,
                        "text": text[:4000]
                    }
        except Exception as e:
            yield {"source": filename, "type": "docx_error", "text": f"Docx parse note: {str(e)}"}
        return

    # 4. Microsoft PowerPoint (.pptx)
    if ext == '.pptx':
        try:
            import pptx
            prs = pptx.Presentation(stream_bytes)
            for s_idx, slide in enumerate(prs.slides):
                for shape in slide.shapes:
                    if hasattr(shape, "text") and shape.text.strip():
                        yield {
                            "source": filename,
                            "type": "pptx",
                            "slide": s_idx + 1,
                            "text": shape.text.strip()[:4000]
                        }
        except Exception as e:
            yield {"source": filename, "type": "pptx_error", "text": f"PPTX parse note: {str(e)}"}
        return

    # 5. CSV / TSV tabular rows
    if ext in ['.csv', '.tsv']:
        stream_bytes.seek(0)
        delimiter = '\t' if ext == '.tsv' else ','
        wrapper = io.TextIOWrapper(stream_bytes, encoding='utf-8', errors='replace')
        reader = csv.reader(wrapper, delimiter=delimiter)
        headers = []
        for r_idx, row in enumerate(reader):
            if r_idx == 0:
                headers = row
                continue
            if row:
                row_str = " | ".join(f"{h}: {v}" for h, v in zip(headers, row) if v)
                yield {
                    "source": filename,
                    "type": "tabular",
                    "row": r_idx,
                    "text": row_str[:3000]
                }
        return


    # 6. JSON / JSONL
    if ext in ['.json', '.jsonl']:
        stream_bytes.seek(0)
        raw = stream_bytes.read().decode('utf-8', errors='replace')
        if ext == '.jsonl':
            for l_idx, line in enumerate(raw.splitlines()):
                line = line.strip()
                if line:
                    yield {
                        "source": filename,
                        "type": "jsonl",
                        "line": l_idx,
                        "text": line[:4000]
                    }
        else:
            try:
                data = json.loads(raw)
                if isinstance(data, list):
                    for idx, item in enumerate(data):
                        yield {"source": filename, "type": "json", "index": idx, "text": json.dumps(item)[:4000]}
                else:
                    yield {"source": filename, "type": "json", "text": json.dumps(data)[:4000]}
            except Exception:
                yield {"source": filename, "type": "json_raw", "text": raw[:4000]}
        return

    # 7. Excel Spreadsheets (.xlsx, .xls)
    if ext in ['.xlsx', '.xls']:
        try:
            import openpyxl
            wb = openpyxl.load_workbook(stream_bytes, data_only=True)
            for sheet_name in wb.sheetnames:
                sheet = wb[sheet_name]
                rows_text = []
                for row in sheet.iter_rows(values_only=True):
                    clean_cells = [str(c).strip() for c in row if c is not None and str(c).strip()]
                    if clean_cells:
                        rows_text.append(" | ".join(clean_cells))
                
                # Chunk every 25 rows
                for idx in range(0, max(1, len(rows_text)), 25):
                    chunk_slice = rows_text[idx:idx + 25]
                    if chunk_slice:
                        yield {
                            "source": filename,
                            "type": "excel",
                            "sheet": sheet_name,
                            "chunk_index": idx // 25,
                            "text": f"Sheet [{sheet_name}]:\n" + "\n".join(chunk_slice)
                        }
            return
        except Exception:
            pass

    # 8. Recursive Archives (.zip)
    if ext == '.zip':
        with zipfile.ZipFile(stream_bytes, 'r') as z:
            total_size = sum(zinfo.file_size for zinfo in z.infolist())
            compressed_size = sum(zinfo.compress_size for zinfo in z.infolist())
            if compressed_size > 0 and (total_size / compressed_size) > 100:
                raise ValueError("Potential zip-bomb detected (compression ratio > 100x)")

            for zinfo in z.infolist():
                if not zinfo.is_dir():
                    with z.open(zinfo) as member_file:
                        member_bytes = io.BytesIO(member_file.read())
                        for chunk in extract_text_stream(zinfo.filename, member_bytes):
                            chunk["archive_source"] = filename
                            yield chunk
        return

    # 9. Universal Fallback: Works on ANY file format without crashing
    stream_bytes.seek(0)
    raw = stream_bytes.read()
    
    # Try decoding as standard text first
    try:
        decoded = raw.decode('utf-8')
        paragraphs = [p.strip() for p in re.split(r'\n\s*\n', decoded) if len(p.strip()) > 10]
        if paragraphs:
            for idx, p in enumerate(paragraphs):
                yield {
                    "source": filename,
                    "type": "text",
                    "chunk_index": idx,
                    "text": p[:4000]
                }
            return
    except Exception:
        pass

    # Binary printable string extractor: extracts words & sentences from any binary/unknown format
    printable_runs = re.findall(rb'[\x20-\x7E\t\r\n]{5,}', raw)
    if printable_runs:
        buffer = []
        curr_len = 0
        chunk_idx = 0
        for run in printable_runs:
            s = run.decode('ascii', errors='ignore').strip()
            if len(s) >= 4:
                buffer.append(s)
                curr_len += len(s)
                if curr_len >= 800:
                    yield {
                        "source": filename,
                        "type": "extracted_text",
                        "chunk_index": chunk_idx,
                        "text": " ".join(buffer)[:4000]
                    }
                    chunk_idx += 1
                    buffer = []
                    curr_len = 0
        if buffer:
            yield {
                "source": filename,
                "type": "extracted_text",
                "chunk_index": chunk_idx,
                "text": " ".join(buffer)[:4000]
            }

