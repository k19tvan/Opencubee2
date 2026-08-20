import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getImageUrl } from '../../utils/imageUrl';

export default function QASubmitModal({ 
  onClose, 
  shot,
  onSubmit
}) {
  const [qaAnswer, setQaAnswer] = useState('');
  const [isOpen, setIsOpen] = useState(true);
  const inputRef = useRef(null);

  const frameUrl = shot ? (getImageUrl(shot.url || shot.frame_name || shot.filepath) || shot.url) : null;
  const frameName = shot?.frame_name || shot?.name || shot?.video_id || 'Selected Frame';
  const videoId = shot?.video_id || '';
  const frameIdx = shot?.frame_idx !== undefined ? shot?.frame_idx : shot?.frame_number;

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    setIsOpen(true);
  }, [shot]);

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
    
    if (onSubmit) {
      onSubmit(shot, qaAnswer.trim());
    }
  };

  const modalContent = (
    <div className="pointer-events-none fixed inset-0 z-[9999] flex items-end justify-end p-6">
      {!isOpen ? (
        <div className="pointer-events-auto">
          <button 
            onClick={() => setIsOpen(true)}
            className="px-4 py-2 bg-emerald-500/90 hover:bg-emerald-500 text-white font-bold rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all text-xs flex items-center gap-2 border border-emerald-400"
          >
            <i className="fas fa-comment-dots shadow-sm"></i> Resume QA Prompt
          </button>
        </div>
      ) : (
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        <div className={`w-[min(380px,calc(100vw-2rem))] origin-bottom-right overflow-hidden rounded-xl border border-white/10 bg-[#1e1e1e] shadow-2xl transition-all duration-300 ${isOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-8 opacity-0'}`}>
          <div className="flex items-center justify-between border-b border-white/5 bg-[#2a2a2a] px-3 py-2">
            <div className="flex items-center gap-2">
              <i className="fas fa-comment-dots text-emerald-500" />
              <span className="text-xs font-bold text-white">QA Question Prompt</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Minimize QA submission"
            >
              <i className="fas fa-minus text-[10px]" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-3">
            {shot && (
              <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-[#252525] p-2">
                {frameUrl ? (
                  <img
                    src={frameUrl}
                    alt={frameName}
                    className="h-14 w-24 shrink-0 rounded-md border border-white/10 object-cover shadow-sm"
                    onError={(e) => { e.target.onerror = null; e.target.src = '/fallback-image.png'; }}
                  />
                ) : (
                  <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-md bg-white/5 border border-white/10 text-[10px] text-white/50">
                    No Image
                  </div>
                )}
                <div className="flex flex-col min-w-0 leading-tight">
                  <span className="text-[11px] font-semibold text-white/90 truncate" title={frameName}>
                    {frameName}
                  </span>
                  {videoId && (
                    <span className="text-[10px] text-white/50 truncate mt-0.5">
                      Video: <span className="font-mono text-white/80">{videoId}</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            <label className="text-[11px] text-white/70" htmlFor="dres-qa-answer">
              Enter QA Answer for this frame:
            </label>
            <input
              id="dres-qa-answer"
              ref={inputRef}
              type="text"
              className="w-full rounded-lg border border-white/10 bg-[#2a2a2a] px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
              placeholder="Your answer..."
              value={qaAnswer}
              onChange={(e) => setQaAnswer(e.target.value)}
              required
            />
            <div className="flex items-center justify-between gap-3 mt-1">
              <span className="text-[10px] text-white/50">Submitted alongside the frame.</span>
              <div className="flex gap-2">
                <button
                   type="button"
                   onClick={onClose}
                   className="rounded-lg bg-zinc-600 px-3 py-2 text-[11px] font-semibold text-white transition-all hover:bg-zinc-500 active:scale-95"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!qaAnswer.trim()}
                  className="rounded-lg bg-emerald-500 px-3 py-2 text-[11px] font-semibold text-white transition-all hover:bg-emerald-600 hover:shadow-glow active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  autoFocus
                >
                  Submit QA
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
      )}
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
}
