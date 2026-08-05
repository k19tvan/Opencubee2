import React, { useState } from 'react';

export default function ObjectFilterModal({ onClose }) {
  const [enableCountFilter, setEnableCountFilter] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/85 z-[1000] flex items-center justify-center p-4 backdrop-blur-[2px] animate-fadeIn">
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] w-full max-w-[800px] max-h-[80vh] rounded-lg shadow-[var(--shadow-heavy)] flex flex-col overflow-hidden backdrop-blur-md animate-scaleIn">
        <div className="px-6 py-4 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--glass-bg)]">
          <h2 className="text-sm font-bold text-[var(--accent-primary)] uppercase tracking-wider flex items-center gap-2">
            <i className="fas fa-shapes"></i> Object Filters
          </h2>
          <span 
            className="text-lg cursor-pointer text-[var(--text-secondary)] hover:text-red-500 hover:rotate-90 duration-200" 
            onClick={onClose}
          >
            &times;
          </span>
        </div>
        
        <div className="p-6 flex flex-col gap-5 overflow-y-auto">
          <div className="flex flex-col">
            <div className="flex items-center gap-4 mb-4 pb-2 border-b border-[var(--border-color)]">
              <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Object Counting</h3>
              <label className="relative inline-block w-9 h-5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={enableCountFilter}
                  onChange={() => setEnableCountFilter(!enableCountFilter)}
                  className="peer opacity-0 w-0 h-0"
                />
                <span className="absolute inset-0 bg-slate-500 rounded-full transition-colors duration-200 peer-checked:bg-[var(--accent-primary)] after:absolute after:content-[''] after:h-3.5 after:w-4 after:left-0.5 after:bottom-0.75 after:bg-white after:rounded-full after:transition-transform after:duration-200 peer-checked:after:transform peer-checked:after:translateX-[16px]"></span>
              </label>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">Advanced geometric coordinate drawing and quantity configuration.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
