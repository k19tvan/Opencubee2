import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getImageUrl } from '../utils/imageUrl';
import { getVideoThumbnailUrl, BASE_URL } from '../api';
import toast from 'react-hot-toast';
import QAModal from './modals/QAModal';

const getAbsoluteThumbnailUrl = (videoId, frameId) => {
  let url = getVideoThumbnailUrl(videoId, frameId, 360);
  if (url.startsWith('/')) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    url = `${origin}${url}`;
  }
  return url;
};

// Cache metadata globally so it persists across query switching (unmounts)
const globalMetaMap = new Map();
const MULTI_VIDEO_TRAKE_ROW_PREFIX = '__opencubee_trake_v2__';

const parseCsvContent = (csvString, mode, currentData = []) => {
  if (!csvString) return [];
  
  // Build a lookup map from currentData to preserve metadata like similarity_labels
  const metaMap = new Map();
  const safeCurrentData = Array.isArray(currentData) ? currentData : [];
  const flatData = mode === 'trake' ? safeCurrentData.flat() : safeCurrentData;
  for (const item of flatData) {
    if (item?.shot) {
      metaMap.set(`${item.shot.video_id}_${item.shot.frame_id}`, item.shot);
    }
  }

  const getPreservedShot = (video_id, frame_id) => {
    const url = getAbsoluteThumbnailUrl(video_id, frame_id);
    const baseShot = { video_id, frame_id, url };
    
    baseShot.frame_name = `${video_id}_${frame_id.toString().padStart(6, '0')}.webp`;
    
    const existingShot = metaMap.get(`${video_id}_${frame_id}`) || globalMetaMap.get(`${video_id}_${frame_id}`);
    if (existingShot) {
      return { ...baseShot, frame_name: existingShot.frame_name || baseShot.frame_name, similarity_labels: existingShot.similarity_labels, username: existingShot.username };
    }
    return baseShot;
  };

  const lines = csvString.split('\n').filter(l => l.trim());
  
  if (mode === 'kis') {
    return lines.map(line => {
      const p = line.split(',');
      const video_id = Object.is(p[0], undefined) ? '' : p[0];
      const frame_id = Object.is(p[1], undefined) ? '' : String(p[1]).trim();
      return { shot: getPreservedShot(video_id, frame_id), answer: null };
    });
  } else if (mode === 'qa') {
    return lines.map(line => {
      const p = line.split(',');
      const video_id = Object.is(p[0], undefined) ? '' : p[0];
      const frame_id = Object.is(p[1], undefined) ? '' : String(p[1]).trim();
      const answer = p.length > 2 ? p.slice(2).join(',').replace(/^"|"$/g, '') : '';
      return { shot: getPreservedShot(video_id, frame_id), answer };
    });
  } else if (mode === 'trake') {
    return lines.map(line => {
      if (line.startsWith(`${MULTI_VIDEO_TRAKE_ROW_PREFIX},`)) {
        try {
          const encodedFrames = line.slice(MULTI_VIDEO_TRAKE_ROW_PREFIX.length + 1);
          const frames = JSON.parse(decodeURIComponent(encodedFrames));
          if (!Array.isArray(frames)) return [];
          return frames.map(({ video_id, frame_id }) => ({
            shot: getPreservedShot(video_id, String(frame_id).trim()),
          }));
        } catch {
          return [];
        }
      }
      const p = line.split(',');
      const video_id = Object.is(p[0], undefined) ? '' : p[0];
      const frameIds = p.slice(1);
      return frameIds.map(fid => {
        const strFid = String(fid).trim();
        return { shot: getPreservedShot(video_id, strFid) };
      });
    });
  }
  return [];
};

const serializeCsvContent = (localData, mode) => {
  if (!Array.isArray(localData)) return '';
  if (mode === 'kis') {
    return localData.map(item => `${item.shot.video_id},${item.shot.frame_id}`).join('\n');
  } else if (mode === 'qa') {
    return localData.map(item => `${item.shot.video_id},${item.shot.frame_id},"${item.answer || ''}"`).join('\n');
  } else if (mode === 'trake') {
    return localData.map((row) => {
      if (!Array.isArray(row)) return '';
      const frames = row
        .map(({ shot }) => ({ video_id: shot?.video_id, frame_id: shot?.frame_id }))
        .filter(({ video_id, frame_id }) => video_id && frame_id !== undefined && frame_id !== null);
      if (frames.length === 0) return '';

      const videoIds = new Set(frames.map(({ video_id }) => video_id));
      if (videoIds.size === 1) {
        return `${frames[0].video_id},${frames.map(({ frame_id }) => frame_id).join(',')}`;
      }

      // Versioned, URI-encoded JSON preserves one logical row and its order
      // when that row contains frames from several videos.
      return `${MULTI_VIDEO_TRAKE_ROW_PREFIX},${encodeURIComponent(JSON.stringify(frames))}`;
    }).filter(Boolean).join('\n');
  }
  return '';
};

const normalizeDraftContent = (filename, draftContent) => {
  if (!filename?.includes('-trake')) return Array.isArray(draftContent) ? draftContent : [];
  if (!Array.isArray(draftContent)) return [];

  // Trake is a list of rows. Accept a legacy flat list as one row so every
  // frame remains visible instead of rendering only an incomplete payload.
  if (draftContent.every((item) => item?.shot)) return [draftContent];
  return draftContent.map((row) => {
    if (Array.isArray(row)) return row.filter((item) => item?.shot);
    return row?.shot ? [row] : [];
  });
};

const cloneDraftContent = (draftContent, mode) => {
  if (!Array.isArray(draftContent)) return [];
  return mode === 'trake'
    ? draftContent.map((row) => (Array.isArray(row) ? [...row] : []))
    : [...draftContent];
};

const ShotImage = ({ item, mode, onAnswerChange, onMouseEnter, onMouseLeave, onPreviewTrakeFrame, onZoom, onContext, onQuickSearch, onToggleLock, onPreview, onEditAnswer, draggable, onDragStart, onDragOver, onDrop }) => {
  const [answer, setAnswer] = useState(item.answer || '');

  useEffect(() => {
    setAnswer(item.answer || '');
  }, [item.answer]);

  const handleBlur = () => {
    if (onAnswerChange) onAnswerChange(answer);
  };

  const handleInteraction = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const computedUrl = item.shot?.url || item.shot?.frame_name || item.shot?.filepath 
      ? getImageUrl(item.shot.url || item.shot.frame_name || item.shot.filepath) 
      : getAbsoluteThumbnailUrl(item.shot.video_id, item.shot.frame_id);
      
    const enrichedShot = {
      ...item.shot,
      url: computedUrl,
    };
    if (item.shot.frame_name) {
      enrichedShot.frame_name = item.shot.frame_name;
    }

    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (isCtrlOrCmd && e.altKey && onContext) {
      onContext({ ...enrichedShot, contextView: 'video-timeline' });
      return;
    }
    if (e.altKey && onToggleLock) {
      onToggleLock(enrichedShot);
      return;
    }
    if (isCtrlOrCmd && e.shiftKey && onQuickSearch) {
      onQuickSearch(enrichedShot);
    } else if (isCtrlOrCmd && onContext) {
      onContext({ ...enrichedShot, contextView: 'neighbors' });
    } else if (onZoom) {
      onZoom(computedUrl);
    }
  };

  return (
    <div 
      className="relative flex-shrink-0 w-[180px] rounded-lg overflow-hidden border border-[var(--border-color)] hover:border-[var(--accent-primary)] group cursor-pointer"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={handleInteraction}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (onPreview) onPreview(item.shot?.video_id, item.shot?.frame_id);
      }}
      draggable={draggable}
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart?.(e);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragOver?.(e);
      }}
      onDrop={(e) => {
        e.stopPropagation();
        onDrop?.(e);
      }}
    >
      <div className="aspect-video">
        <img
          src={getImageUrl(item.shot?.url || item.shot?.frame_name || item.shot?.filepath)}
          alt="Frame"
          className="w-full h-full object-cover"
          onError={(e) => {
            e.target.onerror = null;
            e.target.src = 'data:image/svg+xml;base64,...'; // fallback
          }}
          loading="lazy"
        />
      </div>
      <div className="absolute top-1 right-1 bg-gradient-to-r from-indigo-900/90 to-indigo-700/90 border border-indigo-500/50 px-1.5 py-0.5 rounded text-[10px] text-white font-mono z-20 shadow-md">
        {item.shot?.video_id}_{item.shot?.frame_id}
      </div>
      {(() => {
        const labels = item.shot?.similarity_labels || [];
        const hasDuplicate = labels.includes('DUP');
        const hasReuse = labels.includes('REUSE');
        if (hasDuplicate || hasReuse) {
          return (
            <div className="absolute top-1.5 left-1.5 z-20 pointer-events-none opacity-90">
              <div className={`px-1.5 py-[3px] rounded bg-gradient-to-br text-white flex items-center justify-center w-fit shadow-[0_2px_8px_rgba(0,0,0,0.6)] border ${hasDuplicate ? 'from-[#e86c1f] to-[#cf5505] border-[#ff8b45]' : 'from-emerald-500 to-emerald-700 border-emerald-400'}`}>
                <i className="far fa-clone text-[8px] mr-[3px]"></i>
                <span className="text-[8px] font-black tracking-widest">{hasDuplicate ? 'DUP' : 'REPE'}</span>
              </div>
            </div>
          );
        }
        return null;
      })()}
      
      {item.shot?.username && (
        <div className={`absolute z-20 pointer-events-none opacity-90 ${mode === 'qa' && item.answer ? 'bottom-1.5 right-1.5' : 'bottom-1.5 left-1.5'}`}>
          <div className="px-1.5 py-[2px] rounded bg-violet-600/90 text-white flex items-center justify-center w-fit shadow-[0_2px_8px_rgba(0,0,0,0.6)] border border-violet-400">
            <i className="fas fa-user-astronaut text-[8px] mr-[3px]"></i>
            <span className="text-[8.5px] font-bold tracking-wide">{item.shot.username}</span>
          </div>
        </div>
      )}

      {mode === 'qa' && item.answer && (
        <div 
          className="absolute bottom-1.5 left-1.5 bg-emerald-500/90 hover:bg-emerald-600 backdrop-blur-md px-2 py-0.5 rounded shadow-lg text-[10.5px] font-extrabold text-white max-w-[120px] truncate border border-emerald-400/50 z-20 cursor-pointer transition-all hover:scale-105" 
          title="Click to edit answer in QA Modal"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onEditAnswer) onEditAnswer(item);
          }}
        >
          <i className="fas fa-pen text-[8px] mr-1 opacity-80"></i>
          {item.answer}
        </div>
      )}
      {mode === 'trake' && (
        <button
          type="button"
          draggable={false}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onPreviewTrakeFrame) onPreviewTrakeFrame(item.shot);
          }}
          className="absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-slate-900/90 text-xs text-white shadow-md transition-all hover:scale-110 hover:border-transparent hover:bg-blue-500 cursor-pointer"
          title="Preview frames around this point"
          aria-label="Preview frames around this point"
        >
          <i className="fas fa-film"></i>
        </button>
      )}
    </div>
  );
};

export default function SubmissionPanel({ 
  activeQueryFilename, 
  activeQueryText,
  activeCsvContent, 
  activeDraftContent,
  onSaveSubmission, 
  onSyncState,
  hoveredFrame, // this comes from layout when hovering over gallery
  onPreviewTrakeFrame,
  onZoom,
  onContext,
  onQuickSearch,
  onToggleLock,
  onPreview,
  setHoveredFrame,
  username,
  onSyncDraft,
}) {
  const [draftsByFile, setDraftsByFile] = useState({});
  const draftsByFileRef = React.useRef({});
  const draftRevisionsRef = React.useRef(new Map());
  const processedExternalDropIdsRef = React.useRef(new Set());
  const setDraftForFile = useCallback((filename, draftContent) => {
    const normalizedDraft = normalizeDraftContent(filename, draftContent);
    const nextDrafts = { ...draftsByFileRef.current, [filename]: normalizedDraft };
    draftsByFileRef.current = nextDrafts;
    setDraftsByFile(nextDrafts);
  }, []);
  const localData = (activeQueryFilename && draftsByFile[activeQueryFilename]) || [];
  
  const [viewMode, setViewMode] = useState('draft');
  const [mode, setMode] = useState('kis');
  const [hoveredPanelItem, setHoveredPanelItem] = useState(null);
  const [qaModalShot, setQaModalShot] = useState(null);
  const [qaModalTrigger, setQaModalTrigger] = useState(0);
  const [qaModalInitialAnswer, setQaModalInitialAnswer] = useState('');
  const [qaModalTargetIndex, setQaModalTargetIndex] = useState(-1);

  const parsedCsvData = useMemo(() => {
    return activeQueryFilename && activeCsvContent !== null ? parseCsvContent(activeCsvContent, mode, []) : [];
  }, [activeCsvContent, mode, activeQueryFilename]);

  useEffect(() => {
    setViewMode('draft');
  }, [activeQueryFilename]);

  useEffect(() => {
    const handleDraftUpdated = (e) => {
      const { filename, draftContent, revision } = e.detail;
      if (!filename) return;

      const incomingRevision = Number(revision);
      const knownRevision = draftRevisionsRef.current.get(filename) || 0;
      if (Number.isFinite(incomingRevision) && incomingRevision < knownRevision) return;
      if (Number.isFinite(incomingRevision)) {
        draftRevisionsRef.current.set(filename, incomingRevision);
      }

      // Cache every query's draft, even while the user is viewing another one.
      // This prevents the old CSV response from winning when they switch back.
      setDraftForFile(filename, draftContent);
    };
    window.addEventListener('draft_updated', handleDraftUpdated);
    return () => window.removeEventListener('draft_updated', handleDraftUpdated);
  }, [setDraftForFile]);

  useEffect(() => {
    if (!activeQueryFilename) return;
    const computedMode = activeQueryFilename.includes('-qa') ? 'qa' 
                       : activeQueryFilename.includes('-trake') ? 'trake' 
                       : 'kis';
    setMode(computedMode);
    
    // Do not initialize draft if we are still legally waiting for the new CSV content
    if (activeCsvContent === null && activeDraftContent === null) return;
    
    // Initialize draft per file only if it doesn't exist
    if (!draftsByFileRef.current[activeQueryFilename]) {
      setDraftForFile(
        activeQueryFilename,
        activeDraftContent || parseCsvContent(activeCsvContent, computedMode, []),
      );
    }
  }, [activeQueryFilename, activeCsvContent, activeDraftContent, setDraftForFile]);

  const updateData = useCallback((updater) => {
    if (!activeQueryFilename) return;
    
    const currentDraft = draftsByFileRef.current[activeQueryFilename] || [];
    const baseDraft = cloneDraftContent(currentDraft, mode);
    const next = typeof updater === 'function' ? updater(baseDraft) : updater;

    setDraftForFile(activeQueryFilename, next);
    if (onSyncDraft) onSyncDraft(activeQueryFilename, next);
  }, [mode, activeQueryFilename, onSyncDraft, setDraftForFile]);

  const addFrame = useCallback((shot, answer = '') => {
    if (!shot) return;
    const { video_id } = shot;
    // ensure shot has frame_id extracted properly if using getDresFrameNumber
    const frame_id = shot.frame_id || (shot.frame_name ? shot.frame_name.split('_').pop().split('.')[0] : '');
    const normalizedShot = { ...shot, video_id, frame_id, username };
    globalMetaMap.set(`${video_id}_${frame_id}`, normalizedShot);

    updateData(prev => {
      if (mode === 'kis' || mode === 'qa') {
        return [...prev, { shot: normalizedShot, answer }];
      } else if (mode === 'trake') {
        const next = [...prev];
        if (next.length === 0) next.push([]);
        // A Trake row is an ordered sequence. video_id is carried by each
        // frame, so mixing videos must not create a row implicitly.
        next[next.length - 1].push({ shot: normalizedShot });
        return next;
      }
      return prev;
    });
  }, [mode, updateData]);

  const removeFrame = useCallback((targetInfo) => {
    if (!targetInfo) return;
    updateData(prev => {
      if (mode === 'kis' || mode === 'qa') {
        return prev.filter((_, index) => index !== targetInfo.index);
      }
      if (mode === 'trake' && targetInfo.type === 'trake') {
        const next = [...prev];
        if (next[targetInfo.rIdx]) {
          next[targetInfo.rIdx] = next[targetInfo.rIdx].filter((_, index) => index !== targetInfo.cIdx);
        }
        return next;
      }
      return prev;
    });
  }, [mode, updateData]);

  const updateAnswer = useCallback((targetIndex, newAnswer) => {
    updateData(prev => {
      if (!Array.isArray(prev) || targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      if (next[targetIndex]) {
        next[targetIndex] = { ...next[targetIndex], answer: newAnswer };
      }
      return next;
    });
  }, [updateData]);

  const handleDragStart = (e, payload, item) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      ...payload,
      ...(item?.shot ? {
          video_id: item.shot.video_id,
          frame_id: item.shot.frame_id,
          frame_name: item.shot.frame_name,
          url: item.shot.url
      } : {})
    }));
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, targetPayload) => {
    e.preventDefault();
    // A Trake row sits inside the panel drop zone. Handle a payload at its
    // innermost target only; otherwise the same native drop bubbles and adds
    // the frame again at each ancestor.
    e.stopPropagation();
    try {
      const source = JSON.parse(e.dataTransfer.getData('application/json'));
      if (source.type === 'submission-frame' && source.shot) {
        if (source.dragId && processedExternalDropIdsRef.current.has(source.dragId)) return;
        if (source.dragId) {
          processedExternalDropIdsRef.current.add(source.dragId);
          window.setTimeout(() => processedExternalDropIdsRef.current.delete(source.dragId), 1000);
        }
        addFrame(source.shot);
        if (viewMode === 'csv') setViewMode('draft');
        return;
      }
      if (!source.type || source.type !== targetPayload.type) return;

      if (source.type === 'kis') {
        const fromIdx = source.index;
        const toIdx = targetPayload.index;
        if (fromIdx === toIdx) return;
        updateData(prev => {
          const next = [...prev];
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          return next;
        });
      } else if (source.type === 'trake-row') {
        const fromIdx = source.index;
        const toIdx = targetPayload.index;
        if (fromIdx === toIdx) return;
        updateData(prev => {
          const next = [...prev];
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          return next;
        });
      } else if (source.type === 'trake') {
        const { rIdx: fromRIdx, cIdx: fromCIdx } = source;
        const { rIdx: toRIdx, cIdx: toCIdx } = targetPayload;
        updateData(prev => {
          const next = prev.map(row => [...row]); // deep copy first level
          if (!next[fromRIdx] || !next[toRIdx] || !next[fromRIdx][fromCIdx]) return prev;
          
          const [moved] = next[fromRIdx].splice(fromCIdx, 1);
          let insertIndex = toCIdx === undefined ? next[toRIdx].length : toCIdx;
          if (fromRIdx === toRIdx && fromCIdx < insertIndex) insertIndex -= 1;
          next[toRIdx].splice(insertIndex, 0, moved);
          return next;
        });
      }
    } catch (err) {}
  };

  const handleAddRow = () => {
    if (mode === 'trake') {
      updateData(prev => [...prev, []]);
    }
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.repeat || !activeQueryFilename) return;
      if (document.querySelector('[data-shortcut-scope="modal"]')) return;

      // Ctrl + Shift + Space -> Submit
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        
        const newCsv = serializeCsvContent(localData, mode);
        onSaveSubmission(newCsv);
        return;
      }

      // Ctrl + Space restores the original panel behavior: remove the frame
      // currently hovered in this submission panel. Preview-sidebar frames are
      // handled independently by TrakeFramePreviewSidebar.
      if (e.ctrlKey && !e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        const isCsvMode = typeof viewMode !== 'undefined' && viewMode === 'csv';
        if (hoveredPanelItem) {
          if (isCsvMode) {
            toast.error("Can't remove frames from CSV view. Switch to Draft first.");
            return;
          }
          removeFrame(hoveredPanelItem);
          return;
        }

        if (hoveredFrame) {
          if (mode === 'qa') {
            setQaModalShot(hoveredFrame);
            setQaModalTrigger(t => t + 1);
          } else {
            addFrame(hoveredFrame);
            if (isCsvMode) toast.success("Added to Draft");
          }
        }
      }
    };

    const handleCustomPushEvent = (e) => {
      const shot = e.detail?.shot;
      if (!shot) return;
      
      const isCsvMode = typeof viewMode !== 'undefined' && viewMode === 'csv';
      if (mode === 'qa') {
        setQaModalShot(shot);
        setQaModalTrigger(t => t + 1);
      } else {
        addFrame(shot);
        if (isCsvMode) toast.success("Added to Draft");
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('push-to-panel', handleCustomPushEvent);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('push-to-panel', handleCustomPushEvent);
    };
  }, [activeQueryFilename, localData, mode, onSaveSubmission, hoveredFrame, addFrame, removeFrame, hoveredPanelItem, viewMode]);

  if (!activeQueryFilename) {
    return (
      <div className="px-6 py-4 border-b border-[var(--border-color)]">
        <p className="text-[var(--text-secondary)] text-xs italic">Select a query from the top bar to start submitting.</p>
      </div>
    );
  }

  return (
    <>
    <div 
      className="border-b border-[var(--border-color)] bg-[var(--bg-primary)] shadow-sm z-[49] relative" 
      onMouseLeave={() => setHoveredPanelItem(null)}
      onDragOver={handleDragOver}
      onDrop={(event) => handleDrop(event, { type: 'submission-panel' })}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-gradient-to-r from-[var(--bg-secondary)] to-[var(--bg-primary)] shadow-inner gap-4">
        <div className="flex-1 min-w-0 pr-4">
          <h3 className="text-[10px] font-extrabold text-[var(--accent-primary)] uppercase tracking-widest flex items-center gap-2 mb-1.5 opacity-90">
            <i className="fas fa-file-contract"></i> Submission Panel ({mode.toUpperCase()})
          </h3>
          <p className="text-sm font-semibold text-[var(--text-primary)] line-clamp-3 leading-snug drop-shadow-sm" title={activeQueryText || activeQueryFilename}>
            {activeQueryText || activeQueryFilename}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex bg-[var(--bg-tertiary)] rounded overflow-hidden shadow-inner mr-2 p-0.5">
            <button
              onClick={() => setViewMode('draft')}
              className={`px-3 py-1 text-xs font-bold rounded transition-colors ${viewMode === 'draft' ? 'bg-blue-600 text-white shadow' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'}`}
              title="View your local unsaved changes"
            >
              Draft
            </button>
            <button
              onClick={() => setViewMode('csv')}
              className={`px-3 py-1 text-xs font-bold rounded transition-colors ${viewMode === 'csv' ? 'bg-blue-600 text-white shadow' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'}`}
              title="View the server's saved CSV content"
            >
              CSV
            </button>
          </div>
          {viewMode === 'csv' && (
            <button 
              onClick={() => {
                const newDraft = parseCsvContent(activeCsvContent, mode, []);
                setDraftsByFile(prev => ({
                   ...prev,
                   [activeQueryFilename]: newDraft
                }));
                if (onSyncDraft) onSyncDraft(activeQueryFilename, newDraft);
                setViewMode('draft');
                toast.success("CSV content pushed to Draft");
              }}
              className="px-3 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/30 rounded text-xs hover:bg-purple-500/20"
              title="Overwrite Draft with this CSV content"
            >
              <i className="fas fa-download mr-1"></i> Push to Draft
            </button>
          )}
          {mode === 'trake' && viewMode === 'draft' && (
            <button 
              onClick={handleAddRow}
              className="px-3 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded text-xs hover:bg-blue-500/20"
            >
              <i className="fas fa-plus mr-1"></i> Add Row
            </button>
          )}
          {viewMode === 'draft' && (
            <button 
              onClick={() => {
                onSaveSubmission(serializeCsvContent(localData, mode))
              }}
              className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded text-xs hover:bg-emerald-500/20 font-bold"
              title="Ctrl + Shift + Space"
            >
              <i className="fas fa-save mr-1"></i> Submit
            </button>
          )}
        </div>
      </div>

      <div className="p-4 overflow-x-auto min-h-[140px] max-h-[300px] overflow-y-auto">
        {(() => {
          const displayData = viewMode === 'csv' ? parsedCsvData : localData;
          if (mode === 'kis' || mode === 'qa') {
            return displayData.length === 0 ? (
              <p className="text-[var(--text-secondary)] text-xs italic">
                {viewMode === 'draft' ? "Hover an image and press Ctrl+Space to add." : "Server CSV is empty."}
              </p>
            ) : (
              <div className="flex flex-nowrap gap-4">
                {displayData.map((item, idx) => (
                  <ShotImage 
                    key={idx} 
                    item={item} 
                    mode={mode} 
                    onAnswerChange={(ans) => {
                      if (viewMode === 'csv') return;
                      updateData(prevLocal => {
                        const newLocal = [...prevLocal];
                        if (newLocal[idx]) {
                          newLocal[idx].answer = ans;
                        }
                        return newLocal;
                      });
                    }}
                    onMouseEnter={() => {
                      setHoveredPanelItem(viewMode === 'draft' ? { type: 'kis', index: idx } : null);
                      if (setHoveredFrame && item?.shot) setHoveredFrame(item.shot);
                    }}
                    onMouseLeave={() => {
                      setHoveredPanelItem(null);
                      if (setHoveredFrame) setHoveredFrame(null);
                    }}
                    draggable={viewMode === 'draft'}
                    onDragStart={(e) => viewMode === 'draft' && handleDragStart(e, { type: 'kis', index: idx }, item)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => viewMode === 'draft' && handleDrop(e, { type: 'kis', index: idx })}
                    onZoom={onZoom}
                    onContext={onContext}
                    onQuickSearch={onQuickSearch}
                    onToggleLock={viewMode === 'draft' ? onToggleLock : undefined}
                    onPreview={onPreview}
                    onEditAnswer={() => {
                      if (viewMode === 'csv') {
                        toast.error("Can't edit answers in CSV mode. Switch to Draft first.");
                        return;
                      }
                      setQaModalShot(item.shot);
                      setQaModalInitialAnswer(item.answer || '');
                      setQaModalTargetIndex(idx);
                      setQaModalTrigger(t => t + 1);
                    }}
                  />
                ))}
              </div>
            );
          } else {
            return (
              <div className="flex flex-col gap-4">
                {displayData.length === 0 ? (
                  <p className="text-[var(--text-secondary)] text-xs italic">
                    {viewMode === 'draft' ? "Hover an image and press Ctrl+Space to add to Trake row." : "Server CSV is empty."}
                  </p>
                ) : (
                  displayData.map((row, rowIdx) => {
                    const rowItems = Array.isArray(row) ? row : (row?.shot ? [row] : []);
                    return (
                      <div 
                        key={rowIdx} 
                        className="flex gap-4 items-center bg-[var(--glass-bg)] p-2 rounded-lg border border-[var(--border-color)]"
                        onDragOver={handleDragOver}
                        onDrop={(e) => viewMode === 'draft' && handleDrop(e, { type: 'trake', rIdx: rowIdx })}
                      >
                        <div className="text-[10px] text-[var(--text-secondary)] font-mono w-4">R{rowIdx+1}</div>
                        <div className="flex flex-nowrap gap-2 overflow-x-auto flex-1">
                          {rowItems.length === 0 ? (
                            <span className="text-[10px] text-[var(--text-secondary)] italic p-2 block w-full h-full"
                               onDragOver={handleDragOver}
                               onDrop={(e) => viewMode === 'draft' && handleDrop(e, { type: 'trake', rIdx: rowIdx, cIdx: 0 })}
                            >Empty row... Drag frame here</span>
                          ) : (
                            rowItems.map((item, idx) => (
                              <ShotImage 
                                key={`${rowIdx}-${idx}`} 
                                item={item} 
                                mode={mode} 
                                onMouseEnter={() => {
                                  setHoveredPanelItem(viewMode === 'draft' ? { type: 'trake', rIdx: rowIdx, cIdx: idx } : null);
                                  if (setHoveredFrame && item?.shot) setHoveredFrame(item.shot);
                                }}
                                onMouseLeave={() => {
                                  setHoveredPanelItem(null);
                                  if (setHoveredFrame) setHoveredFrame(null);
                                }}
                                draggable={viewMode === 'draft'}
                                onDragStart={(e) => viewMode === 'draft' && handleDragStart(e, { type: 'trake', rIdx: rowIdx, cIdx: idx }, item)}
                                onDragOver={handleDragOver}
                                onDrop={(e) => viewMode === 'draft' && handleDrop(e, { type: 'trake', rIdx: rowIdx, cIdx: idx })}
                                onPreviewTrakeFrame={onPreviewTrakeFrame}
                                onZoom={onZoom}
                                onContext={onContext}
                                onQuickSearch={onQuickSearch}
                                onToggleLock={viewMode === 'draft' ? onToggleLock : undefined}
                                onPreview={onPreview}
                              />
                            ))
                          )}
                        </div>
                        {viewMode === 'draft' && (
                          <div className="flex flex-col gap-1 px-2 border-l border-[var(--border-color)]">
                            <button 
                              className="text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Move Row Up"
                              disabled={rowIdx === 0}
                              onClick={() => {
                                updateData(prevLocal => {
                                  const newLocal = [...prevLocal];
                                  const [moved] = newLocal.splice(rowIdx, 1);
                                  newLocal.splice(rowIdx - 1, 0, moved);
                                  return newLocal;
                                });
                              }}
                            >
                              <i className="fas fa-chevron-up"></i>
                            </button>
                            <button 
                              className="text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Move Row Down"
                              disabled={rowIdx === displayData.length - 1}
                              onClick={() => {
                                updateData(prevLocal => {
                                  const newLocal = [...prevLocal];
                                  const [moved] = newLocal.splice(rowIdx, 1);
                                  newLocal.splice(rowIdx + 1, 0, moved);
                                  return newLocal;
                                });
                              }}
                            >
                              <i className="fas fa-chevron-down"></i>
                            </button>
                            <button 
                              className="text-red-400 hover:text-red-300 mt-2"
                              title="Remove row"
                              onClick={() => {
                                updateData(prevLocal => {
                                  const newLocal = [...prevLocal];
                                  newLocal.splice(rowIdx, 1);
                                  return newLocal;
                                });
                              }}
                            >
                              <i className="fas fa-trash"></i>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            );
          }
        })()}
      </div>
    </div>
    {qaModalShot && typeof document !== 'undefined' && createPortal(
      <QAModal
        shot={qaModalShot}
        trigger={qaModalTrigger}
        initialAnswer={qaModalInitialAnswer}
        onClose={() => {
          setQaModalShot(null);
          setQaModalTargetIndex(-1);
          setQaModalInitialAnswer('');
        }}
        onSubmit={(answer) => {
          if (qaModalTargetIndex >= 0) {
            updateAnswer(qaModalTargetIndex, answer);
            toast.success("Updated QA answer");
          } else {
            addFrame(qaModalShot, answer);
          }
          setQaModalShot(null);
          setQaModalTargetIndex(-1);
          setQaModalInitialAnswer('');
        }}
      />,
      document.getElementById('app-theme-root') || document.body
    )}
    </>
  );
}
