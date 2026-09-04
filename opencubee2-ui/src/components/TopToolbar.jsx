// src/components/TopToolbar.jsx
import React, { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { SEARCH_MODEL_OPTIONS, DEFAULT_SEARCH_MODEL } from '../App';

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

const toolBtnBaseClasses = () =>
  'shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-1 px-2 rounded-xl border text-[11px] font-medium transition-all duration-150 ease-out cursor-pointer select-none disabled:opacity-35 disabled:cursor-not-allowed';

const toolBtnStateClasses = (active) =>
  active
    ? 'shadow-sm font-medium'
    : 'bg-transparent border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[var(--glass-bg)]';

const ToolBtn = ({ onClick, icon, label, active = false, title = '', disabled = false, theme = '', responsive = true }) => {
  const isJJK = theme === 'jujutsu';

  const baseClasses = toolBtnBaseClasses();
  const stateClasses = toolBtnStateClasses(active);

  return (
    <button
      onClick={onClick}
      title={title || label}
      disabled={disabled}
      data-active={active ? 'true' : 'false'}
      data-topbar-button="true"
      className={`${baseClasses} ${stateClasses}`}
    >
      <i className={`${icon} ${isJJK ? 'text-[12px]' : 'text-[11px]'}`}></i>
      <span className={responsive ? 'hidden sm:inline' : 'inline'}>{label}</span>
    </button>
  );
};

export default function TopToolbar({
  username,
  userColor,
  theme,
  setTheme,
  onUploadZip,
  submissionQueries = [],
  activeQueryFilename,
  onSelectQuery,
  similarityScopeEnabled,
  hasSimilarityScope,
  onToggleSimilarityScope,
  timeFilterEnabled = false,
  setTimeFilterEnabled = () => {},
  timeRangeInput = '',
  setTimeRangeInput = () => {},
  isClustered,
  setIsClustered,
  isAmbiguous,
  setIsAmbiguous,
  onOpenModal,
  onReset,
  onToggleMobileMenu,
  timingInfo = null,
  searchModel,
  setSearchModel,
  metaClipOnly = false,
  setMetaClipOnly = () => { },
  autoTranslate,
  setAutoTranslate,
  sentenceLevel = false,
  setSentenceLevel = () => { },
  isMuted,
  setIsMuted,
  getHistoryEntries = () => [],
  onRestoreHistory = () => {},
  onClearHistory = () => {},
}) {
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const themeRef = useRef(null);
  const [isModelsOpen, setIsModelsOpen] = useState(false);
  const modelsRef = useRef(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isQueryDropdownOpen, setIsQueryDropdownOpen] = useState(false);
  const historyRef = useRef(null);
  const queryDropRef = useRef(null);
  const activeThemeMeta = THEME_META[theme] || THEME_META.dark;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (themeRef.current && !themeRef.current.contains(event.target)) setIsThemeOpen(false);
      if (modelsRef.current && !modelsRef.current.contains(event.target)) setIsModelsOpen(false);
      if (historyRef.current && !historyRef.current.contains(event.target)) setIsHistoryOpen(false);
      if (queryDropRef.current && !queryDropRef.current.contains(event.target)) setIsQueryDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative w-full min-h-[52px] shrink-0 px-3 sm:px-5 py-1.5 flex flex-row items-center justify-between bg-[var(--card-bg)] border-b border-[var(--border-color)] backdrop-blur-xl backdrop-saturate-150 z-[100] transition-all duration-300 animate-slideDown gap-2 min-w-0">

      {/* Brand & Left Navigation - Always pinned to Line 1 Top Left */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Mobile menu toggle */}
        <button
          onClick={onToggleMobileMenu}
          className="md:hidden flex w-8 h-8 rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] items-center justify-center hover:bg-[var(--glass-bg)] active:scale-95 transition-all shrink-0"
        >
          <i className="fas fa-bars"></i>
        </button>

        <div className="flex items-center gap-2 cursor-pointer group shrink-0">
          <div className="h-9 w-9 sm:h-11 sm:w-11 flex items-center justify-center flex-shrink-0 transition-all duration-300 ease-spring group-hover:scale-105 group-hover:rotate-3 drop-shadow-md">
            <img src="/logo2.png" alt="Logo" className="h-full w-full object-contain" />
          </div>
          <div className="leading-tight hidden sm:block transition-transform duration-300 group-hover:translate-x-0.5">
            <div className="text-lg font-bold text-[var(--text-primary)] tracking-tight">OpenCubee2</div>
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--text-secondary)] tracking-normal mt-0.5">
              <span>
                {username
                  ? <span style={{ color: userColor }}>{username}</span>
                  : <span>Guest</span>
                }
              </span>
              {timingInfo && (
                <span
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--glass-bg)] px-1.5 py-0.5"
                  title="Server time"
                >
                  <i className="fas fa-gauge-high text-[9px] text-[var(--accent-primary)]"></i>
                  <span className="font-mono text-[var(--text-primary)]">
                    {timingInfo.total_request_s?.toFixed(3)}s
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons Toolbar - Fills Line 1 beside logo, extra buttons wrap to Line 2 on the right */}
      <div className="flex gap-1 sm:gap-2 items-center flex-wrap justify-end ml-auto flex-1 min-w-0 py-0.5">
        {/* Theme Selector */}
        <div className="relative flex items-center group shrink-0" ref={themeRef}>
          <button
            onClick={() => setIsThemeOpen(!isThemeOpen)}
            data-topbar-button="true"
            className={`${toolBtnBaseClasses()} ${toolBtnStateClasses(false)}`}
            title="Change theme"
          >
            <i className={`${activeThemeMeta.icon} ${theme === 'jujutsu' ? 'text-[12px]' : 'text-[11px]'}`}></i>
            <span className="hidden sm:inline">{activeThemeMeta.label}</span>
          </button>

          <div
            className={`absolute top-[calc(100%+6px)] left-0 min-w-[140px] flex flex-col ${theme === 'jujutsu' ? 'rounded-xl overflow-hidden' : 'rounded-xl'} border border-[var(--border-color)] shadow-xl transition-all duration-200 origin-top-left z-50 py-1 ${isThemeOpen ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible'} ${theme === 'jujutsu' ? 'bg-[#5b40c2]' : 'bg-[var(--bg-secondary)]'}`}
          >
            {THEME_ORDER.map(t => (
              <button
                key={t}
                onClick={() => {
                  setTheme(t);
                  setIsThemeOpen(false);
                }}
                className={`text-left px-3.5 py-1.5 text-xs transition-colors duration-150 flex items-center gap-2 ${theme === t ? (theme === 'jujutsu' ? 'bg-[#795ceb] text-white font-bold' : 'bg-[var(--glass-bg)] text-[var(--text-primary)] font-semibold') : (theme === 'jujutsu' ? 'text-white hover:bg-[#684dd4]' : 'text-[var(--text-secondary)] hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]')}`}
              >
                <i className={THEME_META[t].icon + ' text-[10px]'}></i>
                {THEME_META[t].label}
              </button>
            ))}
          </div>
        </div>

        {/* Embedding Models Selector */}
        <div className="relative flex items-center group shrink-0" ref={modelsRef}>
          <button
            onClick={() => setIsModelsOpen(!isModelsOpen)}
            data-topbar-button="true"
            className={`${toolBtnBaseClasses()} ${toolBtnStateClasses(false)}`}
            title="Select Embedding Models"
          >
            <i className={`fas fa-layer-group ${theme === 'jujutsu' ? 'text-[12px]' : 'text-[11px]'}`}></i>
            <span className="hidden sm:inline">Models</span>
          </button>

          <div
            className={`absolute top-[calc(100%+6px)] right-0 min-w-[150px] flex flex-col ${theme === 'jujutsu' ? 'rounded-xl overflow-hidden' : 'rounded-xl'} border border-[var(--border-color)] shadow-xl transition-all duration-200 origin-top-right z-50 py-1 ${isModelsOpen ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible'} ${theme === 'jujutsu' ? 'bg-[#5b40c2]' : 'bg-[var(--bg-secondary)]'}`}
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
                  className={`text-left px-3.5 py-1.5 text-xs transition-colors duration-150 flex items-center gap-2 ${active ? (theme === 'jujutsu' ? 'bg-[#795ceb] text-white font-bold' : 'bg-[var(--glass-bg)] text-[var(--text-primary)] font-semibold') : (theme === 'jujutsu' ? 'text-white hover:bg-[#684dd4]' : 'text-[var(--text-secondary)] hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]')}`}
                >
                  <i className={`${model.icon} text-xs w-4 text-center`}></i>
                  <span className="flex-grow">{model.label}</span>
                  {active && <i className="fas fa-check text-[10px] text-emerald-400"></i>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="w-[1px] h-4 bg-[var(--border-color)] opacity-40 shrink-0 -mx-0.5 hidden sm:block" />

        {/* Shortcuts & Utilities */}
        <ToolBtn onClick={() => onOpenModal('help')} icon="fas fa-keyboard" label="Shortcuts" theme={theme} />
        <ToolBtn
          onClick={() => {
            setAutoTranslate(prev => {
              const next = !prev;
              toast.success(`Auto Translate: ${next ? 'ON' : 'OFF'}`, { id: 'auto-translate-toast' });
              return next;
            });
          }}
          icon="fas fa-language"
          label="Auto Translate"
          active={autoTranslate}
          title={autoTranslate ? "Auto Translate: ON (Alt + A)" : "Auto Translate: OFF (Alt + A)"}
          theme={theme}
        />
        <div className="flex items-center gap-1 shrink-0">
          <ToolBtn onClick={() => setTimeFilterEnabled(!timeFilterEnabled)} icon="fas fa-clock" label="Time" active={timeFilterEnabled} title="Time range filter (Alt + 5)" theme={theme} />
          {timeFilterEnabled && <input value={timeRangeInput} onChange={(event) => setTimeRangeInput(event.target.value)} placeholder="0-16, 32-64" aria-label="Time ranges in seconds" className="w-28 sm:w-40 rounded-lg border border-[var(--border-color)] bg-[var(--glass-bg)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]" />}
        </div>

        <div className="w-[1px] h-4 bg-[var(--border-color)] opacity-40 shrink-0 -mx-0.5 hidden sm:block" />

        {/* Search Mode Toggles */}
        <ToolBtn
          onClick={() => {
            setSentenceLevel(prev => {
              const next = !prev;
              toast.success(`Sentence level ASR: ${next ? 'ON' : 'OFF'}`, { id: 'sentence-level-toast' });
              return next;
            });
          }}
          icon="fas fa-align-left"
          label="Sentence level"
          active={sentenceLevel}
          title={sentenceLevel ? "Sentence level Semantic ASR: ON (Ctrl + Q)" : "Sentence level Semantic ASR: OFF (Ctrl + Q)"}
          theme={theme}
        />
        <ToolBtn
          onClick={onToggleSimilarityScope}
          icon="fas fa-images"
          label="Similar only"
          active={similarityScopeEnabled}
          disabled={!hasSimilarityScope}
          title={hasSimilarityScope
            ? (similarityScopeEnabled
              ? 'Similarity-only search: ON. Click to search all videos.'
              : 'Search only within the prepared similarity list.')
            : 'Run a similarity image search first to prepare a similarity list.'}
          theme={theme}
        />
        <ToolBtn
          onClick={() => {
            setMetaClipOnly(prev => {
              const next = !prev;
              toast.success(`MetaCLIP Filter: ${next ? 'ON' : 'OFF'}`, { id: 'metaclip-toast' });
              return next;
            });
          }}
          icon="fas fa-bolt"
          label="MetaCLIP only"
          active={metaClipOnly}
          title={metaClipOnly
            ? 'MetaCLIP only: ON. Click to restore the selected models.'
            : 'Use MetaCLIP only for text search. Image search still uses BGE.'}
          theme={theme}
        />
        <ToolBtn onClick={() => setIsClustered(!isClustered)} icon="fas fa-object-group" label="Cluster" active={isClustered} theme={theme} />
        
        {/* History Dropdown */}
        <div className="relative flex items-center group shrink-0" ref={historyRef}>
          <button
            onClick={() => setIsHistoryOpen(!isHistoryOpen)}
            data-topbar-button="true"
            className={`${toolBtnBaseClasses()} ${toolBtnStateClasses(false)}`}
            title="Search History"
          >
            <i className={`fas fa-history ${theme === 'jujutsu' ? 'text-[12px]' : 'text-[11px]'}`}></i>
            <span className="hidden sm:inline">History</span>
          </button>

          <div
            className={`absolute top-[calc(100%+6px)] right-0 w-[280px] flex flex-col ${theme === 'jujutsu' ? 'rounded-xl overflow-hidden' : 'rounded-xl'} border border-[var(--border-color)] shadow-2xl transition-all duration-200 origin-top-right z-50 py-1 ${isHistoryOpen ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible'} ${theme === 'jujutsu' ? 'bg-[#5b40c2]' : 'bg-[var(--bg-secondary)]'} max-h-[70vh] overflow-y-auto`}
          >
            {getHistoryEntries().length > 0 ? (
              <>
                {[...getHistoryEntries()].reverse().map((entry, index) => {
                  const stages = entry.snapshot?.stages || [];
                  const numStages = stages.length;
                  const isMulti = numStages > 1;
                  
                  const previewStages = stages.slice(0, 2);
                  const hasMorePreview = numStages > 2;

                  return (
                    <button
                      key={entry.id}
                      onClick={() => {
                        onRestoreHistory(entry.id);
                        setIsHistoryOpen(false);
                      }}
                      className={`text-left p-3 text-xs transition-colors duration-150 flex flex-col gap-1.5 border-b border-[var(--border-color)] ${theme === 'jujutsu' ? 'text-white hover:bg-[#684dd4]' : 'text-[var(--text-secondary)] hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]'}`}
                      title={`Restore search ${entry.id}`}
                    >
                      <div className="flex items-center justify-between w-full mb-0.5">
                        <span className={`text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 ${isMulti ? (theme === 'jujutsu' ? 'text-blue-200' : 'text-blue-400') : 'opacity-70'}`}>
                          <i className={`fas ${isMulti ? 'fa-layer-group' : 'fa-search'}`}></i>
                          {isMulti ? `Temporal (${numStages})` : 'Single Stage'}
                        </span>
                        <span className="text-[9px] opacity-40 font-mono">{entry.id.substring(0, 6)}</span>
                      </div>
                      
                      <div className={`flex flex-col gap-1.5 w-full pl-2 border-l-[1.5px] ${theme === 'jujutsu' ? 'border-white/20' : 'border-[var(--border-color)]'} opacity-90`}>
                        {previewStages.map((s, i) => {
                          const isImage = s.queryType === 'image';
                          const text = isImage ? s.imageText : s.queryText;
                          const hasImagePreview = isImage && !!s.imagePreview;
                          return (
                            <div key={i} className="flex items-start gap-1.5 w-full">
                              {hasImagePreview ? (
                                <img src={s.imagePreview} className="w-5 h-5 object-cover rounded shadow-sm shrink-0 border border-white/10" alt="Query Thumbnail" />
                              ) : (
                                <i className={`fas ${isImage ? 'fa-image text-emerald-400' : 'fa-font text-purple-400'} mt-[3px] text-[9px] shrink-0`}></i>
                              )}
                              <span className={`font-medium truncate w-full text-[11px] leading-tight ${hasImagePreview ? 'mt-0.5' : ''}`}>
                                {text ? text : (hasImagePreview ? <span className="italic opacity-60">Similarity Image</span> : <span className="italic opacity-40">Empty query</span>)}
                              </span>
                            </div>
                          );
                        })}
                        {hasMorePreview && (
                          <div className="text-[9px] opacity-60 italic ml-4">+ {numStages - 2} more stage(s)</div>
                        )}
                      </div>
                    </button>
                  );
                })}
                <button
                  onClick={() => {
                    onClearHistory();
                    setIsHistoryOpen(false);
                  }}
                  className={`text-center p-2 text-xs transition-colors duration-150 flex items-center justify-center gap-1.5 font-semibold ${theme === 'jujutsu' ? 'text-red-300 hover:bg-red-500/20' : 'text-red-500 hover:bg-red-500/10'}`}
                >
                  <i className="fas fa-trash-alt text-[10px]"></i>
                  Clear History
                </button>
              </>
            ) : (
              <div className="px-3.5 py-4 text-xs text-[var(--text-secondary)] text-center">
                <i className="fas fa-history text-2xl mb-2 opacity-20 block"></i>
                <span className="italic opacity-70">No history yet</span>
              </div>
            )}
          </div>
        </div>

        <ToolBtn onClick={() => setIsAmbiguous(!isAmbiguous)} icon="fas fa-random" label="Ambiguous" active={isAmbiguous} theme={theme} />

        <div className="w-[1px] h-4 bg-[var(--border-color)] opacity-40 shrink-0 -mx-0.5 hidden sm:block" />

        {/* Integrations (Zip Upload & Query Select) */}
        {!submissionQueries || submissionQueries.length === 0 ? (
          <label
            data-topbar-button="true"
            className={`${toolBtnBaseClasses()} ${toolBtnStateClasses(false)} bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20 cursor-pointer font-bold`}
            title="Upload ZIP containing TXT queries"
          >
            <i className="fas fa-file-archive text-[11px]"></i>
            <span>Upload Queries ZIP</span>
            <input type="file" accept=".zip" className="hidden" onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                onUploadZip(e.target.files[0]);
              }
              e.target.value = null;
            }} />
          </label>
        ) : (
          <div className="flex items-center gap-1 shrink-0 bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-lg p-0.5">
            <div className="relative flex items-center group" ref={queryDropRef}>
              <button
                onClick={() => setIsQueryDropdownOpen(!isQueryDropdownOpen)}
                className="flex items-center justify-between min-w-[200px] max-w-[250px] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--glass-bg)] rounded-md transition-colors"
                title={activeQueryFilename || "Select Query"}
              >
                <div className="flex items-center gap-2 truncate">
                  <i className="fas fa-file-csv text-blue-400"></i>
                  <span className="truncate font-semibold uppercase">{activeQueryFilename || "Select Query"}</span>
                </div>
                <i className={`fas fa-chevron-down text-[10px] text-[var(--text-secondary)] ml-2 transition-transform ${isQueryDropdownOpen ? 'rotate-180' : ''}`}></i>
              </button>

              <div
                className={`absolute top-[calc(100%+6px)] left-0 min-w-[280px] flex flex-col rounded-xl border border-[var(--border-color)] shadow-2xl transition-all duration-200 origin-top-left z-50 py-1 ${isQueryDropdownOpen ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible'} bg-[var(--bg-secondary)] overflow-hidden`}
              >
                <div className="max-h-[50vh] overflow-y-auto custom-scrollbar">
                  {submissionQueries.map((query) => {
                    const isActive = query.filename === activeQueryFilename;
                    const isEmpty = query.is_empty;
                    return (
                      <button
                        key={query.filename}
                        onClick={() => {
                          onSelectQuery(query.filename);
                          setIsQueryDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors duration-150 flex items-center gap-2 ${isActive ? 'bg-blue-500/20 text-blue-300 font-bold' : 'text-[var(--text-secondary)] hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]'}`}
                      >
                        <i className={`fas ${!isEmpty ? 'fa-check-circle text-emerald-400' : 'fa-circle text-[var(--border-color)]'}`}></i>
                        <span className="truncate">{query.filename}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="w-[1px] h-4 bg-[var(--border-color)] opacity-40 shrink-0 mx-0.5" />

            <div className="flex items-center">
              <label
                className="flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)] hover:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer transition-colors"
                title="Upload ZIP"
              >
                <i className="fas fa-file-archive text-[11px]"></i>
                <input type="file" accept=".zip" className="hidden" onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    onUploadZip(e.target.files[0]);
                  }
                  e.target.value = null;
                }} />
              </label>
              
              <button
                onClick={() => {
                  const name = window.prompt("Enter new CSV filename (e.g. L21_V001.csv):");
                  if (name && name.trim()) {
                    let finalName = name.trim();
                    if (!finalName.endsWith('.csv')) finalName += '.csv';
                    onCreateCsv(finalName);
                  }
                }}
                className="flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                title="Create empty CSV"
              >
                <i className="fas fa-plus text-[11px]"></i>
              </button>
            </div>
          </div>
        )}

        <button
          onClick={() => setIsMuted(!isMuted)}
          data-topbar-button="true"
          className={`${toolBtnBaseClasses()} ${toolBtnStateClasses(false)} ${isMuted ? 'text-red-400 border-red-400/30 bg-red-500/10' : ''}`}
          title={isMuted ? "Unmute Sound" : "Mute Sound"}
        >
          <i className={`fas ${isMuted ? 'fa-volume-mute' : 'fa-volume-up'} text-[11px]`}></i>
        </button>

        <button
          onClick={onReset}
          data-topbar-button="true"
          className={`${toolBtnBaseClasses()} ${toolBtnStateClasses(false)} group hover:text-red-300 hover:border-red-400/40 hover:bg-red-500/10`}
          title="Reset search"
        >
          <i className="fas fa-redo-alt text-[11px] transition-transform duration-500 group-hover:-rotate-180"></i>
          <span className="hidden sm:inline">Reset</span>
        </button>

      </div>
    </div>
  );
}
