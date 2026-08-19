import { useEffect, useMemo, useRef, useState } from 'react';
import { getImageUrl } from '../utils/imageUrl';

const MODALITY_META = {
  text: { label: 'Text', icon: 'fas fa-image', color: 'text-violet-300' },
  ocr: { label: 'OCR', icon: 'fas fa-font', color: 'text-amber-300' },
  asr: { label: 'ASR', icon: 'fas fa-microphone', color: 'text-cyan-300' },
  semantic_asr: { label: 'Semantic ASR', icon: 'fas fa-brain', color: 'text-emerald-300' },
};

const getFrameKey = (frame = {}) => frame.filepath || frame.frame_name || frame.url || '';

function FrameAction({ icon, label, onClick, active = false, accent = '' }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className={`inline-flex min-w-0 items-center justify-center gap-1 rounded-md border px-1.5 py-1.5 text-[9px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
        active
          ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
          : `border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-500 hover:bg-slate-800 hover:text-white ${accent}`
      }`}
      title={label}
    >
      <i className={`${icon} shrink-0`} />
      <span className="truncate">{label}</span>
    </button>
  );
}

export default function MultiAgentResultsModal({
  result,
  onClose,
  onZoom,
  onPreview,
  onContext,
  onQuickSearch,
  onToggleLock,
  lockedVideoIds = [],
  onPushToTeam,
  onPushToTrake,
  onDresSubmit,
}) {
  const availableModalities = useMemo(
    () => Object.entries(result?.modalities || {}),
    [result],
  );
  const [activeModality, setActiveModality] = useState(availableModalities[0]?.[0] || 'text');
  const modalRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      const modalScopes = document.querySelectorAll('[data-shortcut-scope="modal"]');
      if (modalScopes[modalScopes.length - 1] === modalRef.current) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (!result) return null;
  const resolvedModality = availableModalities.some(([key]) => key === activeModality)
    ? activeModality
    : (availableModalities[0]?.[0] || 'text');
  const modality = result.modalities?.[resolvedModality] || { frames: [], query: '' };
  const frames = [...(modality.frames || [])].sort(
    (first, second) => (second.critic_score ?? second.score ?? 0) - (first.critic_score ?? first.score ?? 0),
  );
  const meta = MODALITY_META[resolvedModality] || MODALITY_META.text;

  const handleFrameClick = (event, frame) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      if (event.altKey) onContext?.({ ...frame, contextView: 'video-timeline' });
      else if (event.shiftKey) {
        onClose();
        onQuickSearch?.(frame);
      }
      else onContext?.({ ...frame, contextView: 'neighbors' });
      return;
    }
    if (event.altKey) {
      event.preventDefault();
      onToggleLock?.(frame);
      return;
    }
    onZoom?.(getImageUrl(frame.url || frame.frame_name || frame.filepath));
  };

  const handleDragStart = (event, frame) => {
    const url = getImageUrl(frame.url || frame.frame_name || frame.filepath);
    event.dataTransfer.setData('application/json', JSON.stringify({ ...frame, url }));
    event.dataTransfer.setData('text/uri-list', url);
    event.dataTransfer.setData('text/plain', frame.frame_name || url);
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div ref={modalRef} data-shortcut-scope="modal" className="pointer-events-auto fixed inset-0 z-[1900] flex flex-col bg-[#050816] text-slate-100 animate-fadeIn" style={{ backgroundColor: '#050816' }}>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-700 bg-[#0b1020] px-4 py-3 shadow-lg sm:px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]"><i className="fas fa-images" /></span>
            Multi-modal critic results
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-slate-300">{result.selected_count || 0} selected</span>
            {result.warnings?.length > 0 && <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300" title={result.warnings.join('\n')}><i className="fas fa-triangle-exclamation mr-1" />{result.warnings.length} critic warning</span>}
          </div>
          <p className="mt-1 truncate text-[11px] text-slate-400">{result.query} · top {result.frame_limit || '?'} candidates/modality · 20 frames/canvas</p>
        </div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] transition-colors hover:border-red-400 hover:bg-red-500/10 hover:text-red-400" title="Close (Esc)"><i className="fas fa-times" /></button>
      </header>

      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-700 bg-[#0b1020] px-4 py-2 sm:px-6">
        {availableModalities.map(([key, value]) => {
          const tabMeta = MODALITY_META[key] || MODALITY_META.text;
          const active = key === resolvedModality;
          return <button key={key} type="button" onClick={() => setActiveModality(key)} className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${active ? 'border-violet-400 bg-violet-500/20 text-white' : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-500 hover:text-slate-200'}`}>
            <i className={`${tabMeta.icon} ${tabMeta.color}`} />
            {tabMeta.label}
            <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px]" title="Selected / retrieved">{value.frames?.length || 0}/{value.candidate_count || 0}</span>
          </button>;
        })}
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto bg-[#050816] p-4 sm:p-6">
        <div className="mb-5 flex flex-col gap-2 rounded-xl border border-slate-700 bg-[#0c1222] p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className={`text-xs font-bold ${meta.color}`}><i className={`${meta.icon} mr-2`} />{meta.label} query</div>
            <p className="mt-1 break-words text-xs text-slate-100">{modality.query || 'No useful query was generated for this modality.'}</p>
          </div>
          <p className="shrink-0 text-[11px] text-slate-400">{frames.length} selected from {modality.candidate_count || 0} retrieved · best match first</p>
        </div>

        {frames.length === 0 ? (
          <div className="flex min-h-[45vh] flex-col items-center justify-center text-center text-slate-500"><i className="fas fa-filter-circle-xmark mb-3 text-4xl" /><p className="text-sm font-semibold text-slate-300">No frame passed the visual critic</p><p className="mt-1 text-xs">{modality.query ? 'Choose another modality or refine the original request.' : 'The planner did not generate a query for this modality.'}</p></div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {frames.map((frame, index) => {
              const locked = lockedVideoIds.includes(frame.video_id);
              return <article key={`${getFrameKey(frame)}-${index}`} className="group overflow-hidden rounded-xl border border-slate-700 bg-[#0c1222] shadow-[var(--shadow-heavy)] transition-all hover:-translate-y-0.5 hover:border-[var(--border-hover)] hover:ring-1 hover:ring-white/20">
                <div
                  draggable
                  onDragStart={(event) => handleDragStart(event, frame)}
                  onClick={(event) => handleFrameClick(event, frame)}
                  onContextMenu={(event) => { event.preventDefault(); onPreview?.(frame.video_id, frame.frame_id); }}
                  className="relative aspect-video cursor-zoom-in overflow-hidden"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onZoom?.(getImageUrl(frame.url || frame.frame_name || frame.filepath));
                    }
                  }}
                  aria-label={`Zoom frame ${frame.frame_name || index + 1}`}
                >
                  <img src={getImageUrl(frame.url || frame.frame_name || frame.filepath)} alt={frame.frame_name || 'Selected frame'} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]" loading="lazy" />
                  <span className="absolute left-2 top-2 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">#{index + 1}{frame.critic_score != null ? ` · match ${frame.critic_score}` : ''}</span>
                  {locked && <span className="absolute right-2 top-2 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] text-black"><i className="fas fa-lock" /></span>}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent px-2 pb-2 pt-8 text-[10px] text-white"><div className="truncate font-mono">{frame.video_id} · {frame.frame_id}</div><div className="truncate opacity-75">{frame.frame_name}</div></div>
                </div>
                <div className="grid grid-cols-4 gap-1 border-t border-slate-700 bg-[#0b1020] p-1.5">
                  <FrameAction icon="fas fa-magnifying-glass-plus" label="Zoom" onClick={() => onZoom?.(getImageUrl(frame.url || frame.frame_name || frame.filepath))} />
                  <FrameAction icon="fas fa-film" label="Video" onClick={() => onPreview?.(frame.video_id, frame.frame_id)} accent="hover:border-cyan-400/60 hover:text-cyan-200" />
                  <FrameAction icon="fas fa-layer-group" label="Context" onClick={() => onContext?.({ ...frame, contextView: 'neighbors' })} accent="hover:border-violet-400/60 hover:text-violet-200" />
                  <FrameAction icon="fas fa-camera" label="Search" onClick={() => { onClose(); onQuickSearch?.(frame); }} accent="hover:border-fuchsia-400/60 hover:text-fuchsia-200" />
                  <FrameAction icon={`fas ${locked ? 'fa-lock' : 'fa-lock-open'}`} label={locked ? 'Unlock' : 'Lock'} active={locked} onClick={() => onToggleLock?.(frame)} />
                  <FrameAction icon="fas fa-users" label="Team" onClick={() => onPushToTeam?.(frame)} accent="hover:border-blue-400/60 hover:text-blue-200" />
                  <FrameAction icon="fas fa-thumbtack" label="Trake" onClick={() => onPushToTrake?.(frame)} accent="hover:border-rose-400/60 hover:text-rose-200" />
                  <FrameAction icon="fas fa-paper-plane" label="DRES" onClick={() => onDresSubmit?.(frame)} accent="hover:border-emerald-400/60 hover:text-emerald-200" />
                </div>
              </article>;
            })}
          </div>
        )}
      </main>
      <footer className="hidden shrink-0 border-t border-slate-700 bg-[#0b1020] px-4 py-2 text-center text-[10px] text-slate-400 sm:block">Sorted by critic relevance · Drag a frame or use its action bar · Click image: zoom · Right click image: video preview</footer>
    </div>
  );
}
