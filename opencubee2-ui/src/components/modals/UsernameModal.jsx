import React, { useState } from 'react';

export default function UsernameModal({ onJoin }) {
  const [name, setName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) onJoin(name.trim());
  };

  return (
    <div className="fixed inset-0 bg-black/85 z-[3000] flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] w-full max-w-[340px] rounded-lg shadow-[var(--shadow-heavy)] overflow-hidden flex flex-col backdrop-blur-md animate-scaleIn">
        <div className="px-6 py-5 border-b border-[var(--border-color)] bg-[var(--glass-bg)] flex flex-col items-center gap-3">
          <div className="h-16 w-16 flex items-center justify-center flex-shrink-0 animate-float drop-shadow-lg">
            <img src="/logo2.png" alt="Logo" className="h-full w-full object-contain" />
          </div>
          <h2 className="text-base font-bold text-center text-[var(--text-primary)]">Welcome to OpenCubee_2</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          <p className="text-xs text-[var(--text-secondary)]">Please enter your name to join the session.</p>
          <input
            type="text"
            className="w-full px-3 py-2.5 bg-[var(--glass-bg)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-lg text-xs focus:outline-none focus:border-[var(--accent-primary)] placeholder:text-[var(--text-secondary)]"
            placeholder="Your Name..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
          <button
            type="submit"
            className="w-full bg-[var(--text-primary)] text-[var(--bg-primary)] font-semibold text-xs py-3 rounded-lg hover:bg-[var(--accent-secondary)] hover:shadow-glow hover:-translate-y-0.5 active:scale-95 active:translate-y-0 transition-all duration-300 ease-smooth cursor-pointer"
          >
            Join Session
          </button>
        </form>
      </div>
    </div>
  );
}
