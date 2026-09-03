import React, { useState, useEffect, useRef } from 'react';
import { getImageUrl } from '../../utils/imageUrl';

export default function QAModal({ shot, trigger, onClose, onSubmit }) {
  const [qaAnswer, setQaAnswer] = useState('');
  const [isOpen, setIsOpen] = useState(true);
  const inputRef = useRef(null);

  const frameUrl = shot ? (getImageUrl(shot.url || shot.frame_name || shot.filepath) || shot.url) : null;
  const frameName = shot?.frame_name || shot?.name || shot?.video_id || 'Selected Frame';
  const videoId = shot?.video_id || '';
  const frameIdx = shot?.frame_id || '';

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    setIsOpen(true);
  }, [shot, trigger]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!qaAnswer.trim()) return;
    onSubmit(qaAnswer.trim());
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[9999] flex justify-end px-4 sm:px-6">
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        <div className={`w-[min(380px,calc(100vw-2rem))] origin-bottom-right overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-heavy)] backdrop-blur-md transition-all duration-300 ${isOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-8 opacity-0'}`}>
          <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--glass-bg)] px-3 py-2">
            <div className="flex items-center gap-2">
              <i className="fas fa-comment-dots text-emerald-500" />
              <span className="text-xs font-bold text-[var(--text-primary)]">QA Answer</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]"
            >
              <i className="fas fa-chevron-down text-[10px]" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-3">
            {shot && (
              <div className="flex items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                {frameUrl ? (
                  <img
                    src={frameUrl}
                    alt={frameName}
                    className="h-14 w-24 shrink-0 rounded-md border border-white/10 object-cover shadow-sm"
                    onError={(e) => { e.target.onerror = null; e.target.src = '/fallback-image.png'; }}
                  />
                ) : (
                  <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-md bg-white/5 border border-white/10 text-[10px] text-[var(--text-secondary)]">
                    No Image
                  </div>
                )}
                <div className="flex flex-col min-w-0 leading-tight">
                  <span className="text-[11px] font-semibold text-[var(--text-primary)] truncate" title={frameName}>
                    {frameName}
                  </span>
                  {videoId && (
                    <span className="text-[10px] text-[var(--text-secondary)] truncate mt-0.5">
                      Video: <span className="font-mono text-[var(--text-primary)]">{videoId}</span>
                    </span>
                  )}
                  {frameIdx && (
                    <span className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                      Frame: <span className="font-mono text-emerald-400">{frameIdx}</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            <label className="text-[11px] text-[var(--text-secondary)]" htmlFor="qa-answer">
              Enter your answer
            </label>
            <input
              id="qa-answer"
              ref={inputRef}
              type="text"
              className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none"
              placeholder="Answer..."
              value={qaAnswer}
              onChange={(e) => setQaAnswer(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              required
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-[var(--text-secondary)]">Push to Submission Panel</span>
              <button
                type="submit"
                disabled={!qaAnswer.trim()}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white transition-all hover:bg-emerald-500 hover:shadow-glow active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Submit
              </button>
            </div>
          </form>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((previous) => !previous)}
          className={`flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold shadow-lg transition-all hover:-translate-y-0.5 ${isOpen ? 'border-emerald-400/50 bg-emerald-600 text-white' : 'border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] hover:border-emerald-400/50'}`}
        >
          {frameUrl && (
            <img src={frameUrl} alt="Thumbnail" className="h-5 w-5 rounded-full object-cover border border-white/30" />
          )}
          <i className="fas fa-comment-dots" />
          <span>QA Answer</span>
          <i className={`fas fa-chevron-up text-[9px] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  );
}
