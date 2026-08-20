import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { getImageUrl } from '../utils/imageUrl';
import { getSimilarFrames, getVideoThumbnailUrl } from '../api';
import QASubmitModal from './modals/QASubmitModal';

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
                <div className="absolute bottom-1.5 left-1.5 bg-black/70 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white shadow-sm">
                  {shot.video_id}
                </div>
                <div className="absolute bottom-1.5 right-1.5 bg-black/70 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white shadow-sm">
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
  setHoveredFrame,
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
          className="absolute bottom-1.5 left-1.5 w-9 h-9 rounded-lg bg-slate-900/90 border border-white/10 text-white flex items-center justify-center text-xs hover:bg-slate-700 hover:border-transparent cursor-pointer pointer-events-auto shadow-md"
          onClick={(e) => { e.stopPropagation(); onPushToTeam(shot); }}
          title="Send to Team"
        >
          <i className="fas fa-users"></i>
        </button>
        <button
          className="absolute bottom-1.5 right-1.5 w-9 h-9 rounded-lg bg-[#10b981] border border-[#10b981] text-white flex items-center justify-center text-xs hover:brightness-110 hover:border-transparent cursor-pointer pointer-events-auto transition-all shadow-[0_0_10px_rgba(16,185,129,0.4)] hover:scale-110"
          onClick={(e) => { e.stopPropagation(); onPushToTrake(shot); }}
          title="Stage for Submission"
        >
          <i className="fas fa-paper-plane"></i>
        </button>

      </div>
      {isLocked && (
        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded bg-emerald-500/90 flex items-center justify-center z-10" title="Video locked">
          <i className="fas fa-lock text-[8px] text-white"></i>
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

// Component cho Teamwork Panel
const TeamworkPanel = React.memo(({ teamworkFrames, wrongFrames, correctSubmission, onDragStart, onItemClick, onContextMenu, onMouseEnter, onMouseLeave }) => {
  if (teamworkFrames.length === 0) {
    return <p className="text-[var(--text-secondary)] text-xs italic px-6 py-4">No frames shared by the team yet...</p>;
  }

  return (
    <div className="flex flex-nowrap overflow-x-auto gap-4 px-6 pb-4 select-none">
      {teamworkFrames.map((frame, idx) => {
        const isCorrect = isSameShot(frame.shot, correctSubmission);
        const isWrong = !isCorrect && wrongFrames.some((shot) => isSameShot(frame.shot, shot));
        const statusColor = isCorrect
          ? '#ccff00'
          : isWrong
            ? '#ff1744'
            : (frame.user?.color || 'var(--accent-primary)');
        const hasSubmissionStatus = isCorrect || isWrong;

        return (
          <div
          key={`teamwork-${frame.shot?.filepath || frame.shot?.frame_name || frame.shot?.url || idx}`}
          draggable={true}
          onDragStart={(e) => onDragStart(e, frame.shot)}
          className={`relative flex-shrink-0 w-[180px] aspect-video rounded-lg overflow-hidden border-0 hover:scale-[1.03] hover:-translate-y-0.5 transition-transform duration-300 ease-spring cursor-grab active:cursor-grabbing active:scale-100 will-change-transform animate-scaleIn ${
            hasSubmissionStatus ? 'z-20' : '!border-2 !border-[var(--border-color)]'
          }`}
          style={{
            boxShadow: hasSubmissionStatus
              ? `0 0 15px 3px ${statusColor}, 0 0 30px 8px ${statusColor}, 0 0 60px 15px ${statusColor}, inset 0 0 25px 5px ${statusColor}`
              : `0 4px 15px ${statusColor}26`
          }}
          onClick={(e) => onItemClick(e, frame.shot)}
          onContextMenu={(e) => {
            e.preventDefault();
            onContextMenu(frame.shot);
          }}
          onMouseEnter={() => onMouseEnter(frame.shot, false)}
          onMouseMove={(event) => onMouseEnter(
            frame.shot,
            event.movementX !== 0 || event.movementY !== 0,
          )}
          onMouseLeave={() => onMouseLeave(frame.shot)}
        >
          <img
            src={getImageUrl(frame.shot?.url || frame.shot?.frame_name || frame.shot?.filepath)}
            alt="Frame"
            className="w-full h-full object-cover animate-fadeIn"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWUxZTFlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMCIgZmlsbD0iIzY2NiIgZG1pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JbWFnZSBOb3QgRm91bmQ8L3RleHQ+PC9zdmc+';
            }}
            loading="lazy"
            decoding="async"
          />
          <div
            className="absolute bottom-1 left-1.5 bg-slate-900/90 text-white px-2 py-0.5 rounded text-[9px] font-bold border-l-2"
            style={{ borderLeftColor: statusColor }}
          >
            {frame.user?.name}
          </div>
        </div>
        );
      })}
    </div>
  );
});

export default function RightResultsPanel({
  searchResults = [],
  teamworkFrames = [],
  trakeFrames = [],
  wrongFrames = [],
  showTrake = false,
  loading = false,
  loadingMore = false,
  hasMore = false,
  onLoadMore = () => { },
  onPreview = () => { },
  sendRealtimeMessage = () => false,
  username = '',
  userColor = '',
  onPushToTrake = () => { },
  onReorderTrake = () => { },
  onRemoveFromTrake = () => { },
  onPreviewTrakeFrame = () => { },
  correctSubmission = null,
  onZoom = () => { },
  isClustered = false,
  isAmbiguous = false,
  onContext = () => { },
  onQuickSearch = () => { },
  onToggleLock = () => { },
  lockedVideoIds = [],
  setHoveredFrame,
  setIsHoveringTrakePanel,
  soloAIQueries = [],
  activeSoloQueryIndex = 0,
  setActiveSoloQueryIndex = () => { },
  onSoloAISubmit = () => { },
  onDeleteSoloAISubmit = () => { },
  editTrakeRowIndex = null,
  onEditTrakeRow,
  onCancelEditTrakeRow,
  onDeleteTrakeRow,
  onReloadSoloAICsv,
  queryCommits = {},
  onCreateCommit,
  onSelectCommit,
  onPrevCommit,
  onNextCommit,
  onDeleteCommit,
  isViewingCommit = false,
  onPushCommitToDraft,
}) {
  const containerRef = useRef(null);
  const sentinelRef = useRef(null);
  const prevFirstResult = useRef(null);
  const trakeDragIndexRef = useRef(null);
  const [overFolder, setOverFolder] = useState(false);
  const trakeFramesRef = useRef(trakeFrames);
  const hoveredTrakeShotRef = useRef(null);
  const hoveredTrakeIndexRef = useRef(null);
  const hoveredTeamShotRef = useRef(null);
  const suppressTeamRemovalRef = useRef(false);
  const hoveredShotRef = useRef(null);
  
  const [isTrakeDropdownOpen, setIsTrakeDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsTrakeDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  trakeFramesRef.current = trakeFrames;

  const pushToTeam = useCallback((shot) => {
    if (!shot) return;
    sendRealtimeMessage({
      type: 'new_frame',
      data: { shot, user: { name: username, color: userColor } },
    });
  }, [sendRealtimeMessage, username, userColor]);

  const removeFromTeam = useCallback((shot) => {
    if (!shot) return;
    const frameKey = shot.filepath || shot.frame_name || shot.url;
    if (!frameKey) return;

    suppressTeamRemovalRef.current = true;
    hoveredTeamShotRef.current = null;
    setHoveredFrame?.(null);
    sendRealtimeMessage({
      type: 'remove_frame',
      data: {
        filepath: shot.filepath,
        frame_name: shot.frame_name,
        url: shot.url,
      },
    });
  }, [sendRealtimeMessage, setHoveredFrame]);

  const pushToTrake = useCallback((shot) => {
    onPushToTrake(shot);
  }, [onPushToTrake]);

  const removeFromTrake = useCallback((shot) => {
    const currentFrames = trakeFramesRef.current;
    const frameKey = shot?.filepath || shot?.frame_name || shot?.url || (shot?.video_id && shot?.frame_id ? `${shot.video_id}_${shot.frame_id}` : '');
    const index = currentFrames.findIndex((frame) => {
      const fKey = frame?.filepath || frame?.frame_name || frame?.url || (frame?.video_id && frame?.frame_id ? `${frame.video_id}_${frame.frame_id}` : '');
      return fKey === frameKey;
    });
    const nextFrame = index >= 0 ? currentFrames[index + 1] : null;
    hoveredTrakeIndexRef.current = nextFrame ? index : null;
    hoveredTrakeShotRef.current = nextFrame || null;
    trakeFramesRef.current = index >= 0
      ? currentFrames.filter((_, frameIndex) => frameIndex !== index)
      : currentFrames;
    onRemoveFromTrake(shot);
  }, [onRemoveFromTrake]);

  useEffect(() => {
    const handleShortcut = (event) => {
      if (event.repeat) return;
      if (document.querySelector('[data-shortcut-scope="modal"]')) return;
      const hoveredTrakeShot = hoveredTrakeIndexRef.current != null
        ? trakeFramesRef.current[hoveredTrakeIndexRef.current]
        : hoveredTrakeShotRef.current;

      const hoveredTeamShot = hoveredTeamShotRef.current;

      if (event.ctrlKey && event.code === 'Space' && !event.shiftKey) {
        event.preventDefault();

        if (hoveredTrakeShot) {
          removeFromTrake?.(hoveredTrakeShot);
        } else if (hoveredTeamShot && !suppressTeamRemovalRef.current) {
          removeFromTeam(hoveredTeamShot);
        } else if (hoveredShotRef.current) {
          pushToTeam(hoveredShotRef.current);
        }
      } else if (event.ctrlKey && event.shiftKey && event.code === 'Space') {
        event.preventDefault();
        if (hoveredTrakeShot) {
          removeFromTrake?.(hoveredTrakeShot);
        } else if (hoveredShotRef.current && !hoveredTeamShot) {
          pushToTrake(hoveredShotRef.current);
        } else if (hoveredTeamShot) {
          pushToTrake(hoveredTeamShot);
        }
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
    };
  }, [pushToTeam, removeFromTeam, pushToTrake, removeFromTrake, soloAIQueries, activeSoloQueryIndex, onSoloAISubmit]);

  useEffect(() => {
    const hovered = hoveredTrakeShotRef.current;
    if (hoveredTrakeIndexRef.current != null && hoveredTrakeIndexRef.current >= trakeFrames.length) {
      hoveredTrakeIndexRef.current = null;
    }
    if (!hovered) return;
    const hoveredKey = hovered.filepath || hovered.frame_name || hovered.url;
    const stillInTrake = trakeFrames.some((shot) => (
      (shot.filepath || shot.frame_name || shot.url) === hoveredKey
    ));
    if (!stillInTrake) hoveredTrakeShotRef.current = null;
  }, [trakeFrames]);

  const handleResultMouseEnter = useCallback((shot) => {
    hoveredShotRef.current = shot || null;
    hoveredTeamShotRef.current = null;
    hoveredTrakeShotRef.current = null;
    hoveredTrakeIndexRef.current = null;
  }, []);

  const handleResultMouseLeave = useCallback((shot) => {
    if (hoveredShotRef.current === shot) hoveredShotRef.current = null;
  }, []);

  const handleTeamMouseEnter = useCallback((shot, pointerMoved = false) => {
    if (suppressTeamRemovalRef.current && !pointerMoved) return;
    if (pointerMoved) suppressTeamRemovalRef.current = false;
    hoveredTeamShotRef.current = shot || null;
    hoveredShotRef.current = null;
    hoveredTrakeShotRef.current = null;
    hoveredTrakeIndexRef.current = null;
    setHoveredFrame?.(shot);
  }, [setHoveredFrame]);

  const handleTeamMouseLeave = useCallback((shot) => {
    if (hoveredTeamShotRef.current === shot) hoveredTeamShotRef.current = null;
    setHoveredFrame?.(null);
  }, [setHoveredFrame]);

  const handleDragStart = useCallback((e, shot) => {
    if (!shot) return;
    const fullUrl = getImageUrl(shot.url || shot.frame_name || shot.filepath);
    const enrichedShot = { ...shot, url: fullUrl };
    e.dataTransfer.setData('application/json', JSON.stringify(enrichedShot));
    e.dataTransfer.setData('text/uri-list', fullUrl);
    e.dataTransfer.setData('text/plain', shot.frame_name || fullUrl);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleTrakeDragStart = useCallback((event, shot, index) => {
    trakeDragIndexRef.current = index;
    handleDragStart(event, shot);
    event.dataTransfer.effectAllowed = 'move';
  }, [handleDragStart]);

  const handleTrakeDrop = useCallback((event, targetIndex) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceIndex = trakeDragIndexRef.current;
    trakeDragIndexRef.current = null;
    if (sourceIndex == null || sourceIndex === targetIndex) return;

    const reorderedFrames = [...trakeFrames];
    const [movedFrame] = reorderedFrames.splice(sourceIndex, 1);
    if (!movedFrame) return;
    reorderedFrames.splice(targetIndex, 0, movedFrame);
    onReorderTrake(reorderedFrames);
  }, [trakeFrames, onReorderTrake]);

  const handleTrakePanelDrop = useCallback((event) => {
    event.preventDefault();
    if (trakeDragIndexRef.current != null) return;

    try {
      const serializedShot = event.dataTransfer.getData('application/json');
      const shot = serializedShot ? JSON.parse(serializedShot) : null;
      if (shot) pushToTrake(shot);
    } catch {
    }
  }, [pushToTrake]);

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
    const isCorrect = isSameShot(shot, correctSubmission);
    const isWrong = !isCorrect && wrongFrames.some((wrongShot) => isSameShot(shot, wrongShot));
    return (
      <ResultItem
        key={key}
        shot={shot}
        onDragStart={handleDragStart}
        onClick={handleItemClick}
        onContextMenu={handleOpenPreview}
        onMouseEnter={handleResultMouseEnter}
        onMouseLeave={handleResultMouseLeave}
        onPushToTeam={pushToTeam}
        onPushToTrake={pushToTrake}
        onZoom={onZoom}
        onPreview={onPreview}
        onContext={onContext}
        isLocked={lockedVideoIds.includes(shot.video_id)}
        setHoveredFrame={setHoveredFrame}
        isWrong={isWrong}
        isCorrect={isCorrect}
      />
    );
  }, [handleDragStart, handleItemClick, handleOpenPreview, handleResultMouseEnter, handleResultMouseLeave, pushToTeam, pushToTrake, lockedVideoIds, setHoveredFrame, wrongFrames, correctSubmission]);

  useEffect(() => {
    const firstResult = searchResults.length > 0 ? searchResults[0] : null;
    if (firstResult && firstResult !== prevFirstResult.current) {
      if (containerRef.current) containerRef.current.scrollTop = 0;
    }
    prevFirstResult.current = firstResult;
  }, [searchResults]);

  useEffect(() => {
    const hovered = hoveredTeamShotRef.current;
    if (!hovered) return;

    const stillExists = teamworkFrames.some((frame) => {
      const shot = frame.shot || {};
      return (
        (hovered.filepath && shot.filepath === hovered.filepath) ||
        (hovered.frame_name && shot.frame_name === hovered.frame_name) ||
        (hovered.url && shot.url === hovered.url)
      );
    });

    if (!stillExists) hoveredTeamShotRef.current = null;
  }, [teamworkFrames]);

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
      <div className="sticky top-0 z-[49] bg-[var(--bg-primary)] flex flex-col transition-colors duration-300 pointer-events-auto border-b border-[var(--border-color)] shadow-md">
        {!showTrake && (
          <div id="teamworkPanelContainer" className="pt-4 border-b border-[var(--border-color)] pb-2">
            <h3 className="text-xs font-bold text-[var(--accent-primary)] uppercase tracking-widest flex items-center gap-2 px-6 mb-3">
              <i className="fas fa-users"></i> Teamwork Submission Panel
            </h3>
            <TeamworkPanel
              teamworkFrames={teamworkFrames}
              wrongFrames={wrongFrames}
              correctSubmission={correctSubmission}
              onDragStart={handleDragStart}
              onItemClick={handleItemClick}
              onContextMenu={handleOpenPreview}
              onMouseEnter={handleTeamMouseEnter}
              onMouseLeave={handleTeamMouseLeave}
            />
          </div>
        )}

        {showTrake && (
          <div
            id="trakePanelContainer"
            className="pt-4 pb-2"
            onMouseEnter={() => setIsHoveringTrakePanel?.(true)}
          onMouseLeave={() => {
            hoveredTrakeShotRef.current = null;
            hoveredTrakeIndexRef.current = null;
            setIsHoveringTrakePanel?.(false);
          }}
        >
          <div className="flex-shrink-0 px-6 mb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                  {isViewingCommit ? (
                    <span className="flex items-center gap-1.5 text-amber-400">
                      <i className="fas fa-lock text-xs"></i> COMMIT VIEW (READ-ONLY)
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-emerald-400">
                      <i className="fas fa-users text-xs"></i> TEAM DRAFT PANEL
                    </span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ml-1 ${
                    isViewingCommit ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                  }`}>
                    {trakeFrames.length} Frames
                  </span>
                  {!isViewingCommit && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[9px] font-semibold border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      Live Teamwork
                    </span>
                  )}
                </h3>

                {soloAIQueries[activeSoloQueryIndex]?.filename?.toLowerCase().includes('trake') && soloAIQueries[activeSoloQueryIndex]?.submissions?.length > 0 && (
                  <div className="flex items-center gap-1.5 ml-2 border-l border-white/10 pl-3">
                    <div className="relative" ref={dropdownRef}>
                      <button
                        type="button"
                        disabled={isViewingCommit}
                        onClick={() => !isViewingCommit && setIsTrakeDropdownOpen(!isTrakeDropdownOpen)}
                        className={`flex items-center justify-between min-w-[120px] bg-[#1e1e1e] border border-white/10 rounded px-3 py-1 text-xs text-white outline-none focus:border-emerald-500 h-6 transition-colors ${
                          isViewingCommit ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-white/5'
                        }`}
                      >
                        <span className="truncate mr-2 font-mono">
                          {editTrakeRowIndex !== null ? `Row ${editTrakeRowIndex + 1}` : "+ Append New"}
                        </span>
                        <i className={`fas fa-chevron-down text-[10px] transition-transform ${isTrakeDropdownOpen ? 'rotate-180' : ''}`}></i>
                      </button>
                      
                      {isTrakeDropdownOpen && !isViewingCommit && (
                        <div className="absolute top-full left-0 mt-1 min-w-[120px] bg-[#2a2a2a] border border-white/10 rounded-md shadow-xl z-50 overflow-hidden text-xs">
                          {soloAIQueries[activeSoloQueryIndex].submissions.map((_, rIdx) => (
                            <button
                              key={`trake-row-${rIdx}`}
                              className={`w-full text-left px-3 py-1.5 font-mono transition-colors hover:bg-emerald-500 hover:text-white ${editTrakeRowIndex === rIdx ? 'bg-emerald-500/20 text-emerald-300' : 'text-white'}`}
                              onClick={() => {
                                onEditTrakeRow && onEditTrakeRow(rIdx);
                                setIsTrakeDropdownOpen(false);
                              }}
                            >
                              Row {rIdx + 1}
                            </button>
                          ))}
                          <div className="border-t border-white/10 my-0.5"></div>
                          <button
                            className={`w-full text-left px-3 py-1.5 font-mono transition-colors hover:bg-emerald-500 hover:text-white ${editTrakeRowIndex === null ? 'bg-emerald-500/20 text-emerald-300' : 'text-white/70'}`}
                            onClick={() => {
                              onCancelEditTrakeRow && onCancelEditTrakeRow();
                              setIsTrakeDropdownOpen(false);
                            }}
                          >
                            + Append New
                          </button>
                        </div>
                      )}
                    </div>
                    {editTrakeRowIndex !== null && !isViewingCommit && (
                      <button 
                        onClick={() => {
                           onDeleteTrakeRow && onDeleteTrakeRow(editTrakeRowIndex);
                        }}
                        className="text-[10px] text-white/40 hover:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 px-2 flex items-center justify-center h-6 w-6 rounded transition-colors"
                        title="Delete this row"
                      >
                        <i className="fas fa-trash"></i>
                      </button>
                    )}
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onCreateCommit && typeof onCreateCommit === 'function') {
                      onCreateCommit(trakeFramesRef.current);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1 bg-purple-600/20 text-purple-300 border border-purple-500/40 rounded text-[11px] font-bold uppercase tracking-wider hover:bg-purple-600 hover:text-white transition-all cursor-pointer shadow-[0_0_8px_rgba(147,51,234,0.15)]"
                  title="Create a local commit snapshot (without saving to CSV yet)"
                >
                  <i className="fas fa-bookmark mr-0.5"></i> Commit
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onSoloAISubmit && typeof onSoloAISubmit === 'function') {
                      onSoloAISubmit(trakeFramesRef.current);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1 bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/30 rounded text-[11px] font-bold uppercase tracking-wider hover:bg-[#10b981] hover:text-white transition-all shadow-[0_0_8px_rgba(16,185,129,0.15)] cursor-pointer"
                  title="Commit & Save to backend CSV file"
                >
                  <i className="fas fa-save mr-0.5"></i> Save CSV
                </button>
              </div>
            </div>
            
            <div className="flex gap-2 items-center flex-wrap mt-2">
              <span className="text-[10px] text-zinc-500 italic lowercase tracking-wider">
                /SoLoaiAIC/{soloAIQueries[activeSoloQueryIndex]?.filename?.replace('.txt', '.csv')}
              </span>
              
              {(() => {
                const activeQueryFilename = soloAIQueries[activeSoloQueryIndex]?.filename;
                const activeQueryCommitState = queryCommits[activeQueryFilename] || { commits: [], activeCommitIndex: null };
                const currentCommits = activeQueryCommitState.commits || [];
                const activeCommitIndex = activeQueryCommitState.activeCommitIndex;

                return (
                  <div className="flex items-center gap-1.5 bg-[#181825] border border-emerald-500/30 rounded px-2 py-0.5 text-xs text-white">
                    <span className="text-[10px] uppercase font-bold text-emerald-400">Commits ({currentCommits.length}):</span>
                    <button
                      type="button"
                      disabled={activeCommitIndex === null || activeCommitIndex <= 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPrevCommit && onPrevCommit();
                      }}
                      className="px-1.5 py-0.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-[10px] cursor-pointer"
                      title="Previous Commit"
                    >
                      <i className="fas fa-chevron-left"></i>
                    </button>
                    <select
                      value={typeof activeCommitIndex === 'number' && activeCommitIndex >= 0 ? activeCommitIndex : -1}
                      onChange={(e) => {
                        e.stopPropagation();
                        onSelectCommit && onSelectCommit(activeQueryFilename, Number(e.target.value));
                      }}
                      className="bg-[#11111b] border border-emerald-500/40 rounded px-2 py-0.5 text-[11px] text-emerald-300 font-mono outline-none cursor-pointer"
                    >
                      <option value={-1}>* Draft (Live Collaborative) *</option>
                      {currentCommits.map((c, i) => (
                        <option key={c.id || i} value={i}>
                          Commit #{i + 1} ({c.timestamp}) [{c.frames?.length || 0} frames]
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={activeCommitIndex === null || activeCommitIndex >= currentCommits.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        onNextCommit && onNextCommit();
                      }}
                      className="px-1.5 py-0.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-[10px] cursor-pointer"
                      title="Next Commit"
                    >
                      <i className="fas fa-chevron-right"></i>
                    </button>
                    {typeof activeCommitIndex === 'number' && activeCommitIndex >= 0 && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPushCommitToDraft && onPushCommitToDraft();
                          }}
                          className="px-2.5 py-0.5 bg-amber-500 hover:bg-amber-400 text-black font-extrabold rounded text-[10px] uppercase cursor-pointer transition-all flex items-center gap-1 shadow-[0_0_8px_rgba(245,158,11,0.3)]"
                          title="Copy this commit's frames into Draft (editable)"
                        >
                          <i className="fas fa-file-export"></i> Push to Draft
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onDeleteCommit && typeof onDeleteCommit === 'function') {
                              onDeleteCommit(activeQueryFilename, activeCommitIndex);
                            }
                          }}
                          className="px-1.5 py-0.5 bg-rose-500/20 hover:bg-rose-500 text-rose-400 hover:text-white rounded text-[10px] cursor-pointer transition-colors"
                          title={`Delete Commit #${activeCommitIndex + 1}`}
                        >
                          <i className="fas fa-trash-alt"></i>
                        </button>
                      </>
                    )}
                  </div>
                );
              })()}
              
              {isViewingCommit && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const activeQueryFilename = soloAIQueries[activeSoloQueryIndex]?.filename;
                    onSelectCommit && onSelectCommit(activeQueryFilename, -1);
                  }}
                  className="flex items-center justify-center px-3 py-1 cursor-pointer text-emerald-300 bg-emerald-600/25 hover:bg-emerald-500 hover:text-white rounded transition-all border border-emerald-500/40 font-bold uppercase tracking-wider text-[11px]"
                  title="Return to the live collaborative Draft"
                >
                  <i className="fas fa-arrow-left text-[10px] mr-1.5"></i> Back to Draft
                </button>
              )}
            </div>
            
            {soloAIQueries[activeSoloQueryIndex]?.content && (
              <div className="text-[11px] leading-relaxed text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md p-3 mt-3 break-words whitespace-pre-wrap">
                {soloAIQueries[activeSoloQueryIndex].content}
              </div>
            )}
          </div>
          <div
            id="trakeGrid"
            className="flex flex-nowrap overflow-x-auto gap-4 px-6 pb-4 select-none min-h-[110px]"
            onDragOver={(event) => !isViewingCommit && event.preventDefault()}
            onDrop={!isViewingCommit ? handleTrakePanelDrop : undefined}
          >
            {(() => {
              if (trakeFrames.length === 0) {
                return <p className="text-[var(--text-secondary)] text-xs italic py-2">Drag or pin frames here to build your submission...</p>;
              }
              
              const renderStaged = () => trakeFrames.map((shot, idx) => (
                <div
                  key={`staged-${shot?.filepath || shot?.frame_name || shot?.url || idx}`}
                  draggable={!isViewingCommit}
                  onDragStart={(e) => !isViewingCommit && handleTrakeDragStart(e, shot, idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => !isViewingCommit && handleTrakeDrop(e, idx)}
                  onDragEnd={() => { trakeDragIndexRef.current = null; }}
                  className={`relative flex-shrink-0 w-[180px] aspect-video rounded-lg overflow-hidden border transition-all duration-300 ease-spring will-change-transform animate-scaleIn ${
                    isViewingCommit ? 'border-amber-500/40 opacity-95' : 'border-[var(--border-color)] hover:border-[var(--border-hover)] hover:scale-[1.03] hover:-translate-y-0.5 cursor-grab active:cursor-grabbing active:scale-100'
                  }`}
                  onClick={(e) => handleItemClick(e, shot)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    handleOpenPreview(shot);
                  }}
                  onMouseEnter={() => {
                    hoveredTrakeShotRef.current = shot;
                    hoveredTrakeIndexRef.current = idx;
                    setIsHoveringTrakePanel?.(true);
                  }}
                  onMouseMove={() => {
                    hoveredTrakeShotRef.current = shot;
                    hoveredTrakeIndexRef.current = idx;
                  }}
                  onMouseLeave={() => {
                    if (hoveredTrakeShotRef.current === shot) hoveredTrakeShotRef.current = null;
                  }}
                >
                  <img
                    src={getImageUrl(shot.url || shot.frame_name || shot.filepath || getVideoThumbnailUrl(shot.video_id, shot.frame_id))}
                    alt={`Frame ${shot.frame_id || idx}`}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.target.onerror = null; e.target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWUxZTFlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMCIgZmlsbD0iIzY2NiIgZG1pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JbWFnZSBOb3QgRm91bmQ8L3RleHQ+PC9zdmc+'; }}
                  />
                  {soloAIQueries[activeSoloQueryIndex]?.filename?.toLowerCase().includes('trake') && (
                    <div className="absolute top-1 left-1.5 z-10 px-1.5 py-0.5 rounded bg-emerald-700/90 text-emerald-100 text-[10px] font-bold shadow-md">
                      E{idx + 1}
                    </div>
                  )}
                  {shot.user?.name && (
                    <div
                      className="absolute bottom-1 left-1 z-10 bg-slate-900/90 text-white px-1.5 py-0.5 rounded text-[8px] font-bold border-l-2 max-w-[80px] truncate shadow-sm pointer-events-none"
                      style={{ borderLeftColor: shot.user.color || 'var(--accent-primary)' }}
                      title={`Added by ${shot.user.name}`}
                    >
                      {shot.user.name}
                    </div>
                  )}
                  {shot.qaAnswer && (
                    <div className="absolute bottom-1 left-1 z-10 px-1.5 py-0.5 rounded bg-emerald-500/90 text-white text-[10px] font-bold shadow-sm w-fit max-w-[85%] truncate" title={shot.qaAnswer}>
                      {shot.qaAnswer}
                    </div>
                  )}
                  {!isViewingCommit && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromTrake(shot);
                      }}
                      className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-[10px] text-white/70 hover:bg-rose-500 hover:text-white"
                      title="Remove from staging"
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  )}
                  {shot.similarityScore !== undefined && shot.similarityScore !== null && (
                     <div className="absolute bottom-1 right-1 px-1 py-0.5 rounded text-[8px] bg-black/50 text-white font-mono pointer-events-none">
                        {(shot.similarityScore).toFixed(2)}
                     </div>
                  )}
                  {soloAIQueries[activeSoloQueryIndex]?.filename?.toLowerCase().includes('trake') && (
                    <button
                      type="button"
                      draggable={false}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onPreviewTrakeFrame(shot);
                      }}
                      className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded bg-slate-900/80 text-[10px] text-white shadow-sm border border-white/20 transition-all hover:scale-110 hover:border-transparent hover:bg-rose-500 cursor-pointer"
                      title="Preview frames around this point"
                    >
                      <i className="fas fa-film"></i>
                    </button>
                  )}
                </div>
              ));

              return (
                <React.Fragment>
                  {renderStaged()}
                </React.Fragment>
              );
            })()}
          </div>
        </div>
        )}
      </div>

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
