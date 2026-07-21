import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { getVideoInfo, DRES_BASE_URL } from '../../api';

export default function DresSubmitModal({ 
  onClose, 
  shot, 
  sessionId, 
  evaluationId 
}) {
  const [qaAnswer, setQaAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [fps, setFps] = useState(25);
  const inputRef = useRef(null);

  useEffect(() => {
    if (shot?.video_id) {
      getVideoInfo(shot.video_id).then(info => {
        if (info?.fps) setFps(info.fps);
      }).catch(err => console.error("Failed to fetch FPS", err));
    }
  }, [shot]);

  // Focus input automatically
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const calculateTime = (frameId) => Math.floor((frameId / fps) * 1000);

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

    const videoId = shot?.video_id || '';
    const frameId = shot?.frame_id || 0;
    const timeMs = calculateTime(frameId);

    const payload = {
      answerSets: [{
        answers: [{
          text: `QA-${qaAnswer.trim()}-${videoId}-${timeMs}`
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
    <div className="fixed inset-0 bg-black/85 z-[3000] flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] w-full max-w-[420px] rounded-lg shadow-[var(--shadow-heavy)] overflow-hidden flex flex-col backdrop-blur-md animate-scaleIn relative">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg)] transition-colors z-10"
        >
          <i className="fas fa-times"></i>
        </button>
        <div className="px-6 py-5 border-b border-[var(--border-color)] bg-[var(--glass-bg)] flex flex-col items-center gap-2">
          <div className="text-3xl text-blue-500 mb-1">
            <i className="fas fa-comment-dots"></i>
          </div>
          <h2 className="text-base font-bold text-center text-[var(--text-primary)]">QA Submit to DRES</h2>
        </div>
        
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-5">
          <div className="bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-lg p-3 text-xs text-[var(--text-secondary)]">
            <div className="flex flex-col gap-2">
              <p className="font-semibold text-[var(--text-primary)]">Q&A Submission</p>
              <input
                ref={inputRef}
                type="text"
                className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded text-xs focus:outline-none focus:border-[var(--accent-primary)]"
                placeholder="Enter your answer..."
                value={qaAnswer}
                onChange={(e) => setQaAnswer(e.target.value)}
                required
              />
              <p>Format: QA-&lt;ANSWER&gt;-{shot?.video_id || 'VID'}-{calculateTime(shot?.frame_id || 0)}</p>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !qaAnswer.trim()}
            className="w-full bg-blue-500 text-white font-semibold text-xs py-3 rounded-lg hover:bg-blue-600 hover:shadow-glow hover:-translate-y-0.5 active:scale-95 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <i className="fas fa-spinner fa-spin"></i> : 'Confirm QA Submit'}
          </button>
        </form>
      </div>
    </div>
  );
}
