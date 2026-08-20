// src/components/LeftSearchPanel.jsx
import { useState, useRef, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import StageCard from './StageCard';
import { googleImageSearch } from '../api';

export default function LeftSearchPanel({
  stages,
  lastFinalQueries = [],
  setStages,
  focusRequest = null,
  onFocusStage = () => { },
  onSearch,
  onQuickSearch,
  loading,
  isSemanticAsr = false,
  semanticAsrQuery = '',
  setSemanticAsrQuery = () => { },
  onSemanticAsrSearch = () => { },
  semanticAsrSentenceLevel = false,
  setSemanticAsrSentenceLevel = () => { },
}) {
  const [googleQuery, setGoogleQuery] = useState('');
  const [googleResults, setGoogleResults] = useState([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  // Keep keystrokes local. Updating App state on every character rerenders the
  // result panel (which can contain hundreds of keyframes) and stalls typing.
  const [semanticAsrDraft, setSemanticAsrDraft] = useState(semanticAsrQuery);
  const [reorderingStageId, setReorderingStageId] = useState(null);
  const reorderIndexRef = useRef(null);
  const panelRef = useRef(null);
  const reorderFrameRef = useRef(null);
  const semanticAsrRef = useRef(null);

  // Tự động Focus vào con trỏ khi bật chế độ Semantic ASR
  useEffect(() => {
    if (isSemanticAsr) {
      const timer = setTimeout(() => {
        semanticAsrRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isSemanticAsr]);

  // App may clear or prefill the query when resetting/restoring a workspace.
  useEffect(() => {
    setSemanticAsrDraft(semanticAsrQuery);
  }, [semanticAsrQuery]);

  const isInteractiveStageTarget = useCallback((target) => {
    return !!target?.closest?.([
      'button',
      'input',
      'textarea',
      'select',
      'option',
      'label',
      'a',
      '[contenteditable="true"]',
      '[data-no-stage-drag]',
    ].join(','));
  }, []);

  const moveStage = useCallback((from, to) => {
    if (from === to || from === null || to === null) return;
    setStages((prev) => {
      if (from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    reorderIndexRef.current = to;
  }, [setStages]);

  const addStage = () => {
    setStages((prev) => [...prev, {
      id: Date.now(),
      queryText: '', ocrText: '', asrText: '',
      ocrActive: true, asrActive: true,
      queryType: 'text',
      options: { enhance: false, bge_caption: false },
    }]);
  };

  const removeLastStage = () => {
    if (stages.length > 1) setStages((prev) => prev.slice(0, -1));
  };

  const handleStageChange = (id, data) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...data } : s)));
  };

  const handleStageDelete = (id) => {
    setStages((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));
  };

  const handleNavigateStage = useCallback((currentIndex, direction) => {
    const targetStage = stages[currentIndex + direction];
    if (!targetStage) return;
    onFocusStage({
      stageId: targetStage.id,
      field: targetStage.queryType === 'image' ? 'imageText' : 'query',
      select: false,
      token: Date.now(),
    });
  }, [stages, onFocusStage]);

  const getTargetStageIndex = useCallback((clientY) => {
    const panel = panelRef.current;
    if (!panel) return null;

    const stageNodes = [...panel.querySelectorAll('[data-stage-index]')];
    if (stageNodes.length === 0) return null;

    let targetIndex = stageNodes.length - 1;
    for (const node of stageNodes) {
      const rect = node.getBoundingClientRect();
      const nodeIndex = Number(node.dataset.stageIndex);
      if (Number.isNaN(nodeIndex)) continue;
      if (clientY < rect.top + rect.height / 2) {
        targetIndex = nodeIndex;
        break;
      }
    }

    return targetIndex;
  }, []);

  const handleReorderPointerDown = useCallback((idx, event) => {
    if (stages.length <= 1) return;
    if (isInteractiveStageTarget(event.target)) return;
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const draggedStageId = stages[idx]?.id || null;
    let hasStarted = false;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    const handlePointerMove = (moveEvent) => {
      const deltaX = Math.abs(moveEvent.clientX - startX);
      const deltaY = Math.abs(moveEvent.clientY - startY);
      if (!hasStarted) {
        if (deltaX < 4 && deltaY < 4) return;
        hasStarted = true;
        reorderIndexRef.current = idx;
        setReorderingStageId(draggedStageId);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }

      moveEvent.preventDefault();
      const panel = panelRef.current;
      if (!panel) return;

      const rect = panel.getBoundingClientRect();
      const edgeSize = 56;
      if (moveEvent.clientY < rect.top + edgeSize) {
        panel.scrollTop -= 14;
      } else if (moveEvent.clientY > rect.bottom - edgeSize) {
        panel.scrollTop += 14;
      }

      if (reorderFrameRef.current) return;
      reorderFrameRef.current = window.requestAnimationFrame(() => {
        reorderFrameRef.current = null;
        const to = getTargetStageIndex(moveEvent.clientY);
        if (to === null || to === reorderIndexRef.current) return;
        moveStage(reorderIndexRef.current, to);
      });
    };

    const handlePointerUp = () => {
      if (reorderFrameRef.current) {
        window.cancelAnimationFrame(reorderFrameRef.current);
        reorderFrameRef.current = null;
      }
      reorderIndexRef.current = null;
      setReorderingStageId(null);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);
  }, [getTargetStageIndex, isInteractiveStageTarget, moveStage, stages]);

  const executeGoogleSearch = async () => {
    if (!googleQuery.trim()) return;
    setGoogleLoading(true);
    try {
      const res = await googleImageSearch(googleQuery);
      setGoogleResults(res.image_urls || []);
    } catch (e) {
      toast.error('Error loading Google Images: ' + e.message);
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div
      id="left-search-panel"
      className="w-full h-full border-r border-[var(--border-color)] flex flex-col overflow-hidden transition-all duration-300"
      style={{ background: 'var(--card-bg)' }}
    >
      <div ref={panelRef} className="flex-grow overflow-y-auto p-4 space-y-4">
        {isSemanticAsr ? (
          <div className="space-y-4 animate-fadeIn">
            <div className="pb-3 border-b border-[var(--border-color)]">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-[var(--accent-primary)] uppercase tracking-wider">
                  <i className="fas fa-closed-captioning text-base"></i> Semantic ASR
                </div>
                <button
                  type="button"
                  onClick={() => setSemanticAsrSentenceLevel(!semanticAsrSentenceLevel)}
                  data-active={semanticAsrSentenceLevel ? 'true' : 'false'}
                  data-topbar-button="true"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-all cursor-pointer select-none active:scale-95 ${
                    semanticAsrSentenceLevel
                      ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] border-[var(--text-primary)] shadow-sm'
                      : 'bg-[var(--glass-bg)] text-[var(--text-secondary)] border-[var(--border-color)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)]'
                  }`}
                  title={semanticAsrSentenceLevel ? 'Switch to paragraph level' : 'Switch to sentence level'}
                >
                  <i className={`fas ${semanticAsrSentenceLevel ? 'fa-check-circle' : 'fa-circle-dot'} text-[10px]`}></i>
                  <span>Sentence level</span>
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                {semanticAsrSentenceLevel
                  ? 'Tìm kiếm theo câu thoại với index semantic_asr_sentence_level.'
                  : 'Tìm kiếm tóm tắt đoạn thoại với index semantic_asr.'}
              </p>
            </div>

            <div className="space-y-3">
              <textarea
                ref={semanticAsrRef}
                autoFocus
                className="w-full p-3 bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] text-xs focus:outline-none focus:border-[var(--border-hover)] focus:ring-1 focus:ring-white/10 transition-all min-h-[120px] resize-y placeholder:text-[var(--text-secondary)]"
                placeholder={semanticAsrSentenceLevel ? "Nhập câu thoại cần tìm (Sentence Level)..." : "Nhập nội dung thoại hoặc tóm tắt cần tìm..."}
                rows="5"
                value={semanticAsrDraft}
                onChange={(e) => setSemanticAsrDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    setSemanticAsrQuery(semanticAsrDraft);
                    onSemanticAsrSearch(semanticAsrDraft);
                  }
                }}
              />

              <button
                className="w-full flex items-center justify-center gap-2 bg-[var(--text-primary)] text-[var(--bg-primary)] px-4 py-2.5 rounded-lg font-bold text-xs tracking-wide hover:bg-[var(--accent-secondary)] transition-all duration-200 cursor-pointer disabled:opacity-50 shadow-sm"
                onClick={() => {
                  setSemanticAsrQuery(semanticAsrDraft);
                  onSemanticAsrSearch(semanticAsrDraft);
                }}
                disabled={loading}
              >
                <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-search'}`}></i>
                {loading ? 'Searching ASR Chunks...' : 'Search Semantic ASR'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="pb-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2.5">
                <i className="fab fa-google text-red-500"></i> Google Image Search
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-grow px-3 py-2 bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] text-xs focus:outline-none focus:border-[var(--border-hover)] focus:ring-1 focus:ring-white/10 transition-all placeholder:text-[var(--text-secondary)]"
                  placeholder="Search Google Images..."
                  value={googleQuery}
                  onChange={(e) => setGoogleQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && executeGoogleSearch()}
                />
                <button
                  className="w-9 h-9 rounded-lg border border-[var(--border-color)] bg-[var(--glass-bg)] text-[var(--text-secondary)] flex items-center justify-center hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] transition-all cursor-pointer active:scale-95 flex-shrink-0"
                  onClick={executeGoogleSearch}
                  disabled={googleLoading}
                >
                  <i className={`fas ${googleLoading ? 'fa-spinner fa-spin' : 'fa-search'} text-xs`}></i>
                </button>
              </div>

              {googleResults.length > 0 && (
                <div className="relative mt-2.5 animate-fadeIn">
                  <button
                    type="button"
                    onClick={() => setGoogleResults([])}
                    className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] text-white/80 transition-colors hover:bg-black hover:text-white"
                    title="Close Google image results"
                    aria-label="Close Google image results"
                  >
                    <i className="fas fa-times"></i>
                  </button>
                  <div className="flex min-h-[72px] gap-2 overflow-x-auto rounded-lg border border-[var(--border-color)] bg-[var(--glass-bg)] p-2 pr-8 items-center">
                    {googleResults.map((url, idx) => (
                      <div
                        key={idx}
                        draggable
                        className="flex-shrink-0 w-24 h-[52px] rounded-md overflow-hidden border border-[var(--border-color)] hover:border-[var(--border-hover)] hover:scale-105 hover:shadow-glow transition-all duration-300 ease-spring cursor-grab active:cursor-grabbing animate-scaleIn"
                        style={{ animationDelay: `${idx * 40}ms` }}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'copy';
                          e.dataTransfer.setData('text/uri-list', url);
                          e.dataTransfer.setData('text/plain', url);
                        }}
                        onClick={(e) => {
                          if (e.ctrlKey && e.shiftKey && onQuickSearch) {
                            e.preventDefault();
                            onQuickSearch({ url });
                          }
                        }}
                        title="Drag to an Image query, or Ctrl+Shift+Click for Quick Image Search"
                      >
                        <img src={url} alt="Google result" className="w-full h-full object-cover" draggable={false} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {stages.map((stage, idx) => (
                <div
                  key={stage.id}
                  data-stage-index={idx}
                  className="animate-fadeInUp rounded-lg transition-transform duration-150 ease-out"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <StageCard
                    stage={stage}
                    index={idx}
                    finalQueryPreview={lastFinalQueries[idx] || ''}
                    focusRequest={focusRequest}
                    onDelete={() => handleStageDelete(stage.id)}
                    onChange={handleStageChange}
                    onSearch={onSearch}
                    canDelete={stages.length > 1}
                    isReordering={reorderingStageId === stage.id}
                    onReorderPointerDown={(event) => handleReorderPointerDown(idx, event)}
                    onNavigateStage={handleNavigateStage}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {!isSemanticAsr && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-[var(--border-color)] flex items-center justify-between gap-2 bg-[var(--card-bg)]">
          <div className="flex gap-1.5">
            <button
              className="w-8 h-8 rounded-lg border border-[var(--border-color)] bg-transparent text-[var(--text-secondary)] text-sm flex items-center justify-center hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[var(--glass-bg)] transition-all cursor-pointer active:scale-95"
              onClick={addStage}
              title="Add stage"
            >
              <i className="fas fa-plus text-xs"></i>
            </button>
            <button
              className="w-8 h-8 rounded-lg border border-[var(--border-color)] bg-transparent text-[var(--text-secondary)] text-sm flex items-center justify-center hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[var(--glass-bg)] transition-all cursor-pointer active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={removeLastStage}
              disabled={stages.length <= 1}
              title="Remove last stage"
            >
              <i className="fas fa-minus text-xs"></i>
            </button>
            {stages.length > 1 && (
              <span className="self-center text-[10px] text-[var(--text-secondary)] ml-1">
                {stages.length} stages
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              className="group relative flex items-center gap-2 bg-[var(--text-primary)] text-[var(--bg-primary)] px-5 py-2 rounded-lg font-semibold text-xs tracking-normal hover:bg-[var(--accent-secondary)] hover:-translate-y-0.5 hover:shadow-glow active:scale-95 active:translate-y-0 transition-all duration-300 ease-smooth shadow-sm cursor-pointer disabled:opacity-50 disabled:hover:translate-y-0 overflow-hidden"
              onClick={onSearch}
              disabled={loading}
              data-primary-search-button="true"
            >
              <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-search group-hover:scale-110'} text-xs transition-transform duration-300`}></i>
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
