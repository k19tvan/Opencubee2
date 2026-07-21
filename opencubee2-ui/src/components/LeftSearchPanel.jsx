// src/components/LeftSearchPanel.jsx
import { useState } from 'react';
import toast from 'react-hot-toast';
import StageCard from './StageCard';
import { googleImageSearch } from '../api';

export default function LeftSearchPanel({
  stages,
  lastFinalQueries = [],
  setStages,
  focusRequest = null,
  onSearch,
  loading,
}) {
  const [googleQuery, setGoogleQuery] = useState('');
  const [googleResults, setGoogleResults] = useState([]);
  const [googleLoading, setGoogleLoading] = useState(false);

  const addStage = () => {
    setStages((prev) => [...prev, {
      id: Date.now(),
      queryText: '', ocrText: '', asrText: '',
      ocrActive: false, asrActive: false,
      queryType: 'text',
      options: { enhance: false, bge_caption: false },
    }]);
  };

  const removeLastStage = () => {
    if (stages.length > 1) setStages((prev) => prev.slice(0, -1));
  };

  const handleStageChange = (id, data) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...data } : s)));
  };

  const handleStageDelete = (id) => {
    setStages((prev) => prev.filter((s) => s.id !== id));
  };

  const executeGoogleSearch = async () => {
    if (!googleQuery.trim()) return;
    setGoogleLoading(true);
    try {
      const res = await googleImageSearch(googleQuery);
      setGoogleResults(res.image_urls || []);
    } catch (e) {
      toast.error('Error loading Google Images: ' + e.message);
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div
      id="left-search-panel"
      className="w-full h-full border-r border-[var(--border-color)] flex flex-col overflow-hidden transition-all duration-300"
      style={{ background: 'var(--card-bg)' }}
    >
      <div className="flex-grow overflow-y-auto p-4 space-y-4">
        <div className="pb-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2.5">
            <i className="fab fa-google text-red-500"></i> Google Image Search
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-grow px-3 py-2 bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] text-xs focus:outline-none focus:border-[var(--border-hover)] focus:ring-1 focus:ring-white/10 transition-all placeholder:text-[var(--text-secondary)]"
              placeholder="Search Google Images..."
              value={googleQuery}
              onChange={(e) => setGoogleQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && executeGoogleSearch()}
            />
            <button
              className="w-9 h-9 rounded-lg border border-[var(--border-color)] bg-[var(--glass-bg)] text-[var(--text-secondary)] flex items-center justify-center hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] transition-all cursor-pointer active:scale-95 flex-shrink-0"
              onClick={executeGoogleSearch}
              disabled={googleLoading}
            >
              <i className={`fas ${googleLoading ? 'fa-spinner fa-spin' : 'fa-search'} text-xs`}></i>
            </button>
          </div>

          {googleResults.length > 0 && (
            <div className="mt-2.5 flex gap-2 overflow-x-auto p-2 bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-lg min-h-[72px] items-center animate-fadeIn">
              {googleResults.map((url, idx) => (
                <div
                  key={idx}
                  className="flex-shrink-0 w-24 h-[52px] rounded-md overflow-hidden border border-[var(--border-color)] hover:border-[var(--border-hover)] hover:scale-105 hover:shadow-glow transition-all duration-300 ease-spring cursor-pointer animate-scaleIn"
                  style={{ animationDelay: `${idx * 40}ms` }}
                >
                  <img src={url} alt="Google result" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {stages.map((stage, idx) => (
            <div
              key={stage.id}
              className="animate-fadeInUp"
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              <StageCard
                stage={stage}
                index={idx}
                finalQueryPreview={lastFinalQueries[idx] || ''}
                focusRequest={focusRequest}
                onDelete={() => handleStageDelete(stage.id)}
                onChange={handleStageChange}
                onSearch={onSearch}
              />
            </div>
          ))}
        </div>
      </div>



      <div className="flex-shrink-0 px-4 py-3 border-t border-[var(--border-color)] flex items-center justify-between gap-2 bg-[var(--card-bg)]">
        <div className="flex gap-1.5">
          <button
            className="w-8 h-8 rounded-lg border border-[var(--border-color)] bg-transparent text-[var(--text-secondary)] text-sm flex items-center justify-center hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[var(--glass-bg)] transition-all cursor-pointer active:scale-95"
            onClick={addStage}
            title="Add stage"
          >
            <i className="fas fa-plus text-xs"></i>
          </button>
          <button
            className="w-8 h-8 rounded-lg border border-[var(--border-color)] bg-transparent text-[var(--text-secondary)] text-sm flex items-center justify-center hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[var(--glass-bg)] transition-all cursor-pointer active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={removeLastStage}
            disabled={stages.length <= 1}
            title="Remove last stage"
          >
            <i className="fas fa-minus text-xs"></i>
          </button>
          {stages.length > 1 && (
            <span className="self-center text-[10px] text-[var(--text-secondary)] ml-1">
              {stages.length} stages
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            className="group relative flex items-center gap-2 bg-[var(--text-primary)] text-[var(--bg-primary)] px-5 py-2 rounded-lg font-semibold text-xs tracking-normal hover:bg-[var(--accent-secondary)] hover:-translate-y-0.5 hover:shadow-glow active:scale-95 active:translate-y-0 transition-all duration-300 ease-smooth shadow-sm cursor-pointer disabled:opacity-50 disabled:hover:translate-y-0 overflow-hidden"
            onClick={onSearch}
            disabled={loading}
            data-primary-search-button="true"
          >
            <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-search group-hover:scale-110'} text-xs transition-transform duration-300`}></i>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>
    </div>
  );
}
