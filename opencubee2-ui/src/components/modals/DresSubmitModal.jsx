import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { DRES_BASE_URL } from '../../api';
import { getImageUrl } from '../../utils/imageUrl';

export default function DresSubmitModal({ 
  onClose, 
  shot, 
  sessionId, 
  evaluationId 
}) {
  const [qaAnswer, setQaAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  // Open immediately when QA is triggered from a selected frame so the user
  // can start typing without an extra click.
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
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!sessionId || !evaluationId) {
      toast.error('DRES is not logged in.');
      return;
    }

    if (!shot || !qaAnswer.trim()) {
      toast.error('Please provide an answer for QA.');
      return;
    }

    const payload = {
      answerSets: [{
        answers: [{
          // QA accepts the answer verbatim; it must not be decorated with
          // frame, timestamp, or mode metadata.
          text: qaAnswer.trim()
        }]
      }]
    };

    setLoading(true);
    const loadingToast = toast.loading('Submitting QA to DRES...');
    try {
      const res = await fetch(`${DRES_BASE_URL}/api/v2/submit/${evaluationId}?session=${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        priority: 'high'
      });
      
      const resText = await res.text();
      if (!res.ok) {
        throw new Error(resText || res.statusText);
      }
      
      let resData = {};
      try { resData = JSON.parse(resText); } catch(err) {}

      if (resData.submission === 'CORRECT') {
         toast.success('QA Submit CORRECT!', { id: loadingToast });
         // Send a custom event to App.jsx to clear teamworkFrames and push this shot
         window.dispatchEvent(new CustomEvent('dres-qa-correct', { detail: { shot } }));
      } else {
         toast.success(`QA Submitted: ${resData.submission || 'OK'}`, { id: loadingToast });
      }
      onClose();
    } catch (error) {
      console.error('DRES Submit Error:', error);
      toast.error(error.message || 'Failed to submit QA to DRES', { id: loadingToast });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[3000] flex justify-end px-4 sm:px-6">
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        <div className={`w-[min(380px,calc(100vw-2rem))] origin-bottom-right overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-heavy)] backdrop-blur-md transition-all duration-300 ${isOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-8 opacity-0'}`}>
          <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--glass-bg)] px-3 py-2">
            <div className="flex items-center gap-2">
              <i className="fas fa-comment-dots text-blue-500" />
              <span className="text-xs font-bold text-[var(--text-primary)]">QA Submit to DRES</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]"
              aria-label="Minimize QA submission"
            >
              <i className="fas fa-chevron-down text-[10px]" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-3">
            {/* Selected Frame Thumbnail & Information Preview */}
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
                  {frameIdx !== undefined && frameIdx !== null && (
                    <span className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                      Frame: <span className="font-mono text-emerald-400">{frameIdx}</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            <label className="text-[11px] text-[var(--text-secondary)]" htmlFor="dres-qa-answer">
              Enter your answer
            </label>
            <input
              id="dres-qa-answer"
              ref={inputRef}
              type="text"
              className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              placeholder="Answer..."
              value={qaAnswer}
              onChange={(e) => setQaAnswer(e.target.value)}
              required
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-[var(--text-secondary)]">Submitted exactly as typed.</span>
              <button
                type="submit"
                disabled={loading || !qaAnswer.trim()}
                className="rounded-lg bg-blue-500 px-3 py-2 text-[11px] font-semibold text-white transition-all hover:bg-blue-600 hover:shadow-glow active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? <i className="fas fa-spinner fa-spin" /> : 'Submit'}
              </button>
            </div>
          </form>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((previous) => !previous)}
          className={`flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold shadow-lg transition-all hover:-translate-y-0.5 ${isOpen ? 'border-blue-400/50 bg-blue-500 text-white' : 'border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] hover:border-blue-400/50'}`}
          aria-expanded={isOpen}
          aria-controls="dres-qa-answer"
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

