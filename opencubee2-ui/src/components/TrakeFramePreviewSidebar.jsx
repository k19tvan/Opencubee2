import React, { useEffect, useMemo, useState } from 'react';
import { getVideoInfo, getVideoThumbnailUrl } from '../api';
import { getDresFrameNumber } from '../utils/frameNumber';

const CONTEXT_STEPS = 15;
const STEP_SECONDS = 0.2;

export default function TrakeFramePreviewSidebar({ shot, onClose, onZoom }) {
  const [videoInfo, setVideoInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setVideoInfo(null);
    setError('');

    if (!shot?.video_id) {
      setError('This Trake frame has no video information.');
      return undefined;
    }

    getVideoInfo(shot.video_id)
      .then((info) => {
        if (!cancelled) setVideoInfo(info);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load video information.');
      });

    return () => { cancelled = true; };
  }, [shot]);

  const frames = useMemo(() => {
    if (!videoInfo || !shot) return [];
    const fps = Number(videoInfo.fps) || 25;
    const frameCount = Number(videoInfo.frame_count) || 1;
    const originalFrame = getDresFrameNumber(shot);
    const stepFrames = Math.max(1, Math.round(fps * STEP_SECONDS));

    return Array.from({ length: CONTEXT_STEPS * 2 + 1 }, (_, index) => {
      const offset = index - CONTEXT_STEPS;
      const frame = Math.min(Math.max(originalFrame + (offset * stepFrames), 0), frameCount - 1);
      return {
        offset,
        frame,
        isOriginal: offset === 0,
        label: offset === 0 ? 'ORIGINAL' : `${offset > 0 ? '+' : ''}${(offset * STEP_SECONDS).toFixed(1)}s`,
        url: getVideoThumbnailUrl(shot.video_id, frame, 360),
      };
    });
  }, [shot, videoInfo]);

  return (
    <aside className="relative flex h-full w-[340px] max-w-[85vw] flex-shrink-0 flex-col border-l border-[var(--border-color)] bg-[var(--bg-primary)] shadow-[-10px_0_30px_rgba(0,0,0,0.25)] animate-fadeIn">
      <header className="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--glass-bg)] px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[var(--accent-primary)]">
            <i className="fas fa-film"></i> Trake frame preview
          </h2>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
            {shot?.video_id || 'Unknown video'} · 0.2s intervals · ±3.0s
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-white/10 hover:text-white"
          title="Close preview"
          aria-label="Close preview"
        >
          <i className="fas fa-times"></i>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {!videoInfo && !error && (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-[var(--text-secondary)]">
            <i className="fas fa-spinner fa-spin"></i> Loading video frames...
          </div>
        )}
        {error && <p className="py-16 text-center text-xs text-red-400">{error}</p>}
        {frames.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {frames.map((frame) => (
              <button
                type="button"
                key={frame.offset}
                onClick={() => onZoom?.(frame.url)}
                className={`group relative aspect-video overflow-hidden rounded-lg border bg-[var(--card-bg)] text-left transition-all hover:scale-[1.02] ${
                  frame.isOriginal
                    ? 'border-[6px] ring-[6px] ring-slate-100'
                    : 'border-[var(--border-color)] hover:border-[var(--accent-primary)]'
                }`}
                style={frame.isOriginal ? {
                  borderColor: '#d1d5db',
                  boxShadow: '0 0 12px #f8fafc, 0 0 28px #e5e7eb, 0 0 46px #94a3b8',
                } : undefined}
                title={`${frame.label} — video frame ${frame.frame}`}
              >
                <img src={frame.url} alt={frame.label} className="h-full w-full object-cover" loading="lazy" />
                <span className={`absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider z-10 ${
                  frame.isOriginal ? 'bg-black text-white flex items-center justify-center w-fit shadow' : 'bg-black/80 text-white'
                }`}>
                  {frame.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
