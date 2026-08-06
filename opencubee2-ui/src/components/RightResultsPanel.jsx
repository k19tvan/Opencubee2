// src/components/RightResultsPanel.jsx
import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { getImageUrl } from '../utils/imageUrl';

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
  isLocked = false,
  dresMode,
  setHoveredFrame,
  onDresSubmit,
  isWrong = false,
  isCorrect = false,
}) => {
  const [loaded, setLoaded] = useState(false);

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
    if (!isHovering) return;
    const handleKeyDown = (e) => {
      if (e.repeat) return;
      if (e.ctrlKey && !e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        onPushToTeam(shot);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHovering, shot, onPushToTeam]);

  const hasSubmissionStatus = isCorrect || isWrong;
  const statusColor = isCorrect ? '#39ff14' : '#ff1744';

  return (
    <div
      draggable={true}
      onDragStart={(e) => onDragStart(e, shot)}
      className={`relative bg-[var(--card-bg)] rounded-lg ${hasSubmissionStatus ? 'border-[5px]' : 'border'} ${isCorrect ? 'ring-[5px] ring-lime-300' : isWrong ? 'ring-[5px] ring-rose-500' : 'border-[var(--border-color)]'} aspect-video cursor-pointer ${hasSubmissionStatus ? '' : 'hover:border-[var(--border-hover)] hover:ring-1 hover:ring-white/20'} shadow-[var(--shadow-heavy)] group`}
      style={hasSubmissionStatus ? {
        borderColor: statusColor,
        boxShadow: `0 0 10px ${statusColor}, 0 0 24px ${statusColor}, 0 0 36px ${statusColor}`,
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
          className="absolute bottom-1.5 right-1.5 w-9 h-9 rounded-lg bg-slate-900/90 border border-white/10 text-white flex items-center justify-center text-xs hover:bg-slate-700 hover:border-transparent cursor-pointer pointer-events-auto shadow-md"
          onClick={(e) => { e.stopPropagation(); onPushToTrake(shot); }}
          title="Pin to Trake"
        >
          <i className="fas fa-thumbtack"></i>
        </button>
        {(dresMode === 'KIS' || dresMode === 'QA') && (
          <button
            className={`absolute top-1.5 right-1.5 w-9 h-9 rounded-lg border flex items-center justify-center text-xs text-white hover:border-transparent cursor-pointer pointer-events-auto ${dresMode === 'KIS'
              ? 'bg-emerald-600/90 border-emerald-400/30 hover:bg-emerald-500'
              : 'bg-blue-600/90 border-blue-400/30 hover:bg-blue-500'
              }`}
            onClick={(e) => { e.stopPropagation(); onDresSubmit?.(shot); }}
            title={`Submit ${dresMode}`}
          >
            <i className={`fas ${dresMode === 'KIS' ? 'fa-paper-plane' : 'fa-comment-dots'}`}></i>
          </button>
        )}
      </div>
      {isLocked && (
        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded bg-emerald-500/90 flex items-center justify-center z-10" title="Video locked">
          <i className="fas fa-lock text-[8px] text-white"></i>
        </div>
      )}
      <div className="absolute top-1.5 left-1.5 flex flex-col gap-1 z-30 pointer-events-none">
        {isWrong && (
          <div className="px-1.5 py-0.5 rounded bg-red-600/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity w-fit pointer-events-auto shadow" title="Wrong Submission">
            <span className="text-[10px] font-bold tracking-wider text-white">WRONG</span>
          </div>
        )}
        {isCorrect && (
          <div className="px-1.5 py-0.5 rounded bg-lime-500/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity w-fit pointer-events-auto shadow" title="Correct Submission">
            <span className="text-[10px] font-bold tracking-wider text-slate-950">CORRECT</span>
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
          ? '#39ff14'
          : isWrong
            ? '#ff1744'
            : (frame.user?.color || 'var(--accent-primary)');
        const hasSubmissionStatus = isCorrect || isWrong;

        return (
          <div
          key={`teamwork-${idx}-${frame.shot?.url}`}
          draggable={true}
          onDragStart={(e) => onDragStart(e, frame.shot)}
          className={`relative flex-shrink-0 w-[180px] aspect-video rounded-lg overflow-hidden ${hasSubmissionStatus ? 'border-[6px]' : 'border-2'} hover:scale-[1.03] hover:-translate-y-0.5 transition-transform duration-300 ease-spring cursor-grab active:cursor-grabbing active:scale-100 will-change-transform animate-scaleIn ${
            isCorrect ? 'ring-[6px] ring-lime-300' : isWrong ? 'ring-[6px] ring-rose-500' : ''
          }`}
          style={{
            borderColor: statusColor,
            boxShadow: hasSubmissionStatus
              ? `0 0 12px ${statusColor}, 0 0 28px ${statusColor}, 0 0 46px ${statusColor}`
              : `0 4px 15px ${statusColor}26`
          }}
          onClick={(e) => onItemClick(e, frame.shot)}
          onContextMenu={(e) => {
            e.preventDefault();
            onContextMenu(frame.shot);
          }}
          onMouseEnter={() => onMouseEnter(frame.shot)}
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
  socket = null,
  username = '',
  userColor = '',
  onTeamworkAddLocal = () => { },
  onTeamworkRemoveLocal = () => { },
  onPushToTrake = () => { },
  correctSubmission = null,
  onZoom = () => { },
  isClustered = false,
  isAmbiguous = false,
  onContext = () => { },
  onQuickSearch = () => { },
  onToggleLock = () => { },
  lockedVideoIds = [],
  dresMode,
  setHoveredFrame,
  setIsHoveringTrakePanel,
  onDresSubmit,
}) {
  const containerRef = useRef(null);
  const sentinelRef = useRef(null);
  const prevFirstResult = useRef(null);
  const hoveredShotRef = useRef(null);
  const hoveredTeamShotRef = useRef(null);
  const pushedShortcutRef = useRef(false);

  const pushToTeam = useCallback((shot) => {
    onTeamworkAddLocal(shot);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: 'new_frame',
          data: { shot, user: { name: username, color: userColor } },
        })
      );
    }
  }, [socket, username, userColor, onTeamworkAddLocal]);

  const removeFromTeam = useCallback((shot) => {
    if (!shot) return;
    onTeamworkRemoveLocal(shot);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: 'remove_frame',
          data: {
            filepath: shot.filepath,
            frame_name: shot.frame_name,
            url: shot.url,
          },
        })
      );
    }
  }, [socket, onTeamworkRemoveLocal]);

  useEffect(() => {
    const handleShortcut = (event) => {
      if (event.ctrlKey && event.code === 'Space' && !event.shiftKey) {
        event.preventDefault();
        if (pushedShortcutRef.current) return;
        pushedShortcutRef.current = true;

        if (hoveredTeamShotRef.current) {
          removeFromTeam(hoveredTeamShotRef.current);
          hoveredTeamShotRef.current = null;
        } else if (hoveredShotRef.current) {
          pushToTeam(hoveredShotRef.current);
        }
      }
    };

    const clearShortcut = (event) => {
      if (event.key === 'Control' || event.code === 'Space') pushedShortcutRef.current = false;
    };

    const clearOnBlur = () => { pushedShortcutRef.current = false; };

    window.addEventListener('keydown', handleShortcut);
    window.addEventListener('keyup', clearShortcut);
    window.addEventListener('blur', clearOnBlur);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
      window.removeEventListener('keyup', clearShortcut);
      window.removeEventListener('blur', clearOnBlur);
    };
  }, [pushToTeam, removeFromTeam]);

  const handleResultMouseEnter = useCallback((shot) => {
    hoveredShotRef.current = shot || null;
    hoveredTeamShotRef.current = null;
  }, []);

  const handleResultMouseLeave = useCallback((shot) => {
    if (hoveredShotRef.current === shot) hoveredShotRef.current = null;
  }, []);

  const handleTeamMouseEnter = useCallback((shot) => {
    hoveredTeamShotRef.current = shot || null;
    hoveredShotRef.current = null;
    setHoveredFrame?.(shot);
  }, [setHoveredFrame]);

  const handleTeamMouseLeave = useCallback((shot) => {
    if (hoveredTeamShotRef.current === shot) hoveredTeamShotRef.current = null;
    setHoveredFrame?.(null);
  }, [setHoveredFrame]);

  const pushToTrake = useCallback((shot) => {
    onPushToTrake(shot);
  }, [onPushToTrake]);

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
    if (e.altKey) {
      e.preventDefault();
      onToggleLock(shot);
      return;
    }
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (isCtrlOrCmd && e.shiftKey) {
      e.preventDefault();
      onQuickSearch(shot);
    } else if (isCtrlOrCmd) {
      e.preventDefault();
      onContext(shot);
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
        isLocked={lockedVideoIds.includes(shot.video_id)}
        dresMode={dresMode}
        setHoveredFrame={setHoveredFrame}
        onDresSubmit={onDresSubmit}
        isWrong={isWrong}
        isCorrect={isCorrect}
      />
    );
  }, [handleDragStart, handleItemClick, handleOpenPreview, handleResultMouseEnter, handleResultMouseLeave, pushToTeam, pushToTrake, lockedVideoIds, dresMode, setHoveredFrame, onDresSubmit, wrongFrames, correctSubmission]);

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
      <div id="teamworkPanelContainer" className="pt-4 border-b border-[var(--border-color)] sticky top-0 bg-[var(--bg-primary)] z-[49] transition-colors duration-300 shadow-sm">
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

      {showTrake && (
        <div id="trakePanelContainer" className="pt-4 border-b border-[var(--border-color)] sticky top-0 bg-[var(--bg-primary)] z-[48] transition-colors duration-300 shadow-sm">
          <div
            className="flex-shrink-0"
            onMouseEnter={() => setIsHoveringTrakePanel?.(true)}
            onMouseLeave={() => setIsHoveringTrakePanel?.(false)}
          >
            <h3 className="text-xs font-bold text-rose-500 uppercase tracking-widest flex items-center gap-2 px-6 mb-3">
              <i className="fas fa-thumbtack"></i> Trake Panel
              <span className="text-[10px] bg-rose-500/20 text-rose-500 px-1.5 py-0.5 rounded-full font-mono ml-1">
                {trakeFrames.length}
              </span>
              {dresMode === 'Trake' && (
                <span className="text-[10px] bg-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded-full font-mono font-bold animate-pulse ml-2">
                  READY TO SUBMIT (Ctrl+Shift+Space)
                </span>
              )}
            </h3>
          </div>
          <div id="trakeGrid" className="flex flex-nowrap overflow-x-auto gap-4 px-6 pb-4 select-none min-h-[110px]">
            {trakeFrames.length === 0 ? (
              <p className="text-[var(--text-secondary)] text-xs italic py-2">Drag or pin frames here to compare...</p>
            ) : (
              trakeFrames.map((shot, idx) => (
                <div
                  key={`trake-${idx}-${shot?.url}`}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, shot)}
                  className="relative flex-shrink-0 w-[180px] aspect-video rounded-lg overflow-hidden border border-[var(--border-color)] hover:border-[var(--border-hover)] hover:scale-[1.03] hover:-translate-y-0.5 transition-all duration-300 ease-spring cursor-grab active:cursor-grabbing active:scale-100 will-change-transform animate-scaleIn"
                  onClick={(e) => handleItemClick(e, shot)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    handleOpenPreview(shot);
                  }}
                >
                  <img
                    src={getImageUrl(shot.url || shot.frame_name || shot.filepath)}
                    alt="Trake frame"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWUxZTFlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMCIgZmlsbD0iIzY2NiIgZG1pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JbWFnZSBOb3QgRm91bmQ8L3RleHQ+PC9zdmc+';
                    }}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              ))
            )}
          </div>
        </div>
      )}

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
                    {chunk.summary || "No summary text available."}
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
                      No keyframe files found in frame range [{chunk.start_id} - {chunk.end_id}].
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
