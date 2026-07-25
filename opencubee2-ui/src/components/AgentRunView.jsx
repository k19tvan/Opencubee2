import { useCallback, useMemo } from 'react';
import { getImageUrl } from '../utils/imageUrl';

const statusMeta = {
  starting: { label: 'Starting', icon: 'fa-circle-notch fa-spin', tone: 'text-sky-400 border-sky-400/30 bg-sky-400/10' },
  thinking: { label: 'Thinking', icon: 'fa-brain', tone: 'text-[var(--text-primary)] border-[var(--border-hover)] bg-[var(--glass-bg)]' },
  searching: { label: 'Searching', icon: 'fa-search', tone: 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10' },
  inspecting: { label: 'Inspecting', icon: 'fa-eye', tone: 'text-[var(--text-primary)] border-[var(--border-hover)] bg-[var(--glass-bg)]' },
  found: { label: 'Found', icon: 'fa-check-circle', tone: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' },
  gave_up: { label: 'Gave Up', icon: 'fa-flag', tone: 'text-amber-400 border-amber-400/30 bg-amber-400/10' },
  failed: { label: 'Failed', icon: 'fa-triangle-exclamation', tone: 'text-red-400 border-red-400/30 bg-red-400/10' },
  idle: { label: 'Idle', icon: 'fa-circle', tone: 'text-[var(--text-secondary)] border-[var(--border-color)] bg-[var(--glass-bg)]' },
};

const getShotUrl = (shot = {}) => getImageUrl(shot.url || shot.frame_name);

const getShotKey = (shot = {}) => shot.filepath || shot.file_path || shot.frame_name || shot.url || '';

function normalizeShot(shot = {}) {
  if (!shot) return null;
  return {
    ...shot,
    filepath: shot.filepath || shot.file_path,
    url: getShotUrl(shot),
  };
}

function AgentFrameCard({
  shot,
  label = '',
  compact = false,
  onZoom,
  onPreview,
  onContext,
  onQuickSearch,
  onPushToTeam,
  onPushToTrake,
  onToggleLock = () => {},
  isLocked = false,
}) {
  const normalizedShot = normalizeShot(shot);
  if (!normalizedShot?.url) return null;

  const handleClick = (event) => {
    if (event.altKey) {
      event.preventDefault();
      onToggleLock(normalizedShot);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (event.shiftKey) onQuickSearch(normalizedShot);
      else onContext(normalizedShot);
      return;
    }
    onZoom(normalizedShot.url);
  };

  return (
    <div
      className={`group relative overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-heavy)] cursor-pointer ${compact ? 'aspect-video' : 'min-h-[220px]'}`}
      onClick={handleClick}
      onContextMenu={(event) => {
        event.preventDefault();
        onPreview(normalizedShot.video_id, normalizedShot.frame_id);
      }}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/json', JSON.stringify(normalizedShot));
        event.dataTransfer.setData('text/uri-list', normalizedShot.url);
        event.dataTransfer.setData('text/plain', normalizedShot.frame_name || '');
        event.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <img
        src={normalizedShot.url}
        alt={label || normalizedShot.frame_name || 'Agent frame'}
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
      />
      {isLocked && (
        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded bg-emerald-500/90 flex items-center justify-center z-10" title="Video locked">
          <i className="fas fa-lock text-[8px] text-white"></i>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 to-transparent p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {label && <div className="text-[10px] uppercase tracking-widest text-white/70 font-bold">{label}</div>}
            <div className="truncate text-xs font-semibold text-white">{normalizedShot.frame_name || normalizedShot.video_id || 'Agent frame'}</div>
          </div>
          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              className="w-8 h-8 rounded-lg bg-slate-950/90 border border-white/10 text-white hover:bg-white hover:text-slate-950"
              onClick={(event) => { event.stopPropagation(); onPushToTeam(normalizedShot); }}
              title="Send to Teamwork"
            >
              <i className="fas fa-users text-xs"></i>
            </button>
            <button
              className="w-8 h-8 rounded-lg bg-slate-950/90 border border-white/10 text-white hover:bg-white hover:text-slate-950"
              onClick={(event) => { event.stopPropagation(); onPushToTrake(normalizedShot); }}
              title="Pin to Trake"
            >
              <i className="fas fa-thumbtack text-xs"></i>
            </button>
            <button
              className="w-8 h-8 rounded-lg bg-slate-950/90 border border-white/10 text-white hover:bg-white hover:text-slate-950"
              onClick={(event) => { event.stopPropagation(); onPreview(normalizedShot.video_id, normalizedShot.frame_id); }}
              title="Preview video"
            >
              <i className="fas fa-play text-xs"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function classifyLog(message = '') {
  if (message.includes('Thought')) return { label: 'Thought', icon: 'fa-brain' };
  if (message.includes('Executing')) return { label: 'Action', icon: 'fa-bolt' };
  if (message.includes('Compiling') || message.includes('Canvas')) return { label: 'Observation', icon: 'fa-table-cells-large' };
  if (message.includes('ERROR') || message.includes('failed') || message.includes('halted')) return { label: 'Error', icon: 'fa-triangle-exclamation' };
  return { label: 'Log', icon: 'fa-terminal' };
}

export default function AgentRunView({
  run,
  socket,
  username,
  userColor,
  onTeamworkAddLocal,
  onZoom,
  onPreview,
  onContext,
  onQuickSearch,
  onToggleLock = () => {},
  lockedVideoIds = [],
}) {
  const meta = statusMeta[run?.status] || statusMeta.idle;

  const latestObservation = useMemo(() => {
    const observations = run?.observations || [];
    return observations.length ? observations[observations.length - 1] : null;
  }, [run?.observations]);

  const latestShots = useMemo(() => {
    const shots = latestObservation?.shots || [];
    return Array.from(new Map(shots.map((shot) => [getShotKey(shot), normalizeShot(shot)])).values()).filter(Boolean);
  }, [latestObservation]);

  const pushToTeam = useCallback((shot) => {
    if (!shot) return;
    onTeamworkAddLocal(shot);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'new_frame',
        data: { shot, user: { name: username, color: userColor } },
      }));
    }
  }, [socket, username, userColor, onTeamworkAddLocal]);

  const pushToTrake = useCallback((shot) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'trake_add',
        data: { shot },
      }));
    }
  }, [socket]);

  if (!run) {
    return (
      <div className="flex flex-grow items-center justify-center text-[var(--text-secondary)]">
        Agent run not found.
      </div>
    );
  }

  const finalShot = normalizeShot(run.final?.shot);

  return (
    <div className="flex-grow min-w-0 overflow-y-auto bg-[var(--bg-primary)]">
      <div className="px-5 py-5 md:px-6 max-w-[1500px] mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1 text-xs font-bold ${meta.tone}`}>
                <i className={`fas ${meta.icon}`}></i>
                {meta.label}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] font-bold">
                ReAct Agent
              </span>
            </div>
            <h2 className="text-xl md:text-2xl font-semibold text-[var(--text-primary)] leading-tight break-words">
              {run.prompt}
            </h2>
          </div>
          {finalShot && (
            <button
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--text-primary)] text-[var(--bg-primary)] px-4 py-2 text-xs font-semibold hover:bg-[var(--accent-secondary)] active:scale-95 transition-all"
              onClick={() => pushToTeam(finalShot)}
            >
              <i className="fas fa-users"></i>
              Push Final to Teamwork
            </button>
          )}
        </div>

        {finalShot && (
          <div className="mb-6 grid grid-cols-1 xl:grid-cols-[minmax(300px,460px)_1fr] gap-5">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-3 flex items-center gap-2">
                <i className="fas fa-check-circle"></i>
                Final Match
              </h3>
              <AgentFrameCard
                shot={finalShot}
                label={run.final?.selected_index ? `Frame #${run.final.selected_index}` : 'Selected'}
                onZoom={onZoom}
                onPreview={onPreview}
                onContext={onContext}
                onQuickSearch={onQuickSearch}
                onPushToTeam={pushToTeam}
                onPushToTrake={pushToTrake}
                onToggleLock={onToggleLock}
                isLocked={lockedVideoIds.includes(finalShot?.video_id)}
              />
            </div>
            <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-4 min-h-[120px]">
              <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-bold mb-2">Agent Reason</div>
              <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                {run.final?.reason || 'The agent selected this frame as the best match.'}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-5">
          <section className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--accent-primary)] flex items-center gap-2">
                <i className="fas fa-list-check"></i>
                Agent Cycle
              </h3>
              <span className="text-[10px] text-[var(--text-secondary)] font-semibold">{run.logs?.length || 0} logs</span>
            </div>
            <div className="max-h-[640px] overflow-y-auto p-4 space-y-3">
              {(run.logs || []).length === 0 ? (
                <div className="text-xs text-[var(--text-secondary)] italic">Waiting for the first thought...</div>
              ) : (
                run.logs.map((log, index) => {
                  const logMeta = classifyLog(log.message);
                  return (
                    <div key={`${log.receivedAt || index}-${index}`} className="grid grid-cols-[28px_1fr] gap-3">
                      <div className="w-7 h-7 rounded-lg border border-[var(--border-color)] bg-[var(--glass-bg)] flex items-center justify-center text-[var(--accent-primary)]">
                        <i className={`fas ${logMeta.icon} text-[11px]`}></i>
                      </div>
                      <div className="min-w-0 rounded-lg bg-[var(--glass-bg)] border border-[var(--border-color)] px-3 py-2">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1">
                          {logMeta.label}
                        </div>
                        <p className="text-xs leading-relaxed text-[var(--text-primary)] break-words">{log.message}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="min-w-0 space-y-5">
            {latestObservation?.image && (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--accent-primary)] flex items-center gap-2">
                    <i className="fas fa-table-cells-large"></i>
                    Latest Observation
                  </h3>
                  <button
                    className="w-8 h-8 rounded-lg border border-[var(--border-color)] bg-[var(--glass-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    onClick={() => onZoom(latestObservation.image)}
                    title="Zoom canvas"
                  >
                    <i className="fas fa-expand text-xs"></i>
                  </button>
                </div>
                <button
                  className="block w-full bg-white"
                  onClick={() => onZoom(latestObservation.image)}
                  title="Zoom canvas"
                >
                  <img src={latestObservation.image} alt="Agent observation canvas" className="w-full h-auto" />
                </button>
              </div>
            )}

            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--accent-primary)] flex items-center gap-2">
                  <i className="fas fa-images"></i>
                  Candidate Frames
                </h3>
                <span className="text-[10px] text-[var(--text-secondary)] font-semibold">{latestShots.length} visible</span>
              </div>
              <div className="p-4">
                {latestShots.length === 0 ? (
                  <div className="min-h-[180px] flex items-center justify-center text-xs text-[var(--text-secondary)] italic">
                    Candidates will appear after the first observation.
                  </div>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
                    {latestShots.map((shot, index) => (
                      <AgentFrameCard
                        key={getShotKey(shot) || index}
                        shot={shot}
                        label={`Frame #${shot.agent_index || index + 1}`}
                        compact
                        onZoom={onZoom}
                        onPreview={onPreview}
                        onContext={onContext}
                        onQuickSearch={onQuickSearch}
                        onPushToTeam={pushToTeam}
                        onPushToTrake={pushToTrake}
                        onToggleLock={onToggleLock}
                        isLocked={lockedVideoIds.includes(shot?.video_id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
