import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { getSimilarFrames, BASE_URL } from '../../api';
import { getImageUrl } from '../../utils/imageUrl';

export default function GlobalFilterModal({ onClose, onAddClick, onUpdate }) {
  const [sources, setSources] = useState({});
  const [loading, setLoading] = useState(true);
  
  // State for viewing duplicates of a specific source
  const [selectedSource, setSelectedSource] = useState(null);
  const [duplicates, setDuplicates] = useState([]);
  const [loadingDuplicates, setLoadingDuplicates] = useState(false);

  const fetchBlacklist = async () => {
    try {
      const baseUrl = BASE_URL || '';
      const res = await fetch(`${baseUrl}/blacklist`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        setSources(data.sources_data || {});
      }
    } catch (err) {
      console.error("Failed to fetch blacklist:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBlacklist();
  }, []);

  const handleDelete = async (e, frameName) => {
    e.stopPropagation();
    try {
      const baseUrl = BASE_URL || '';
      const res = await fetch(`${baseUrl}/blacklist/${encodeURIComponent(frameName)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        toast.success(`Removed ${frameName} from blacklist`);
        fetchBlacklist();
        if (selectedSource === frameName) {
          setSelectedSource(null);
        }
        if (onUpdate) onUpdate();
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(`Failed to remove item: ${errData.detail || res.status}`);
      }
    } catch (err) {
      toast.error(`Error removing item: ${err.message}`);
      console.error(err);
    }
  };

  const handleViewDuplicates = async (frameName) => {
    setSelectedSource(frameName);
    setLoadingDuplicates(true);
    setDuplicates([]);
    try {
      const data = await getSimilarFrames(frameName, 1000, 0.99);
      if (data && data.results) {
        setDuplicates(data.results);
      }
    } catch (err) {
      toast.error("Failed to load duplicates");
      console.error(err);
    } finally {
      setLoadingDuplicates(false);
    }
  };
  
  const getSafeImageUrl = (fname) => {
    if (!fname) return '';
    const nameWithExt = fname.includes('.') ? fname : `${fname}.webp`;
    return getImageUrl(nameWithExt);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      {/* Dynamic blurred backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fadeIn duration-300"
        onClick={onClose}
      />
      
      {/* Modal Container */}
      <div className="relative w-full max-w-5xl bg-[#111216]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_0_80px_rgba(239,68,68,0.15)] flex flex-col overflow-hidden animate-scaleIn">
        
        {/* Glow Effects */}
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-red-500/20 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="absolute -bottom-40 -right-40 w-80 h-80 bg-orange-500/10 rounded-full blur-[100px] pointer-events-none"></div>

        {/* Header */}
        <div className="relative px-8 py-5 border-b border-white/10 flex justify-between items-center bg-white/5">
          <div className="flex flex-col">
            <h2 className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-400 tracking-wider flex items-center gap-3">
              {selectedSource ? (
                <button 
                  onClick={() => setSelectedSource(null)}
                  className="hover:text-white text-slate-300 transition-colors"
                  title="Back to Blacklist"
                >
                  <i className="fas fa-arrow-left drop-shadow-md"></i> 
                </button>
              ) : (
                <i className="fas fa-ban text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]"></i>
              )}
              {selectedSource ? 'VIEWING HIDDEN FRAMES' : 'GLOBAL BLACKLIST'}
            </h2>
            <p className="text-[11px] text-slate-400 font-medium mt-1">
              {selectedSource 
                ? `Showing frames hidden because they are ≥ 0.99 similar to ${selectedSource}`
                : 'Select frames to permanently hide them (and their ≥ 0.99 duplicates) for all users.'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {!selectedSource && (
              <button 
                onClick={() => {
                  onClose();
                  onAddClick();
                }}
                className="group relative overflow-hidden bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-orange-500 text-white text-sm px-5 py-2.5 rounded-lg font-bold transition-all duration-300 shadow-[0_4px_20px_rgba(239,68,68,0.4)] hover:shadow-[0_6px_25px_rgba(239,68,68,0.6)] hover:-translate-y-0.5 active:translate-y-0"
              >
                <span className="relative z-10 flex items-center gap-2">
                  <i className="fas fa-crosshairs group-hover:rotate-90 transition-transform duration-300"></i> 
                  ENTER SELECTION MODE
                </span>
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></div>
              </button>
            )}
            <button 
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors duration-200" 
              onClick={onClose}
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="relative p-8 flex flex-col gap-6 overflow-y-auto max-h-[75vh] custom-scrollbar">
          {selectedSource ? (
            // Duplicates Viewer View
            loadingDuplicates ? (
              <div className="flex flex-col justify-center items-center py-20 gap-4">
                <div className="relative w-12 h-12">
                  <div className="absolute inset-0 border-4 border-orange-500/20 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-orange-500 rounded-full border-t-transparent animate-spin"></div>
                </div>
                <p className="text-slate-400 text-sm font-medium animate-pulse">Finding hidden duplicates...</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                {duplicates.map((dup, idx) => (
                  <div 
                    key={idx} 
                    className="relative bg-[#1a1c23] rounded-lg overflow-hidden border border-white/10 shadow-lg hover:border-orange-500/50 transition-colors"
                  >
                    <div className="aspect-video w-full bg-black/80">
                      <img 
                        src={getSafeImageUrl(dup.frame_name)} 
                        alt={dup.frame_name}
                        className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm p-1.5 flex justify-between items-center">
                      <span className="text-[9px] font-bold text-white truncate max-w-[70%]" title={dup.frame_name}>
                        {dup.frame_name}
                      </span>
                      <span className="text-[9px] text-orange-400 font-bold">
                        {(dup.score * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            // Main Blacklist View
            loading ? (
              <div className="flex flex-col justify-center items-center py-20 gap-4">
                <div className="relative w-12 h-12">
                  <div className="absolute inset-0 border-4 border-red-500/20 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-red-500 rounded-full border-t-transparent animate-spin"></div>
                </div>
                <p className="text-slate-400 text-sm font-medium animate-pulse">Loading blacklist data...</p>
              </div>
            ) : Object.keys(sources).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-500">
                <div className="relative mb-6 group">
                  <div className="absolute inset-0 bg-red-500/20 blur-xl rounded-full group-hover:bg-red-500/30 transition-colors duration-500"></div>
                  <i className="fas fa-shield-alt text-6xl relative z-10 text-slate-700 drop-shadow-md group-hover:scale-110 transition-transform duration-500"></i>
                </div>
                <h3 className="text-xl font-bold text-slate-300 mb-2">No Frames Blacklisted</h3>
                <p className="text-sm max-w-md text-center text-slate-400">
                  Your search results are completely unfiltered. Click the button above to start hiding irrelevant frames.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
                {Object.values(sources).map((item, idx) => (
                  <div 
                    key={item.frame_name} 
                    onClick={() => handleViewDuplicates(item.frame_name)}
                    className="group relative bg-[#1a1c23] rounded-xl overflow-hidden border border-white/5 hover:border-red-500/50 shadow-lg hover:shadow-[0_8px_30px_rgba(239,68,68,0.2)] transition-all duration-300 hover:-translate-y-1 cursor-pointer"
                    style={{ animationDelay: `${idx * 50}ms` }}
                  >
                    <div className="aspect-video w-full bg-black/80 overflow-hidden relative">
                      <img 
                        src={getSafeImageUrl(item.frame_name)} 
                        alt={item.frame_name}
                        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#1a1c23] via-transparent to-transparent opacity-80"></div>
                    </div>
                    
                    <div className="p-3 relative z-10">
                      <p className="text-[11px] font-bold text-slate-200 truncate" title={item.frame_name}>
                        {item.frame_name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                        <p className="text-[10px] text-slate-400 font-medium">
                          Hiding <strong className="text-red-400">{item.count_banned || 0}</strong> duplicates
                        </p>
                      </div>
                      <div className="mt-2 text-[9px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex justify-center items-center gap-1 font-bold">
                        <i className="fas fa-search-plus"></i> CLICK TO VIEW
                      </div>
                    </div>
                    
                    <button 
                      onClick={(e) => handleDelete(e, item.frame_name)}
                      className="absolute top-2 right-2 bg-black/60 backdrop-blur-md hover:bg-red-600 text-white w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 -translate-y-2 group-hover:translate-y-0 transition-all duration-300 shadow-md z-20"
                      title="Restore this frame"
                    >
                      <i className="fas fa-trash-restore text-xs"></i>
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
