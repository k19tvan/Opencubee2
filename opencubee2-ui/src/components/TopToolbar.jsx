// src/components/TopToolbar.jsx
import React, { useState, useRef, useEffect } from 'react';
import { SEARCH_MODEL_OPTIONS, DEFAULT_SEARCH_MODEL } from '../App';

// Theme cycle: Dark → Light → Judge (the special emerald theme ported from
// the JudgeResearch dashboard) → back to Dark. Pressing the toggle once more
// past Light turns on the special theme.
const THEME_ORDER = ['normal', 'dark', 'light', 'blue', 'neon', 'random', 'jujutsu'];
const THEME_META = {
  normal: { icon: 'fas fa-circle', label: 'Normal' },
  dark: { icon: 'fas fa-moon', label: 'Dark' },
  light: { icon: 'fas fa-wand-magic-sparkles', label: 'Purple' },
  blue: { icon: 'fas fa-snowflake', label: 'Blue' },
  neon: { icon: 'fas fa-circle-half-stroke', label: 'Static' },
  random: { icon: 'fas fa-shuffle', label: 'Random' },
  jujutsu: { icon: 'fas fa-ghost', label: 'Jujutsu Kaisen' },
};

// Shared button class builders so the theme toggle and every ToolBtn keep the
// exact same shape/style. Hoisted for stable identity across re-renders.
const toolBtnBaseClasses = () =>
  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-medium transition-all duration-200 ease-smooth cursor-pointer select-none hover:-translate-y-0.5 active:scale-95 active:translate-y-0 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:translate-y-0';

const toolBtnStateClasses = (isJJK, active) => isJJK
  ? (active ? 'bg-[var(--accent-primary)] border-[var(--border-hover)] text-white shadow-glow' : 'bg-transparent border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[var(--glass-bg)]')
  : (active
    ? 'bg-[var(--text-primary)] border-[var(--text-primary)] text-[var(--bg-primary)] shadow-glow'
    : 'bg-transparent border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[var(--glass-bg)]');

// Hoisted out of TopToolbar so it keeps a stable component identity across
// renders — otherwise every toolbar render (e.g. dragging a weight slider)
// unmounts and remounts every button.
const ToolBtn = ({ onClick, icon, label, active = false, title = '', disabled = false, theme = '' }) => {
  const isJJK = theme === 'jujutsu';

  const baseClasses = toolBtnBaseClasses();
  const stateClasses = toolBtnStateClasses(isJJK, active);

  return (
    <button
      onClick={onClick}
      title={title || label}
      disabled={disabled}
      data-active={active ? 'true' : 'false'}
      className={`${baseClasses} ${stateClasses}`}
    >
      <i className={`${icon} ${isJJK ? 'text-[14px]' : 'text-xs'}`}></i>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
};

export default function TopToolbar({
  username,
  userColor,
  theme,
  setTheme,
  dresMode,
  setDresMode,
  dresSessionId,
  onLogoutDres,
  onOpenDresLogin,
  showTrake,
  setShowTrake,
  isClustered,
  setIsClustered,
  isAmbiguous,
  setIsAmbiguous,
  onOpenModal,
  onGoBack,
  onGoForward,
  canGoBack,
  canGoForward,
  goBackDepth = 0,
  goForwardDepth = 0,
  onReset,
  onToggleMobileMenu,
  timingInfo = null,
  searchModel,
  setSearchModel,
  autoTranslate,
  setAutoTranslate,
  dresUsername,
  isMuted,
  setIsMuted
}) {
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const themeRef = useRef(null);
  const [isModelsOpen, setIsModelsOpen] = useState(false);
  const modelsRef = useRef(null);
  const [isDresModeOpen, setIsDresModeOpen] = useState(false);
  const dresModeRef = useRef(null);
  const activeThemeMeta = THEME_META[theme] || THEME_META.dark;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (themeRef.current && !themeRef.current.contains(event.target)) {
        setIsThemeOpen(false);
      }
      if (modelsRef.current && !modelsRef.current.contains(event.target)) {
        setIsModelsOpen(false);
      }
      if (dresModeRef.current && !dresModeRef.current.contains(event.target)) {
        setIsDresModeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="fixed top-0 left-0 w-full h-[72px] px-6 flex justify-between items-center bg-[var(--card-bg)] border-b border-[var(--border-color)] backdrop-blur-xl backdrop-saturate-150 z-[100] transition-colors duration-300 animate-slideDown">

      <div className="flex items-center gap-4">
        {/* Mobile menu toggle */}
        <button
          onClick={onToggleMobileMenu}
          className="md:hidden block w-8 h-8 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] flex items-center justify-center hover:bg-[var(--glass-bg)] active:scale-95 transition-all"
        >
          <i className="fas fa-bars"></i>
        </button>


        <div className="flex items-center gap-3 cursor-pointer group">
          <div className="h-16 w-16 flex items-center justify-center flex-shrink-0 transition-all duration-300 ease-spring group-hover:scale-110 group-hover:rotate-6 drop-shadow-lg">
            <img src="/logo2.png" alt="Logo" className="h-full w-full object-contain" />
          </div>
          <div className="leading-tight hidden sm:block transition-transform duration-300 group-hover:translate-x-1 ml-1">
            <div className="text-xl font-semibold text-[var(--text-primary)] tracking-normal">OpenCubee2</div>
            <div className="flex items-center gap-2 text-[11px] font-medium text-[var(--text-secondary)] tracking-normal mt-0.5">
              <span>
                {username
                  ? <span style={{ color: userColor }}>{username}</span>
                  : <span>Guest</span>
                }
              </span>
              {timingInfo && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--glass-bg)] px-2 py-0.5"
                  title="Server time"
                >
                  <i className="fas fa-gauge-high text-[10px] text-[var(--accent-primary)]"></i>
                  <span className="font-mono text-[var(--text-primary)]">
                    {timingInfo.total_request_s?.toFixed(3)}s
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-1.5 items-center flex-wrap">
        <div className="relative flex items-center group" ref={themeRef}>
          <button
            onClick={() => setIsThemeOpen(!isThemeOpen)}
            className={`${toolBtnBaseClasses()} ${toolBtnStateClasses(theme === 'jujutsu', false)} relative pr-8`}
            title="Change theme"
          >
            <i className={`${activeThemeMeta.icon} ${theme === 'jujutsu' ? 'text-[14px]' : 'text-xs'}`}></i>
            <span className="hidden sm:inline">{activeThemeMeta.label}</span>
            <i className={`fas fa-chevron-down absolute right-2.5 ${theme === 'jujutsu' ? 'text-[11px]' : 'text-[9px]'} transition-transform duration-200 ${isThemeOpen ? 'rotate-180' : ''}`}></i>
          </button>

          <div
            className={`absolute top-[calc(100%+6px)] left-0 min-w-[140px] flex flex-col ${theme === 'jujutsu' ? 'rounded-xl overflow-hidden' : 'rounded-lg'} border border-[var(--border-color)] shadow-xl transition-all duration-200 origin-top-left z-50 py-1 ${isThemeOpen ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible'} ${theme === 'jujutsu' ? 'bg-[#5b40c2]' : 'bg-[var(--bg-secondary)]'}`}
          >
            {THEME_ORDER.map(t => (
              <button
                key={t}
                onClick={() => {
                  setTheme(t);
                  setIsThemeOpen(false);
                }}
                className={`text-left px-4 py-2 text-sm transition-colors duration-150 flex items-center gap-2 ${theme === t ? (theme === 'jujutsu' ? 'bg-[#795ceb] text-white font-bold' : 'bg-[var(--glass-bg)] text-[var(--text-primary)] font-semibold') : (theme === 'jujutsu' ? 'text-white hover:bg-[#684dd4]' : 'text-[var(--text-secondary)] hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]')}`}
              >
                {THEME_META[t].label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative flex items-center group" ref={modelsRef}>
          <button
            onClick={() => setIsModelsOpen(!isModelsOpen)}
            className={`${toolBtnBaseClasses()} ${toolBtnStateClasses(theme === 'jujutsu', false)} relative pr-8`}
            title="Select Embedding Models"
          >
            <i className={`fas fa-layer-group ${theme === 'jujutsu' ? 'text-[14px]' : 'text-xs'}`}></i>
            <span className="hidden sm:inline">Models</span>
            <i className={`fas fa-chevron-down absolute right-2.5 ${theme === 'jujutsu' ? 'text-[11px]' : 'text-[9px]'} transition-transform duration-200 ${isModelsOpen ? 'rotate-180' : ''}`}></i>
          </button>

          <div
            className={`absolute top-[calc(100%+6px)] right-0 min-w-[140px] flex flex-col ${theme === 'jujutsu' ? 'rounded-xl overflow-hidden' : 'rounded-lg'} border border-[var(--border-color)] shadow-xl transition-all duration-200 origin-top-right z-50 py-1 ${isModelsOpen ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible'} ${theme === 'jujutsu' ? 'bg-[#5b40c2]' : 'bg-[var(--bg-secondary)]'}`}
          >
            {SEARCH_MODEL_OPTIONS.map((model) => {
              const selectedModels = Array.isArray(searchModel) ? searchModel : DEFAULT_SEARCH_MODEL;
              const active = selectedModels.includes(model.value);
              return (
                <button
                  key={model.value}
                  onClick={() => {
                    const nextModels = active ? selectedModels.filter(m => m !== model.value) : [...selectedModels, model.value];
                    setSearchModel?.(nextModels.length > 0 ? nextModels : DEFAULT_SEARCH_MODEL);
                  }}
                  className={`text-left px-4 py-2 text-sm transition-colors duration-150 flex items-center gap-2 ${active ? (theme === 'jujutsu' ? 'bg-[#795ceb] text-white font-bold' : 'bg-[var(--glass-bg)] text-[var(--text-primary)] font-semibold') : (theme === 'jujutsu' ? 'text-white hover:bg-[#684dd4]' : 'text-[var(--text-secondary)] hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]')}`}
                >
                  <i className={`${model.icon} text-xs w-4 text-center`}></i>
                  <span className="flex-grow">{model.label}</span>
                  {active && <i className="fas fa-check text-[10px]"></i>}
                </button>
              );
            })}
          </div>
        </div>

        <ToolBtn onClick={() => onOpenModal('help')} icon="fas fa-keyboard" label="Shortcuts" theme={theme} />
        <ToolBtn
          onClick={() => setAutoTranslate(!autoTranslate)}
          icon="fas fa-language"
          label="Auto Translate"
          active={autoTranslate}
          title={autoTranslate ? "Auto Translate: ON" : "Auto Translate: OFF"}
          theme={theme}
        />
        <ToolBtn
          onClick={onGoBack}
          icon="fas fa-undo"
          label={`Back ${goBackDepth ? `(${goBackDepth})` : ''}`}
          title="Go back one search step (Ctrl + Left)"
          active={canGoBack}
          theme={theme}
        />
        <ToolBtn
          onClick={onGoForward}
          icon="fas fa-redo"
          label={`Forward ${goForwardDepth ? `(${goForwardDepth})` : ''}`}
          title="Go forward one search step (Ctrl + Right)"
          active={canGoForward}
          theme={theme}
        />
        <ToolBtn onClick={() => setShowTrake(!showTrake)} icon="fas fa-stream" label="Trake" active={showTrake} theme={theme} />
        <ToolBtn onClick={() => onOpenModal('filter')} icon="fas fa-shapes" label="Filters" theme={theme} />
        <ToolBtn onClick={() => setIsClustered(!isClustered)} icon="fas fa-object-group" label="Cluster" active={isClustered} theme={theme} />
        <ToolBtn onClick={() => setIsAmbiguous(!isAmbiguous)} icon="fas fa-random" label="Ambiguous" active={isAmbiguous} theme={theme} />

        {dresSessionId ? (
          <div className="flex items-center gap-1.5">
            <div className="relative flex items-center group" ref={dresModeRef}>
              <button
                onClick={() => setIsDresModeOpen(!isDresModeOpen)}
                className={`${toolBtnBaseClasses()} ${toolBtnStateClasses(theme === 'jujutsu', false)} relative pr-8`}
                title="DRES Submit Mode"
              >
                <i className={`fas fa-paper-plane ${theme === 'jujutsu' ? 'text-[14px]' : 'text-xs'}`}></i>
                <span className="hidden sm:inline">{dresMode}</span>
                <i className={`fas fa-chevron-down absolute right-2.5 ${theme === 'jujutsu' ? 'text-[11px]' : 'text-[9px]'} transition-transform duration-200 ${isDresModeOpen ? 'rotate-180' : ''}`}></i>
              </button>

              <div
                className={`absolute top-[calc(100%+6px)] right-0 min-w-[120px] flex flex-col ${theme === 'jujutsu' ? 'rounded-xl overflow-hidden' : 'rounded-lg'} border border-[var(--border-color)] shadow-xl transition-all duration-200 origin-top-right z-50 py-1 ${isDresModeOpen ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible'} ${theme === 'jujutsu' ? 'bg-[#5b40c2]' : 'bg-[var(--bg-secondary)]'}`}
              >
                {['KIS', 'QA'].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setDresMode(mode);
                      setIsDresModeOpen(false);
                    }}
                    className={`text-left px-4 py-2 text-sm transition-colors duration-150 flex items-center gap-2 ${dresMode === mode ? (theme === 'jujutsu' ? 'bg-[#795ceb] text-white font-bold' : 'bg-[var(--glass-bg)] text-[var(--text-primary)] font-semibold') : (theme === 'jujutsu' ? 'text-white hover:bg-[#684dd4]' : 'text-[var(--text-secondary)] hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]')}`}
                  >
                    <span className="flex-grow">{mode} Mode</span>
                    {dresMode === mode && <i className="fas fa-check text-[10px]"></i>}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={onOpenDresLogin}
              className={`${toolBtnBaseClasses()} bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/20`}
              title="DRES Session Active (Click to view session/logout)"
            >
              <i className="fas fa-plug"></i>
              <span className="hidden sm:inline">{dresUsername || 'Dres'}</span>
            </button>
          </div>
        ) : (
          <button
            onClick={onOpenDresLogin}
            className={`${toolBtnBaseClasses()} ${toolBtnStateClasses(theme === 'jujutsu', false)}`}
            title="DRES Login"
          >
            <i className="fas fa-plug"></i>
            <span className="hidden sm:inline">Dres</span>
          </button>
        )}

        <button
          onClick={() => setIsMuted(!isMuted)}
          className={`${toolBtnBaseClasses()} ${toolBtnStateClasses(theme === 'jujutsu', false)} ${isMuted ? 'text-red-400 border-red-400/30' : ''}`}
          title={isMuted ? "Unmute Sound" : "Mute Sound"}
        >
          <i className={`fas ${isMuted ? 'fa-volume-mute' : 'fa-volume-up'} text-xs`}></i>
        </button>

        <button
          onClick={onReset}
          className={`${toolBtnBaseClasses()} ${toolBtnStateClasses(theme === 'jujutsu', false)} group hover:text-red-300 hover:border-red-400/40 hover:bg-red-500/10`}
          title="Reset search"
        >
          <i className="fas fa-redo-alt text-xs transition-transform duration-500 group-hover:-rotate-180"></i>
          <span className="hidden sm:inline">Reset</span>
        </button>
      </div>
    </div>
  );
}
