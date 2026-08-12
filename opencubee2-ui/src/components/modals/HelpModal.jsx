import React from 'react';

const SHORTCUTS = [
  { label: 'Zoom Image', keys: 'Click' },
  { label: 'Open Video Preview', keys: 'Right-Click' },
  { label: 'Find Context / Neighboring Frames', keys: 'Ctrl/Cmd + Click' },
  { label: 'Quick Search via Image', keys: 'Ctrl/Cmd + Shift + Click' },
  { label: 'Lock / Unlock Video Search', keys: 'Alt + Click' },
  { label: 'Push / Remove Hovered Teamwork Frame', keys: 'Hover, then Ctrl + Space' },
  { label: 'Focus OCR Filter', keys: 'Alt + T' },
  { label: 'Focus ASR Filter', keys: 'Alt + Y' },
  { label: 'Toggle MetaCLIP Only', keys: 'Alt + M' },
  { label: 'Toggle Latest Cell Image Mode', keys: 'Alt + I' },
  { label: 'Toggle Enhance On Search', keys: 'Ctrl + E' },
  { label: 'Add Temporal Search Cell', keys: 'Alt + +' },
  { label: 'Remove Latest Temporal Cell', keys: 'Alt + -' },
  { label: 'Go Back One Search Step', keys: 'Ctrl + Left' },
  { label: 'Go Forward One Search Step', keys: 'Ctrl + Right' },
  { label: 'Reset Search Panel', keys: 'Alt + R' },
  { label: 'Execute Search Panel', keys: 'Enter' },
];

export default function HelpModal({ onClose }) {
  return (
    <div
      className="fixed inset-0 bg-black/85 z-[3000] flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-[var(--card-bg)] border border-[var(--border-color)] w-full max-w-[640px] max-h-[85vh] rounded-lg shadow-[var(--shadow-heavy)] flex flex-col overflow-hidden backdrop-blur-md animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — stays fixed while the list scrolls */}
        <div className="px-6 py-4 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--glass-bg)] flex-shrink-0">
          <h2 className="text-sm font-bold text-[var(--accent-primary)] uppercase tracking-wider flex items-center gap-2">
            <i className="fas fa-keyboard"></i> Keyboard Shortcuts
          </h2>
          <span
            className="text-lg cursor-pointer text-[var(--text-secondary)] hover:text-red-500 hover:rotate-90 inline-flex w-7 h-7 items-center justify-center rounded-lg hover:bg-red-500/10 transition-all duration-300"
            onClick={onClose}
          >
            &times;
          </span>
        </div>

        {/* Scrollable body — two columns on wider screens, one on mobile */}
        <div className="p-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1">
          {SHORTCUTS.map(({ label, keys }) => (
            <div
              key={label}
              className="flex justify-between items-center gap-3 border-b border-[var(--border-color)]/60 py-2.5"
            >
              <span className="text-[13px] text-[var(--text-primary)] leading-snug">{label}</span>
              <kbd className="flex-shrink-0 whitespace-nowrap bg-[var(--glass-bg)] border border-[var(--border-color)] px-2 py-1 rounded text-[11px] font-mono text-[var(--text-primary)] shadow-sm">
                {keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
