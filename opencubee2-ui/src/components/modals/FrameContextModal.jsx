// src/components/modals/FrameContextModal.jsx
import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { getImageUrl } from '../../utils/imageUrl'; // Import URL builder helper
import { BASE_URL } from '../../api';

export default function FrameContextModal({ shotData, onClose, onZoom, onPreview, socket, username, userColor, onSubmitDres, onContext, onQuickSearch }) {
  const [neighbors, setNeighbors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hoveredShot, setHoveredShot] = useState(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        if (e.shiftKey) {
          if (hoveredShot && onSubmitDres) {
            onSubmitDres(hoveredShot);
          }
        } else {
          if (hoveredShot) {
            pushToTeam(hoveredShot);
            toast.success('Sent to Team!');
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hoveredShot, onSubmitDres, onClose]);

  useEffect(() => {
    const fetchNeighbors = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${BASE_URL}/check_temporal_frames`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base_frame_name: shotData.frame_name })
        });
        if (!response.ok) throw new Error("Failed to load context frames");
        const filenames = await response.json();
        
        const mapped = filenames.map(fname => {
          const frame_id_match = fname.match(/_(\d+)\.[^.]+$/);
          const frameId = frame_id_match ? parseInt(frame_id_match[1], 10) : null;
          return {
            frame_name: fname,
            frame_id: frameId,
            video_id: shotData.video_id,
            shot_id: shotData.shot_id,
            filepath: fname,
            url: getImageUrl(fname) 
          };
        });
        setNeighbors(mapped);
      } catch (e) {
        console.error("Error checking temporal frames:", e);
        toast.error("Error loading neighboring frames");
      } finally {
        setLoading(false);
      }
    };
    fetchNeighbors();
  }, [shotData]);

  const pushToTeam = (shot) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: 'new_frame',
          data: { shot, user: { name: username, color: userColor } },
        })
      );
    }
  };

  const pushToTrake = (shot) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: 'trake_add',
          data: { shot },
        })
      );
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-[2000] flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg w-[95vw] max-h-[90vh] flex flex-col overflow-hidden shadow-[var(--shadow-heavy)]">
        
        <div className="px-6 py-4 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--glass-bg)]">
          <h2 className="text-sm font-bold text-[var(--accent-primary)] uppercase tracking-wider flex items-center gap-2">
            <i className="fas fa-layer-group"></i> 
            Frame Context – Video: <span className="font-mono text-[var(--text-primary)]">{shotData.video_id}</span>, Frame: <span className="font-mono text-[var(--text-primary)]">{shotData.frame_id}</span>
          </h2>
          <span 
            className="text-lg cursor-pointer text-[var(--text-secondary)] hover:text-red-500 hover:rotate-90 duration-200" 
            onClick={onClose}
          >
            &times;
          </span>
        </div>

        <div className="p-6 overflow-y-auto flex-grow">
          {loading ? (
            <div className="flex items-center justify-center text-[var(--accent-primary)] text-xs py-20 gap-2 animate-pulse">
              <i className="fas fa-spinner fa-spin text-sm"></i> Checking available frames...
            </div>
          ) : neighbors.length === 0 ? (
            <p className="text-center text-[var(--text-secondary)] py-20 italic">No context frames found.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {neighbors.map((shot, idx) => {
                const offset = shot.frame_id - shotData.frame_id;
                const isCenter = offset === 0;
                const labelText = offset > 0 ? `+${offset}` : `${offset}`;

                return (
                  <div
                    key={idx}
                    className={`relative bg-[var(--card-bg)] rounded-xl overflow-hidden border aspect-video cursor-zoom-in hover:scale-[1.03] transition-all duration-200 group ${
                      isCenter 
                        ? 'border-[var(--accent-purple)] shadow-[0_0_15px_rgba(102,126,234,0.6)]' 
                        : 'border-[var(--border-color)] hover:border-[var(--accent-primary)]'
                    }`}
                    onClick={(e) => {
                      if (e.ctrlKey && e.shiftKey && onQuickSearch) {
                        onQuickSearch(shot);
                        onClose();
                      } else if (e.ctrlKey && onContext) {
                        onContext(shot);
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
                    <img src={getImageUrl(shot.url || shot.frame_name || shot.filepath)} className="w-full h-full object-cover" alt="Context result" onError={(e) => { e.target.onerror = null; e.target.src = '/fallback-image.png'; }} />
                    
                    <div className="absolute top-2 left-2 bg-black/80 text-white px-2 py-0.5 rounded text-[10px] font-bold z-10">
                      {isCenter ? 'Original' : labelText}
                    </div>

                    <div className="absolute inset-0 bg-slate-950/0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20">
                      {onSubmitDres && (
                        <button
                          className="absolute top-1.5 right-1.5 w-9 h-9 rounded-lg bg-slate-900/90 border border-white/10 text-white flex items-center justify-center text-xs hover:bg-blue-500 hover:border-transparent hover:scale-110 duration-150 cursor-pointer pointer-events-auto"
                          onClick={(e) => { e.stopPropagation(); onSubmitDres(shot); }}
                          title="Submit to DRES"
                        >
                          <i className="fas fa-paper-plane"></i>
                        </button>
                      )}
                      <button 
                        className="absolute bottom-1.5 left-1.5 w-9 h-9 rounded-lg bg-slate-900/90 border border-white/10 text-white flex items-center justify-center text-xs hover:bg-slate-700 hover:border-transparent hover:scale-110 duration-150 cursor-pointer pointer-events-auto"
                        onClick={(e) => { e.stopPropagation(); pushToTeam(shot); }} 
                        title="Send to Team"
                      >
                        <i className="fas fa-users"></i>
                      </button>
                      <button 
                        className="absolute bottom-1.5 right-1.5 w-9 h-9 rounded-lg bg-slate-900/90 border border-white/10 text-white flex items-center justify-center text-xs hover:bg-slate-700 hover:border-transparent hover:scale-110 duration-150 cursor-pointer pointer-events-auto"
                        onClick={(e) => { e.stopPropagation(); pushToTrake(shot); }} 
                        title="Pin to Trake"
                      >
                        <i className="fas fa-thumbtack"></i>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--border-color)] text-center text-xs text-[var(--text-secondary)] bg-[var(--glass-bg)]">
          Shortcuts: Click to zoom. Ctrl+Click to view context of frame. Right-click to open video preview. Hover over any frame for action options (Ctrl+Shift+Space to submit DRES, Ctrl+Space to Send to Team).
        </div>

      </div>
    </div>
  );
}
