// src/components/LeftSearchPanel.jsx
import { useState, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import StageCard from './StageCard';
import { googleImageSearch } from '../api';

export default function LeftSearchPanel({
  stages,
  lastFinalQueries = [],
  setStages,
  focusRequest = null,
  onSearch,
  onAgentSearch,
  onQuickSearch,
  similarityScopeActive = false,
  onClearSimilarityScope,
  loading,
}) {
  const [googleQuery, setGoogleQuery] = useState('');
  const [googleResults, setGoogleResults] = useState([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [reorderingStageId, setReorderingStageId] = useState(null);
  const reorderIndexRef = useRef(null);
  const panelRef = useRef(null);
  const reorderFrameRef = useRef(null);

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
      ocrActive: false, asrActive: false,
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

  const deriveAgentPrompt = () => {
    const stage = [...stages].reverse().find((item) => (
      item.queryText?.trim() ||
      item.imageText?.trim() ||
      item.ocrText?.trim() ||
      item.asrText?.trim()
    ));
    if (!stage) return '';

    const primary = stage.queryType === 'image'
      ? (stage.imageText || '').trim()
      : (stage.queryText || '').trim();
    return [
      primary,
      stage.ocrText?.trim() ? `OCR: ${stage.ocrText.trim()}` : null,
      stage.asrText?.trim() ? `ASR: ${stage.asrText.trim()}` : null,
    ].filter(Boolean).join(' | ');
  };

  const executeAgentSearch = () => {
    const prompt = deriveAgentPrompt();
    if (!prompt) {
      toast.error('Enter a query before starting Agent Search.');
      return;
    }
    onAgentSearch?.(prompt);
  };



  return (
    <div
      id="left-search-panel"
      className="w-full h-full border-r border-[var(--border-color)] flex flex-col overflow-hidden transition-all duration-300"
      style={{ background: 'var(--card-bg)' }}
    >
      <div ref={panelRef} className="flex-grow overflow-y-auto p-4 space-y-4">
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
            <div className="mt-2.5 flex gap-2 overflow-x-auto p-2 bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-lg min-h-[72px] items-center animate-fadeIn">
              {googleResults.map((url, idx) => (
                <div
                  key={idx}
                  className="flex-shrink-0 w-24 h-[52px] rounded-md overflow-hidden border border-[var(--border-color)] hover:border-[var(--border-hover)] hover:scale-105 hover:shadow-glow transition-all duration-300 ease-spring cursor-pointer animate-scaleIn"
                  style={{ animationDelay: `${idx * 40}ms` }}
                  onClick={(e) => {
                    if (e.ctrlKey && e.shiftKey && onQuickSearch) {
                      e.preventDefault();
                      onQuickSearch({ url });
                    }
                  }}
                  title="Ctrl+Shift+Click for Quick Image Search"
                >
                  <img src={url} alt="Google result" className="w-full h-full object-cover" />
                </div>
              ))}
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
                similarityScopeActive={similarityScopeActive}
                onClearSimilarityScope={onClearSimilarityScope}
              />
            </div>
          ))}
        </div>
      </div>



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
            className="group relative flex items-center justify-center gap-2 border border-[var(--border-color)] bg-[var(--glass-bg)] text-[var(--text-primary)] px-3 py-2 rounded-lg font-semibold text-xs tracking-normal hover:-translate-y-0.5 hover:border-[var(--border-hover)] active:scale-95 active:translate-y-0 transition-all duration-300 ease-smooth cursor-pointer disabled:opacity-50"
            onClick={executeAgentSearch}
            disabled={loading}
            title="Start Agent Search"
          >
            <i className="fas fa-brain text-xs group-hover:scale-110 transition-transform duration-300"></i>
            Agent
          </button>
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
    </div>
  );
}
