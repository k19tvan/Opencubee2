// src/components/modals/FrameContextModal.jsx
import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { getImageUrl } from '../../utils/imageUrl'; // Import URL builder helper
import { BASE_URL } from '../../api';

function buildTimelineSlots(frames, words) {
  if (frames.length === 0) return [];

  const slots = frames.map((shot) => ({ shot, words: [] }));
  let slotIndex = 0;
  for (const word of words) {
    while (
      slotIndex < frames.length - 1
      && word.start_frame_id >= frames[slotIndex + 1].frame_id
    ) {
      slotIndex += 1;
    }
    slots[slotIndex].words.push(word);
  }

  return slots.map((slot) => {
    const characterCount = slot.words.reduce(
      (total, word) => total + word.word.trim().length + 1,
      0,
    );
    const extraWidth = Math.min(500, slot.words.length * 7 + characterCount * 1.4);
    return { ...slot, width: Math.round(230 + extraWidth) };
  });
}

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

export default function FrameContextModal({ shotData, onClose, onZoom, onPreview, sendRealtimeMessage, username, userColor, onContext, onQuickSearch, wrongFrames = [], correctSubmission = null }) {
  const [neighbors, setNeighbors] = useState([]);
  const [contextMode, setContextMode] = useState('all');
  const [timelineWords, setTimelineWords] = useState([]);
  const [timelineFps, setTimelineFps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hoveredShot, setHoveredShot] = useState(null);
  const isVideoTimeline = shotData.contextView === 'video-timeline';
  const railRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startScrollLeft: 0, moved: false });
  const suppressClickRef = useRef(false);
  const timelineSlots = useMemo(
    () => isVideoTimeline ? buildTimelineSlots(neighbors, timelineWords) : [],
    [isVideoTimeline, neighbors, timelineWords],
  );

  useEffect(() => {
    if (!isVideoTimeline) return undefined;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehaviorX;
    const previousBodyOverscroll = document.body.style.overscrollBehaviorX;
    document.documentElement.style.overscrollBehaviorX = 'none';
    document.body.style.overscrollBehaviorX = 'none';
    return () => {
      document.documentElement.style.overscrollBehaviorX = previousHtmlOverscroll;
      document.body.style.overscrollBehaviorX = previousBodyOverscroll;
    };
  }, [isVideoTimeline]);

  useEffect(() => {
    if (!isVideoTimeline) return undefined;
    const rail = railRef.current;
    if (!rail) return undefined;

    const handleWheel = (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const maxScrollLeft = rail.scrollWidth - rail.clientWidth;
      if (maxScrollLeft <= 0) return;
      event.preventDefault();
      rail.scrollLeft += event.deltaY;
    };

    rail.addEventListener('wheel', handleWheel, { passive: false });
    return () => rail.removeEventListener('wheel', handleWheel);
  }, [isVideoTimeline, loading, neighbors.length]);

  useEffect(() => {
    if (!isVideoTimeline || loading || neighbors.length === 0) return;
    const centerFrame = railRef.current?.querySelector('[data-center-frame="true"]');
    centerFrame?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
  }, [isVideoTimeline, loading, neighbors]);

  const handleRailPointerDown = useCallback((event) => {
    if (
      event.button !== 0
      || event.ctrlKey
      || event.metaKey
      || event.target.closest?.('button')
    ) return;
    const rail = railRef.current;
    if (!rail) return;
    dragRef.current = {
      active: true,
      startX: event.clientX,
      startScrollLeft: rail.scrollLeft,
      moved: false,
    };
    suppressClickRef.current = false;
  }, []);

  const handleRailPointerMove = useCallback((event) => {
    const rail = railRef.current;
    const drag = dragRef.current;
    if (!rail || !drag.active) return;
    const deltaX = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(deltaX) > 10) {
      drag.moved = true;
      suppressClickRef.current = true;
      rail.setPointerCapture?.(event.pointerId);
    }
    if (drag.moved) {
      event.preventDefault();
      rail.scrollLeft = drag.startScrollLeft - deltaX;
    }
  }, []);

  const finishRailDrag = useCallback((event) => {
    const rail = railRef.current;
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    if (rail?.hasPointerCapture?.(event.pointerId)) {
      rail.releasePointerCapture(event.pointerId);
    }
    if (dragRef.current.moved) {
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
  }, []);

  const pushToTeam = useCallback((shot) => {
    sendRealtimeMessage?.({
      type: 'new_frame',
      data: { shot, user: { name: username, color: userColor } },
    });
  }, [sendRealtimeMessage, username, userColor]);

  const pushToTrake = useCallback((shot) => {
    sendRealtimeMessage?.({ type: 'trake_add', data: { shot } });
  }, [sendRealtimeMessage]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.repeat) return;
      if (e.key === 'Escape') {
        if (document.getElementById('video-preview-modal')) return;
        onClose();
        return;
      }
      if (e.ctrlKey && !e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        if (hoveredShot) {
          pushToTeam(hoveredShot);
          toast.success('Sent to Team!');
        }
      } else if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        e.stopImmediatePropagation?.();
        if (hoveredShot && pushToTrake) {
          pushToTrake(hoveredShot);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hoveredShot, onClose, pushToTeam, pushToTrake]);

  useEffect(() => {
    const controller = new AbortController();
    const fetchNeighbors = async () => {
      setLoading(true);
      setNeighbors([]);
      setTimelineWords([]);
      setTimelineFps(null);
      try {
        const response = isVideoTimeline
          ? await fetch(`${BASE_URL}/video_timeline/${encodeURIComponent(shotData.video_id)}`, {
              signal: controller.signal,
            })
          : await fetch(`${BASE_URL}/check_temporal_frames`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ base_frame_name: shotData.frame_name, mode: contextMode }),
              signal: controller.signal,
            });
        if (!response.ok) throw new Error("Failed to load context frames");
        const payload = await response.json();
        const filenames = isVideoTimeline ? payload.frames : payload;
        if (!Array.isArray(filenames)) throw new Error("Invalid frame timeline response");
        if (isVideoTimeline) {
          setTimelineWords(Array.isArray(payload.words) ? payload.words : []);
          setTimelineFps(payload.fps ?? null);
        }

        const mapped = filenames.map(fname => {
          const frame_id_match = fname.match(/_(\d+)\.[^.]+$/);
          const frameId = frame_id_match ? parseInt(frame_id_match[1], 10) : null;
          const nameParts = fname.replace(/\.[^.]+$/, '').split('_');
          return {
            frame_name: fname,
            frame_id: frameId,
            video_id: shotData.video_id,
            shot_id: nameParts.length >= 4 ? nameParts[nameParts.length - 2] : shotData.shot_id,
            filepath: fname,
            url: getImageUrl(fname) 
          };
        });
        const isDynamicVideoFrame = shotData.filepath?.startsWith('dynamic-frame-')
          || shotData.url?.startsWith('data:image');
        const originalFrame = isDynamicVideoFrame ? {
          ...shotData,
          url: shotData.url || getImageUrl(shotData.frame_name || shotData.filepath),
          isOriginalFrame: true,
        } : null;
        const displayedFrames = originalFrame ? [originalFrame, ...mapped] : mapped;
        if (originalFrame) {
          // Video-preview frames are dynamic and are not part of the mapped
          // keyframe list.  Keep the original in chronological position for
          // both the neighbors grid and the full timeline; prepending it
          // makes the context appear out of order (and always puts ORIGINAL
          // in the top-left corner).
          displayedFrames.sort((first, second) => {
            const firstFrame = Number.isFinite(first.frame_id) ? first.frame_id : Number.POSITIVE_INFINITY;
            const secondFrame = Number.isFinite(second.frame_id) ? second.frame_id : Number.POSITIVE_INFINITY;
            return firstFrame - secondFrame;
          });
        }
        setNeighbors(displayedFrames);
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.error("Error checking temporal frames:", e);
        toast.error(isVideoTimeline ? "Error loading video timeline" : "Error loading neighboring frames");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    fetchNeighbors();
    return () => controller.abort();
  }, [isVideoTimeline, shotData, contextMode]);

  return (
    <div data-shortcut-scope="modal" className="fixed inset-0 bg-black/90 z-[2000] flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg w-[95vw] max-h-[90vh] flex flex-col overflow-hidden shadow-[var(--shadow-heavy)]">
        
        <div className="px-6 py-4 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--glass-bg)] group/header">
          <div className="flex items-center gap-6">
            <h2 className="text-sm font-bold text-[var(--accent-primary)] uppercase tracking-wider flex items-center gap-2">
              <i className="fas fa-layer-group"></i> 
              {isVideoTimeline ? 'Video Timeline + Word ASR' : 'Frame Context'} – Video: <span className="font-mono text-[var(--text-primary)]">{shotData.video_id}</span>, Frame: <span className="font-mono text-[var(--text-primary)]">{shotData.frame_id}</span>
              {isVideoTimeline && timelineFps && <span className="font-mono text-[var(--text-secondary)]">({timelineFps} FPS)</span>}
            </h2>
            
            {!isVideoTimeline && (
              <div className="flex items-center bg-black/40 rounded-full p-1 border border-white/5 opacity-80 hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setContextMode('all')}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                    contextMode === 'all'
                      ? 'bg-[var(--accent-primary)] text-white shadow-[0_0_10px_var(--accent-primary)]'
                      : 'text-zinc-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  All Frames
                </button>
                <button
                  onClick={() => setContextMode('shot')}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                    contextMode === 'shot'
                      ? 'bg-[var(--accent-primary)] text-white shadow-[0_0_10px_var(--accent-primary)]'
                      : 'text-zinc-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  Shot Segments
                </button>
              </div>
            )}
          </div>

          <span 
            className="text-lg cursor-pointer text-[var(--text-secondary)] hover:text-red-500 hover:rotate-90 duration-200" 
            onClick={onClose}
          >
            &times;
          </span>
        </div>

        <div className={isVideoTimeline
          ? 'p-6 overflow-hidden flex-grow flex items-center'
          : 'p-6 overflow-y-auto flex-grow'
        }>
          {loading ? (
            <div className="flex items-center justify-center text-[var(--accent-primary)] text-xs py-20 gap-2 animate-pulse">
              <i className="fas fa-spinner fa-spin text-sm"></i> Checking available frames...
            </div>
          ) : neighbors.length === 0 ? (
            <p className="text-center text-[var(--text-secondary)] py-20 italic">No context frames found.</p>
          ) : (
            <div
              ref={railRef}
              className={isVideoTimeline
                ? 'flex w-full items-stretch gap-3 overflow-x-auto overflow-y-hidden px-2 py-5 custom-scrollbar cursor-grab active:cursor-grabbing select-none'
                : 'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 w-full'
              }
              style={isVideoTimeline
                ? { overscrollBehaviorX: 'contain', touchAction: 'pan-y', scrollBehavior: 'auto' }
                : undefined
              }
              onPointerDown={isVideoTimeline ? handleRailPointerDown : undefined}
              onPointerMove={isVideoTimeline ? handleRailPointerMove : undefined}
              onPointerUp={isVideoTimeline ? finishRailDrag : undefined}
              onPointerCancel={isVideoTimeline ? finishRailDrag : undefined}
              onLostPointerCapture={isVideoTimeline ? finishRailDrag : undefined}
            >
              {(isVideoTimeline
                ? timelineSlots
                : neighbors.map((shot) => ({ shot, words: [], width: null }))
              ).map(({ shot, words, width }, idx) => {
                const offset = shot.frame_id - shotData.frame_id;
                const isCenter = shot.isOriginalFrame || offset === 0;
                const labelText = isVideoTimeline
                  ? `#${shot.frame_id}`
                  : (offset > 0 ? `+${offset}` : `${offset}`);
                const isCorrect = isSameShot(shot, correctSubmission);
                const isWrong = !isCorrect && wrongFrames.some((wrongFrame) => isSameShot(shot, wrongFrame));
                const hasSubmissionStatus = isCorrect || isWrong;
                const statusColor = isCorrect ? '#ccff00' : '#ff1744';

                return (
                  <div
                    key={shot.frame_name || `${shot.video_id}-${shot.frame_id}-${idx}`}
                    className={isVideoTimeline ? 'min-w-0 flex-none flex flex-col gap-1' : 'contents'}
                    style={isVideoTimeline ? { width: `${width}px` } : undefined}
                  >
                    <div
                      data-center-frame={isCenter ? 'true' : 'false'}
                      className={`relative bg-[var(--card-bg)] rounded-xl overflow-hidden aspect-video cursor-zoom-in hover:scale-[1.03] transition-all duration-200 group ${
                        isVideoTimeline ? 'self-start w-[230px]' : ''
                      } ${
                        isCenter
                          ? 'border-[6px] ring-[6px] ring-slate-100'
                          : hasSubmissionStatus
                            ? 'border-0 z-20'
                          : 'border-[var(--border-color)] hover:border-[var(--accent-primary)]'
                      }`}
                      style={hasSubmissionStatus ? {
                        boxShadow: `0 0 15px 3px ${statusColor}, 0 0 30px 8px ${statusColor}, 0 0 60px 15px ${statusColor}, inset 0 0 25px 5px ${statusColor}`,
                      } : isCenter ? {
                        borderColor: '#d1d5db',
                        boxShadow: '0 0 12px #f8fafc, 0 0 28px #e5e7eb, 0 0 46px #94a3b8',
                      } : undefined}
                      onClick={(e) => {
                        if (suppressClickRef.current) {
                          e.preventDefault();
                          return;
                        }
                        if ((e.ctrlKey || e.metaKey) && e.altKey && onContext) {
                          e.preventDefault();
                          e.stopPropagation();
                          setHoveredShot(null);
                          onContext({ ...shot, contextView: 'video-timeline' });
                        } else if (e.ctrlKey && e.shiftKey && onQuickSearch) {
                        onQuickSearch(shot);
                        onClose();
                      } else if ((e.ctrlKey || e.metaKey) && onContext) {
                        e.preventDefault();
                        e.stopPropagation();
                        setHoveredShot(null);
                        onContext({ ...shot, contextView: 'neighbors' });
                      } else {
                        onZoom(shot.url);
                      }
                      }}
                      onContextMenu={(e) => {
                      e.preventDefault();
                      onPreview(shot.video_id, shot.frame_id);
                      }}
                      onMouseEnter={() => setHoveredShot(shot)}
                      onMouseLeave={() => setHoveredShot(null)}
                    >
                      <img loading="lazy" draggable="false" src={getImageUrl(shot.url || shot.frame_name || shot.filepath)} className="w-full h-full object-cover pointer-events-none" alt="Context result" onError={(e) => { e.target.onerror = null; e.target.src = '/fallback-image.png'; }} />
                    
                      <div className="absolute top-2 left-2 flex flex-col gap-1 z-10 pointer-events-none">
                        <div className={`px-2 py-0.5 rounded-full border text-[9px] font-extrabold tracking-widest shadow-lg w-fit ${
                          isCenter ? 'bg-[var(--accent-secondary)] text-white border-white/50 shadow-[0_0_10px_var(--accent-secondary)]' : 'bg-black/80 border-white/20 text-white'
                        }`}>
                          {isCenter ? 'ORIGINAL' : labelText}
                        </div>
                        {isWrong && (
                          <div className="px-2 py-0.5 rounded-full bg-rose-600 text-white flex items-center justify-center w-fit shadow-[0_0_8px_rgba(225,29,72,0.8)] border border-rose-400" title="Wrong Submission">
                            <span className="text-[9px] font-extrabold tracking-widest text-white">WRONG</span>
                          </div>
                        )}
                        {isCorrect && (
                          <div className="px-2 py-0.5 rounded-full bg-[#ccff00] text-slate-900 flex items-center justify-center w-fit shadow-[0_0_10px_#ccff00] border border-[#a8cc00]/50" title="Correct Submission">
                            <span className="text-[9px] font-extrabold tracking-widest text-slate-900">CORRECT</span>
                          </div>
                        )}
                      </div>

                      <div className="absolute inset-0 bg-slate-950/0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20">
                      <button 
                        className="absolute bottom-1.5 left-1.5 w-9 h-9 rounded-lg bg-slate-900/90 border border-white/10 text-white flex items-center justify-center text-xs hover:bg-slate-700 hover:border-transparent hover:scale-110 duration-150 cursor-pointer pointer-events-auto"
                        onClick={(e) => { e.stopPropagation(); pushToTeam(shot); }} 
                        title="Send to Team"
                      >
                        <i className="fas fa-users"></i>
                      </button>
                      <button 
                        className="absolute bottom-1.5 right-1.5 w-9 h-9 rounded-lg bg-[#10b981] border border-[#10b981] text-white flex items-center justify-center text-xs hover:brightness-110 hover:border-transparent cursor-pointer pointer-events-auto transition-all shadow-[0_0_10px_rgba(16,185,129,0.4)] hover:scale-110"
                        onClick={(e) => { e.stopPropagation(); pushToTrake(shot); }} 
                        title="Stage for Submission (Ctrl+Shift+Space)"
                      >
                        <i className="fas fa-paper-plane"></i>
                      </button>
                      </div>
                    </div>
                    {isVideoTimeline && (
                      <div className="min-h-12 w-full min-w-0 px-2 pt-1 text-left text-sm font-medium leading-6 text-[var(--text-primary)]">
                        {words.length > 0 ? words.map((word, wordIndex) => (
                          <span
                            key={`${word.start_frame_id}-${word.end_frame_id}-${wordIndex}`}
                            className="hover:text-[var(--accent-primary)]"
                            title={`${word.start.toFixed(2)}s–${word.end.toFixed(2)}s · frame ${word.start_frame_id}–${word.end_frame_id}`}
                          >
                            {word.word.trim()}{' '}
                          </span>
                        )) : (
                          <span aria-hidden="true">&nbsp;</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--border-color)] text-center text-xs text-[var(--text-secondary)] bg-[var(--glass-bg)]">
          Click to zoom. Ctrl+Click: neighboring frames. Ctrl+Alt+Click: horizontal timeline of the entire video. Right-click to open video preview. Hover over any frame for action options (Ctrl+Shift+Space to push to Submission panel, Ctrl+Space to Send to Team).
        </div>

      </div>
    </div>
  );
}
