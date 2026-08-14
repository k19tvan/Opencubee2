import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  deleteAgentSession,
  getAgentEvents,
  selectAgentOption,
  sendAgentFeedback,
  sendAgentMessage,
} from '../api';
import { getImageUrl } from '../utils/imageUrl';

const TOP_K_OPTIONS = [5, 10, 15, 20, 25, 30];
const sleep = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));
const createSessionId = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const initialMessages = () => ([{
  id: `welcome-${Date.now()}`,
  role: 'assistant',
  type: 'welcome',
  text: 'Describe the frame you want to find. Enable Research when the request contains an ambiguous place, event, person, or named entity.',
}]);

const buildModelPayload = (searchModel) => {
  const models = Array.isArray(searchModel) && searchModel.length ? searchModel : ['beit3'];
  const weight = 1 / models.length;
  return {
    models,
    model_weights: Object.fromEntries(models.map((model) => [model, weight])),
  };
};

const mergeEvents = (current = [], incoming = []) => {
  const byId = new Map(current.map((event) => [event.id, event]));
  incoming.forEach((event) => byId.set(event.id, event));
  return [...byId.values()].sort((first, second) => first.id - second.id);
};

function QueryBlock({ queries = {}, onPush }) {
  const rows = [
    { label: 'Visual', key: 'text_query', icon: 'fa-eye', tone: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
    { label: 'OCR', key: 'ocr_query', icon: 'fa-font', tone: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
    { label: 'ASR', key: 'asr_query', icon: 'fa-wave-square', tone: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  ];
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/45">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-color)] px-4 py-3.5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
            <i className="fas fa-sliders text-[var(--accent-primary)]" /> Retrieval plan
          </div>
          <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">Queries used by the final retrieval round</p>
        </div>
        <button
          type="button"
          onClick={() => onPush(queries)}
          className="inline-flex h-9 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--glass-bg)] px-3.5 text-[11px] font-semibold text-[var(--text-primary)] transition-all hover:-translate-y-0.5 hover:border-[var(--border-hover)] hover:shadow-lg"
        >
          <i className="fas fa-arrow-up-right-from-square mr-2 text-[var(--accent-primary)]" /> Push to Search
        </button>
      </div>
      <div className="grid gap-2.5 p-3 sm:grid-cols-3">
        {rows.map(({ label, key, icon, tone }) => {
          const value = queries[key];
          return (
            <div key={key} className="min-w-0 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3">
              <div className={`mb-2 inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${tone}`}>
                <i className={`fas ${icon}`} /> {label}
              </div>
              <p className={`break-words text-[11px] leading-5 ${value ? 'text-[var(--text-primary)]' : 'italic text-[var(--text-secondary)]'}`}>
                {value || 'Not used in this search'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STEP_LABELS = {
  request: 'Request',
  research: 'Gemini research',
  option: 'Research option',
  query_planner: 'Query planner',
  search: 'Frame search',
  image_search: 'Image search',
  compose_image_retrieval: 'Compose image retrieval',
  canvas: 'Critic canvas',
  critic: 'Visual critic',
  refine: 'Query refinement',
  feedback: 'User feedback',
  finalize: 'Final selection',
  error: 'Error',
};

const formatDetailLabel = (key) => key
  .replaceAll('_', ' ')
  .replace(/\b\w/g, (character) => character.toUpperCase());

function QueryDetails({ value }) {
  const rows = [
    ['Text', value?.text_query],
    ['OCR', value?.ocr_query],
    ['ASR', value?.asr_query],
  ];
  return (
    <div className="grid gap-1.5">
      {rows.map(([label, query]) => (
        <div key={label} className="grid grid-cols-[42px_1fr] gap-2 rounded-md bg-black/10 px-2 py-1.5">
          <span className="font-semibold text-[var(--accent-primary)]">{label}</span>
          <span className={query ? 'break-words text-[var(--text-primary)]' : 'italic text-[var(--text-secondary)]'}>{query || 'Not used'}</span>
        </div>
      ))}
    </div>
  );
}

function DetailValue({ name, value }) {
  if (name.includes('queries') && value && typeof value === 'object' && !Array.isArray(value)) {
    return <QueryDetails value={value} />;
  }
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (value && typeof value === 'object') {
    return (
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/15 p-2 text-[9px] leading-4 text-[var(--text-primary)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span className="whitespace-pre-wrap break-words text-[var(--text-primary)]">{String(value ?? '') || '—'}</span>;
}

function KeptFrameStrip({ frames = [] }) {
  if (!frames.length) return null;
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {frames.map((frame) => {
        const imageUrl = getImageUrl(frame.url || frame.frame_name || frame.filepath);
        return (
          <a
            key={frame.frame_name || imageUrl}
            href={imageUrl}
            target="_blank"
            rel="noreferrer"
            className="group overflow-hidden rounded-lg border border-emerald-500/30 bg-[var(--bg-primary)]"
            title={`Open ${frame.frame_name}`}
          >
            <img src={imageUrl} alt={frame.frame_name || 'Critic-selected frame'} className="aspect-video w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
            <span className="block truncate px-1.5 py-1 font-mono text-[8px] text-emerald-300">{frame.frame_name}</span>
          </a>
        );
      })}
    </div>
  );
}

function EventRow({ event }) {
  const [expanded, setExpanded] = useState(false);
  const details = Object.entries(event.details || {}).filter(([, value]) => value !== undefined && value !== null);
  const selectedFrames = Array.isArray(event.details?.selected_frames) ? event.details.selected_frames : [];
  const hasDetails = details.length > 0;
  const statusIcon = event.status === 'failed'
    ? 'fa-circle-xmark text-rose-400'
    : event.status === 'completed'
      ? 'fa-circle-check text-emerald-400'
      : 'fa-ellipsis text-amber-400';

  return (
    <div className="relative border-b border-[var(--border-color)]/50 last:border-b-0">
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={hasDetails ? expanded : undefined}
        className={`flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${hasDetails ? 'cursor-pointer hover:bg-[var(--glass-bg)]' : 'cursor-default'}`}
      >
        <span className="relative mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)]">
          <i className={`fas ${statusIcon} text-[9px]`} />
        </span>
        <span className="min-w-0 flex-grow">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] font-bold text-[var(--text-primary)]">{STEP_LABELS[event.step] || formatDetailLabel(event.step)}</span>
            <span className="font-mono text-[8px] text-[var(--text-secondary)]">{new Date(event.timestamp * 1000).toLocaleTimeString([], { hour12: false })}</span>
          </span>
          <span className={`mt-0.5 block text-[10px] leading-4 ${event.status === 'failed' ? 'text-rose-400' : 'text-[var(--text-secondary)]'}`}>{event.message}</span>
        </span>
        <i className={`fas fa-chevron-right mt-2 text-[8px] text-[var(--text-secondary)] transition-transform ${expanded ? 'rotate-90' : ''} ${hasDetails ? 'opacity-100' : 'opacity-0'}`} />
      </button>
      {selectedFrames.length > 0 && (
        <div className="mx-11 mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5">
          <div className="text-[9px] font-semibold text-emerald-300"><i className="fas fa-bookmark mr-1.5" /> Critic kept {selectedFrames.length} frame(s) in this round</div>
          <KeptFrameStrip frames={selectedFrames} />
        </div>
      )}
      {hasDetails && expanded && (
        <div className="mb-3 ml-11 mr-2 grid gap-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/65 p-3 text-[10px] shadow-inner">
          {details.map(([name, value]) => (
            <div key={name} className="grid gap-1">
              <span className="text-[9px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">{formatDetailLabel(name)}</span>
              <DetailValue name={name} value={value} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineLog({ message }) {
  const completedEvents = message.events?.filter((event) => event.status === 'completed').length || 0;
  const eventCount = message.events?.length || 0;
  return (
    <div className="mr-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-heavy)]">
      <div className="border-b border-[var(--border-color)] bg-[var(--glass-bg)] px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${message.complete ? 'bg-emerald-500/12 text-emerald-400' : 'bg-violet-500/12 text-violet-400'}`}>
              <i className={`fas ${message.complete ? 'fa-check' : 'fa-circle-notch fa-spin'}`} />
            </span>
            <div>
              <div className="text-xs font-semibold text-[var(--text-primary)]">Agent workflow</div>
              <div className="mt-0.5 text-[9px] text-[var(--text-secondary)]">{message.complete ? 'Execution completed' : (message.label || 'Working through the retrieval graph…')}</div>
            </div>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold ${message.complete ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/25 bg-amber-500/10 text-amber-400'}`}>
            {message.complete ? `${completedEvents} steps done` : `${eventCount} events`}
          </span>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--bg-primary)]">
          <div className={`h-full rounded-full bg-[image:var(--accent-gradient)] transition-all duration-500 ${message.complete ? 'w-full' : 'w-2/3 animate-pulse'}`} />
        </div>
      </div>
      <div className="max-h-96 overflow-y-auto px-3 py-2">
        {message.events?.length ? message.events.map((event) => (
          <EventRow key={event.id} event={event} />
        )) : (
          <div className="flex items-center gap-2 py-2 text-[10px] text-[var(--text-secondary)]">
            <i className="fas fa-circle-notch fa-spin text-[var(--accent-primary)]" />
            {message.label || 'Waiting for the backend agent…'}
          </div>
        )}
      </div>
    </div>
  );
}

const frameActionClass = 'flex h-8 min-w-0 items-center justify-center rounded-lg border border-white/10 bg-slate-950/90 text-[10px] text-white shadow-md transition-all hover:-translate-y-0.5 hover:border-transparent';

function AgentFrameCard({
  frame,
  rank,
  vote,
  onVote,
  onZoom,
  onPreview,
  onContext,
  onQuickSearch,
  onPushToTeam,
  onPushToTrake,
  onDresSubmit,
  onToggleLock,
}) {
  const imageUrl = getImageUrl(frame.url || frame.frame_name || frame.filepath);
  const handleClick = (event) => {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.altKey) return onContext({ ...frame, contextView: 'video-timeline' });
    if (event.altKey) return onToggleLock(frame);
    if (ctrl && event.shiftKey) return onQuickSearch(frame);
    if (ctrl) return onContext({ ...frame, contextView: 'neighbors' });
    onZoom(imageUrl);
  };

  return (
    <div
      className={`group relative aspect-video cursor-pointer overflow-hidden rounded-2xl border bg-[var(--card-bg)] shadow-[var(--shadow-heavy)] transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${vote === 'positive' ? 'border-emerald-400 ring-2 ring-emerald-400/35' : vote === 'negative' ? 'border-rose-500 opacity-70 ring-2 ring-rose-500/35' : 'border-[var(--border-color)] hover:border-[var(--border-hover)]'}`}
      onClick={handleClick}
      onContextMenu={(event) => {
        event.preventDefault();
        onPreview(frame.video_id, frame.frame_id);
      }}
    >
      <img src={imageUrl} alt={frame.frame_name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.035]" loading="lazy" />
      <div className="absolute left-2 top-2 flex h-7 items-center rounded-lg border border-white/20 bg-black/75 px-2.5 font-mono text-[9px] font-bold text-white shadow-lg backdrop-blur-md">
        <span className="mr-1 text-violet-300">#</span>{rank}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent px-2 pb-2 pt-12">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-mono text-[9px] font-medium text-white">{frame.frame_name}</div>
            <div className="mt-0.5 text-[8px] text-white/55">{frame.video_id || 'Unknown video'}{frame.score !== undefined ? ` · ${(Number(frame.score) * 100).toFixed(1)}%` : ''}</div>
          </div>
          {vote && <i className={`fas ${vote === 'positive' ? 'fa-thumbs-up text-emerald-400' : 'fa-thumbs-down text-rose-400'} mb-0.5`} />}
        </div>
      </div>

      <div className="absolute inset-0 bg-black/10 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
        <div className="absolute right-2 top-2 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/45 p-1 backdrop-blur-md">
          <button type="button" onClick={(event) => { event.stopPropagation(); onVote(frame, 'positive'); }} className={`${frameActionClass} w-8 ${vote === 'positive' ? 'bg-emerald-500 text-white' : 'text-emerald-400 hover:bg-emerald-500 hover:text-white'}`} title="Mark as relevant"><i className="fas fa-thumbs-up" /></button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onVote(frame, 'negative'); }} className={`${frameActionClass} w-8 ${vote === 'negative' ? 'bg-rose-500 text-white' : 'text-rose-400 hover:bg-rose-500 hover:text-white'}`} title="Mark as irrelevant"><i className="fas fa-thumbs-down" /></button>
        </div>

        <div className="absolute inset-x-2 bottom-10 grid grid-cols-6 gap-1 rounded-xl border border-white/10 bg-black/45 p-1 backdrop-blur-md">
          <button type="button" onClick={(event) => { event.stopPropagation(); onPreview(frame.video_id, frame.frame_id); }} className={`${frameActionClass} hover:bg-violet-500`} title="Open video"><i className="fas fa-play" /></button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onContext(frame); }} className={`${frameActionClass} hover:bg-blue-500`} title="View neighbors"><i className="fas fa-layer-group" /></button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onQuickSearch(frame); }} className={`${frameActionClass} hover:bg-cyan-500`} title="Similarity search"><i className="fas fa-magnifying-glass-plus" /></button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onPushToTeam(frame); }} className={`${frameActionClass} hover:bg-slate-500`} title="Send to Team"><i className="fas fa-users" /></button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onPushToTrake(frame); }} className={`${frameActionClass} hover:bg-rose-500`} title="Pin to Trake"><i className="fas fa-thumbtack" /></button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onDresSubmit(frame); }} className={`${frameActionClass} hover:bg-emerald-500`} title="Submit to DRES"><i className="fas fa-paper-plane" /></button>
        </div>
      </div>
    </div>
  );
}

function ResultMessage({ message, votes, onVote, onPushQueries, frameActions }) {
  const [showCanvas, setShowCanvas] = useState(false);
  const successfulRound = message.rounds?.find((round) => round.satisfied);
  return (
    <div className="w-full overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-heavy)]">
      <div className="border-b border-[var(--border-color)] bg-[var(--glass-bg)] px-5 py-5 md:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/25"><i className="fas fa-sparkles" /></div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Retrieval complete</h2>
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${successfulRound ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/25 bg-amber-500/10 text-amber-400'}`}>
                  {successfulRound ? `Matched in round ${successfulRound.round}` : 'Best available matches'}
                </span>
              </div>
              <p className="mt-2 max-w-4xl whitespace-pre-wrap text-xs leading-5 text-[var(--text-secondary)]">{message.text}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 lg:w-[310px]">
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/55 px-3 py-2.5 text-center">
              <div className="text-base font-semibold text-[var(--text-primary)]">{message.frames?.length || 0}</div>
              <div className="text-[8px] uppercase tracking-wider text-[var(--text-secondary)]">Frames</div>
            </div>
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/55 px-3 py-2.5 text-center">
              <div className="text-base font-semibold text-[var(--text-primary)]">{message.rounds?.length || 0}</div>
              <div className="text-[8px] uppercase tracking-wider text-[var(--text-secondary)]">Rounds</div>
            </div>
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/55 px-3 py-2.5 text-center">
              <div className="text-base font-semibold text-[var(--text-primary)]">{message.topK}</div>
              <div className="text-[8px] uppercase tracking-wider text-[var(--text-secondary)]">Top K</div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 md:p-6">
        <div className="min-w-0">
          {message.rounds?.length > 0 && (
            <div className="grid gap-2.5">
              <div className="flex flex-wrap gap-2">
                {message.rounds.map((round) => (
                  <span key={round.round} title={round.analysis} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[9px] font-medium ${round.satisfied ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-[var(--border-color)] bg-[var(--bg-primary)]/40 text-[var(--text-secondary)]'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${round.satisfied ? 'bg-emerald-400' : 'bg-amber-400'}`} /> Round {round.round} · {round.candidate_count} frames · kept {round.selected_frames?.length || 0}
                  </span>
                ))}
              </div>
              {message.rounds.some((round) => round.selected_frames?.length) && (
                <div className="overflow-hidden rounded-2xl border border-emerald-500/20 bg-emerald-500/5">
                  <div className="border-b border-emerald-500/15 px-4 py-3 text-[10px] font-semibold text-emerald-300">
                    <i className="fas fa-bookmark mr-2" /> Frames kept by the critic after each round
                  </div>
                  <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {message.rounds.flatMap((round) => (round.selected_frames || []).map((frame) => (
                      <button
                        type="button"
                        key={`round-${round.round}-${frame.frame_name}`}
                        onClick={() => frameActions.onZoom(getImageUrl(frame.url || frame.frame_name || frame.filepath))}
                        className="group flex min-w-0 items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/55 p-2 text-left transition-colors hover:border-emerald-400/50"
                        title={`View ${frame.frame_name}`}
                      >
                        <img src={getImageUrl(frame.url || frame.frame_name || frame.filepath)} alt={frame.frame_name} className="h-12 w-20 flex-shrink-0 rounded-lg object-cover" loading="lazy" />
                        <span className="min-w-0"><span className="block text-[9px] font-bold text-emerald-400">Round {round.round} · kept</span><span className="mt-1 block truncate font-mono text-[9px] text-[var(--text-primary)]">{frame.frame_name}</span></span>
                      </button>
                    )))}
                  </div>
                </div>
              )}
            </div>
          )}
          <QueryBlock queries={message.queries} onPush={onPushQueries} />
        </div>

      {message.canvasImage && (
        <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/45">
          <button type="button" onClick={() => setShowCanvas((current) => !current)} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--glass-bg)]">
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400"><i className="fas fa-table-cells-large" /></span>
              <span><span className="block text-xs font-semibold text-[var(--text-primary)]">Visual critic canvas</span><span className="mt-0.5 block text-[9px] text-[var(--text-secondary)]">Inspect the contact sheet evaluated by Qwen · Top {message.topK}</span></span>
            </span>
            <i className={`fas fa-chevron-down text-[9px] transition-transform ${showCanvas ? 'rotate-180' : ''}`} />
          </button>
          {showCanvas && <div className="border-t border-[var(--border-color)] p-3"><img src={message.canvasImage} alt={`Top ${message.topK} critic contact sheet`} className="w-full rounded-xl border border-[var(--border-color)] bg-white object-contain" /></div>}
        </div>
      )}

      <div className="mt-7 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border-color)] pb-3">
        <div>
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">Critic-selected results</h3>
          <p className="mt-1 text-[9px] text-[var(--text-secondary)]">Only frames explicitly kept by the critic across all rounds · hover a frame for actions</p>
        </div>
        <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)]/40 px-3 py-1 font-mono text-[9px] text-[var(--text-secondary)]">{message.frames?.length || 0} of {message.topK}</span>
      </div>
      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
        {(message.frames || []).map((frame, index) => (
          <AgentFrameCard key={frame.frame_name || frame.url} frame={frame} rank={index + 1} vote={votes[frame.frame_name]} onVote={onVote} {...frameActions} />
        ))}
      </div>
      </div>
    </div>
  );
}

function TopKSelector({ value, onChange, disabled }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="hidden whitespace-nowrap text-[9px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] sm:block">Canvas size</span>
      <div className="flex min-w-0 overflow-x-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-1">
        {TOP_K_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option)}
            className={`h-7 min-w-8 rounded-lg px-2 text-[9px] font-bold transition-all disabled:opacity-40 ${value === option ? 'bg-[var(--accent-primary)] text-[var(--bg-primary)] shadow-md' : 'text-[var(--text-secondary)] hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]'}`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

const EXAMPLE_PROMPTS = [
  { icon: 'fa-dragon', title: 'Visual attributes', text: 'A white lion dance costume performing outdoors in front of a crowd' },
  { icon: 'fa-newspaper', title: 'Text on screen', text: 'A television news frame showing the words "thời tiết" on screen' },
  { icon: 'fa-person-walking-arrow-right', title: 'Event sequence', text: 'A person enters a room, sits at a table, and starts using a laptop' },
];

function WelcomeMessage({ onSelectPrompt }) {
  return (
    <div className="mx-auto w-full max-w-5xl py-4 md:py-10">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-violet-400/20 bg-violet-500/10 text-2xl text-violet-400 shadow-2xl shadow-violet-500/10">
          <i className="fas fa-cube" />
        </div>
        <div className="mt-5 text-[10px] font-bold uppercase tracking-[0.28em] text-[var(--accent-primary)]">Multimodal video retrieval</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text-primary)] md:text-3xl">What frame are you looking for?</h1>
        <p className="mx-auto mt-3 max-w-2xl text-xs leading-5 text-[var(--text-secondary)]">
          Describe a scene naturally. The agent plans visual, OCR, and ASR queries, evaluates a critic canvas, and refines weak results automatically.
        </p>
      </div>
      <div className="mt-7 grid gap-3 md:grid-cols-3">
        {EXAMPLE_PROMPTS.map((example) => (
          <button
            key={example.title}
            type="button"
            onClick={() => onSelectPrompt(example.text)}
            className="group rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 text-left shadow-lg transition-all hover:-translate-y-1 hover:border-[var(--border-hover)] hover:bg-[var(--glass-bg)]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--glass-bg)] text-sm text-[var(--accent-primary)] transition-transform group-hover:scale-105"><i className={`fas ${example.icon}`} /></span>
            <span className="mt-3 block text-[11px] font-semibold text-[var(--text-primary)]">{example.title}</span>
            <span className="mt-1.5 block text-[10px] leading-4 text-[var(--text-secondary)]">{example.text}</span>
            <span className="mt-3 inline-flex items-center gap-1 text-[9px] font-semibold text-[var(--accent-primary)]">Use prompt <i className="fas fa-arrow-right text-[8px] transition-transform group-hover:translate-x-1" /></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TextMessage({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex w-full items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border ${message.error ? 'border-rose-500/25 bg-rose-500/10 text-rose-400' : 'border-violet-500/25 bg-violet-500/10 text-violet-400'}`}>
          <i className={`fas ${message.error ? 'fa-triangle-exclamation' : 'fa-cube'} text-xs`} />
        </span>
      )}
      <div className={`max-w-3xl rounded-2xl px-4 py-3 text-xs leading-5 shadow-md ${isUser ? 'rounded-tr-md bg-[var(--accent-primary)] text-[var(--bg-primary)]' : `rounded-tl-md border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] ${message.error ? 'border-rose-500/30 text-rose-400' : ''}`}`}>
        <div className="whitespace-pre-wrap">{message.text}</div>
      </div>
    </div>
  );
}

function ResearchOptions({ message, loading, onSelect }) {
  return (
    <div className="mr-auto w-full max-w-4xl overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-heavy)]">
      <div className="border-b border-[var(--border-color)] bg-blue-500/5 px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-400"><i className="fas fa-globe" /></span>
          <div>
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">Choose the intended interpretation</h3>
            <p className="mt-1 text-[10px] leading-4 text-[var(--text-secondary)]">{message.text || 'Gemini found multiple possible meanings. Select one to continue.'}</p>
          </div>
        </div>
      </div>
      <div className="grid gap-2.5 p-4 md:grid-cols-2">
        {message.options.map((option, index) => (
          <button key={`${option.option}-${index}`} type="button" disabled={message.selected !== undefined || loading} onClick={() => onSelect(message.id, index)} className={`group rounded-2xl border p-4 text-left transition-all disabled:cursor-default ${message.selected === index ? 'border-[var(--accent-primary)] bg-[var(--glass-bg)] ring-1 ring-[var(--accent-primary)]' : 'border-[var(--border-color)] bg-[var(--bg-primary)]/35 hover:-translate-y-0.5 hover:border-[var(--border-hover)] hover:bg-[var(--glass-bg)]'}`}>
            <span className="flex items-start gap-3">
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[10px] font-bold text-[var(--accent-primary)]">{index + 1}</span>
              <span className="min-w-0"><span className="block text-[11px] font-semibold text-[var(--text-primary)]">{option.option}</span><span className="mt-1.5 block text-[10px] leading-4 text-[var(--text-secondary)]">{option.explain}</span></span>
            </span>
          </button>
        ))}
        <button type="button" disabled={message.selected !== undefined || loading} onClick={() => onSelect(message.id, null)} className="rounded-2xl border border-dashed border-[var(--border-color)] p-4 text-left text-[10px] text-[var(--text-secondary)] transition-all hover:border-[var(--border-hover)] hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)] disabled:cursor-default md:col-span-2">
          <i className="fas fa-arrow-rotate-left mr-2" /> None of these — keep the original request
        </button>
      </div>
    </div>
  );
}

export default function AgentWorkspace({
  searchModel,
  backgroundAgentJob = null,
  onPushQueries,
  onZoom,
  onPreview,
  onContext,
  onQuickSearch,
  onPushToTeam,
  onPushToTrake,
  onDresSubmit,
  onToggleLock,
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [sessionId, setSessionId] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [research, setResearch] = useState(false);
  const [topK, setTopK] = useState(20);
  const [loading, setLoading] = useState(false);
  const [awaitingOption, setAwaitingOption] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [votes, setVotes] = useState({});
  const bottomRef = useRef(null);
  const pollTokenRef = useRef(0);
  const displayedBackgroundResultRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  useEffect(() => () => {
    pollTokenRef.current += 1;
  }, []);

  const modelPayload = useMemo(() => buildModelPayload(searchModel), [searchModel]);

  const updatePipelineEvents = (messageId, events, complete = false) => {
    setMessages((previous) => previous.map((item) => item.id === messageId
      ? { ...item, events: mergeEvents(item.events, events), complete: complete || item.complete }
      : item));
  };

  const beginEventPolling = (activeSessionId, label) => {
    const messageId = `pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const token = pollTokenRef.current + 1;
    pollTokenRef.current = token;
    setMessages((previous) => [...previous, {
      id: messageId,
      role: 'assistant',
      type: 'pipeline',
      label,
      events: [],
      complete: false,
    }]);

    const poll = async () => {
      let afterId = 0;
      while (pollTokenRef.current === token) {
        try {
          const response = await getAgentEvents(activeSessionId, afterId);
          if (pollTokenRef.current !== token) break;
          if (response.events?.length) {
            updatePipelineEvents(messageId, response.events);
            afterId = response.last_event_id || afterId;
          }
        } catch (error) {
          if (!String(error.message).includes('not found')) console.debug('Agent event polling:', error.message);
        }
        await sleep(700);
      }
    };
    poll();
    return { messageId, token };
  };

  const finishEventPolling = async (run, activeSessionId, responseEvents = []) => {
    if (pollTokenRef.current === run.token) pollTokenRef.current += 1;
    let finalEvents = responseEvents;
    try {
      const response = await getAgentEvents(activeSessionId, 0);
      finalEvents = mergeEvents(finalEvents, response.events || []);
    } catch (error) {
      console.debug('Final agent event fetch:', error.message);
    }
    updatePipelineEvents(run.messageId, finalEvents, true);
  };

  const appendCompleted = (response) => {
    setSessionId(response.session_id);
    setMessages((previous) => [...previous, {
      id: `result-${Date.now()}`,
      role: 'assistant',
      type: 'result',
      text: response.assistant_message,
      queries: response.queries,
      frames: response.frames || [],
      rounds: response.rounds || [],
      topK: response.top_k || topK,
      canvasImage: response.canvas_image || '',
    }]);
    setVotes({});
    setFeedback('');
    setAwaitingOption(false);
  };

  useEffect(() => {
    const response = backgroundAgentJob?.response;
    if (!response || displayedBackgroundResultRef.current === backgroundAgentJob.sessionId) return;
    displayedBackgroundResultRef.current = backgroundAgentJob.sessionId;
    appendCompleted(response);
  }, [backgroundAgentJob]);

  const handleSend = async () => {
    const message = prompt.trim();
    if (!message || loading || awaitingOption) return;
    const activeSessionId = createSessionId();
    if (sessionId) deleteAgentSession(sessionId).catch((error) => console.debug('Old agent session cleanup:', error.message));
    setSessionId(activeSessionId);
    setPrompt('');
    setLoading(true);
    setMessages((previous) => [...previous, { id: `user-${Date.now()}`, role: 'user', type: 'text', text: message }]);
    const run = beginEventPolling(activeSessionId, research ? 'Starting Gemini research…' : 'Starting retrieval pipeline…');
    try {
      const response = await sendAgentMessage({
        session_id: activeSessionId,
        message,
        use_research: research,
        top_k: topK,
        ...modelPayload,
      });
      await finishEventPolling(run, activeSessionId, response.events || []);
      if (response.status === 'awaiting_option') {
        setMessages((previous) => [...previous, {
          id: `options-${Date.now()}`,
          role: 'assistant',
          type: 'options',
          text: response.assistant_message,
          options: response.options || [],
          selected: undefined,
        }]);
        setAwaitingOption(true);
      } else {
        appendCompleted(response);
      }
    } catch (error) {
      await finishEventPolling(run, activeSessionId);
      toast.error(`Agent failed: ${error.message}`);
      setMessages((previous) => [...previous, { id: `error-${Date.now()}`, role: 'assistant', type: 'text', error: true, text: `The request could not be completed: ${error.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOption = async (messageId, optionIndex) => {
    if (loading || !sessionId) return;
    setLoading(true);
    setMessages((previous) => previous.map((item) => item.id === messageId ? { ...item, selected: optionIndex } : item));
    const run = beginEventPolling(sessionId, `Generating queries and searching the top ${topK} frames…`);
    try {
      const response = await selectAgentOption({
        session_id: sessionId,
        option_index: optionIndex,
        top_k: topK,
        ...modelPayload,
      });
      await finishEventPolling(run, sessionId, response.events || []);
      appendCompleted(response);
    } catch (error) {
      await finishEventPolling(run, sessionId);
      toast.error(`Agent failed: ${error.message}`);
      setMessages((previous) => previous.map((item) => item.id === messageId ? { ...item, selected: undefined } : item));
      setMessages((previous) => [...previous, { id: `error-${Date.now()}`, role: 'assistant', type: 'text', error: true, text: `Search could not be completed: ${error.message}` }]);
      setAwaitingOption(true);
    } finally {
      setLoading(false);
    }
  };

  const handleVote = (frame, value) => {
    setVotes((previous) => ({
      ...previous,
      [frame.frame_name]: previous[frame.frame_name] === value ? undefined : value,
    }));
  };

  const handleFeedback = async () => {
    const positive = Object.entries(votes).filter(([, value]) => value === 'positive').map(([name]) => name);
    const negative = Object.entries(votes).filter(([, value]) => value === 'negative').map(([name]) => name);
    if (!feedback.trim() && positive.length === 0 && negative.length === 0) {
      toast.error('Enter feedback or mark at least one frame as relevant/irrelevant.');
      return;
    }
    setLoading(true);
    setMessages((previous) => [...previous, {
      id: `feedback-${Date.now()}`,
      role: 'user',
      type: 'text',
      text: feedback.trim() || `Frame feedback: ${positive.length} relevant, ${negative.length} irrelevant.`,
    }]);
    const run = beginEventPolling(sessionId, 'Applying feedback and rerunning retrieval…');
    try {
      const response = await sendAgentFeedback({
        session_id: sessionId,
        feedback: feedback.trim(),
        positive_frame_names: positive,
        negative_frame_names: negative,
        top_k: topK,
        ...modelPayload,
      });
      await finishEventPolling(run, sessionId, response.events || []);
      appendCompleted(response);
    } catch (error) {
      await finishEventPolling(run, sessionId);
      toast.error(`Feedback failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleNewChat = async () => {
    pollTokenRef.current += 1;
    try {
      await deleteAgentSession(sessionId);
    } catch (error) {
      console.debug('Agent session cleanup:', error.message);
    }
    setSessionId(null);
    setMessages(initialMessages());
    setPrompt('');
    setFeedback('');
    setVotes({});
    setAwaitingOption(false);
  };

  const frameActions = {
    onZoom, onPreview, onContext, onQuickSearch, onPushToTeam,
    onPushToTrake, onDresSubmit, onToggleLock,
  };
  const hasResult = messages.some((message) => message.type === 'result');
  // A Search-mode Ctrl+Enter task arrives through backgroundAgentJob before
  // this workspace owns a local message, so it must also hide the landing UI.
  const hasStartedSearch = Boolean(backgroundAgentJob)
    || messages.some((message) => message.type !== 'welcome');
  const positiveVoteCount = Object.values(votes).filter((value) => value === 'positive').length;
  const negativeVoteCount = Object.values(votes).filter((value) => value === 'negative').length;
  const activeModelLabel = modelPayload.models.map((model) => model.replaceAll('_', ' ')).join(' + ');

  return (
    <div className="relative flex h-full w-full isolate flex-col overflow-hidden bg-[var(--bg-primary)]">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-70" style={{ backgroundImage: 'radial-gradient(circle at 15% 0%, color-mix(in srgb, var(--accent-primary) 12%, transparent), transparent 28%), radial-gradient(circle at 85% 15%, color-mix(in srgb, var(--accent-secondary) 8%, transparent), transparent 24%)' }} />

      <div className="z-10 flex items-center justify-between gap-4 border-b border-[var(--border-color)] bg-[var(--card-bg)]/88 px-4 py-3 backdrop-blur-xl md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-primary)] text-[var(--bg-primary)] shadow-lg"><i className="fas fa-cube" /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">OpenCubee Agent</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online</span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-[9px] text-[var(--text-secondary)]">
              <span className="truncate capitalize"><i className="fas fa-microchip mr-1 text-[var(--accent-primary)]" />{activeModelLabel}</span>
              <span className="text-[var(--border-hover)]">•</span>
              <span className="whitespace-nowrap">Qwen critic · 3 rounds max</span>
            </div>
          </div>
        </div>
        <button type="button" onClick={handleNewChat} disabled={loading} className="inline-flex h-9 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--glass-bg)] px-3 text-[10px] font-semibold text-[var(--text-secondary)] shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--border-hover)] hover:text-[var(--text-primary)] disabled:opacity-40">
          <i className="fas fa-pen-to-square sm:mr-2" /><span className="hidden sm:inline">New chat</span>
        </button>
      </div>

      <div className="flex-grow overflow-y-auto px-3 py-5 md:px-6 md:py-7">
        <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
          {backgroundAgentJob?.status === 'running' && (
            <PipelineLog message={{
              id: `background-agent-${backgroundAgentJob.sessionId}`,
              label: 'Background search from Search mode is running…',
              events: backgroundAgentJob.events || [],
              complete: false,
            }} />
          )}
          {backgroundAgentJob?.status === 'failed' && (
            <TextMessage message={{
              id: `background-agent-error-${backgroundAgentJob.sessionId}`,
              role: 'assistant',
              error: true,
              text: `Background agent search failed: ${backgroundAgentJob.error}`,
            }} />
          )}
          {messages.map((message) => (
            message.type === 'result' ? (
              <ResultMessage key={message.id} message={message} votes={votes} onVote={handleVote} onPushQueries={onPushQueries} frameActions={frameActions} />
            ) : message.type === 'pipeline' ? (
              <PipelineLog key={message.id} message={message} />
            ) : message.type === 'options' ? (
              <ResearchOptions key={message.id} message={message} loading={loading} onSelect={handleSelectOption} />
            ) : message.type === 'welcome' ? (
              !hasStartedSearch ? <WelcomeMessage key={message.id} onSelectPrompt={setPrompt} /> : null
            ) : (
              <TextMessage key={message.id} message={message} />
            )
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="z-10 border-t border-[var(--border-color)] bg-[var(--card-bg)]/92 px-3 py-3 shadow-[0_-16px_40px_rgba(0,0,0,0.12)] backdrop-blur-xl md:px-6">
        <div className="mx-auto w-full max-w-6xl">
          {hasResult && !awaitingOption && (
            <div className="mb-3 overflow-hidden rounded-2xl border border-violet-500/20 bg-violet-500/5">
              <div className="flex flex-col gap-2 p-2 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-grow items-center gap-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3">
                  <i className="fas fa-wand-magic-sparkles text-xs text-violet-400" />
                  <input value={feedback} onChange={(event) => setFeedback(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) handleFeedback(); }} disabled={loading} placeholder="Tell the agent what to correct, e.g. the lion must be white…" className="h-10 min-w-0 flex-grow bg-transparent text-[11px] outline-none placeholder:text-[var(--text-secondary)]" />
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-start">
                  <div className="flex gap-1.5">
                    <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-[9px] font-semibold text-emerald-400"><i className="fas fa-thumbs-up mr-1" />{positiveVoteCount}</span>
                    <span className="rounded-lg bg-rose-500/10 px-2 py-1 text-[9px] font-semibold text-rose-400"><i className="fas fa-thumbs-down mr-1" />{negativeVoteCount}</span>
                  </div>
                  <button type="button" onClick={handleFeedback} disabled={loading} className="inline-flex h-10 items-center justify-center rounded-xl bg-violet-500 px-4 text-[10px] font-semibold text-white shadow-lg shadow-violet-500/15 transition-all hover:-translate-y-0.5 hover:bg-violet-400 disabled:opacity-40"><i className="fas fa-rotate mr-2" /> Refine results</button>
                </div>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-[var(--shadow-heavy)] transition-all focus-within:border-[var(--border-hover)] focus-within:ring-2 focus-within:ring-[var(--accent-primary)]/10">
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSend(); } }} disabled={loading || awaitingOption} rows={2} placeholder={awaitingOption ? 'Choose a research option above to continue…' : 'Describe the scene, visible text, spoken words, or sequence of events…'} className="max-h-40 min-h-[58px] w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-xs leading-5 outline-none placeholder:text-[var(--text-secondary)] disabled:opacity-50" />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)] px-2 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <button type="button" onClick={() => setResearch((value) => !value)} disabled={loading || awaitingOption} className={`inline-flex h-8 items-center justify-center rounded-xl border px-3 text-[9px] font-semibold transition-all ${research ? 'border-blue-400/40 bg-blue-500/12 text-blue-400' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]'}`} title="Use Gemini research before retrieval">
                  <i className="fas fa-globe mr-1.5" /> Research
                  <span className={`ml-2 h-1.5 w-1.5 rounded-full ${research ? 'bg-blue-400' : 'bg-[var(--text-secondary)]'}`} />
                </button>
                <TopKSelector value={topK} onChange={setTopK} disabled={loading} />
              </div>
              <button type="button" onClick={handleSend} disabled={loading || awaitingOption || !prompt.trim()} className="flex h-9 items-center justify-center rounded-xl bg-[var(--accent-primary)] px-3.5 text-[10px] font-semibold text-[var(--bg-primary)] shadow-lg transition-all hover:-translate-y-0.5 disabled:opacity-30 disabled:hover:translate-y-0" title="Send request">
                {loading ? <><i className="fas fa-circle-notch fa-spin mr-2" />Working</> : <><span className="hidden sm:inline">Search with Agent</span><i className="fas fa-arrow-up sm:ml-2" /></>}
              </button>
            </div>
          </div>
          <p className="mt-1.5 hidden text-center text-[8px] text-[var(--text-secondary)] sm:block">Enter to send · Shift+Enter for a new line · Click a frame to zoom · Right-click to preview video</p>
        </div>
      </div>
    </div>
  );
}
