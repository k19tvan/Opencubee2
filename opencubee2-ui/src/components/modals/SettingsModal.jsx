// src/components/modals/SettingsModal.jsx
import React from 'react';

export default function SettingsModal({
  isOpen,
  onClose,
  asrSearchMode,
  setAsrSearchMode,
  meilisearchWeight,
  setMeilisearchWeight,
  milvusWeight,
  setMilvusWeight,
  theme,
}) {
  if (!isOpen) return null;

  const handleMeiliSlider = (val) => {
    const meili = parseFloat(val);
    setMeilisearchWeight(meili);
    setMilvusWeight(parseFloat((1 - meili).toFixed(2)));
  };

  const handleMilvusSlider = (val) => {
    const milvus = parseFloat(val);
    setMilvusWeight(milvus);
    setMeilisearchWeight(parseFloat((1 - milvus).toFixed(2)));
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn">
      <div className={`relative w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl overflow-hidden p-5 flex flex-col gap-4 text-[var(--text-primary)] ${theme === 'jujutsu' ? 'bg-[#18112e] border-purple-500/40' : ''}`}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]">
              <i className="fas fa-sliders text-sm"></i>
            </div>
            <div>
              <h3 className="font-bold text-sm">Search Settings & Fusion Weights</h3>
              <p className="text-[10px] text-[var(--text-secondary)]">Cấu hình trọng số RRF cho Semantic ASR</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)] transition-colors"
          >
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        {/* Search Mode for Semantic ASR */}
        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
            Semantic ASR Search Mode
          </label>
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[var(--card-bg)] border border-[var(--border-color)]">
            {[
              { mode: 'meilisearch', label: 'Meilisearch', icon: 'fas fa-align-left' },
              { mode: 'hybrid', label: 'RRF Fusion', icon: 'fas fa-layer-group' },
              { mode: 'embedding', label: 'Milvus (Qwen)', icon: 'fas fa-brain' },
            ].map(({ mode, label, icon }) => {
              const active = asrSearchMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAsrSearchMode(mode)}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    active
                      ? 'bg-[var(--accent-primary)] text-[var(--bg-primary)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg)]'
                  }`}
                >
                  <i className={`${icon} text-[10px]`}></i>
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed italic">
            * Lưu ý: Sentence level Semantic ASR luôn tự động sử dụng Meilisearch.
          </p>
        </div>

        {/* Fusion Weights Sliders (Active when Hybrid / RRF Fusion is selected) */}
        {asrSearchMode === 'hybrid' && (
          <div className="flex flex-col gap-3.5 p-3.5 rounded-xl bg-[var(--card-bg)] border border-[var(--border-color)] animate-fadeIn">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <i className="fas fa-scale-balanced text-[var(--accent-primary)]"></i> RRF Fusion Weights
              </span>
              <span className="text-[10px] font-mono text-[var(--text-secondary)]">
                Total: {Math.round((meilisearchWeight + milvusWeight) * 100)}%
              </span>
            </div>

            {/* Meilisearch Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-secondary)] flex items-center gap-1">
                  <i className="fas fa-file-lines text-amber-400"></i> Meilisearch (Lexical)
                </span>
                <span className="font-bold font-mono text-[var(--accent-primary)]">
                  {Math.round(meilisearchWeight * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={meilisearchWeight}
                onChange={(e) => handleMeiliSlider(e.target.value)}
                className="w-full accent-[var(--accent-primary)] cursor-pointer h-1.5 bg-slate-700 rounded-lg"
              />
            </div>

            {/* Milvus Qwen Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-secondary)] flex items-center gap-1">
                  <i className="fas fa-microchip text-violet-400"></i> Milvus Qwen3 (Vector)
                </span>
                <span className="font-bold font-mono text-[var(--accent-primary)]">
                  {Math.round(milvusWeight * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={milvusWeight}
                onChange={(e) => handleMilvusSlider(e.target.value)}
                className="w-full accent-[var(--accent-primary)] cursor-pointer h-1.5 bg-slate-700 rounded-lg"
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-[var(--border-color)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[var(--accent-primary)] text-[var(--bg-primary)] font-bold text-xs hover:opacity-90 transition-opacity"
          >
            Đã xong
          </button>
        </div>
      </div>
    </div>
  );
}
