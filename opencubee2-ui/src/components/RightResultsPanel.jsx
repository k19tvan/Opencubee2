import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { getImageUrl } from '../utils/imageUrl';
import { getSimilarFrames } from '../api';
import SubmissionPanel from './SubmissionPanel';

const HIGHLIGHT_START = '__MEILI_HIGHLIGHT_START__';
const HIGHLIGHT_END = '__MEILI_HIGHLIGHT_END__';

const renderHighlightedSummary = (summary) => {
  if (!summary || !summary.includes(HIGHLIGHT_START)) return summary;
  const parts = summary.split(/(__MEILI_HIGHLIGHT_START__|__MEILI_HIGHLIGHT_END__)/);
  let highlighted = false;
  return parts.map((part, index) => {
    if (part === HIGHLIGHT_START) {
      highlighted = true;
      return null;
    }
    if (part === HIGHLIGHT_END) {
      highlighted = false;
      return null;
    }
    return highlighted ? (
      <mark key={index} className="mx-0.5 rounded bg-amber-300/25 px-0.5 font-extrabold text-amber-100 ring-1 ring-amber-300/35">
        {part}
      </mark>
    ) : <React.Fragment key={index}>{part}</React.Fragment>;
  });
};

const SimilarFramesPopover = ({ shotData, onClose, onZoom, onPreview, onContext, setHoveredFrame, onMouseEnterPopoverItem, parentShot }) => {
  const [neighbors, setNeighbors] = useState([]);
  const [loading, setLoading] = useState(true);
  const popoverRef = useRef(null);

  useEffect(() => {
    const handleGlobalInteraction = (e) => {
      // Ignore right clicks for context menu (which shouldn't automatically close the panel)
      if (e.type === 'mousedown' && e.button === 2) return;

      // Close if clicking outside the popover
      if (e.type === 'mousedown' && popoverRef.current && !popoverRef.current.contains(e.target)) {
        // Only close if we are not clicking inside another modal (e.g. video preview)
        // Modals in this app usually use Tailwind fixed classes with high z-index
        const isClickingInsideModal = e.target.closest('.fixed');
        if (!isClickingInsideModal) {
          onClose();
        }
      }
    };
    document.addEventListener('mousedown', handleGlobalInteraction);
    return () => {
      document.removeEventListener('mousedown', handleGlobalInteraction);
    };
  }, [onClose]);

  useEffect(() => {
    const fetchNeighbors = async () => {
      setLoading(true);
      try {
        const frameNameOrPath = shotData.frame_name || shotData.filepath;
        if (!frameNameOrPath) return;
        const response = await getSimilarFrames(frameNameOrPath);
        const results = response.results || [];
        // Map and extract match_type
        const mapped = results.map(shot => ({
          ...shot,
          url: getImageUrl(shot.url || shot.frame_name || shot.filepath)
        }));
        setNeighbors(mapped);
      } catch (err) {
        console.error("Error fetching similar frames:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchNeighbors();
  }, [shotData]);

  return (
    <div 
      ref={popoverRef}
      className="absolute top-[110%] left-0 w-[240px] bg-[#22102f] border border-white/20 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] z-[9999] overflow-hidden flex flex-col cursor-default animate-scaleIn origin-top-left pointer-events-auto"
      onClick={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
    >
      {loading ? (
        <div className="p-6 text-center text-xs text-[var(--accent-primary)] animate-pulse">
          <i className="fas fa-circle-notch fa-spin mr-2"></i> Loading frames...
        </div>
      ) : neighbors.length === 0 ? (
        <div className="p-4 text-center text-xs text-gray-400 italic">No similar frames</div>
      ) : (
        <div className="max-h-[450px] overflow-y-auto p-3 flex flex-col gap-3 custom-scrollbar">
          {neighbors.map((shot, idx) => {
            const hasDup = shot.match_type === 'DUP';
            return (
              <div 
                key={idx} 
                className="relative flex-shrink-0 aspect-video rounded-lg overflow-hidden border-2 border-[#412e4f] hover:border-orange-500 hover:scale-[1.02] transition-all cursor-pointer shadow-md group"
                onClick={(e) => { 
                  e.stopPropagation(); 
                  const isCtrlOrCmd = e.ctrlKey || e.metaKey;
                  if (isCtrlOrCmd && onContext) {
                    onContext(shot);
                  } else {
                    onZoom(shot.url); 
                  }
                }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onPreview(shot.video_id, shot.frame_id); }}
                onMouseEnter={(e) => {
                  e.stopPropagation();
                  setHoveredFrame?.(shot);
                  if (onMouseEnterPopoverItem) onMouseEnterPopoverItem(shot);
                }}
                onMouseMove={(e) => {
                  e.stopPropagation();
                  setHoveredFrame?.(shot);
                  if (onMouseEnterPopoverItem) onMouseEnterPopoverItem(shot);
                }}
                onMouseLeave={(e) => {
                  e.stopPropagation();
                  setHoveredFrame?.(parentShot || null);
                  if (onMouseEnterPopoverItem) onMouseEnterPopoverItem(parentShot || null);
                }}
              >
                <img src={shot.url} className="w-full h-full object-cover opacity-90 group-hover:opacity-100" />
                <div className="absolute top-1.5 left-1.5 bg-black/80 px-2 py-0.5 rounded text-[10px] font-extrabold text-white">
                  {hasDup ? 'DUP' : 'REPEAT'}
                </div>
                <div className="absolute bottom-1.5 left-1.5 bg-gradient-to-r from-blue-900/90 to-blue-700/90 border border-blue-500/50 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white shadow-sm">
                  {shot.video_id}
                </div>
                <div className="absolute bottom-1.5 right-1.5 bg-gradient-to-l from-indigo-900/90 to-indigo-700/90 border border-indigo-500/50 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white shadow-sm">
                  {shot.frame_id}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Component cho mỗi item ảnh
const ResultItem = React.memo(({
  shot,
  onDragStart,
  onClick,
  onContextMenu,
  onMouseEnter,
  onMouseLeave,
  onPushToTeam,
  onPushToTrake,
  onZoom,
  onPreview,
  onContext,
  isLocked = false,
  isDeletedLocked = false,
  dresMode,
  setHoveredFrame,
  onDresSubmit,
  isWrong = false,
  isCorrect = false,
}) => {
  const [loaded, setLoaded] = useState(false);
  const [showSimilarPopover, setShowSimilarPopover] = useState(false);

  const handleError = useCallback((e) => {
    e.target.onerror = null;
    e.target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWUxZTFlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMCIgZmlsbD0iIzY2NiIgZG1pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JbWFnZSBOb3QgRm91bmQ8L3RleHQ+PC9zdmc+';
    setLoaded(true);
  }, []);

  const setImgRef = useCallback((node) => {
    if (node && node.complete && node.naturalWidth > 0) setLoaded(true);
  }, []);

  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    // We removed the individual listener here because RightResultsPanel 
    // handles shortcuts globally based on hoveredShotRef, preventing duplicate fires.
  }, []);

  const hasSubmissionStatus = isCorrect || isWrong;
  const statusColor = isCorrect ? '#ccff00' : '#ff1744'; // Use a bright neon lime instead of theme accent color
  const similarityLabels = shot.similarity_labels || [];
  const hasIntro = similarityLabels.includes('INTRO');
  const hasDuplicate = similarityLabels.includes('DUP');
  const hasReuse = similarityLabels.includes('REUSE');

  return (
    <div
      draggable={true}
      onDragStart={(e) => onDragStart(e, shot)}
      className={`relative bg-[var(--card-bg)] rounded-lg aspect-video cursor-pointer ${hasSubmissionStatus ? 'border-0 z-20' : 'border border-[var(--border-color)] hover:border-[var(--border-hover)] hover:ring-1 hover:ring-white/20'} shadow-[var(--shadow-heavy)] group ${showSimilarPopover ? 'z-[55]' : ''}`}
      style={hasSubmissionStatus ? {
        boxShadow: `0 0 15px 3px ${statusColor}, 0 0 30px 8px ${statusColor}, 0 0 60px 15px ${statusColor}, inset 0 0 25px 5px ${statusColor}`,
      } : undefined}
      onClick={(e) => onClick(e, shot)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(shot);
      }}
      onMouseEnter={() => {
        onMouseEnter(shot);
        setHoveredFrame?.(shot);
        setIsHovering(true);
      }}
      onMouseMove={() => {
        onMouseEnter(shot);
        setHoveredFrame?.(shot);
      }}
      onMouseLeave={() => {
        onMouseLeave(shot);
        setHoveredFrame?.(null);
        setIsHovering(false);
      }}
    >
      <img
        ref={setImgRef}
        src={getImageUrl(shot.url || shot.frame_name || shot.filepath)}
        alt="Search result"
        className={`w-full h-full object-cover rounded-lg ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onError={handleError}
        onLoad={() => setLoaded(true)}
        loading="lazy"
        decoding="async"
      />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-slate-950/50 to-transparent opacity-0 group-hover:opacity-100 pointer-events-none rounded-b-lg" />
      <div className="absolute inset-0 bg-slate-950/0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-20">
        <button
          className="absolute top-1.5 right-1.5 px-3 py-1.5 rounded-md bg-emerald-600/95 border border-emerald-400 text-white flex items-center justify-center text-[10px] hover:bg-emerald-500 hover:scale-105 shadow-[0_0_12px_rgba(16,185,129,0.8)] cursor-pointer pointer-events-auto z-40 transition-all gap-1.5"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('push-to-panel', { detail: { shot } }));
          }}
          title="Push to Panel (Ctrl + Space)"
        >
          <i className="fas fa-level-up-alt"></i>
          <span className="font-bold tracking-wider">PUSH</span>
        </button>
      </div>
      {isLocked && (
        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded bg-emerald-500/90 flex items-center justify-center z-10" title="Video search locked">
          <i className="fas fa-lock text-[8px] text-white"></i>
        </div>
      )}
      {isDeletedLocked && (
        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded bg-rose-600/90 flex items-center justify-center z-10" title="Video delete locked (Excluded from search)">
          <i className="fas fa-trash-alt text-[8px] text-white"></i>
        </div>
      )}
      <div className="absolute top-1.5 left-1.5 flex flex-col gap-1 z-30 pointer-events-none">
        {hasIntro && (
          <div className="px-2 py-0.5 rounded-full bg-blue-600 text-white flex items-center justify-center w-fit shadow-[0_0_8px_rgba(37,99,235,0.8)] border border-blue-400">
            <span className="text-[9px] font-extrabold tracking-widest text-white">INTRO</span>
          </div>
        )}
        {(hasReuse || hasDuplicate) && (
          <div className="relative">
            <div 
              className={`px-2 py-0.5 rounded-md text-white flex items-center justify-center w-fit shadow-lg cursor-pointer pointer-events-auto hover:scale-105 transition-transform ${hasDuplicate ? 'bg-[#e86c1f] border border-[#ff8b45]' : 'bg-emerald-600 border border-emerald-400'}`}
              onClick={(e) => { e.stopPropagation(); setShowSimilarPopover(!showSimilarPopover); }}
              title="View Similar Frames"
            >
              <i className="far fa-clone text-[9px] mr-1.5"></i>
              <span className="text-[10px] font-extrabold tracking-wider text-white">{hasDuplicate ? 'DUP' : 'REPEAT'}</span>
            </div>
            {showSimilarPopover && (
              <SimilarFramesPopover 
                shotData={shot} 
                onClose={() => setShowSimilarPopover(false)}
                onZoom={onZoom}
                onPreview={onPreview}
                onContext={onContext}
                setHoveredFrame={setHoveredFrame}
                onMouseEnterPopoverItem={onMouseEnter}
                parentShot={shot}
              />
            )}
          </div>
        )}
        {isWrong && (
          <div className="px-2 py-0.5 rounded-full bg-rose-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity w-fit pointer-events-auto shadow-[0_0_8px_rgba(225,29,72,0.8)] border border-rose-400" title="Wrong Submission">
            <span className="text-[9px] font-extrabold tracking-widest text-white">WRONG</span>
          </div>
        )}
        {isCorrect && (
          <div className="px-2 py-0.5 rounded-full bg-[var(--accent-primary)] text-[var(--bg-primary)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity w-fit pointer-events-auto shadow-[0_0_10px_var(--accent-primary)] border border-white/50" title="Correct Submission">
            <span className="text-[9px] font-extrabold tracking-widest text-[var(--bg-primary)]">CORRECT</span>
          </div>
        )}
      </div>
    </div>
  );
});

ResultItem.displayName = 'ResultItem';

const isSameShot = (first, second) => {
  if (!first || !second) return false;
  return (
    (first.filepath && second.filepath && first.filepath === second.filepath)
    || (first.frame_name && second.frame_name && first.frame_name === second.frame_name)
    || (
      first.video_id && second.video_id
      && first.video_id === second.video_id
      && first.frame_id != null && second.frame_id != null
      && String(first.frame_id) === String(second.frame_id)
    )
  );
};


export default function RightResultsPanel({
  searchResults = [],
  loading = false,
  loadingMore = false,
  hasMore = false,
  onLoadMore = () => { },
  onPreview = () => { },
  onZoom = () => { },
  isClustered = false,
  isAmbiguous = false,
  onContext = () => { },
  onQuickSearch = () => { },
  onToggleLock = () => { },
  lockedVideoIds = [],
  deletedVideoIds = [],
  activeQueryFilename,
  activeQueryText,
  activeCsvContent,
  activeDraftContent,
  onSaveSubmission,
  onSyncState,
  setHoveredFrame,
  onPreviewTrakeFrame,
  username,
  onSyncDraft,
}) {
  const containerRef = useRef(null);
  const sentinelRef = useRef(null);
  const prevFirstResult = useRef(null);
  const hoveredShotRef = useRef(null);

  const handleResultMouseEnter = useCallback((shot) => {
    hoveredShotRef.current = shot || null;
  }, []);

  const handleResultMouseLeave = useCallback((shot) => {
    if (hoveredShotRef.current === shot) hoveredShotRef.current = null;
  }, []);

  const handleDragStart = useCallback((e, shot) => {
    if (!shot) return;
    const fullUrl = getImageUrl(shot.url || shot.frame_name || shot.filepath);
    const enrichedShot = { ...shot, url: fullUrl };
    e.dataTransfer.setData('application/json', JSON.stringify(enrichedShot));
    e.dataTransfer.setData('text/uri-list', fullUrl);
    e.dataTransfer.setData('text/plain', shot.frame_name || fullUrl);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleItemClick = useCallback((e, shot) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (isCtrlOrCmd && e.altKey) {
      e.preventDefault();
      onContext({ ...shot, contextView: 'video-timeline' });
      return;
    }
    if (e.altKey) {
      e.preventDefault();
      onToggleLock(shot);
      return;
    }
    if (isCtrlOrCmd && e.shiftKey) {
      e.preventDefault();
      onQuickSearch(shot);
    } else if (isCtrlOrCmd) {
      e.preventDefault();
      onContext({ ...shot, contextView: 'neighbors' });
    } else {
      onZoom(getImageUrl(shot.url || shot.frame_name || shot.filepath));
    }
  }, [onQuickSearch, onContext, onZoom, onToggleLock]);

  const handleOpenPreview = useCallback((shot) => {
    if (!shot) return;
    onPreview(shot.video_id, shot.frame_id);
  }, [onPreview]);

  const isTemporalSearch = useMemo(() => {
    return searchResults && searchResults.length > 0 && searchResults.some(res => res.clusters || res.combined_score);
  }, [searchResults]);

  const isSemanticAsrResults = useMemo(() => {
    return searchResults && searchResults.length > 0 && searchResults[0].summary !== undefined;
  }, [searchResults]);

  const rankedSingleStageShots = useMemo(() => {
    const ranked = (searchResults || [])
      .flatMap((cluster) => {
        if (cluster?.shots?.length) return cluster.shots;
        return cluster?.best_shot ? [cluster.best_shot] : [];
      })
      .sort((a, b) => (
        (b.rrf_score ?? b.score ?? 0) - (a.rrf_score ?? a.score ?? 0)
      ));

    return Array.from(
      new Map(ranked.filter(Boolean).map((shot) => [
        shot.filepath || shot.frame_name || shot.url,
        shot,
      ])).values()
    );
  }, [searchResults]);

  const renderResultItem = useCallback((shot, key) => {
    if (!shot || !shot.url) return null;
    return (
      <ResultItem
        key={key}
        shot={shot}
        onClick={handleItemClick}
        onDragStart={handleDragStart}
        onContextMenu={handleOpenPreview}
        onMouseEnter={handleResultMouseEnter}
        onMouseLeave={handleResultMouseLeave}
        isLocked={lockedVideoIds.includes(shot.video_id)}
        isDeletedLocked={deletedVideoIds.includes(shot.video_id)}
        setHoveredFrame={setHoveredFrame}
        onZoom={onZoom}
        onContext={onContext}
        onQuickSearch={onQuickSearch}
      />
    );
  }, [handleDragStart, handleItemClick, handleOpenPreview, handleResultMouseEnter, handleResultMouseLeave, lockedVideoIds, deletedVideoIds, setHoveredFrame, onZoom, onContext, onQuickSearch]);

  useEffect(() => {
    const firstResult = searchResults.length > 0 ? searchResults[0] : null;
    if (firstResult && firstResult !== prevFirstResult.current) {
      if (containerRef.current) containerRef.current.scrollTop = 0;
    }
    prevFirstResult.current = firstResult;
  }, [searchResults]);


  useEffect(() => {
    if (!containerRef.current || !hasMore || loading || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0] && entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { rootMargin: '300px', threshold: 0.1 }
    );

    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loading, loadingMore, onLoadMore]);

  return (
    <div
      id="right-results-panel"
      ref={containerRef}
      className="flex-grow overflow-y-auto bg-[var(--bg-primary)] pb-12 transition-colors duration-300 relative w-full"
      style={{ willChange: 'transform' }}
    >
      <SubmissionPanel
        activeQueryFilename={activeQueryFilename}
        activeQueryText={activeQueryText}
        activeCsvContent={activeCsvContent}
        activeDraftContent={activeDraftContent}
        onSaveSubmission={onSaveSubmission}
        onSyncState={onSyncState}
        hoveredFrame={hoveredShotRef.current}
        onPreviewTrakeFrame={onPreviewTrakeFrame}
        onZoom={onZoom}
        onContext={onContext}
        onQuickSearch={onQuickSearch}
        onPreview={onPreview}
        onToggleLock={onToggleLock}
        username={username}
        onSyncDraft={onSyncDraft}
      />

      <div className="px-6 py-4">
        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4.5 animate-fadeIn">
            {Array.from({ length: 15 }).map((_, idx) => (
              <div
                key={`skeleton-${idx}`}
                className="skeleton-shimmer relative bg-[var(--card-bg)] rounded-lg border border-[var(--border-color)] aspect-video flex flex-col items-center justify-center shadow-[var(--shadow-heavy)] animate-scaleIn"
                style={{ animationDelay: `${idx * 35}ms` }}
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--glass-bg)] border border-[var(--border-color)]">
                  <i className="fas fa-circle-notch fa-spin text-sm text-[var(--accent-primary)]"></i>
                </div>
                <span className="text-[10px] text-[var(--text-secondary)] mt-2.5 font-medium tracking-wide">
                  Retrieving Frame...
                </span>
              </div>
            ))}
          </div>
        ) : !searchResults || searchResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-36 animate-fadeInUp">
            <div className="relative mb-6 animate-float">
              <div className="absolute inset-0 blur-2xl bg-white/5 rounded-full" />
              <div className="relative w-20 h-20 rounded-lg bg-[var(--glass-bg)] border border-[var(--border-color)] flex items-center justify-center">
                <i className="fas fa-search text-3xl text-[var(--text-secondary)]"></i>
              </div>
            </div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Ready when you are</p>
            <p className="text-xs mt-1 text-[var(--text-secondary)]">Enter a query and hit Search to explore frames.</p>
          </div>
        ) : isSemanticAsrResults ? (
          <div className="space-y-6 animate-fadeIn">
            {searchResults.map((chunk, chunkIdx) => (
              <div
                key={`asr-chunk-${chunk.chunk_id || chunkIdx}`}
                className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-4 shadow-[var(--shadow-heavy)] hover:border-[var(--border-hover)] transition-all duration-200"
              >
                <div className="mb-3.5 pb-3 border-b border-[var(--border-color)]">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-md bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] font-mono text-xs font-bold border border-[var(--accent-primary)]/30">
                        <i className="fas fa-video mr-1.5"></i>{chunk.video_id}
                      </span>
                      {chunk.scene_id && (
                        <span className="text-[11px] font-mono text-[var(--text-secondary)] bg-[var(--glass-bg)] px-2 py-0.5 rounded border border-[var(--border-color)]">
                          Scene: {chunk.scene_id}
                        </span>
                      )}
                      <span className="text-[11px] font-mono text-[var(--text-secondary)] bg-[var(--glass-bg)] px-2 py-0.5 rounded border border-[var(--border-color)]">
                        Frame Range: {chunk.start_id} → {chunk.end_id}
                      </span>
                    </div>
                    {chunk.score !== undefined && (
                      <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                        Similarity: {(chunk.score * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>

                  <div className="p-3 bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-lg text-xs leading-relaxed text-[var(--text-primary)] shadow-inner">
                    <span className="font-bold text-[var(--accent-primary)] mr-2 inline-flex items-center gap-1">
                      <i className="fas fa-quote-left text-[10px]"></i> Summary:
                    </span>
                    {renderHighlightedSummary(chunk.formatted_summary || chunk.summary || "No summary text available.")}
                  </div>
                </div>

                <div className="flex items-center gap-3.5 overflow-x-auto pb-2 custom-scrollbar select-none min-h-[110px]">
                  {chunk.shots && chunk.shots.length > 0 ? (
                    chunk.shots.map((shot, shotIdx) => (
                      <div key={`chunk-shot-${chunkIdx}-${shotIdx}`} className="flex-shrink-0 w-[200px]">
                        {renderResultItem(shot, `shot-chunk-${chunkIdx}-${shotIdx}`)}
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-[var(--text-secondary)] italic py-4 px-2">
                      No keyframes are mapped to this semantic scene.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {isTemporalSearch ? (
              searchResults.map((sequence, seqIndex) => {
                if (!sequence) return null;
                return (
                  <div key={`sequence-${seqIndex}`} className="mb-10 border-b border-[var(--border-color)] pb-8 last:border-0 last:pb-0 animate-fadeIn">
                    <h3 className="text-xs font-bold text-[var(--accent-primary)] uppercase tracking-widest mb-4 px-1 flex items-center gap-2">
                      <i className="fas fa-stream"></i>
                      {isAmbiguous ? `Ambiguous Match in Video: ${sequence.video_id}` : `Sequence ${seqIndex + 1} (Video: ${sequence.video_id})`}
                    </h3>

                    {isClustered ? (
                      (sequence.clusters || []).map((cluster, clusterIdx) => {
                        const sortedShots = [...(cluster.shots || [])].sort((a, b) => {
                          return (a.shot_id_int || 0) - (b.shot_id_int || 0) || (a.frame_id || 0) - (b.frame_id || 0);
                        });
                        if (sortedShots.length === 0) return null;

                        return (
                          <div key={`cluster-${seqIndex}-${clusterIdx}`} className="mb-6 pl-4 border-l-2 border-[var(--accent-secondary)]">
                            <h4 className="text-[10px] text-[var(--text-secondary)] font-semibold uppercase tracking-wider mb-2.5">
                              Cluster from Video: <span className="font-mono">{sortedShots[0].video_id}</span>
                            </h4>
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4.5">
                              {sortedShots.map((shot, shotIdx) => renderResultItem(shot, `shot-${seqIndex}-${clusterIdx}-${shotIdx}`))}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4.5">
                        {(sequence.shots || []).map((shot, shotIdx) => renderResultItem(shot, `shot-${seqIndex}-${shotIdx}`))}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              isClustered ? (
                searchResults.map((cluster, index) => {
                  const sortedShots = [...(cluster.shots || [])].sort((a, b) => {
                    return (a.shot_id_int || 0) - (b.shot_id_int || 0) || (a.frame_id || 0) - (b.frame_id || 0);
                  });
                  if (sortedShots.length === 0) return null;

                  return (
                    <div key={`cluster-main-${index}`} className="mb-8 border-b border-[var(--border-color)] pb-6 last:border-0 last:pb-0 animate-fadeIn">
                      <h3 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3.5 px-1 flex items-center gap-2">
                        <i className="fas fa-video text-[var(--accent-primary)]"></i>
                        Cluster from Video: <span className="text-[var(--text-primary)] font-mono">{sortedShots[0].video_id}</span>
                      </h3>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4.5">
                        {sortedShots.map((shot, shotIdx) => renderResultItem(shot, `shot-cluster-${index}-${shotIdx}`))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4.5">
                  {rankedSingleStageShots.map((shot, idx) => renderResultItem(shot, `item-${shot.frame_name || idx}`))}
                </div>
              )
            )}

            {loadingMore && (
              <div className="flex items-center justify-center text-[var(--accent-primary)] text-xs py-8 gap-2.5 animate-pulse w-full col-span-full">
                <i className="fas fa-circle-notch fa-spin text-lg"></i>
                <span className="font-semibold tracking-wide">Loading more frames...</span>
              </div>
            )}

            {hasMore && !loading && !loadingMore && (
              <div ref={sentinelRef} style={{ height: '20px', marginTop: '20px' }} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
