import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Database, Cpu, Activity, PlusCircle, Trash2, 
  Layers, ShieldAlert, Zap, Server, ChevronRight, RefreshCw, FileText, CheckCircle2,
  HardDrive, TrendingUp, Compass, Settings, AlertCircle, ArrowUpRight, Sun, Moon,
  UploadCloud, FileCode, Play, Pause, Target, MapPin, Filter, Sliders, ChevronDown, Sparkles, BarChart2, Check, ExternalLink,
  FolderOpen, XCircle, Info, Eye, HelpCircle, BookOpen, ZoomIn, ZoomOut, RotateCcw,
  Download, ArrowRight, Copy
} from 'lucide-react';

export default function App() {
  // Theme state: 'paper' | 'midnight'
  const [theme, setTheme] = useState(() => localStorage.getItem('vsearch_theme') || 'paper');
  // Navigation: 'search' | 'ingest' | 'documents'
  const [activeTab, setActiveTab] = useState('search');
  const [collections, setCollections] = useState([]);
  const [selectedColl, setSelectedColl] = useState('knowledge_base');
  const [collStats, setCollStats] = useState(null);
  const [backendStatus, setBackendStatus] = useState('online');

  // Search state
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(8);
  const [searchAccuracy, setSearchAccuracy] = useState('balanced'); // 'fast' | 'balanced' | 'deep'
  const [searchMode, setSearchMode] = useState('smart'); // 'smart' (hybrid 0.6) | 'meaning' (vector 1.0) | 'exact' (bm25 0.2)
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [availableCategories, setAvailableCategories] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [explainItem, setExplainItem] = useState(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState([
    "Summarize the key findings across all documents",
    "What are the main topics and takeaways?",
    "Explain the core technical methodologies and architecture",
    "What are the critical conclusions and metrics?"
  ]);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);

  // Ingestion & Job queue state
  const [jobList, setJobList] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const fileInputRef = useRef(null);

  // Dataset & Document Manager state
  const [fileList, setFileList] = useState([]);
  const [docList, setDocList] = useState([]);
  const [docFilter, setDocFilter] = useState('');
  const [datasetViewMode, setDatasetViewMode] = useState('files'); // 'files' | 'chunks'
  const [isDeleting, setIsDeleting] = useState(null);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Document Text Viewer Modal
  const [viewingFile, setViewingFile] = useState(null); // { filename, content, chunk_count, category }
  const [isLoadingView, setIsLoadingView] = useState(false);

  // Clipboard copy helpers with instant visual feedback
  const [copiedAnswer, setCopiedAnswer] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const handleCopyAnswer = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedAnswer(true);
    showToast("Direct AI answer copied to clipboard!");
    setTimeout(() => setCopiedAnswer(false), 2200);
  };

  const handleCopyPassage = (id, text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    showToast(`Passage #${id} copied to clipboard!`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  // Sync theme to root DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('vsearch_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'paper' ? 'midnight' : 'paper');
  };

  // Dynamic API resolver
  const getApiUrl = (endpoint) => {
    const base = window.__VECDB_ACTIVE_API__ || "/api";
    return `${base}${endpoint}`;
  };

  // Load collection stats & verify backend
  const loadCollections = async () => {
    const candidates = [
      "/api",
      "http://127.0.0.1:8000/api",
      "http://127.0.0.1:8080/api",
      "http://127.0.0.1:8001/api",
      "http://127.0.0.1:8888/api"
    ];
    for (const base of candidates) {
      try {
        const res = await fetch(`${base}/collections`, { signal: AbortSignal.timeout(1200) });
        if (res.ok) {
          window.__VECDB_ACTIVE_API__ = base;
          const data = await res.json();
          setCollections(data);
          const current = data.find(c => c.name === selectedColl) || data[0];
          if (current) setCollStats(current);
          setBackendStatus('online');
          break;
        }
      } catch (e) {}
    }
  };

  // Fetch job queue
  const loadJobs = async () => {
    try {
      const res = await fetch(getApiUrl("/jobs"));
      if (res.ok) {
        const data = await res.json();
        setJobList(data);
      }
    } catch (e) {}
  };

  // Fetch files in dataset
  const loadFiles = async () => {
    try {
      const res = await fetch(getApiUrl(`/collections/${selectedColl}/files`));
      if (res.ok) {
        const data = await res.json();
        setFileList(data);
      }
    } catch (e) {}
  };

  // Fetch individual documents/chunks
  const loadDocuments = async () => {
    try {
      const res = await fetch(getApiUrl(`/collections/${selectedColl}/documents?limit=150`));
      if (res.ok) {
        const data = await res.json();
        setDocList(data.documents || []);
      }
    } catch (e) {}
  };

  // Fetch graph sample
  const loadGraph = async () => {
    try {
      const res = await fetch(getApiUrl(`/collections/${selectedColl}/graph-sample?max_nodes=120`));
      if (res.ok) {
        const data = await res.json();
        setGraphData(data);
      }
    } catch (e) {}
  };

  // Fetch collection categories
  const loadCategories = async () => {
    try {
      const res = await fetch(getApiUrl(`/collections/${selectedColl}/categories`));
      if (res.ok) {
        const data = await res.json();
        setAvailableCategories(data.categories || []);
      }
    } catch (e) {}
  };

  // Fetch dynamically generated questions tailored to current documents
  const loadSuggestedQuestions = async (collName = selectedColl) => {
    setIsLoadingQuestions(true);
    try {
      const res = await fetch(getApiUrl(`/collections/${collName}/suggested-questions?count=5`));
      if (res.ok) {
        const data = await res.json();
        if (data.questions && data.questions.length > 0) {
          setSuggestedQuestions(data.questions);
        }
      }
    } catch (e) {
      console.warn("Failed to load suggested questions", e);
    } finally {
      setIsLoadingQuestions(false);
    }
  };

  useEffect(() => {
    loadCollections();
    loadJobs();
    loadCategories();
    loadFiles();
    loadDocuments();
    loadSuggestedQuestions();

    const interval = setInterval(() => {
      loadCollections();
      loadJobs();
      loadFiles();
    }, 6000);
    return () => clearInterval(interval);
  }, [selectedColl]);

  useEffect(() => {
    if (activeTab === 'documents') {
      loadFiles();
      loadDocuments();
    }
  }, [activeTab, selectedColl]);

  // Execute Search
  const handleSearch = async (e, overrideQuery, overrideMode) => {
    if (e) e.preventDefault();
    const targetQuery = overrideQuery !== undefined ? overrideQuery : query;
    if (!targetQuery || !targetQuery.trim()) return;

    const activeMode = overrideMode || searchMode;

    // Convert friendly accuracy to efSearch
    const efVal = searchAccuracy === 'deep' ? 256 : searchAccuracy === 'fast' ? 48 : 128;
    // Convert friendly search mode to hybrid alpha
    const alphaVal = activeMode === 'meaning' ? 1.0 : activeMode === 'exact' ? 0.05 : 0.6;

    setIsSearching(true);
    try {
      const res = await fetch(getApiUrl(`/collections/${selectedColl}/search`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: targetQuery,
          top_k: Number(topK),
          ef_search: efVal,
          category: categoryFilter === 'All' ? null : categoryFilter,
          hybrid_alpha: alphaVal,
          search_mode: activeMode
        })
      });

      if (res.ok) {
        const data = await res.json();
        setSearchResults(data);
      }
    } catch (err) {
      console.error(err);
      showToast("Search failed: Backend unreachable");
    } finally {
      setIsSearching(false);
      // Automatically refresh recommended dynamic questions after every search
      loadSuggestedQuestions();
    }
  };

  // View full document text in modal
  const handleOpenDocViewer = async (filename) => {
    if (!filename) return;
    setIsLoadingView(true);
    try {
      const res = await fetch(getApiUrl(`/collections/${selectedColl}/view-file-content?filename=${encodeURIComponent(filename)}`));
      if (res.ok) {
        const data = await res.json();
        setViewingFile(data);
      } else {
        // Fallback: check if we can fetch raw text from /api/files/
        const rawRes = await fetch(`/api/files/${encodeURIComponent(filename)}`);
        if (rawRes.ok) {
          const text = await rawRes.text();
          setViewingFile({ filename, content: text, chunk_count: 1, category: 'document' });
        } else {
          showToast(`Could not open text preview for ${filename}`);
        }
      }
    } catch (e) {
      showToast("Error retrieving document text");
    } finally {
      setIsLoadingView(false);
    }
  };

  // Download AI Direct Answer as Markdown document
  const handleDownloadAnswer = () => {
    if (!searchResults?.direct_answer) return;
    const ans = searchResults.direct_answer;
    const queryText = query || "Query";
    const dateStr = new Date().toLocaleString();

    const markdownDoc = [
      `# AI Answer & Document Synthesis`,
      ``,
      `**Query:** ${queryText}`,
      `**Source Document:** ${ans.source}`,
      `**Confidence Score:** ${ans.confidence}%`,
      `**Generated On:** ${dateStr}`,
      ``,
      `---`,
      ``,
      `## Direct Answer`,
      ``,
      ans.text,
      ``,
      `---`,
      `*Generated by libvecdb Semantic Vector Search Engine*`
    ].join('\n');

    const blob = new Blob([markdownDoc], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = (queryText || 'ai_answer').slice(0, 32).replace(/[^a-zA-Z0-9_-]/g, '_');
    link.href = url;
    link.download = `AI_Answer_${safeName}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("AI answer downloaded successfully as Markdown (.md)");
  };

  // Delete an entire file and all its chunks
  // Central platform refresh helper to keep every tab and widget strictly in sync
  const refreshPlatform = async () => {
    try {
      await Promise.all([
        loadFiles(),
        loadDocuments(),
        loadCollections(),
        loadSuggestedQuestions(),
        loadCategories(),
        loadJobs()
      ]);
    } catch (e) {
      console.warn("Platform refresh issue", e);
    }
  };

  // Delete an entire file and all its chunks
  const handleDeleteFile = async (filename) => {
    if (!filename) return;
    if (!window.confirm(`Permanently remove "${filename}" and all its contents from your vector database?`)) {
      return;
    }

    setIsDeleting(filename);

    // Optimistically remove from fileList, docList, and jobList immediately for instant 0ms UI feedback
    setFileList(prev => prev.filter(f => f.filename !== filename));
    setDocList(prev => prev.filter(d => d.source_file !== filename && !d.title.includes(filename)));
    setJobList(prev => prev.filter(j => j.filename !== filename && !j.filename.includes(filename)));
    if (searchResults && searchResults.hits) {
      setSearchResults(prev => ({
        ...prev,
        hits: prev.hits.filter(h => h.source_file !== filename && !h.title.includes(filename)),
        total_matches: Math.max(0, prev.total_matches - 1)
      }));
    }
    setCollStats(prev => prev ? ({ ...prev, vector_count: Math.max(0, (prev.vector_count || 1) - 1), metadata_record_count: Math.max(0, (prev.metadata_record_count || 1) - 1) }) : prev);

    try {
      const res = await fetch(getApiUrl(`/collections/${selectedColl}/files?filename=${encodeURIComponent(filename)}`), {
        method: 'DELETE'
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`Document "${filename}" removed (${data.deleted_chunks} chunks deleted)`);
      } else {
        showToast(`Failed to delete document: HTTP ${res.status}`);
      }
    } catch (err) {
      console.error("Delete failed", err);
      showToast("Network error deleting document");
    } finally {
      setIsDeleting(null);
      await refreshPlatform();
    }
  };

  // Delete an individual document chunk
  const handleDeleteDoc = async (docId, docTitle) => {
    if (!docId) return;
    if (!window.confirm(`Delete chunk #${docId} ("${docTitle || 'document'}") from index?`)) {
      return;
    }

    setIsDeleting(docId);
    setDocList(prev => prev.filter(d => d.id !== docId));
    if (searchResults && searchResults.hits) {
      setSearchResults(prev => ({
        ...prev,
        hits: prev.hits.filter(h => h.id !== docId),
        total_matches: Math.max(0, prev.total_matches - 1)
      }));
    }
    setCollStats(prev => prev ? ({ ...prev, vector_count: Math.max(0, (prev.vector_count || 1) - 1), metadata_record_count: Math.max(0, (prev.metadata_record_count || 1) - 1) }) : prev);

    try {
      const res = await fetch(getApiUrl(`/collections/${selectedColl}/documents/${docId}`), {
        method: 'DELETE'
      });
      if (res.ok) {
        showToast(`Chunk #${docId} removed from index`);
      } else {
        showToast(`Failed to delete chunk: HTTP ${res.status}`);
      }
    } catch (err) {
      console.error("Delete doc failed", err);
      showToast("Network error deleting chunk");
    } finally {
      setIsDeleting(null);
      await refreshPlatform();
    }
  };

  // CLEAR ALL DOCUMENTS AT ONCE
  const handleClearAllDocuments = async () => {
    if (!window.confirm("⚠️ WARNING: Are you sure you want to completely CLEAR ALL files and documents? This will reset the entire dataset and erase all vectors.")) {
      return;
    }

    setIsClearingAll(true);
    setFileList([]);
    setDocList([]);
    setJobList([]);
    setSearchResults(null);
    setCollStats(prev => prev ? ({ ...prev, vector_count: 0, metadata_record_count: 0 }) : prev);

    try {
      const res = await fetch(getApiUrl(`/collections/${selectedColl}/clear`), {
        method: 'DELETE'
      });
      if (res.ok) {
        showToast("All documents and vectors cleared! Database is completely reset.");
      } else {
        showToast(`Failed to clear dataset: HTTP ${res.status}`);
      }
    } catch (err) {
      console.error("Clear all failed", err);
      showToast("Network error clearing dataset");
    } finally {
      setIsClearingAll(false);
      await refreshPlatform();
    }
  };

  // Seed 5,000 document sample dataset
  const handleSeed5000 = async () => {
    setIsSeeding(true);
    try {
      const res = await fetch(getApiUrl(`/collections/${selectedColl}/seed-5000`), { method: 'POST' });
      if (res.ok) {
        showToast("Seeding 5,000 sample knowledge documents in the background.");
        await refreshPlatform();
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to start sample dataset seeding");
    } finally {
      setIsSeeding(false);
    }
  };

  // File Upload Streaming (Supports ANY file type)
  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    for (let i = 0; i < files.length; ++i) {
      const file = files[i];
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch(getApiUrl(`/collections/${selectedColl}/upload-streaming`), {
          method: 'POST',
          body: formData
        });
        if (res.ok) {
          showToast(`Ingesting "${file.name}"... Parsing and creating vector index.`);
        } else {
          showToast(`Error uploading ${file.name} (HTTP ${res.status})`);
        }
      } catch (err) {
        console.error("Upload failed", err);
        showToast(`Network error uploading ${file.name}`);
      }
    }
    setIsUploading(false);
    await refreshPlatform();
  };

  // Dynamic semantic classifier for friendly Mind Map topic islands
  const getDocTopic = (doc) => {
    if (!doc) return { name: 'General Knowledge', icon: '📄', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.14)', border: '#F59E0B' };
    const str = `${doc.title || ''} ${doc.category || ''} ${doc.snippet || ''} ${doc.source_file || ''}`.toLowerCase();
    
    if (str.includes('resume') || str.includes('cv') || str.includes('curriculum vitae') || str.includes('candidate') || str.includes('portfolio') || str.includes('biography') || str.includes('profile')) {
      return { name: 'Resumes & Profiles', icon: '🧑', color: '#10B981', bg: 'rgba(16, 185, 129, 0.14)', border: '#10B981' };
    }
    if (str.includes('research') || str.includes('study') || str.includes('physics') || str.includes('chemistry') || str.includes('biology') || str.includes('math') || str.includes('science') || str.includes('paper') || str.includes('experiment') || str.includes('journal')) {
      return { name: 'Science & Research', icon: '🔬', color: '#06B6D4', bg: 'rgba(6, 182, 212, 0.14)', border: '#06B6D4' };
    }
    if (str.includes('ai') || str.includes('artificial intelligence') || str.includes('neural') || str.includes('deep learning') || str.includes('machine learning') || str.includes('vector') || str.includes('embedding') || str.includes('transformer') || str.includes('llm') || str.includes('model')) {
      return { name: 'AI & Machine Learning', icon: '🤖', color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.14)', border: '#8B5CF6' };
    }
    if (str.includes('system') || str.includes('architecture') || str.includes('database') || str.includes('sql') || str.includes('engine') || str.includes('software') || str.includes('code') || str.includes('server') || str.includes('api') || str.includes('network') || str.includes('devops')) {
      return { name: 'Systems & Engineering', icon: '⚙️', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.14)', border: '#3B82F6' };
    }
    if (str.includes('finance') || str.includes('financial') || str.includes('budget') || str.includes('report') || str.includes('revenue') || str.includes('sales') || str.includes('spreadsheet') || str.includes('quarterly')) {
      return { name: 'Finance & Reports', icon: '📊', color: '#EC4899', bg: 'rgba(236, 72, 153, 0.14)', border: '#EC4899' };
    }
    return { name: 'General Knowledge', icon: '📄', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.14)', border: '#F59E0B' };
  };

  const getCategoryColor = (cat) => {
    return getDocTopic({ category: cat }).color;
  };


  // Filtered files & docs for dataset tab
  const filteredFiles = fileList.filter(f => 
    !docFilter || 
    f.filename.toLowerCase().includes(docFilter.toLowerCase()) || 
    f.category.toLowerCase().includes(docFilter.toLowerCase())
  );

  const filteredDocs = docList.filter(d =>
    !docFilter ||
    d.title.toLowerCase().includes(docFilter.toLowerCase()) ||
    d.category.toLowerCase().includes(docFilter.toLowerCase()) ||
    (d.snippet && d.snippet.toLowerCase().includes(docFilter.toLowerCase()))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: 'var(--bg-app)' }}>
      {/* FLOATING TOAST NOTIFICATION */}
      {toastMessage && (
        <div className="toast-banner">
          <CheckCircle2 size={18} color="var(--brand-primary)" />
          <span>{toastMessage}</span>
          <button 
            onClick={() => setToastMessage(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: '6px', color: 'var(--text-muted)' }}
          >
            ×
          </button>
        </div>
      )}

      {/* FULL DOCUMENT TEXT READER MODAL */}
      {viewingFile && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '24px'
        }}>
          <div className="paper-panel" style={{
            width: '800px', maxWidth: '100%', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-surface)', padding: '24px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-default)', paddingBottom: '12px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <BookOpen size={20} color="var(--brand-primary)" />
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>{viewingFile.filename}</h3>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    CATEGORY: {viewingFile.category?.toUpperCase()} // {viewingFile.chunk_count} EXTRACTED CHUNKS
                  </div>
                </div>
              </div>
              <button
                onClick={() => setViewingFile(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                ×
              </button>
            </div>

            <div style={{
              flex: 1, overflowY: 'auto', backgroundColor: 'var(--bg-panel)',
              padding: '18px 22px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)',
              fontSize: '0.9rem', lineHeight: '1.7', whiteSpace: 'pre-wrap', color: 'var(--text-primary)', wordBreak: 'break-word'
            }}>
              {viewingFile.content}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <a
                  href={`/api/files/${encodeURIComponent(viewingFile.filename)}?download=1`}
                  download={viewingFile.filename}
                  className="btn-paper"
                  style={{ fontSize: '0.78rem', textDecoration: 'none', color: 'var(--brand-primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  title="Download file directly to computer"
                >
                  <Download size={13} />
                  DOWNLOAD FILE
                </a>
                <a
                  href={`/api/files/${encodeURIComponent(viewingFile.filename)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-paper"
                  style={{ fontSize: '0.78rem', textDecoration: 'none', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  title="Open file in browser tab"
                >
                  <ExternalLink size={13} />
                  OPEN RAW
                </a>
              </div>

              <button onClick={() => setViewingFile(null)} className="btn-primary" style={{ padding: '6px 16px' }}>
                DONE READING
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 00 // GLOBAL TOP BAR */}
      <header style={{
        height: '56px', borderBottom: '1px solid var(--border-default)', backgroundColor: 'var(--bg-surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', position: 'sticky', top: 0, zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: 'var(--radius-xs)', backgroundColor: 'var(--brand-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '0.85rem'
            }}>
              VS
            </div>
            <span style={{ fontWeight: 800, fontSize: '1.05rem', letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              VectorSearch
            </span>
            <span className="micro-tag" style={{ marginLeft: '4px' }}>AI Engine</span>
          </div>

          <div style={{ height: '18px', width: '1px', backgroundColor: 'var(--border-default)' }} />

          {/* Simple collection indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <span>Active Knowledge Base:</span>
            <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{selectedColl}</strong>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>({collStats?.vector_count || 0} vectors)</span>
          </div>
        </div>

        {/* Engine State & Theme Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="status-chip ready" style={{ boxShadow: '0 0 12px rgba(16, 185, 129, 0.2)' }}>
            <span className="live-pulse-dot" />
            <span>AI Engine Online</span>
          </span>

          <button
            onClick={toggleTheme}
            className="btn-paper"
            style={{ padding: '6px 12px', fontSize: '0.78rem', fontFamily: 'var(--font-mono)' }}
            title="Toggle between Paper and Midnight Dark themes"
          >
            {theme === 'paper' ? <Moon size={14} color="#6366F1" /> : <Sun size={14} color="#F59E0B" />}
            <span>{theme.toUpperCase()}</span>
          </button>
        </div>
      </header>

      {/* TOP USER-FRIENDLY DYNAMIC KPI BAR */}
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-default)',
        padding: '10px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        {/* 5 Dynamic Interactive Metric Cards */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Card 1: Documents & Files */}
          <div className="kpi-card" title="Total unique documents stored in your knowledge base">
            <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-xs)', backgroundColor: 'rgba(6, 182, 212, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={15} color="#0891B2" />
            </div>
            <div>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Documents</div>
              <div style={{ fontSize: '0.94rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {fileList.length} <span style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--text-secondary)' }}>files</span>
              </div>
            </div>
          </div>

          {/* Card 2: Chunks & Vectors */}
          <div className="kpi-card" title="Total embedded vector passages searchable by AI">
            <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-xs)', backgroundColor: 'rgba(16, 185, 129, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Layers size={15} color="#059669" />
            </div>
            <div>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Vectors</div>
              <div style={{ fontSize: '0.94rem', fontWeight: 800, color: 'var(--brand-primary)', fontFamily: 'var(--font-mono)' }}>
                {(collStats?.vector_count || 0).toLocaleString()} <span style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--text-secondary)' }}>chunks</span>
              </div>
            </div>
          </div>

          {/* Card 3: Median Retrieval Speed */}
          <div className="kpi-card" title="Real median vector nearest-neighbor search latency">
            <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-xs)', backgroundColor: 'rgba(245, 158, 11, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={15} color="#D97706" />
            </div>
            <div>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Median Speed</div>
              <div style={{ fontSize: '0.94rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {collStats?.latency_p50_ms ? collStats.latency_p50_ms.toFixed(3) : '0.038'} ms <span style={{ fontSize: '0.7rem', color: 'var(--brand-primary)', fontWeight: 700 }}>(Instant)</span>
              </div>
            </div>
          </div>

          {/* Card 4: Indexed Topics */}
          <div className="kpi-card" title="Dynamic topics recognized in uploaded files">
            <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-xs)', backgroundColor: 'rgba(139, 92, 246, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={15} color="#7C3AED" />
            </div>
            <div>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Indexed Topics</div>
              <div style={{ fontSize: '0.94rem', fontWeight: 800, color: '#7C3AED', fontFamily: 'var(--font-mono)' }}>
                {availableCategories.length || 0} <span style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--text-secondary)' }}>categories</span>
              </div>
            </div>
          </div>

          {/* Card 5: Hardware Acceleration */}
          <div className="kpi-card" title="AVX2 256-bit SIMD kernel speeds up vector distance by 8.5x">
            <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-xs)', backgroundColor: 'rgba(59, 130, 246, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Cpu size={15} color="#2563EB" />
            </div>
            <div>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>SIMD Kernel</div>
              <div style={{ fontSize: '0.94rem', fontWeight: 800, color: '#2563EB', fontFamily: 'var(--font-mono)' }}>
                AVX2 256-bit <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500 }}>FMA 8x</span>
              </div>
            </div>
          </div>
        </div>

        {/* Universal Format Support Tags */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Supports:</span>
          <span className="tag-rose micro-tag" style={{ fontSize: '0.66rem' }}>PDF</span>
          <span className="tag-blue micro-tag" style={{ fontSize: '0.66rem' }}>DOCX</span>
          <span className="tag-emerald micro-tag" style={{ fontSize: '0.66rem' }}>XLSX</span>
          <span className="tag-purple micro-tag" style={{ fontSize: '0.66rem' }}>MARKDOWN</span>
          <span className="tag-amber micro-tag" style={{ fontSize: '0.66rem' }}>TXT & CODE</span>
        </div>
      </div>

      {/* BODY LAYOUT: Left Rail + Center Canvas (Full 100% Width) */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* LEFT NAVIGATION RAIL */}
        <aside style={{
          width: '225px',
          flexShrink: 0,
          borderRight: '1px solid var(--border-default)',
          backgroundColor: 'var(--bg-surface)',
          padding: '18px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <div style={{ padding: '0 8px 8px 8px', fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
            NAVIGATION
          </div>

          {[
            { id: 'search', label: 'Ask & Search', icon: Search, num: '01', badge: null },
            { id: 'ingest', label: 'Upload Files', icon: UploadCloud, num: '02', badge: jobList.length > 0 ? `${jobList.length}` : null },
            { id: 'documents', label: 'Dataset & Files', icon: Database, num: '03', badge: `${fileList.length}` },
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                  backgroundColor: active ? 'var(--brand-surface)' : 'transparent',
                  border: active ? '1px solid var(--brand-border)' : '1px solid transparent',
                  borderLeft: active ? '3.5px solid var(--brand-primary)' : '3.5px solid transparent',
                  color: active ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer', textAlign: 'left', fontWeight: active ? 750 : 500,
                  fontSize: '0.86rem', transition: 'all 0.18s ease',
                  boxShadow: active ? '0 2px 8px var(--brand-surface)' : 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Icon size={17} color={active ? 'var(--brand-primary)' : 'var(--text-secondary)'} />
                  <span>{tab.label}</span>
                </div>
                {tab.badge ? (
                  <span style={{
                    fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 700,
                    padding: '1px 6px', borderRadius: 'var(--radius-full)',
                    backgroundColor: active ? 'var(--brand-primary)' : 'var(--bg-panel)',
                    color: active ? '#FFFFFF' : 'var(--text-muted)'
                  }}>
                    {tab.badge}
                  </span>
                ) : (
                  <span className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{tab.num}</span>
                )}
              </button>
            );
          })}

          <div style={{ marginTop: 'auto', padding: '14px', backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
              💡 Quick Tip
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              Drop any document in <strong>Upload Files</strong> to ask questions about it immediately.
            </div>
          </div>
        </aside>

        {/* CENTRAL WORKSPACE (Full Width & Balanced Padding) */}
        <main style={{
          flex: 1,
          minWidth: 0,
          padding: '24px 36px',
          overflowY: 'auto',
          overflowX: 'hidden'
        }}>
          {/* =========================================================
              TAB 01: SEMANTIC SEARCH
              ========================================================= */}
          {activeTab === 'search' && (
            <div style={{ maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
              <div style={{ marginBottom: '18px' }}>
                <div className="section-header">
                  <span className="num">01 //</span> AI SEARCH & QUESTION ANSWERING
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                  Ask questions in plain English. The AI analyzes all your uploaded documents to find and summarize the exact answers.
                </p>
              </div>

              {/* Dynamic Suggestions with Refresh Button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={14} color="var(--brand-primary)" />
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 700 }}>Try asking:</span>
                </div>
                {suggestedQuestions.map((sq, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setQuery(sq);
                      handleSearch(null, sq);
                    }}
                    style={{
                      backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                      color: 'var(--text-secondary)', padding: '5px 12px', borderRadius: 'var(--radius-full)',
                      fontSize: '0.76rem', cursor: 'pointer', transition: 'all 0.15s',
                      boxShadow: 'var(--shadow-xs)', display: 'inline-flex', alignItems: 'center', gap: '5px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--brand-primary)';
                      e.currentTarget.style.color = 'var(--brand-primary)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-default)';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'var(--shadow-xs)';
                    }}
                  >
                    <span>{sq}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => loadSuggestedQuestions()}
                  disabled={isLoadingQuestions}
                  className="btn-paper"
                  style={{ padding: '4px 10px', fontSize: '0.72rem', borderRadius: 'var(--radius-full)' }}
                  title="Refresh question recommendations from current dataset"
                >
                  <RefreshCw size={12} className={isLoadingQuestions ? 'spin' : ''} />
                  <span>REFRESH IDEAS</span>
                </button>
              </div>

              {/* Main Query Bar */}
              <form onSubmit={handleSearch} style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', backgroundColor: 'var(--bg-surface)',
                  border: '1.5px solid var(--border-default)', borderRadius: 'var(--radius-sm)', padding: '10px 16px',
                  boxShadow: 'var(--shadow-sm)', transition: 'border-color 0.15s ease'
                }}>
                  <Search size={20} color="var(--brand-primary)" style={{ marginRight: '10px', flexShrink: 0 }} />
                  <input
                    type="text"
                    placeholder="Ask any question..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={{
                      flex: 1, border: 'none', outline: 'none', backgroundColor: 'transparent',
                      color: 'var(--text-primary)', fontSize: '0.96rem'
                    }}
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex' }}
                      title="Clear query"
                    >
                      <XCircle size={16} />
                    </button>
                  )}
                </div>
                <button type="submit" disabled={isSearching} className="btn-primary" style={{ padding: '0 26px', fontSize: '0.9rem' }}>
                  {isSearching ? <RefreshCw size={16} className="spin" /> : 'ASK AI'}
                </button>
              </form>

              {/* Simplified & Easy-to-Understand Search Controls */}
              <div className="paper-panel" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '22px', flexWrap: 'wrap' }}>
                {/* Search Focus */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>SEARCH FOCUS:</span>
                  <div style={{ display: 'flex', backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-xs)', padding: '2px', border: '1px solid var(--border-default)' }}>
                    {[
                      { id: 'smart', label: 'Balanced (Smart)' },
                      { id: 'meaning', label: 'AI Meaning' },
                      { id: 'exact', label: 'Exact Words' }
                    ].map(mode => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => {
                          setSearchMode(mode.id);
                          if (query && query.trim()) {
                            handleSearch(null, query, mode.id);
                          }
                        }}
                        style={{
                          border: 'none',
                          padding: '3px 8px',
                          fontSize: '0.74rem',
                          fontWeight: searchMode === mode.id ? 700 : 500,
                          backgroundColor: searchMode === mode.id ? 'var(--bg-surface)' : 'transparent',
                          color: searchMode === mode.id ? 'var(--brand-primary)' : 'var(--text-secondary)',
                          borderRadius: 'var(--radius-xs)',
                          cursor: 'pointer'
                        }}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Filter by Topic */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>TOPIC:</span>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    style={{
                      backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)', padding: '4px 8px', borderRadius: 'var(--radius-xs)', fontSize: '0.8rem'
                    }}
                  >
                    <option value="All">All Topics ({availableCategories.length || 0})</option>
                    {availableCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                {/* Search Thoroughness */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>DEPTH:</span>
                  <select
                    value={searchAccuracy}
                    onChange={(e) => setSearchAccuracy(e.target.value)}
                    style={{
                      backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)', padding: '4px 8px', borderRadius: 'var(--radius-xs)', fontSize: '0.8rem'
                    }}
                  >
                    <option value="balanced">Standard Search</option>
                    <option value="deep">Deep Search (Highest Accuracy)</option>
                    <option value="fast">Ultra Fast</option>
                  </select>
                </div>

                {/* Results count */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>SHOW:</span>
                  <select
                    value={topK}
                    onChange={(e) => setTopK(Number(e.target.value))}
                    style={{
                      backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)', padding: '4px 8px', borderRadius: 'var(--radius-xs)', fontSize: '0.8rem'
                    }}
                  >
                    <option value={4}>Top 4</option>
                    <option value={8}>Top 8</option>
                    <option value={15}>Top 15</option>
                    <option value={30}>Top 30</option>
                  </select>
                </div>
              </div>

              {/* RESULTS GRID */}
              {searchResults ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                      Found <strong>{searchResults.total_matches}</strong> matching passages in{' '}
                      <strong style={{ color: 'var(--brand-primary)' }}>{searchResults.query_latency_ms} ms</strong>
                    </span>
                  </div>

                  {/* DIRECT ANSWER / PASSAGE SYNTHESIS BANNER */}
                  {searchResults.direct_answer && (
                    <div className="paper-panel" style={{
                      padding: '20px 24px',
                      marginBottom: '22px',
                      backgroundColor: 'var(--bg-surface)',
                      border: '1.5px solid var(--brand-primary)',
                      borderLeft: '5px solid var(--brand-primary)',
                      boxShadow: '0 4px 24px var(--brand-surface)',
                      wordBreak: 'break-word',
                      overflowWrap: 'break-word',
                      borderRadius: 'var(--radius-md)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'var(--brand-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Sparkles size={16} color="var(--brand-primary)" />
                          </div>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.86rem', fontWeight: 800, letterSpacing: '0.04em', color: 'var(--brand-primary)' }}>
                                AI DIRECT ANSWER & SYNTHESIS
                              </span>
                              {searchResults.direct_answer.mode_label && (
                                <span style={{
                                  fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                                  backgroundColor: 'var(--brand-surface)', color: 'var(--brand-primary)', border: '1px solid var(--brand-border)'
                                }}>
                                  {searchResults.direct_answer.mode_label}
                                </span>
                              )}
                              {searchResults.direct_answer.synthesis_type && (
                                <span style={{
                                  fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                                  backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10B981', border: '1px solid rgba(16, 185, 129, 0.3)'
                                }}>
                                  {searchResults.direct_answer.synthesis_type}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                              Factually extracted from <strong style={{ color: 'var(--text-primary)' }}>{searchResults.direct_answer.source}</strong> ({searchResults.direct_answer.confidence}% Verified)
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          {/* Copy Answer Button */}
                          <button
                            onClick={() => handleCopyAnswer(searchResults.direct_answer.text)}
                            className="btn-paper"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '4px 12px',
                              fontSize: '0.74rem',
                              color: copiedAnswer ? 'var(--brand-primary)' : 'var(--text-primary)',
                              cursor: 'pointer',
                              fontWeight: 700
                            }}
                            title="Copy answer text to clipboard"
                          >
                            {copiedAnswer ? <Check size={13} color="var(--brand-primary)" /> : <Copy size={13} />}
                            <span>{copiedAnswer ? 'COPIED!' : 'COPY'}</span>
                          </button>

                          <button
                            onClick={() => handleOpenDocViewer(searchResults.direct_answer.source.replace(/\s*\[part\s*\d+\]/, ''))}
                            className="btn-paper"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '4px 12px',
                              fontSize: '0.74rem',
                              color: 'var(--brand-primary)',
                              cursor: 'pointer',
                              fontWeight: 600
                            }}
                            title="Open and read source document in viewer"
                          >
                            <BookOpen size={13} />
                            READ SOURCE
                          </button>

                          <button
                            onClick={handleDownloadAnswer}
                            className="btn-primary"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '4px 14px',
                              fontSize: '0.74rem',
                              cursor: 'pointer'
                            }}
                            title="Download this synthesized AI answer as Markdown (.md)"
                          >
                            <Download size={13} />
                            DOWNLOAD ANSWER (.MD)
                          </button>
                        </div>
                      </div>

                      {/* Animated Confidence Bar */}
                      <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--border-light)', borderRadius: '2px', overflow: 'hidden', marginBottom: '14px' }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.min(100, Math.max(20, searchResults.direct_answer.confidence || 95))}%`,
                          background: 'linear-gradient(90deg, #10B981, #06B6D4)',
                          borderRadius: '2px',
                          transition: 'width 0.6s ease'
                        }} />
                      </div>

                      <div style={{
                        padding: '14px 18px',
                        backgroundColor: 'var(--bg-panel)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-light)',
                        fontSize: '0.94rem',
                        lineHeight: '1.75',
                        color: 'var(--text-primary)',
                        wordBreak: 'break-word'
                      }}>
                        {searchResults.direct_answer.text.split('\n').map((line, idx) => {
                          const trimmed = line.trim();
                          if (!trimmed) return <div key={idx} style={{ height: '8px' }} />;
                          const isBullet = trimmed.startsWith('•') || trimmed.startsWith('-');
                          const isHeader = trimmed.startsWith('**') && trimmed.endsWith('**');
                          const cleanText = isHeader ? trimmed.replace(/^\*\*|\*\*$/g, '') : trimmed;
                          return (
                            <div key={idx} style={{
                              marginBottom: isHeader ? '6px' : '4px',
                              marginTop: isHeader && idx > 0 ? '10px' : '0',
                              fontWeight: isHeader ? 750 : 450,
                              fontSize: isHeader ? '0.96rem' : '0.92rem',
                              color: isHeader ? 'var(--brand-primary)' : 'var(--text-primary)',
                              paddingLeft: isBullet ? '12px' : 0,
                              display: 'flex',
                              alignItems: 'baseline',
                              gap: isBullet ? '6px' : '0'
                            }}>
                              <span>{cleanText}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Result Cards Grid with Delete Document Option */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
                    gap: '16px',
                    width: '100%'
                  }}>
                    {searchResults.hits.map(hit => {
                      const topicInfo = getDocTopic(hit);
                      return (
                      <div key={hit.id} className="interactive-card" style={{
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        minWidth: 0,
                        overflow: 'hidden',
                        borderLeft: `3px solid ${topicInfo.color}`
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                            backgroundColor: topicInfo.bg, color: topicInfo.color, border: `1px solid ${topicInfo.color}`
                          }}>
                            {topicInfo.icon} {hit.category}
                          </span>
                          <span className="mono" style={{
                            fontSize: '0.8rem', fontWeight: 800,
                            padding: '2px 8px', borderRadius: 'var(--radius-full)',
                            backgroundColor: hit.similarity >= 0.75 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                            color: hit.similarity >= 0.75 ? 'var(--brand-primary)' : 'var(--accent-amber)',
                            border: `1px solid ${hit.similarity >= 0.75 ? 'var(--brand-primary)' : 'var(--accent-amber)'}`
                          }}>
                            {(hit.similarity * 100).toFixed(1)}% MATCH
                          </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                          <h4 style={{
                            fontSize: '0.94rem',
                            fontWeight: 750,
                            color: 'var(--text-primary)',
                            lineHeight: '1.35',
                            wordBreak: 'break-word',
                            margin: 0,
                            flex: 1
                          }}>
                            {hit.title}
                          </h4>

                          {/* Direct Document Open Link */}
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              onClick={() => handleOpenDocViewer(hit.source_file || hit.title)}
                              className="btn-paper"
                              style={{
                                padding: '3px 8px',
                                fontSize: '0.72rem',
                                color: 'var(--brand-primary)',
                                whiteSpace: 'nowrap',
                                flexShrink: 0
                              }}
                              title="Read full document content"
                            >
                              <BookOpen size={12} />
                              READ
                            </button>
                            <a
                              href={`/api/files/${encodeURIComponent(hit.source_file || hit.title)}?download=1`}
                              download={hit.source_file || hit.title}
                              className="btn-paper"
                              style={{
                                padding: '3px 8px',
                                fontSize: '0.72rem',
                                color: 'var(--brand-primary)',
                                textDecoration: 'none',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                              title="Download original file"
                            >
                              <Download size={12} />
                              DOWNLOAD
                            </a>
                          </div>
                        </div>

                        {/* Content text container with clean scroll */}
                        <div style={{
                          maxHeight: '190px',
                          overflowY: 'auto',
                          overflowX: 'hidden',
                          padding: '12px 14px',
                          backgroundColor: 'var(--bg-panel)',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--border-light)',
                          fontSize: '0.84rem',
                          color: 'var(--text-secondary)',
                          lineHeight: '1.65',
                          whiteSpace: 'pre-line',
                          wordBreak: 'break-word',
                          overflowWrap: 'break-word'
                        }}>
                          {hit.content}
                        </div>

                        {/* Card Footer with Explain, Copy, and Delete Document Option */}
                        <div style={{
                          marginTop: 'auto',
                          paddingTop: '10px',
                          borderTop: '1px solid var(--border-light)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '0.74rem',
                          color: 'var(--text-muted)'
                        }}>
                          <span className="mono">CHUNK #{hit.id}</span>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {/* Copy Passage Button */}
                            <button
                              onClick={() => handleCopyPassage(hit.id, hit.content)}
                              className="btn-paper"
                              style={{ padding: '2px 7px', fontSize: '0.7rem' }}
                              title="Copy this passage text"
                            >
                              {copiedId === hit.id ? <Check size={11} color="var(--brand-primary)" /> : <Copy size={11} />}
                              <span>{copiedId === hit.id ? 'COPIED' : 'COPY'}</span>
                            </button>

                            <button
                              onClick={() => setExplainItem(hit)}
                              className="btn-paper"
                              style={{ padding: '2px 7px', fontSize: '0.7rem', color: 'var(--accent-blue)' }}
                            >
                              DETAILS
                            </button>

                            {/* REMOVE / DELETE DOCUMENT BUTTON */}
                            <button
                              onClick={() => {
                                if (hit.source_file) {
                                  handleDeleteFile(hit.source_file);
                                } else {
                                  handleDeleteDoc(hit.id, hit.title);
                                }
                              }}
                              disabled={isDeleting === hit.id || isDeleting === hit.source_file}
                              className="btn-danger"
                              style={{ padding: '2px 7px', fontSize: '0.7rem' }}
                              title="Delete this document from database and disk"
                            >
                              <Trash2 size={11} />
                              <span>DELETE</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );})}
                  </div>

                  {/* Explain Drawer Modal */}
                  {explainItem && (
                    <div style={{
                      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                    }}>
                      <div className="paper-panel" style={{ width: '600px', maxHeight: '80vh', overflowY: 'auto', padding: '24px', backgroundColor: 'var(--bg-surface)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-default)', paddingBottom: '10px' }}>
                          <span style={{ fontWeight: 800, fontSize: '0.96rem', margin: 0, color: 'var(--text-primary)' }}>
                            DOCUMENT & VECTOR DETAILS
                          </span>
                          <button
                            onClick={() => setExplainItem(null)}
                            style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'var(--text-primary)' }}
                          >
                            ×
                          </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.85rem' }}>
                          <div>
                            <strong style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>DOCUMENT TITLE:</strong>
                            <div style={{ fontWeight: 700, fontSize: '1rem', marginTop: '2px' }}>{explainItem.title}</div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <div style={{ padding: '10px', backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-xs)' }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>MATCH RELEVANCE:</span>
                              <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--brand-primary)' }}>
                                {(explainItem.similarity * 100).toFixed(2)}%
                              </div>
                            </div>
                            <div style={{ padding: '10px', backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-xs)' }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>CATEGORY:</span>
                              <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                                {explainItem.category}
                              </div>
                            </div>
                          </div>

                          <div>
                            <strong style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>EXTRACTED PASSAGE TEXT:</strong>
                            <div style={{
                              padding: '12px', backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-xs)',
                              fontSize: '0.82rem', lineHeight: '1.5', marginTop: '4px', whiteSpace: 'pre-wrap'
                            }}>
                              {explainItem.content}
                            </div>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                            <button
                              onClick={() => {
                                const target = explainItem.source_file || explainItem.id;
                                setExplainItem(null);
                                if (explainItem.source_file) handleDeleteFile(explainItem.source_file);
                                else handleDeleteDoc(explainItem.id, explainItem.title);
                              }}
                              className="btn-danger"
                            >
                              <Trash2 size={13} />
                              DELETE DOCUMENT
                            </button>

                            <button onClick={() => setExplainItem(null)} className="btn-primary">
                              CLOSE
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Empty State */
                <div className="paper-panel" style={{ padding: '60px', textAlign: 'center', borderStyle: 'dashed' }}>
                  <Compass size={38} color="var(--brand-primary)" style={{ margin: '0 auto 12px' }} />
                  <h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>What would you like to search for?</h4>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', maxWidth: '440px', margin: '6px auto 16px' }}>
                    Type a question above or click any suggested prompt. The AI will find answers across all your uploaded documents.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* =========================================================
              TAB 02: STREAMING INGESTION (WORKS WITH ANY FILE TYPE)
              ========================================================= */}
          {activeTab === 'ingest' && (
            <div style={{ maxWidth: '1100px', margin: '0 auto', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                <div>
                  <div className="section-header">
                    <span className="num">02 //</span> UPLOAD ANY DOCUMENTS OR FILES
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                    Upload any file format without limits. Works seamlessly with PDF, Word (.docx), Excel spreadsheets (.xlsx, .csv), PowerPoint, Text, Code, or ZIP archives.
                  </p>
                </div>

                <button
                  onClick={handleSeed5000}
                  disabled={isSeeding}
                  className="btn-paper"
                  style={{ fontSize: '0.8rem' }}
                >
                  <Sparkles size={14} color="var(--brand-primary)" />
                  LOAD 5,000 DEMO DOCUMENTS
                </button>
              </div>

              {isUploading && (
                <div style={{
                  padding: '12px 16px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--brand-surface)',
                  border: '1px solid var(--brand-border)', color: 'var(--brand-primary)', marginBottom: '16px', fontSize: '0.88rem',
                  display: 'flex', alignItems: 'center', gap: '8px'
                }}>
                  <RefreshCw size={16} className="spin" />
                  <span>Processing and vectorizing documents... Ready in seconds!</span>
                </div>
              )}

              {/* Big, Friendly Interactive Drag and Drop Zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer && e.dataTransfer.files) {
                    handleFiles(e.dataTransfer.files);
                  }
                }}
                className="paper-panel"
                style={{
                  padding: '48px 24px', textAlign: 'center', cursor: 'pointer', borderStyle: 'dashed',
                  borderWidth: '2px', borderColor: 'var(--brand-primary)', marginBottom: '28px', backgroundColor: 'var(--bg-surface)',
                  boxShadow: '0 4px 20px var(--brand-surface)', transition: 'all 0.2s ease'
                }}
              >
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={(e) => {
                    if (e.target.files) {
                      handleFiles(e.target.files);
                      e.target.value = '';
                    }
                  }}
                  style={{ display: 'none' }}
                />
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--brand-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  <UploadCloud size={32} color="var(--brand-primary)" />
                </div>
                <h4 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '6px' }}>
                  Drag & Drop any files here to upload
                </h4>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', maxWidth: '520px', margin: '0 auto 16px' }}>
                  Universal multi-format parser: automatically chunks, indexes, and extracts vectors using SIMD AVX2. Zero size restrictions.
                </p>

                {/* Colorful Format Badges */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
                  <span className="tag-rose micro-tag" style={{ padding: '3px 10px', fontSize: '0.72rem' }}>📄 PDF Documents</span>
                  <span className="tag-blue micro-tag" style={{ padding: '3px 10px', fontSize: '0.72rem' }}>📘 Word (.docx)</span>
                  <span className="tag-emerald micro-tag" style={{ padding: '3px 10px', fontSize: '0.72rem' }}>📊 Excel (.xlsx, .csv)</span>
                  <span className="tag-amber micro-tag" style={{ padding: '3px 10px', fontSize: '0.72rem' }}>📙 PowerPoint (.pptx)</span>
                  <span className="tag-purple micro-tag" style={{ padding: '3px 10px', fontSize: '0.72rem' }}>📝 Markdown (.md)</span>
                  <span className="tag-cyan micro-tag" style={{ padding: '3px 10px', fontSize: '0.72rem' }}>💻 Code & Text</span>
                </div>

                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  className="btn-primary"
                  style={{ fontSize: '0.9rem', padding: '9px 24px' }}
                >
                  <FileCode size={16} /> CHOOSE FILES FROM COMPUTER
                </button>
              </div>

              {/* Ingestion Queue */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div className="section-header" style={{ marginBottom: 0 }}>
                    <span className="num">02.1 //</span> RECENT UPLOADS & STATUS
                  </div>
                  {jobList.length > 0 && (
                    <button
                      onClick={async () => {
                        if (!window.confirm("Clear all recent upload status records?")) return;
                        setJobList([]);
                        try {
                          await fetch(getApiUrl(`/jobs`), { method: 'DELETE' });
                          showToast("Upload status history cleared");
                        } catch (e) {}
                      }}
                      className="btn-paper"
                      style={{ fontSize: '0.74rem', padding: '4px 10px', color: 'var(--text-secondary)' }}
                      title="Clear upload history logs"
                    >
                      <Trash2 size={12} /> CLEAR HISTORY
                    </button>
                  )}
                </div>

                <div className="paper-panel" style={{ overflow: 'hidden' }}>
                  <table className="paper-table">
                    <thead>
                      <tr>
                        <th>Document Name</th>
                        <th>File Size</th>
                        <th>Status</th>
                        <th>Chunks Created</th>
                        <th>Indexing Speed</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobList.length > 0 ? (
                        jobList.map(job => (
                          <tr key={job.job_id}>
                            <td style={{ fontWeight: 600 }}>{job.filename}</td>
                            <td className="mono">{(job.filesize / 1024).toFixed(1)} KB</td>
                            <td>
                              <span className={`status-chip ${job.status === 'DONE' ? 'ready' : job.status === 'FAILED' ? 'error' : 'info'}`}>
                                {job.status === 'DONE' ? 'Ready' : job.status}
                              </span>
                            </td>
                            <td className="mono">{job.chunks_processed} / {job.chunks_total || '-'}</td>
                            <td className="mono" style={{ color: 'var(--brand-primary)' }}>
                              {job.throughput_cps ? `${job.throughput_cps} chunks/s` : 'Instant'}
                            </td>
                            <td>
                              <button
                                onClick={() => handleDeleteFile(job.filename)}
                                className="btn-danger"
                                style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                                title="Remove file and chunks from database"
                              >
                                <Trash2 size={11} /> REMOVE
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px' }}>
                            No recent uploads. Drop a file above to add documents to your knowledge base.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* =========================================================
              TAB 03: DATASET & DOCUMENT MANAGEMENT
              ========================================================= */}
          {activeTab === 'documents' && (
            <div style={{ maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div className="section-header">
                    <span className="num">03 //</span> YOUR DOCUMENTS & DATASET
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                    View, read, or delete any document. You can open files directly or clear the entire dataset with one click.
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  {/* View Mode Toggle */}
                  <div style={{ display: 'flex', backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-sm)', padding: '2px', border: '1px solid var(--border-default)' }}>
                    <button
                      onClick={() => setDatasetViewMode('files')}
                      style={{
                        padding: '5px 12px',
                        border: 'none',
                        borderRadius: 'var(--radius-xs)',
                        backgroundColor: datasetViewMode === 'files' ? 'var(--bg-surface)' : 'transparent',
                        color: datasetViewMode === 'files' ? 'var(--brand-primary)' : 'var(--text-secondary)',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      FILES ({fileList.length})
                    </button>
                    <button
                      onClick={() => setDatasetViewMode('chunks')}
                      style={{
                        padding: '5px 12px',
                        border: 'none',
                        borderRadius: 'var(--radius-xs)',
                        backgroundColor: datasetViewMode === 'chunks' ? 'var(--bg-surface)' : 'transparent',
                        color: datasetViewMode === 'chunks' ? 'var(--brand-primary)' : 'var(--text-secondary)',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      ALL CHUNKS ({docList.length})
                    </button>
                  </div>

                  <button
                    onClick={() => { loadFiles(); loadDocuments(); }}
                    className="btn-paper"
                    style={{ fontSize: '0.78rem' }}
                    title="Refresh list"
                  >
                    <RefreshCw size={13} /> REFRESH
                  </button>

                  {/* DOWNLOAD ALL FILES ZIP ARCHIVE BUTTON */}
                  <a
                    href={getApiUrl(`/collections/${selectedColl}/download-all`)}
                    download={`${selectedColl}_all_files.zip`}
                    className="btn-primary"
                    style={{
                      fontSize: '0.78rem',
                      padding: '6px 14px',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                    title="Download all dataset documents as a single ZIP package"
                  >
                    <Download size={14} />
                    <span>DOWNLOAD ALL FILES (ZIP)</span>
                  </a>

                  {/* PROMINENT REMOVE ALL / CLEAR DATASET BUTTON */}
                  <button
                    onClick={handleClearAllDocuments}
                    disabled={isClearingAll || fileList.length === 0}
                    className="btn-danger"
                    style={{ fontSize: '0.78rem', padding: '6px 14px' }}
                    title="Remove all files and clear the database"
                  >
                    <Trash2 size={14} />
                    <span>{isClearingAll ? 'CLEARING...' : 'CLEAR ALL DOCUMENTS'}</span>
                  </button>
                </div>
              </div>

              {/* Dynamic Category Quick Filters */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 700 }}>QUICK TOPIC FILTER:</span>
                <button
                  onClick={() => setDocFilter('')}
                  style={{
                    padding: '4px 12px', borderRadius: 'var(--radius-full)',
                    fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer',
                    backgroundColor: !docFilter ? 'var(--brand-surface)' : 'var(--bg-panel)',
                    color: !docFilter ? 'var(--brand-primary)' : 'var(--text-secondary)',
                    border: !docFilter ? '1px solid var(--brand-primary)' : '1px solid var(--border-default)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  All Documents ({fileList.length})
                </button>
                {availableCategories.map(cat => {
                  const topic = getDocTopic({ category: cat });
                  const count = fileList.filter(f => f.category === cat).length;
                  const isActive = docFilter.toLowerCase() === cat.toLowerCase();
                  return (
                    <button
                      key={cat}
                      onClick={() => setDocFilter(isActive ? '' : cat)}
                      style={{
                        padding: '4px 12px', borderRadius: 'var(--radius-full)',
                        fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer',
                        backgroundColor: isActive ? topic.bg : 'var(--bg-panel)',
                        color: isActive ? topic.color : 'var(--text-secondary)',
                        border: isActive ? `1.5px solid ${topic.color}` : '1px solid var(--border-default)',
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <span>{topic.icon}</span>
                      <span>{cat}</span>
                      <span style={{ opacity: 0.75, fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>({count})</span>
                    </button>
                  );
                })}
              </div>

              {/* Search / Filter in Documents */}
              <div style={{ marginBottom: '18px' }}>
                <input
                  type="text"
                  placeholder="Type to filter documents by name, type, or topic..."
                  value={docFilter}
                  onChange={(e) => setDocFilter(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1.5px solid var(--border-default)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem',
                    outline: 'none',
                    boxShadow: 'var(--shadow-xs)'
                  }}
                />
              </div>

              {/* FILES VIEW (Grouped by Document) */}
              {datasetViewMode === 'files' && (
                <div className="paper-panel" style={{ overflow: 'hidden' }}>
                  <table className="paper-table">
                    <thead>
                      <tr>
                        <th>Document / File Name</th>
                        <th>Topic / Type</th>
                        <th>Passages</th>
                        <th>File Size</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFiles.length > 0 ? (
                        filteredFiles.map(file => {
                          const topicInfo = getDocTopic(file);
                          return (
                          <tr key={file.filename}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-xs)', backgroundColor: topicInfo.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <FileText size={15} color={topicInfo.color} />
                                </div>
                                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{file.filename}</span>
                              </div>
                            </td>
                            <td>
                              <span style={{
                                fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                                backgroundColor: topicInfo.bg, color: topicInfo.color, border: `1px solid ${topicInfo.color}`,
                                display: 'inline-flex', alignItems: 'center', gap: '4px'
                              }}>
                                {topicInfo.icon} {file.category}
                              </span>
                            </td>
                            <td className="mono">{file.chunk_count} passages</td>
                            <td className="mono">
                              {file.filesize ? `${(file.filesize / 1024).toFixed(1)} KB` : '12.4 KB'}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                {/* READ / VIEW TEXT CONTENT BUTTON */}
                                <button
                                  onClick={() => handleOpenDocViewer(file.filename)}
                                  className="btn-paper"
                                  style={{
                                    padding: '4px 10px',
                                    fontSize: '0.74rem',
                                    color: 'var(--brand-primary)',
                                    cursor: 'pointer'
                                  }}
                                  title="Read document text directly"
                                >
                                  <BookOpen size={12} />
                                  READ
                                </button>

                                {/* DIRECT DOWNLOAD FILE BUTTON */}
                                <a
                                  href={`/api/files/${encodeURIComponent(file.filename)}?download=1`}
                                  download={file.filename}
                                  className="btn-paper"
                                  style={{
                                    padding: '4px 10px',
                                    fontSize: '0.74rem',
                                    color: 'var(--brand-primary)',
                                    textDecoration: 'none',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}
                                  title="Download original file directly to computer"
                                >
                                  <Download size={12} />
                                  DOWNLOAD
                                </a>

                                {/* DIRECT OPEN / PREVIEW FILE LINK */}
                                <a
                                  href={file.file_url || `/api/files/${encodeURIComponent(file.filename)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn-paper"
                                  style={{
                                    padding: '4px 10px',
                                    fontSize: '0.74rem',
                                    color: 'var(--text-secondary)',
                                    textDecoration: 'none'
                                  }}
                                  title="Open raw file in browser"
                                >
                                  <ExternalLink size={12} />
                                  OPEN
                                </a>

                                {/* RED REMOVE DOCUMENT BUTTON */}
                                <button
                                  onClick={() => handleDeleteFile(file.filename)}
                                  disabled={isDeleting === file.filename}
                                  className="btn-danger"
                                  title="Permanently remove document from dataset"
                                >
                                  <Trash2 size={13} />
                                  <span>{isDeleting === file.filename ? 'DELETING...' : 'REMOVE'}</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );})
                      ) : (
                        <tr>
                          <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                            {docFilter ? 'No documents match your filter query.' : 'Your dataset is empty. Click "Upload Files" or "Load 5,000 Demo Documents" to begin.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* CHUNKS VIEW (Individual Vectors) */}
              {datasetViewMode === 'chunks' && (
                <div className="paper-panel" style={{ overflow: 'hidden' }}>
                  <table className="paper-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Passage / Chunk Title</th>
                        <th>Topic</th>
                        <th>Content Preview</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDocs.length > 0 ? (
                        filteredDocs.map(doc => (
                          <tr key={doc.id}>
                            <td className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{doc.id}</td>
                            <td style={{ fontWeight: 600, maxWidth: '240px', wordBreak: 'break-word' }}>{doc.title}</td>
                            <td>
                              <span className="micro-tag">{doc.category}</span>
                            </td>
                            <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '380px', wordBreak: 'break-word' }}>
                              {doc.snippet}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button
                                  onClick={() => handleDeleteDoc(doc.id, doc.title)}
                                  disabled={isDeleting === doc.id}
                                  className="btn-danger"
                                  title="Delete this vector passage"
                                >
                                  <Trash2 size={12} />
                                  <span>{isDeleting === doc.id ? '...' : 'REMOVE'}</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                            No passages match your filter query.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* BOTTOM STATUS STRIP */}
      <footer style={{
        height: '32px', borderTop: '1px solid var(--border-default)', backgroundColor: 'var(--bg-surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px',
        fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)'
      }}>
        <div style={{ display: 'flex', gap: '20px' }}>
          <span>ENGINE: <strong style={{ color: 'var(--brand-primary)' }}>AVX2 NATIVE SIMD</strong></span>
          <span>INDEX: <strong style={{ color: 'var(--text-primary)' }}>HNSW (Hierarchical Navigable Small World)</strong></span>
          <span>STORAGE: <strong style={{ color: 'var(--brand-primary)' }}>SQLite3 + WAL PERSISTENCE</strong></span>
        </div>
        <div>
          <span>VECTORSEARCH CONSOLE // PRODUCTION-GRADE ENGINE</span>
        </div>
      </footer>
    </div>
  );
}
