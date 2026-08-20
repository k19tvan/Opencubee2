// src/App.jsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import TopToolbar from './components/TopToolbar';
import LeftSearchPanel from './components/LeftSearchPanel';
import RightResultsPanel from './components/RightResultsPanel';
import AgentWorkspace from './components/AgentWorkspace';
import UsernameModal from './components/modals/UsernameModal';
import ObjectFilterModal from './components/modals/ObjectFilterModal';
import VideoPreviewModal from './components/modals/VideoPreviewModal';
import FrameContextModal from './components/modals/FrameContextModal';
import QASubmitModal from './components/modals/QASubmitModal';
import TrakeFramePreviewSidebar from './components/TrakeFramePreviewSidebar';
import HelpModal from './components/modals/HelpModal';
import {
  BASE_URL,
  enhanceQuery,
  searchSingle,
  searchTemporal,
  searchSemanticAsr,
  getWsUrl,
  DRES_BASE_URL,
  getAgentEvents,
  sendAgentMessage,
  uploadSoloAIZip,
  getVideoThumbnailUrl
} from './api';
import { getImageUrl } from './utils/imageUrl';
import { getDresFrameNumber } from './utils/frameNumber';

const createEmptyStage = () => ({
  id: Date.now(),
  queryText: '',
  ocrText: '',
  asrText: '',
  ocrActive: true,
  asrActive: true,
  queryType: 'text',
  options: { enhance: false, bge_caption: false },
});

const formatFinalQuery = (stage = {}) => {
  const primary = stage.queryType === 'image'
    ? (stage.imageText || '').trim()
    : (stage.queryText || '').trim();
  const parts = [
    primary,
    stage.ocrActive && stage.ocrText?.trim() ? `OCR: ${stage.ocrText.trim()}` : null,
    stage.asrActive && stage.asrText?.trim() ? `ASR: ${stage.asrText.trim()}` : null,
  ].filter(Boolean);
  return parts.join(' | ');
};

const MAX_GO_BACK_STEPS = 10;
const WORKSPACE_HISTORY_STORAGE_KEY = 'opencubee2.workspaceHistory';
const WORKSPACE_HISTORY_STATE_KEY = 'opencubee2WorkspaceId';

const getShotKey = (shot = {}) => shot.filepath || shot.frame_name || shot.url || (shot.video_id && shot.frame_id ? `${shot.video_id}_${shot.frame_id}` : '');

const collectFrameNames = (results = []) => {
  const frameNames = new Set();
  const visit = (item) => {
    if (!item || typeof item !== 'object') return;
    if (item.frame_name) frameNames.add(item.frame_name);
    if (item.best_shot) visit(item.best_shot);
    (item.shots || []).forEach(visit);
    (item.clusters || []).forEach(visit);
  };
  results.forEach(visit);
  return [...frameNames];
};

const cloneState = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const createHistoryId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const THEME_OPTIONS = ['normal', 'dark', 'light', 'blue', 'neon', 'jujutsu', 'random'];
const RANDOM_THEME_OPTIONS = ['normal', 'dark', 'light', 'blue', 'neon', 'jujutsu'];
export const SEARCH_MODEL_OPTIONS = [
  { value: 'beit3', label: 'BEiT-3', icon: 'fas fa-cubes' },
  { value: 'bge', label: 'BGE-VL', icon: 'fas fa-language' },
  { value: 'jina_v5_omni', label: 'Jina v5', icon: 'fas fa-globe' },
  { value: 'metaclip2', label: 'MetaCLIP 2', icon: 'fas fa-bolt' },
  { value: 'fgclip2', label: 'FG-CLIP 2', icon: 'fas fa-image' },
];
export const DEFAULT_SEARCH_MODEL = ['beit3'];

const normalizeSearchModel = (values, fallback = []) => {
  if (!Array.isArray(values)) {
    const valStr = String(values);
    if (valStr === 'all') return ['bge', 'beit3', 'jina_v5_omni', 'metaclip2', 'fgclip2'];
    if (valStr === 'both') return ['bge', 'beit3'];
    if (SEARCH_MODEL_OPTIONS.some((o) => o.value === valStr)) return [valStr];
    return fallback;
  }
  const valid = values.filter(v => SEARCH_MODEL_OPTIONS.some(o => o.value === v));
  return valid.length > 0 ? valid : fallback;
};

const buildSearchModelPayload = (values) => {
  const selectedModels = normalizeSearchModel(values, DEFAULT_SEARCH_MODEL);
  if (!selectedModels || selectedModels.length === 0) return null;
  const weight = 1 / selectedModels.length;
  return {
    models: selectedModels,
    model_weights: selectedModels.reduce((acc, model) => ({ ...acc, [model]: weight }), {}),
  };
};

function AgentResultsToast({ toastInstance, frames = [], onZoom, onOpenAgent }) {
  const visibleFrames = frames.slice(0, 20);
  const hasResults = visibleFrames.length > 0;
  return (
    <div className={`w-[min(900px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--border-hover)] bg-[var(--card-bg)] text-[var(--text-primary)] shadow-[var(--shadow-heavy)] backdrop-blur-xl transition-all duration-500 ease-out ${toastInstance.visible ? 'agent-result-toast-enter translate-x-0 opacity-100' : 'translate-x-[calc(100%+2rem)] opacity-0'}`}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--glass-bg)] text-[var(--accent-primary)]"><i className={`fas ${hasResults ? 'fa-check' : 'fa-magnifying-glass'} text-[10px]`} /></span>
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold text-[var(--text-primary)]">{hasResults ? `Agent tìm thấy ${frames.length} kết quả` : 'Không tìm thấy kết quả phù hợp'}</span>
            <span className="block text-[8px] text-[var(--text-secondary)]">{hasResults ? 'Kéo ngang để xem · bấm frame để phóng to' : 'Bạn có thể mở tab Agent để xem lại pipeline và query'}</span>
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <button type="button" onClick={onOpenAgent} className="h-7 rounded-lg border border-[var(--border-color)] px-2.5 text-[9px] font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--glass-bg)]">Mở Agent</button>
          <button type="button" onClick={() => toast.dismiss(toastInstance.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--glass-bg)] hover:text-[var(--text-primary)]" title="Đóng"><i className="fas fa-xmark text-[10px]" /></button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto p-2.5 pb-3">
        {visibleFrames.length ? visibleFrames.map((frame, index) => {
          const imageUrl = getImageUrl(frame.url || frame.frame_name || frame.filepath);
          return (
            <button key={`${frame.frame_name || imageUrl}-${index}`} type="button" onClick={() => onZoom(imageUrl)} className="group relative h-20 w-36 flex-shrink-0 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] text-left transition-all hover:-translate-y-0.5 hover:border-[var(--border-hover)] hover:shadow-[var(--shadow-heavy)]">
              <img src={imageUrl} alt={frame.frame_name || 'Agent result'} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
              <span className="absolute left-1.5 top-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[8px] font-bold text-white">#{index + 1}</span>
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/90 to-transparent px-1.5 pb-1 pt-5 font-mono text-[8px] text-white">{frame.frame_name || 'Frame'}</span>
            </button>
          );
        }) : <span className="px-2 py-3 text-[10px] text-[var(--text-secondary)]">Agent đã chạy xong nhưng critic không chọn frame nào.</span>}
      </div>
    </div>
  );
}

const readWorkspaceHistory = () => {
  try {
    const raw = sessionStorage.getItem(WORKSPACE_HISTORY_STORAGE_KEY);
    if (!raw) return { entries: [], currentId: null };
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      currentId: parsed.currentId || null,
    };
  } catch {
    return { entries: [], currentId: null };
  }
};

const writeWorkspaceHistory = (store) => {
  sessionStorage.setItem(WORKSPACE_HISTORY_STORAGE_KEY, JSON.stringify(store));
};

export default function App() {
  const [username, setUsername] = useState(sessionStorage.getItem('username') || '');
  const [userColor, setUserColor] = useState(sessionStorage.getItem('userColor') || '');
  const [showUserModal, setShowUserModal] = useState(!sessionStorage.getItem('username'));

  const handleJoinSession = useCallback((name) => {
    setUsername(name);
    sessionStorage.setItem('username', name);
    if (!sessionStorage.getItem('userColor')) {
      const color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
      setUserColor(color);
      sessionStorage.setItem('userColor', color);
    }
    setShowUserModal(false);
  }, []);

  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('videoSearchTheme') || 'dark';
    return THEME_OPTIONS.includes(savedTheme) ? savedTheme : 'dark';
  });
  const [randomTheme, setRandomTheme] = useState(() => RANDOM_THEME_OPTIONS[Math.floor(Math.random() * RANDOM_THEME_OPTIONS.length)]);
  const effectiveTheme = theme === 'random' ? randomTheme : theme;
  const [showTrake, setShowTrake] = useState(false);
  const [isClustered, setIsClustered] = useState(false);
  const [isAmbiguous, setIsAmbiguous] = useState(false);

  // Semantic ASR State
  const [isSemanticAsr, setIsSemanticAsr] = useState(false);
  const [semanticAsrQuery, setSemanticAsrQuery] = useState('');
  const [semanticAsrSearchMode, setSemanticAsrSearchMode] = useState('meilisearch');
  const [semanticAsrEmbeddingWeight, setSemanticAsrEmbeddingWeight] = useState(0.7);
  const [semanticAsrMeilisearchWeight, setSemanticAsrMeilisearchWeight] = useState(0.3);

  // Mobile responsive menu toggle
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState('search');

  const [activeModal, setActiveModal] = useState(null);
  const [previewVideoData, setPreviewVideoData] = useState(null);
  const [zoomedImage, setZoomedImage] = useState(null);
  const [isHoveringTrakePanel, setIsHoveringTrakePanel] = useState(false);
  const [hoveredFrame, setHoveredFrame] = useState(null);
  const [contextShot, setContextShot] = useState(null);

  const [stages, setStages] = useState([createEmptyStage()]);
  const [searchModel, setSearchModel] = useState(DEFAULT_SEARCH_MODEL);
  const [metaClipOnly, setMetaClipOnly] = useState(false);
  const [stageFocusRequest, setStageFocusRequest] = useState(null);

  const [searchResults, setSearchResults] = useState([]);
  const [similarityScope, setSimilarityScope] = useState(null);
  const [similarityScopeEnabled, setSimilarityScopeEnabled] = useState(false);
  const [lastFinalQueries, setLastFinalQueries] = useState([]);
  const [resultIsAmbiguous, setResultIsAmbiguous] = useState(false);
  const [teamworkFrames, setTeamworkFrames] = useState([]);
  const [stagedFramesByQuery, setStagedFramesByQuery] = useState({});
  const [trakePreviewShot, setTrakePreviewShot] = useState(null);
  const [qaPromptShot, setQaPromptShot] = useState(null);
  const [wrongFrames, setWrongFrames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [timingInfo, setTimingInfo] = useState(null);
  const [correctSubmission, setCorrectSubmission] = useState(null);

  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('opencubee_muted') === 'true';
  });
  const isMutedRef = useRef(isMuted);
  const playingAudioRef = useRef(null);
  const phonkIndexRef = useRef(0);

  useEffect(() => {
    isMutedRef.current = isMuted;
    localStorage.setItem('opencubee_muted', isMuted);
    if (playingAudioRef.current) {
      playingAudioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const [autoTranslate, setAutoTranslate] = useState(() => {
    const saved = localStorage.getItem('opencubee_auto_translate');
    return saved !== null ? saved === 'true' : true;
  });

  useEffect(() => {
    localStorage.setItem('opencubee_auto_translate', autoTranslate);
  }, [autoTranslate]);

  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [goBackDepth, setGoBackDepth] = useState(0);
  const [goForwardDepth, setGoForwardDepth] = useState(0);

  const [lockedVideos, setLockedVideos] = useState([]);

  // -- SoloAI Submission State --
  const [soloAIQueries, setSoloAIQueries] = useState([]);
  const [activeSoloQueryIndex, setActiveSoloQueryIndex] = useState(0);
  const [editTrakeRowIndex, setEditTrakeRowIndex] = useState(null);

  const activeSoloQueryFile = soloAIQueries[activeSoloQueryIndex]?.filename || 'default';
  const trakeFrames = useMemo(() => stagedFramesByQuery[activeSoloQueryFile] || [], [stagedFramesByQuery, activeSoloQueryFile]);

  const setTrakeFrames = useCallback((updater) => {
    setStagedFramesByQuery((prev) => {
      const current = prev[activeSoloQueryFile] || [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [activeSoloQueryFile]: next };
    });
  }, [activeSoloQueryFile]);

  const fetchSoloQueries = useCallback(async () => {
    try {
      const { getSoloAIQueries } = await import('./api');
      const res = await getSoloAIQueries();
      setSoloAIQueries(res.queries || []);
      if (res.queries && res.queries.length > 0) {
        setActiveSoloQueryIndex(prev => prev >= res.queries.length ? 0 : prev);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchSoloQueries();
    const handleRef = () => fetchSoloQueries();
    window.addEventListener('refreshSoloAIQueries', handleRef);
    return () => window.removeEventListener('refreshSoloAIQueries', handleRef);
  }, [fetchSoloQueries]);

  useEffect(() => {
    const activeQuery = soloAIQueries[activeSoloQueryIndex];
    if (!activeQuery || !activeQuery.submissions) return;

    const isQA = activeQuery.filename.toLowerCase().includes('qa');

    let loadedFrames = [];
    activeQuery.submissions.forEach(row => {
      const videoId = row[0];
      if (isQA) {
        if (row[1]) {
          const fId = row[1];
          loadedFrames.push({
            video_id: videoId,
            frame_id: fId,
            qaAnswer: row[2],
            url: getVideoThumbnailUrl(videoId, fId, 1920),
            frame_name: `${videoId}_${String(fId).padStart(6, '0')}.webp`,
            filepath: `csv-frame-${videoId}-${fId}`
          });
        }
      } else {
        row.slice(1).forEach(fId => {
          if (fId && !isNaN(Number(fId))) {
            loadedFrames.push({
              video_id: videoId,
              frame_id: fId,
              url: getVideoThumbnailUrl(videoId, fId, 1920),
              frame_name: `${videoId}_${String(fId).padStart(6, '0')}.webp`,
              filepath: `csv-frame-${videoId}-${fId}`
            });
          }
        });
      }
    });

    setStagedFramesByQuery(prev => {
      // Only populate from CSV if we haven't loaded or modified this query yet
      if (prev[activeQuery.filename] !== undefined) return prev;
      return {
        ...prev,
        [activeQuery.filename]: loadedFrames
      };
    });
  }, [soloAIQueries, activeSoloQueryIndex]);

  const [backgroundAgentJob, setBackgroundAgentJob] = useState(null);

  const socketRef = useRef(null);
  const [realtimeStatus, setRealtimeStatus] = useState('disconnected');
  const lastRealtimeWarningRef = useRef(0);
  const latestWorkspaceRef = useRef(null);
  const submittedStagesRef = useRef(null);
  const submittedSearchModelRef = useRef(DEFAULT_SEARCH_MODEL);
  const submittedSimilarityScopeRef = useRef(null);
  const previousAutoTranslateRef = useRef(autoTranslate);
  latestWorkspaceRef.current = {
    stages,
    searchModel,
    autoTranslate,
    searchResults,
    similarityScope,
    similarityScopeEnabled,
    lastFinalQueries,
    resultIsAmbiguous,
    isClustered,
    isAmbiguous,
    timingInfo,
    page,
    hasMore,
    contextShot,
  };

  const sendRealtimeMessage = useCallback((message, { notify = true } = {}) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('[ws] failed to send message:', error);
      }
    }
    if (notify && Date.now() - lastRealtimeWarningRef.current > 3000) {
      lastRealtimeWarningRef.current = Date.now();
      toast.error('Teamwork is reconnecting. Please try again in a moment.');
    }
    return false;
  }, []);

  useEffect(() => {
    if (activeSoloQueryFile && activeSoloQueryFile !== 'default') {
      sendRealtimeMessage({ type: 'join_query', data: { query_file: activeSoloQueryFile } }, { notify: false });
    }
  }, [activeSoloQueryFile, sendRealtimeMessage]);

  const updateHistoryDepths = (store = readWorkspaceHistory()) => {
    const currentIndex = store.entries.findIndex((entry) => entry.id === store.currentId);
    setGoBackDepth(currentIndex > 0 ? Math.min(currentIndex, MAX_GO_BACK_STEPS - 1) : 0);
    setGoForwardDepth(currentIndex >= 0 ? store.entries.length - currentIndex - 1 : 0);
  };

  const restoreWorkspaceSnapshot = (snapshot) => {
    const restoredStages = snapshot.stages || [createEmptyStage()];
    // Older workspaces may have stored either filter as disabled.
    const stagesWithDefaultOcr = restoredStages.map((stage) => {
      return { ...stage, ocrActive: true, asrActive: true };
    });
    setStages(stagesWithDefaultOcr);
    submittedStagesRef.current = snapshot.submittedStages || snapshot.stages || null;
    setSearchModel(normalizeSearchModel(snapshot.searchModel, DEFAULT_SEARCH_MODEL));
    if (typeof snapshot.autoTranslate === 'boolean') {
      setAutoTranslate(snapshot.autoTranslate);
      previousAutoTranslateRef.current = snapshot.autoTranslate;
    }
    submittedSearchModelRef.current = normalizeSearchModel(snapshot.submittedSearchModel || snapshot.searchModel, DEFAULT_SEARCH_MODEL);
    submittedSimilarityScopeRef.current = snapshot.similarityScopeEnabled === true
      ? (snapshot.submittedSimilarityScope || snapshot.similarityScope || null)
      : null;
    setSimilarityScope(snapshot.similarityScope || null);
    setSimilarityScopeEnabled(snapshot.similarityScopeEnabled === true);
    setSearchResults(snapshot.searchResults || []);
    setLastFinalQueries(snapshot.lastFinalQueries || []);
    setResultIsAmbiguous(snapshot.resultIsAmbiguous || false);
    setIsClustered(snapshot.isClustered || false);
    setIsAmbiguous(snapshot.isAmbiguous || false);
    setTimingInfo(snapshot.timingInfo || null);
    setPage(snapshot.page || 1);
    setHasMore(snapshot.hasMore || false);
    setContextShot(snapshot.contextShot || null);
    setLoading(false);
    setLoadingMore(false);
  };

  useEffect(() => {
    if (previousAutoTranslateRef.current === autoTranslate) return;
    previousAutoTranslateRef.current = autoTranslate;
    submittedStagesRef.current = null;
    setLastFinalQueries([]);
    setPage(1);
    setHasMore(false);
  }, [autoTranslate]);

  const saveWorkspaceHistoryEntry = (overrides = {}, { replace = false } = {}) => {
    if (!latestWorkspaceRef.current) return;

    const snapshot = cloneState({ ...latestWorkspaceRef.current, ...overrides });
    const currentBrowserId = window.history.state?.[WORKSPACE_HISTORY_STATE_KEY] || null;
    const store = readWorkspaceHistory();
    const activeId = store.currentId || currentBrowserId;
    let entries = store.entries;

    if (!replace) {
      const currentIndex = entries.findIndex((entry) => entry.id === activeId);
      if (currentIndex >= 0) entries = entries.slice(0, currentIndex + 1);
    }

    const id = replace && activeId ? activeId : createHistoryId();
    const nextEntry = { id, snapshot };
    const existingIndex = entries.findIndex((entry) => entry.id === id);
    if (existingIndex >= 0) {
      entries = entries.map((entry) => (entry.id === id ? nextEntry : entry));
    } else {
      entries = [...entries, nextEntry];
    }

    if (entries.length > MAX_GO_BACK_STEPS) {
      entries = entries.slice(-MAX_GO_BACK_STEPS);
    }

    const nextStore = { entries, currentId: id };
    writeWorkspaceHistory(nextStore);
    const historyState = { ...(window.history.state || {}), [WORKSPACE_HISTORY_STATE_KEY]: id };
    if (replace) {
      window.history.replaceState(historyState, '', window.location.href);
    } else {
      window.history.pushState(historyState, '', window.location.href);
    }
    updateHistoryDepths(nextStore);
  };

  const goBackOneStep = () => {
    if (goBackDepth <= 0) {
      toast('No previous browser step to restore.');
      return;
    }
    window.history.back();
  };

  const goForwardOneStep = () => {
    if (goForwardDepth <= 0) {
      toast('No forward browser step to restore.');
      return;
    }
    window.history.forward();
  };

  const getWorkspaceHistoryEntries = () => {
    return readWorkspaceHistory().entries;
  };

  const handleClearHistory = () => {
    writeWorkspaceHistory({ entries: [], currentId: null });
    updateHistoryDepths({ entries: [], currentId: null });
    toast.success('Search history cleared.');
  };

  const handleRestoreHistoryId = (historyId) => {
    const store = readWorkspaceHistory();
    const entry = store.entries.find((item) => item.id === historyId);
    if (!entry) {
      toast.error('History entry not found');
      return;
    }
    const updatedStore = { ...store, currentId: historyId };
    writeWorkspaceHistory(updatedStore);
    restoreWorkspaceSnapshot(entry.snapshot);
    updateHistoryDepths(updatedStore);
    const historyState = { ...(window.history.state || {}), [WORKSPACE_HISTORY_STATE_KEY]: historyId };
    window.history.pushState(historyState, '', window.location.href);
    toast.success('Restored previous search state.');
  };

  const setStagesWithHistory = (updater) => {
    setStages(updater);
  };

  const setIsClusteredWithHistory = (value) => {
    setIsClustered(value);
  };

  const setIsAmbiguousWithHistory = (value) => {
    setIsAmbiguous(value);
  };

  const extractVideoId = (frameName) => {
    if (!frameName) return null;
    const match = frameName.match(/^(.+)_\d{4}_\d{6}\.\w+$/);
    return match ? match[1] : null;
  };

  const toggleVideoLock = useCallback((shot) => {
    const videoId = shot.video_id || extractVideoId(shot.frame_name);
    if (!videoId) return;
    setLockedVideos(prev => {
      const exists = prev.some(v => v.videoId === videoId);
      if (exists) return prev.filter(v => v.videoId !== videoId);
      return [...prev, {
        videoId,
        frameName: shot.frame_name,
        thumbnailUrl: shot.url || getImageUrl(shot.frame_name),
      }];
    });
  }, []);

  const filterByLockedVideos = useCallback((results) => {
    if (lockedVideos.length === 0) return results;
    const allowed = new Set(lockedVideos.map(v => v.videoId));
    return results.filter(result => {
      if (result.video_id && allowed.has(result.video_id)) return true;
      if (result.shots) return result.shots.some(s => allowed.has(s.video_id));
      if (result.clusters) return result.clusters.some(c => c.shots?.some(s => allowed.has(s.video_id)));
      return false;
    });
  }, [lockedVideos]);

  const enhanceStagesForSearch = async (inputStages, currentSearchModel = []) => {
    const isOnlyMetaClip = currentSearchModel.length === 1 && currentSearchModel[0] === 'metaclip2';

    const enhancedStages = await Promise.all(inputStages.map(async (stage) => {
      const isEnhance = !!stage.options?.enhance;

      if (!isEnhance && (!autoTranslate || isOnlyMetaClip)) {
        return stage;
      }

      const sourceQuery = stage.queryType === 'image'
        ? (stage.imageText || '').trim()
        : (stage.queryText || '').trim();
      if (!sourceQuery) return stage;

      try {
        const response = await enhanceQuery({
          query: sourceQuery,
          ocr_query: stage.ocrActive ? stage.ocrText || null : null,
          asr_query: stage.asrActive ? stage.asrText || null : null,
          literal_translate: !isEnhance,
        });

        const enhanced = response.enhanced_query?.trim();
        if (!enhanced) return stage;

        return stage.queryType === 'image'
          ? { ...stage, imageText: enhanced }
          : { ...stage, queryText: enhanced };
      } catch (err) {
        console.error("Translation/Enhance failed:", err);
        return stage;
      }
    }));

    return enhancedStages;
  };

  useEffect(() => {
    localStorage.setItem('videoSearchTheme', theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'random') return undefined;

    const pickNextTheme = () => {
      setRandomTheme((current) => {
        const choices = RANDOM_THEME_OPTIONS.filter((item) => item !== current);
        return choices[Math.floor(Math.random() * choices.length)] || current;
      });
    };

    pickNextTheme();
    const intervalId = window.setInterval(pickNextTheme, 10000);
    return () => window.clearInterval(intervalId);
  }, [theme]);

  useEffect(() => {
    const currentId = window.history.state?.[WORKSPACE_HISTORY_STATE_KEY] || null;
    const store = readWorkspaceHistory();
    const currentEntry = store.entries.find((entry) => entry.id === currentId);

    if (currentEntry) {
      const nextStore = { ...store, currentId };
      writeWorkspaceHistory(nextStore);
      restoreWorkspaceSnapshot(currentEntry.snapshot);
      updateHistoryDepths(nextStore);
    } else {
      saveWorkspaceHistoryEntry({}, { replace: true });
    }

    const handlePopState = (event) => {
      const historyId = event.state?.[WORKSPACE_HISTORY_STATE_KEY];
      if (!historyId) return;

      const nextStore = readWorkspaceHistory();
      const entry = nextStore.entries.find((item) => item.id === historyId);
      if (!entry) {
        toast('That browser history step is no longer stored.');
        updateHistoryDepths(nextStore);
        return;
      }

      const updatedStore = { ...nextStore, currentId: historyId };
      writeWorkspaceHistory(updatedStore);
      restoreWorkspaceSnapshot(entry.snapshot);
      updateHistoryDepths(updatedStore);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!zoomedImage) return;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setZoomedImage(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomedImage]);

  useEffect(() => {
    const updateLatestStage = (updater) => {
      setStagesWithHistory((prev) => {
        if (prev.length === 0) return [createEmptyStage()];
        const next = [...prev];
        next[next.length - 1] = updater(next[next.length - 1]);
        return next;
      });
    };

    const focusLatestStageField = (field) => {
      const latestStage = latestWorkspaceRef.current?.stages?.at(-1);
      if (!latestStage) return;
      setStageFocusRequest({ stageId: latestStage.id, field, token: Date.now() });
    };

    const handleKeyDown = (event) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.code === 'KeyQ') {
        event.preventDefault();
        setIsSemanticAsr((prev) => {
          const next = !prev;
          toast.success(next ? 'Semantic ASR Mode: ON' : 'Semantic ASR Mode: OFF');
          return next;
        });
        return;
      }

      if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        const key = event.key.toLowerCase();
        if (key === 'e') {
          event.preventDefault();
          updateLatestStage((stage) => ({
            ...stage,
            options: {
              ...(stage.options || {}),
              enhance: !stage.options?.enhance,
              bge_caption: false,
            },
          }));
        }
        return;
      }

      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

      const key = event.key.toLowerCase();
      if (key === 'q') {
        event.preventDefault();
        setDresMode((previousMode) => {
          const nextMode = previousMode === 'QA' ? 'KIS' : 'QA';
          toast.success(`DRES ${nextMode} Mode: ON`);
          return nextMode;
        });
      } else if (key === 'arrowleft' || key === 'backspace') {
        event.preventDefault();
        const store = readWorkspaceHistory();
        const currentIndex = store.entries.findIndex((entry) => entry.id === store.currentId);
        if (currentIndex > 0) {
          window.history.back();
        } else {
          toast('No previous browser step to restore.');
        }
      } else if (key === 'arrowright') {
        event.preventDefault();
        const store = readWorkspaceHistory();
        const currentIndex = store.entries.findIndex((entry) => entry.id === store.currentId);
        if (currentIndex >= 0 && currentIndex < store.entries.length - 1) {
          window.history.forward();
        } else {
          toast('No forward browser step to restore.');
        }
      } else if (key === 't') {
        event.preventDefault();
        focusLatestStageField('ocr');
      } else if (key === 'y') {
        event.preventDefault();
        focusLatestStageField('asr');
      } else if (key === 'i') {
        event.preventDefault();
        const latestStage = latestWorkspaceRef.current?.stages?.at(-1);
        const nextField = latestStage?.queryType === 'image' ? 'query' : 'imageText';
        updateLatestStage((stage) => ({ ...stage, queryType: stage.queryType === 'image' ? 'text' : 'image' }));
        focusLatestStageField(nextField);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        const activeStage = document.activeElement?.closest('[data-stage-index]');
        const targetIndex = activeStage ? parseInt(activeStage.dataset.stageIndex, 10) : -1;
        const nextStage = createEmptyStage();
        setStagesWithHistory((prev) => {
          const idx = (targetIndex >= 0 && targetIndex < prev.length) ? targetIndex : 0;
          const next = [...prev];
          next.splice(idx, 0, nextStage);
          return next;
        });
        setStageFocusRequest({ stageId: nextStage.id, field: 'query', token: Date.now() });
      } else if (event.key === '-') {
        event.preventDefault();
        const activeStage = document.activeElement?.closest('[data-stage-index]');
        const targetIndex = activeStage ? parseInt(activeStage.dataset.stageIndex, 10) : -1;
        setStagesWithHistory((prev) => {
          if (prev.length <= 1) return prev;
          let idx = 0;
          if (targetIndex > 0) idx = targetIndex - 1;
          const next = [...prev];
          next.splice(idx, 1);
          return next;
        });
      } else if (event.key === ']') {
        event.preventDefault();
        const activeStage = document.activeElement?.closest('[data-stage-index]');
        const targetIndex = activeStage ? parseInt(activeStage.dataset.stageIndex, 10) : -1;
        const nextStage = createEmptyStage();
        setStagesWithHistory((prev) => {
          const idx = (targetIndex >= 0 && targetIndex < prev.length) ? targetIndex + 1 : prev.length;
          const next = [...prev];
          next.splice(idx, 0, nextStage);
          return next;
        });
        setStageFocusRequest({ stageId: nextStage.id, field: 'query', token: Date.now() });
      } else if (event.key === '[') {
        event.preventDefault();
        const activeStage = document.activeElement?.closest('[data-stage-index]');
        const targetIndex = activeStage ? parseInt(activeStage.dataset.stageIndex, 10) : -1;
        setStagesWithHistory((prev) => {
          if (prev.length <= 1) return prev;
          let idx = prev.length - 1;
          if (targetIndex >= 0 && targetIndex < prev.length - 1) idx = targetIndex + 1;
          const next = [...prev];
          next.splice(idx, 1);
          return next;
        });
      } else if (key === 'r') {
        event.preventDefault();
        executeResetRef.current();
      } else if (key === 'a') {
        event.preventDefault();
        setAutoTranslate((prev) => !prev);
      } else if (key === 'm') {
        event.preventDefault();
        setMetaClipOnly((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!username) {
      return undefined;
    }

    const wsUrl = getWsUrl();
    let disposed = false;
    let currentSocket = null;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let reconnectAttempt = 0;
    let lastPongAt = 0;

    const clearHeartbeat = () => {
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      const delay = Math.min(1000 * (2 ** reconnectAttempt), 10000);
      reconnectAttempt += 1;
      setRealtimeStatus('reconnecting');
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const handleMessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        console.error('[ws] invalid JSON message:', error);
        return;
      }
      const { type, data } = message;

      if (type === 'pong') {
        lastPongAt = Date.now();
        return;
      }
      if (type === 'error') {
        console.error('[ws] server rejected a message:', data?.detail || data);
        toast.error(data?.detail || 'Teamwork message was rejected.');
        return;
      }

      if (type === 'new_frame') {
        if (!data?.shot) return;
        const mappedData = {
          ...data,
          shot: {
            ...data.shot,
            url: data.shot.url?.startsWith('data:image')
              ? data.shot.url
              : (getImageUrl(data.shot.url || data.shot.frame_name) || data.shot.url)
          }
        };
        setTeamworkFrames((prev) => {
          const incomingKey = getShotKey(mappedData.shot);
          if (incomingKey && prev.some((frame) => getShotKey(frame.shot) === incomingKey)) return prev;
          return [mappedData, ...prev];
        });
      } else if (type === 'remove_frame') {
        setTeamworkFrames((prev) => prev.filter((f) => {
          const shot = f.shot || {};
          return !(
            (data.filepath && shot.filepath === data.filepath) ||
            (data.frame_name && shot.frame_name === data.frame_name) ||
            (data.url && shot.url === data.url)
          );
        }));
      } else if (type === 'clear_panel') {
        setTeamworkFrames([]);
      } else if (type === 'team_sync') {
        const mappedData = (data || []).map((frame) => ({
          ...frame,
          shot: {
            ...(frame.shot || {}),
            url: frame.shot?.url?.startsWith('data:image')
              ? frame.shot.url
              : (getImageUrl(frame.shot?.url || frame.shot?.frame_name) || frame.shot?.url),
          },
        })).filter((frame) => frame.shot && getShotKey(frame.shot));
        setTeamworkFrames(mappedData);
      } else if (type === 'global_wrong_submission') {
        if (!data?.shot) return;
        setWrongFrames((prev) => {
          const incomingKey = getShotKey(data.shot);
          if (incomingKey && prev.some((frame) => getShotKey(frame) === incomingKey)) return prev;
          return [data.shot, ...prev];
        });

        try {
          if (playingAudioRef.current) {
            playingAudioRef.current.pause();
          }
          const audio = new Audio('/wrong.mp3');
          audio.volume = 1.0;
          audio.muted = isMutedRef.current;
          playingAudioRef.current = audio;
          audio.play().catch(e => console.log("Audio play failed:", e));

          setTimeout(() => {
            if (playingAudioRef.current === audio) {
              audio.pause();
            }
          }, 5000);
        } catch (e) { }

      } else if (type === 'wrong_frames_sync') {
        const mappedData = (data || []).map(shot => ({
          ...shot,
          url: getImageUrl(shot.url || shot.frame_name)
        }));
        setWrongFrames(mappedData);
      } else if (type === 'trake_sync') {
        if (typeof data === 'object' && !Array.isArray(data)) {
          setStagedFramesByQuery(prev => {
            const nextState = { ...prev };
            for (const [qFile, shots] of Object.entries(data)) {
              if (Array.isArray(shots)) {
                nextState[qFile] = shots.map(shot => ({
                  ...shot,
                  url: getImageUrl(shot.url || shot.frame_name)
                }));
              }
            }
            return nextState;
          });
        }
      } else if (type === 'trake_clear') {
        const queryFile = data?.query_file;
        if (queryFile) {
          setStagedFramesByQuery(prev => {
            const next = { ...prev };
            delete next[queryFile];
            return next;
          });
        }
      } else if (type === 'soloai_submitted') {
        const queryFile = data?.query_file;
        if (queryFile) {
          setStagedFramesByQuery(prev => {
            const next = { ...prev };
            delete next[queryFile];
            return next;
          });
        } else {
          setStagedFramesByQuery({});
        }
        window.dispatchEvent(new Event('refreshSoloAIQueries'));
      } else if (type === 'global_correct_submission') {
        const mappedShot = {
          ...data.shot,
          url: data.shot.url?.startsWith('data:image')
            ? data.shot.url
            : (getImageUrl(data.shot.url || data.shot.frame_name) || data.shot.url)
        };
        setCorrectSubmission(mappedShot);
        setWrongFrames([]);
        setTeamworkFrames([{ shot: mappedShot, user: data.user || { name: 'SYSTEM', color: '#10b981' } }]);

        try {
          if (playingAudioRef.current) {
            playingAudioRef.current.pause();
          }
          const phonkFiles = ['/phonk1.MP3', '/phonk2.mp3', '/phonk3.mp3'];
          const currentIndex = phonkIndexRef.current % phonkFiles.length;
          const nextPhonk = phonkFiles[currentIndex];
          phonkIndexRef.current = currentIndex + 1;
          const audio = new Audio(nextPhonk);
          audio.volume = 1.0;
          audio.muted = isMutedRef.current;
          playingAudioRef.current = audio;
          audio.play().catch(e => console.log("Audio play failed:", e));
        } catch (e) { }
      }
    };

    function connect() {
      if (disposed) return;
      setRealtimeStatus(reconnectAttempt ? 'reconnecting' : 'connecting');
      const ws = new WebSocket(wsUrl);
      currentSocket = ws;
      socketRef.current = ws;

      ws.onopen = () => {
        if (disposed || currentSocket !== ws) {
          ws.close(1000, 'stale connection');
          return;
        }
        reconnectAttempt = 0;
        lastPongAt = Date.now();
        setRealtimeStatus('connected');
        console.info(`[ws] connected: ${wsUrl}`);
        clearHeartbeat();
        heartbeatTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            if (Date.now() - lastPongAt > 45000) {
              ws.close(4000, 'heartbeat timeout');
              return;
            }
            try {
              ws.send(JSON.stringify({ type: 'ping', data: { timestamp: Date.now() } }));
            } catch (error) {
              console.error('[ws] heartbeat send failed:', error);
              ws.close(4001, 'heartbeat send failed');
            }
          }
        }, 20000);
      };

      ws.onmessage = handleMessage;
      ws.onerror = () => console.error(`[ws] connection error: ${wsUrl}`);
      ws.onclose = (event) => {
        clearHeartbeat();
        if (socketRef.current === ws) socketRef.current = null;
        if (currentSocket === ws) {
          currentSocket = null;
        }
        console.warn(`[ws] closed (code ${event.code}): ${wsUrl}`);
        scheduleReconnect();
      };
    }

    connect();
    return () => {
      disposed = true;
      clearHeartbeat();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (socketRef.current === currentSocket) socketRef.current = null;
      setRealtimeStatus('disconnected');
      if (currentSocket && currentSocket.readyState < WebSocket.CLOSING) {
        currentSocket.close(1000, 'component cleanup');
      }
    };
  }, [username]);

  const handlePushToTrake = (shot, qaAnswerStr = null) => {
    if (!shot) return;

    // Check if we are in QA mode to intercept submission
    const activeQuery = soloAIQueries?.[activeSoloQueryIndex];
    if (activeQuery?.filename?.toLowerCase().includes('qa') && !qaAnswerStr && !shot.qaAnswer) {
      setQaPromptShot({ ...shot, _ts: Date.now() });
      return;
    }

    const compiledAnswer = qaAnswerStr || shot.qaAnswer;
    const shotWithUrl = { ...shot, url: getImageUrl(shot.url || shot.frame_name) || shot.url, qaAnswer: compiledAnswer };

    setTrakeFrames(prev => {
      const incomingKey = getShotKey(shotWithUrl);
      if (incomingKey && prev.some(s => getShotKey(s) === incomingKey)) return prev;
      const next = [...prev, shotWithUrl];
      sendRealtimeMessage({ type: 'trake_update_state', data: { query_file: activeSoloQueryFile, full_state: next } });
      return next;
    });
    setShowTrake(true);
  };

  const handleAgentPushToTeam = useCallback((shot) => {
    sendRealtimeMessage({
      type: 'new_frame',
      data: { shot, user: { name: username, color: userColor } },
    });
  }, [username, userColor, sendRealtimeMessage]);

  const handleReplaceTrakeFrame = useCallback((newShot) => {
    if (!trakePreviewShot) return;
    setTrakeFrames(prev => {
      const index = prev.findIndex(s => s.frame_name === trakePreviewShot.frame_name);
      if (index === -1) return prev;
      const next = [...prev];
      next[index] = { ...newShot, url: getImageUrl(newShot.url || newShot.frame_name) || newShot.url };
      sendRealtimeMessage({ type: 'trake_update_state', data: { query_file: activeSoloQueryFile, full_state: next } });
      return next;
    });
    setTrakePreviewShot(newShot);
  }, [trakePreviewShot, activeSoloQueryFile, sendRealtimeMessage]);

  const handleReorderTrake = useCallback((orderedFrames) => {
    setTrakeFrames(orderedFrames);
    sendRealtimeMessage({
      type: 'trake_update_state',
      data: { full_state: orderedFrames, query_file: activeSoloQueryFile },
    });
  }, [sendRealtimeMessage, setTrakeFrames, activeSoloQueryFile]);

  const handleRemoveFromTrake = useCallback((shot) => {
    const frameKey = getShotKey(shot);
    if (!frameKey) return;
    setTrakeFrames((previous) => {
      const next = previous.filter((frame) => getShotKey(frame) !== frameKey);
      sendRealtimeMessage({ type: 'trake_update_state', data: { query_file: activeSoloQueryFile, full_state: next } });
      return next;
    });
  }, [sendRealtimeMessage, setTrakeFrames, activeSoloQueryFile]);

  const activeSoloQuery = soloAIQueries[activeSoloQueryIndex] || null;

  const handleSoloAISubmit = useCallback(async (framesArray, answer = null) => {
    if (!activeSoloQuery) {
      toast.error('No active query selected!');
      return;
    }
    const toastId = toast.loading('Submitting...');
    try {
      const { submitSoloAI } = await import('./api');
      await submitSoloAI({
        query_file: activeSoloQuery.filename,
        frames: framesArray.map(f => ({ video_id: f.video_id, frame_id: f.frame_id, answer: f.qaAnswer })),
        answer: answer,
        row_index: editTrakeRowIndex
      });
      toast.success('Submitted successfully', { id: toastId });
      const isTrake = activeSoloQuery.filename.toLowerCase().includes('trake');
      if (isTrake && editTrakeRowIndex === null) {
        // If we just appended a new row, we should transition into editing that new row to stay in it.
        const newIndex = activeSoloQuery.submissions ? activeSoloQuery.submissions.length : 0;
        setEditTrakeRowIndex(newIndex);
      }
      // Note: we do NOT clear trakeFrames (the staging area). It stays exactly as it is (Save-in-place).
      window.dispatchEvent(new Event('refreshSoloAIQueries'));
      sendRealtimeMessage({ type: 'soloai_submitted', data: { query_file: activeSoloQuery.filename } });
    } catch (e) {
      toast.error(`Submit Failed: ${e.message}`, { id: toastId });
    }
  }, [activeSoloQuery, setTrakeFrames, editTrakeRowIndex]);

  const handleDeleteSoloAISubmit = useCallback(async (rowIndex) => {
    if (!activeSoloQuery) return;
    const toastId = toast.loading('Deleting...');
    try {
      const { deleteSoloAISubmit } = await import('./api');
      await deleteSoloAISubmit({
        query_file: activeSoloQuery.filename,
        row_index: rowIndex
      });
      toast.success('Deleted successfully', { id: toastId });
      window.dispatchEvent(new Event('refreshSoloAIQueries'));
      sendRealtimeMessage({ type: 'soloai_submitted', data: { query_file: activeSoloQuery.filename } });
    } catch (e) {
      toast.error(`Delete Failed: ${e.message}`, { id: toastId });
    }
  }, [activeSoloQuery]);

  const handleEditTrakeRow = useCallback((rowIndex) => {
    if (!activeSoloQuery || !activeSoloQuery.submissions) return;
    const row = activeSoloQuery.submissions[rowIndex];
    if (!row) return;

    let loadedFrames = [];
    const isQA = activeSoloQuery.filename.toLowerCase().includes('qa');
    const videoId = row[0];

    if (isQA) {
      if (row[1]) loadedFrames.push({ video_id: videoId, frame_id: row[1], qaAnswer: row[2] });
    } else {
      row.slice(1).forEach(fId => {
        if (fId && !isNaN(Number(fId))) {
          loadedFrames.push({ video_id: videoId, frame_id: fId });
        }
      });
    }

    setTrakeFrames(loadedFrames);
    setEditTrakeRowIndex(rowIndex);
  }, [activeSoloQuery, setTrakeFrames]);

  const handleCancelEditTrakeRow = useCallback(() => {
    setTrakeFrames([]);
    setEditTrakeRowIndex(null);
  }, [setTrakeFrames]);

  useEffect(() => {
    // Reset edit mode when active query changes
    const activeSoloQuery = soloAIQueries[activeSoloQueryIndex];
    if (activeSoloQuery?.filename?.toLowerCase().includes('trake') && activeSoloQuery.submissions?.length > 0) {
      setEditTrakeRowIndex(0);
    } else {
      setEditTrakeRowIndex(null);
    }
  }, [activeSoloQueryIndex, soloAIQueries]);

  const handleUploadSoloAIZip = useCallback(async (file) => {
    const toastId = toast.loading('Uploading zip...');
    try {
      const { uploadSoloAIZip } = await import('./api');
      await uploadSoloAIZip(file);
      toast.success('Uploaded and extracted successfully', { id: toastId });
      setStagedFramesByQuery({});
      window.dispatchEvent(new Event('refreshSoloAIQueries'));
      sendRealtimeMessage({ type: 'soloai_submitted', data: {} });
    } catch (e) {
      toast.error(`Upload Failed: ${e.message}`, { id: toastId });
    }
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (document.querySelector('[data-shortcut-scope="modal"]')) return;
      const isTypingInField = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);

      if (isTypingInField) return;

      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyG') {
        e.preventDefault();
        setIsClustered(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const executeSemanticAsrSearch = async (queryText = semanticAsrQuery) => {
    if (!queryText.trim()) {
      toast.error('Please enter a Semantic ASR query.');
      return;
    }
    setLoading(true);
    setTimingInfo(null);
    try {
      const payload = {
        query_text: queryText.trim(),
        page: 1,
        page_size: 50,
        search_mode: semanticAsrSearchMode,
        embedding_weight: semanticAsrEmbeddingWeight,
        meilisearch_weight: semanticAsrMeilisearchWeight,
        ...(lockedVideos.length > 0 ? { video_ids: lockedVideos.map(v => v.videoId) } : {}),
      };
      const response = await searchSemanticAsr(payload);
      const mappedResults = (response.results || []).map(chunk => ({
        ...chunk,
        shots: (chunk.shots || []).map(shot => ({
          ...shot,
          url: getImageUrl(shot.frame_name || shot.url)
        }))
      }));
      setSearchResults(filterByLockedVideos(mappedResults));
      setTimingInfo(response.timing_info);
    } catch (err) {
      toast.error('Semantic ASR Search failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const performSearch = async (pageNumber = 1, overrideStages = null, captureHistory = true, options = {}) => {
    if (isSemanticAsr) {
      await executeSemanticAsrSearch();
      return;
    }

    const selectedSearchModel = pageNumber === 1
      ? normalizeSearchModel(searchModel)
      : submittedSearchModelRef.current || normalizeSearchModel(searchModel);
    const requestedSearchModel = metaClipOnly ? ['metaclip2'] : selectedSearchModel;

    if (!requestedSearchModel) {
      toast.error('Choose search model(s).');
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    if (pageNumber === 1) {
      setLoading(true);
      setTimingInfo(null);
    } else {
      setLoadingMore(true);
    }

    try {
      const pageSize = 100;
      let response;
      const sourceStages = overrideStages || stages;
      const activeStages = pageNumber === 1
        ? await enhanceStagesForSearch(sourceStages, requestedSearchModel)
        : submittedStagesRef.current || sourceStages;

      const activeSearchModel = options.forceModel || requestedSearchModel;
      const modelPayload = buildSearchModelPayload(activeSearchModel);
      const hasScopeOverride = Object.prototype.hasOwnProperty.call(options, 'similarityScope');
      const requestedSimilarityScope = hasScopeOverride
        ? options.similarityScope
        : (pageNumber === 1 ? similarityScope : submittedSimilarityScopeRef.current);
      const activeSimilarityScope = similarityScopeEnabled ? requestedSimilarityScope : null;
      const candidateFrameNames = activeSimilarityScope?.frameNames || null;
      if (pageNumber === 1) {
        submittedStagesRef.current = activeStages;
        submittedSearchModelRef.current = activeSearchModel;
        submittedSimilarityScopeRef.current = activeSimilarityScope;
      }

      if (activeStages.length === 1) {
        const stage = activeStages[0];
        const searchData = {
          ...modelPayload,
          query_text: stage.queryType === 'text' && stage.queryText?.trim() ? stage.queryText.trim() : null,
          query_image_name: stage.queryType === 'image' ? (stage.tempImageName || null) : null,
          image_search_text: stage.queryType === 'image' && stage.imageText?.trim() ? stage.imageText.trim() : null,
          ocr_query: stage.ocrActive && stage.ocrText?.trim() ? stage.ocrText.trim() : null,
          asr_query: stage.asrActive && stage.asrText?.trim() ? stage.asrText.trim() : null,
          use_bge_caption: stage.options?.bge_caption || false,
          page: pageNumber,
          page_size: pageSize,
          ...(lockedVideos.length > 0 ? { video_ids: lockedVideos.map(v => v.videoId) } : {}),
          ...(candidateFrameNames ? { candidate_frame_names: candidateFrameNames } : {}),
        };

        response = await searchSingle(searchData);
      } else {
        const payload = {
          stages: activeStages.map(s => ({
            query: s.queryType === 'text' && s.queryText?.trim() ? s.queryText.trim() : null,
            query_image_name: s.queryType === 'image' ? (s.tempImageName || null) : null,
            image_search_text: s.queryType === 'image' && s.imageText?.trim() ? s.imageText.trim() : null,
            ocr_query: s.ocrActive && s.ocrText?.trim() ? s.ocrText.trim() : null,
            asr_query: s.asrActive && s.asrText?.trim() ? s.asrText.trim() : null,
          })),
          ...modelPayload,
          cluster: isClustered,
          ambiguous: isAmbiguous,
          page: pageNumber,
          page_size: pageSize,
          ...(lockedVideos.length > 0 ? {
            video_ids: lockedVideos.map(v => v.videoId),
            specified_videos: lockedVideos.map(v => v.videoId)
          } : {}),
          ...(candidateFrameNames ? { candidate_frame_names: candidateFrameNames } : {}),
        };

        response = await searchTemporal(payload);
        if (response.temporal_debug) {
          console.info('Temporal search debug:', response.temporal_debug);
        }
      }

      let localResults = [];
      if (activeStages.length === 1) {
        localResults = (response.results || []).map(cluster => ({
          ...cluster,
          best_shot: { ...cluster.best_shot, url: getImageUrl(cluster.best_shot.frame_name) },
          shots: (cluster.shots || []).map(shot => ({ ...shot, url: getImageUrl(shot.frame_name) }))
        }));
      } else {
        localResults = (response.results || []).map(seq => ({
          ...seq,
          shots: (seq.shots || []).map(shot => ({ ...shot, url: getImageUrl(shot.frame_name) })),
          clusters: (seq.clusters || []).map(cluster => ({
            ...cluster,
            best_shot: { ...cluster.best_shot, url: getImageUrl(cluster.best_shot.frame_name) },
            shots: (cluster.shots || []).map(shot => ({ ...shot, url: getImageUrl(shot.frame_name) }))
          }))
        }));
      }

      let nextSimilarityScope = activeSimilarityScope;
      const nextSimilarityScopeEnabled = options.activateSimilarityScope
        ? false
        : similarityScopeEnabled;
      if (options.activateSimilarityScope) {
        const frameNames = collectFrameNames(localResults);
        nextSimilarityScope = frameNames.length > 0
          ? { frameNames, sourceFrameName: options.similaritySourceFrameName || null }
          : null;
        setSimilarityScope(nextSimilarityScope);
        setSimilarityScopeEnabled(false);
        submittedSimilarityScopeRef.current = null;
      }

      if (pageNumber === 1) {
        setSearchResults(filterByLockedVideos(localResults));
        setTimingInfo(response.timing_info);
        setResultIsAmbiguous(response.is_ambiguous_search === true);
        setLastFinalQueries(activeStages.map(formatFinalQuery));
      } else {
        setSearchResults(prev => filterByLockedVideos([...prev, ...localResults]));
      }

      setPage(pageNumber);

      const totalFetched = pageNumber * pageSize;
      const totalAvailable = response.total_results || 0;
      const nextHasMore = totalFetched < totalAvailable && localResults.length > 0;
      setHasMore(nextHasMore);
      if (captureHistory && pageNumber === 1) {
        saveWorkspaceHistoryEntry({
          stages: sourceStages,
          submittedStages: activeStages,
          searchModel: activeSearchModel,
          submittedSearchModel: activeSearchModel,
          similarityScope: nextSimilarityScope,
          submittedSimilarityScope: nextSimilarityScopeEnabled ? nextSimilarityScope : null,
          similarityScopeEnabled: nextSimilarityScopeEnabled,
          searchResults: pageNumber === 1
            ? localResults
            : [...(latestWorkspaceRef.current?.searchResults || []), ...localResults],
          lastFinalQueries: activeStages.map(formatFinalQuery),
          timingInfo: response.timing_info,
          resultIsAmbiguous: response.is_ambiguous_search === true,
          page: pageNumber,
          hasMore: nextHasMore,
        });
      }

      if (isMobileMenuOpen) setIsMobileMenuOpen(false);

    } catch (error) {
      toast.error("Search failed: " + error.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleQuickImageSearch = async (shot) => {
    setSimilarityScope(null);
    submittedSimilarityScopeRef.current = null;
    setSimilarityScopeEnabled(false);
    setLoading(true);
    setSearchResults([]);
    setTimingInfo(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      let tempImageName = null;
      let imageUrl = null;

      const isDynamicVideoFrame = shot.filepath?.startsWith('dynamic-frame-')
        || shot.url?.startsWith('data:image');

      if (shot.frame_name && !isDynamicVideoFrame) {
        tempImageName = `_frame_:${shot.frame_name}`;
        imageUrl = shot.url || getImageUrl(shot.frame_name);
      } else {
        if (shot.url?.startsWith('data:image')) {
          imageUrl = shot.url;
        } else {
          imageUrl = getImageUrl(shot.url || shot.frame_name);

          if (imageUrl.startsWith('http') && !imageUrl.includes(BASE_URL.replace(/\/$/, ''))) {
            const backendHost = BASE_URL.replace(/\/$/, '');
            imageUrl = `${backendHost}/proxy_image?url=${encodeURIComponent(imageUrl)}`;
          }

          imageUrl += (imageUrl.includes('?') ? '&' : '?') + 'nocache=' + Date.now();
        }

        const res = await fetch(imageUrl, { mode: 'cors' });
        if (!res.ok) {
          throw new Error(`Failed to retrieve image from asset server.`);
        }
        const blob = await res.blob();

        const fd = new FormData();
        fd.append('image', blob, shot.frame_name || 'quick_frame.jpg');

        const backendHost = BASE_URL.replace(/\/$/, '');
        const uploadUrl = `${backendHost}/upload_image`;

        const uploadRes = await fetch(uploadUrl, {
          method: 'POST',
          body: fd,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!uploadRes.ok) {
          let errorMsg = "Upload failed";
          try {
            const errData = await uploadRes.json();
            if (errData?.detail) errorMsg = errData.detail;
          } catch {
            errorMsg = "Upload failed";
          }
          throw new Error(errorMsg);
        }

        const uploadData = await uploadRes.json();
        tempImageName = uploadData.temp_image_name;
      }

      const updatedStages = [{
        ...createEmptyStage(),
        queryType: 'image',
        tempImageName: tempImageName,
        imagePreview: imageUrl,
      }];

      await performSearch(1, updatedStages, true, {
        similarityScope: null,
        activateSimilarityScope: true,
        similaritySourceFrameName: shot.frame_name || null,
        forceModel: ['beit3']
      });

    } catch (err) {
      clearTimeout(timeoutId);
      console.error("Quick image search failed:", err);

      if (err.name === 'AbortError') {
        toast.error("Upload timed out. The server took too long to respond.");
      } else {
        toast.error(`Quick image search failed: ${err.message}`);
      }
      setLoading(false);
    }
  };

  const executeSearch = () => { performSearch(1); };
  const handleLoadMore = () => { performSearch(page + 1); };

  const runAgentSearchInBackground = useCallback((stage) => {
    const message = formatFinalQuery(stage);
    if (!message) {
      toast.error('Enter a query before starting the Agent.');
      return;
    }

    const toastId = toast.loading('Agent is searching in the background…');
    const sessionId = `search-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const agentSearchModel = stage?.queryType === 'image' && stage.tempImageName
      ? ['bge']
      : (metaClipOnly ? ['metaclip2'] : searchModel);
    const modelPayload = buildSearchModelPayload(agentSearchModel);
    setBackgroundAgentJob({ sessionId, message, status: 'running', events: [] });
    let afterId = 0;
    const pollEvents = async () => {
      try {
        const eventResponse = await getAgentEvents(sessionId, afterId);
        if (eventResponse.events?.length) {
          afterId = eventResponse.last_event_id || afterId;
          setBackgroundAgentJob((current) => current?.sessionId === sessionId
            ? {
              ...current,
              events: [...current.events, ...eventResponse.events].filter(
                (event, index, all) => all.findIndex((item) => item.id === event.id) === index,
              ),
            }
            : current);
        }
      } catch {
        // The session is created asynchronously by the POST request; retry on
        // the next interval until the request has completed.
      }
    };
    const pollId = window.setInterval(pollEvents, 700);
    sendAgentMessage({
      session_id: sessionId,
      message,
      use_research: false,
      top_k: 30,
      ...modelPayload,
    }).then((response) => {
      setBackgroundAgentJob({
        sessionId,
        message,
        status: 'completed',
        events: response.events || [],
        response,
      });
      const selectedFrames = response.frames?.length ? response.frames : (response.kept_frames || []);
      toast.custom((currentToast) => (
        <AgentResultsToast
          toastInstance={currentToast}
          frames={selectedFrames}
          onZoom={setZoomedImage}
          onOpenAgent={() => {
            setWorkspaceMode('agent');
            toast.dismiss(currentToast.id);
          }}
        />
      ), { id: toastId, duration: 12000, position: 'bottom-right' });
    }).catch((error) => {
      setBackgroundAgentJob({ sessionId, message, status: 'failed', events: [], error: error.message });
      toast.error(`Agent search failed: ${error.message}`, { id: toastId });
    }).finally(() => {
      window.clearInterval(pollId);
    });
  }, [searchModel, metaClipOnly]);

  const handleOpenVideoPreview = (videoId, frameId) => {
    if (!videoId) return;
    setPreviewVideoData({ videoId, frameId });
    setActiveModal('video');
  };

  const executeResetRef = useRef(null);

  const executeReset = useCallback(() => {
    const nextStages = [createEmptyStage()];
    const currentSearchModel = normalizeSearchModel(latestWorkspaceRef.current?.searchModel || searchModel, DEFAULT_SEARCH_MODEL);
    submittedStagesRef.current = null;
    submittedSearchModelRef.current = currentSearchModel;
    submittedSimilarityScopeRef.current = null;
    setSimilarityScope(null);
    setStages(nextStages);
    setIsSemanticAsr(false);
    setSemanticAsrQuery('');
    setSearchResults([]);
    setLastFinalQueries([]);
    setResultIsAmbiguous(false);
    setTimingInfo(null);
    setPage(1);
    setHasMore(false);
    setLoadingMore(false);
    setContextShot(null);
  }, [searchModel, metaClipOnly]);

  useEffect(() => {
    executeResetRef.current = executeReset;
  }, [executeReset]);

  const handleToggleSimilarityScope = useCallback(() => {
    if (!similarityScope?.frameNames?.length) {
      toast.error('Run a similarity image search first to create a similarity list.');
      return;
    }
    const nextEnabled = !similarityScopeEnabled;
    setSimilarityScopeEnabled(nextEnabled);
    submittedSimilarityScopeRef.current = nextEnabled ? similarityScope : null;
    setPage(1);
    setHasMore(false);
    saveWorkspaceHistoryEntry({
      similarityScope,
      submittedSimilarityScope: nextEnabled ? similarityScope : null,
      similarityScopeEnabled: nextEnabled,
      page: 1,
      hasMore: false,
    });
    toast.success(nextEnabled
      ? 'Similarity-only search enabled. Future queries use the similarity list.'
      : 'Similarity-only search disabled. Future queries search all videos.');
  }, [similarityScope, similarityScopeEnabled]);

  const handleResetSearch = () => {
    toast(
      (t) => (
        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Reset the search panel?</span>
          <div className="flex gap-2">
            <button
              className="bg-red-500 hover:bg-red-600 text-white px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              onClick={() => { executeReset(); toast.dismiss(t.id); }}
            >
              Yes, Reset
            </button>
            <button
              className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              onClick={() => toast.dismiss(t.id)}
            >
              Cancel
            </button>
          </div>
        </div>
      ),
      { duration: Infinity, position: 'top-center' }
    );
  };

  const handlePushAgentQueries = useCallback((queries = {}) => {
    const nextStage = {
      ...createEmptyStage(),
      queryText: queries.text_query || '',
      ocrText: queries.ocr_query || '',
      asrText: queries.asr_query || '',
      ocrActive: Boolean(queries.ocr_query),
      asrActive: Boolean(queries.asr_query),
      queryType: 'text',
    };
    submittedStagesRef.current = null;
    submittedSimilarityScopeRef.current = null;
    setStages([nextStage]);
    setSearchResults([]);
    setLastFinalQueries([]);
    setTimingInfo(null);
    setSimilarityScope(null);
    setSimilarityScopeEnabled(false);
    setPage(1);
    setHasMore(false);
    setWorkspaceMode('search');
    setIsMobileMenuOpen(false);
    setStageFocusRequest({ stageId: nextStage.id, field: 'query', token: Date.now() });
    toast.success('Agent queries were pushed to Search.');
  }, []);

  const handleAgentQuickSearch = useCallback((shot) => {
    setWorkspaceMode('search');
    handleQuickImageSearch(shot);
  }, [handleQuickImageSearch]);

  return (
    <div className={`theme-${effectiveTheme} flex flex-col w-full h-screen overflow-hidden ${effectiveTheme === 'jujutsu' ? 'bg-[#050505]' : 'bg-[var(--bg-primary)]'} text-[var(--text-primary)] transition-colors duration-1000 ease-smooth relative`}>
      {theme === 'random' && (
        <div
          key={effectiveTheme}
          className="theme-shift-wash"
          aria-hidden="true"
        />
      )}
      {effectiveTheme === 'jujutsu' && (
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover z-0 opacity-60 pointer-events-none"
        >
          <source src="/jujutsu_kaisen.mp4" type="video/mp4" />
        </video>
      )}
      <div className="relative z-10 flex flex-col w-full h-full pointer-events-none">
        <div className="pointer-events-auto flex flex-col w-full h-full">
          <Toaster position="bottom-right" reverseOrder={false} />
          {username && realtimeStatus !== 'connected' && (
            <div className="fixed right-4 top-[78px] z-[3000] rounded-lg border border-amber-500/40 bg-amber-950/90 px-3 py-1.5 text-[10px] font-semibold text-amber-200 shadow-lg backdrop-blur">
              <i className="fas fa-rotate fa-spin mr-1.5" />
              Teamwork {realtimeStatus === 'reconnecting' ? 'reconnecting' : 'connecting'}…
            </div>
          )}

          <TopToolbar
            username={username}
            userColor={userColor}
            theme={theme}
            setTheme={setTheme}
            showTrake={showTrake}
            setShowTrake={setShowTrake}
            similarityScopeEnabled={similarityScopeEnabled}
            hasSimilarityScope={Boolean(similarityScope?.frameNames?.length)}
            onToggleSimilarityScope={handleToggleSimilarityScope}
            isClustered={isClustered}
            setIsClustered={setIsClusteredWithHistory}
            isAmbiguous={isAmbiguous}
            setIsAmbiguous={setIsAmbiguousWithHistory}
            isSemanticAsr={isSemanticAsr}
            setIsSemanticAsr={setIsSemanticAsr}
            searchModel={searchModel}
            setSearchModel={setSearchModel}
            metaClipOnly={metaClipOnly}
            setMetaClipOnly={setMetaClipOnly}
            autoTranslate={autoTranslate}
            setAutoTranslate={setAutoTranslate}
            onUploadSoloAIZip={handleUploadSoloAIZip}
            soloAIQueries={soloAIQueries}
            activeSoloQueryIndex={activeSoloQueryIndex}
            setActiveSoloQueryIndex={setActiveSoloQueryIndex}
            fetchSoloQueries={fetchSoloQueries}

            onOpenModal={setActiveModal}
            onGoBack={goBackOneStep}
            onGoForward={goForwardOneStep}
            canGoBack={goBackDepth > 0}
            canGoForward={goForwardDepth > 0}
            goBackDepth={goBackDepth}
            goForwardDepth={goForwardDepth}
            getHistoryEntries={getWorkspaceHistoryEntries}
            onRestoreHistory={handleRestoreHistoryId}
            onClearHistory={handleClearHistory}
            onReset={handleResetSearch}
            onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            timingInfo={timingInfo}
            isMuted={isMuted}
            setIsMuted={setIsMuted}
            workspaceMode={workspaceMode}
            setWorkspaceMode={setWorkspaceMode}
          />

          <div className={`flex flex-col flex-grow min-h-0 h-full w-full overflow-hidden ${effectiveTheme === 'jujutsu' ? 'bg-transparent' : 'bg-[var(--bg-primary)]'} relative transition-colors duration-700 ease-smooth`}>
            <div className={`${workspaceMode === 'search' ? 'flex' : 'hidden'} flex-row flex-grow min-h-0 w-full overflow-hidden relative`}>
              {isMobileMenuOpen && (
                <div
                  className="fixed inset-0 bg-black/50 z-[50] md:hidden backdrop-blur-sm"
                  onClick={() => setIsMobileMenuOpen(false)}
                />
              )}

              <div className={`
                ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
                md:translate-x-0 transition-transform duration-300 absolute md:relative z-[60] h-full shadow-2xl md:shadow-none w-[340px] max-w-[85vw]
              `}>
                <LeftSearchPanel
                  stages={stages}
                  searchModel={searchModel}
                  lastFinalQueries={lastFinalQueries}
                  setStages={setStagesWithHistory}
                  setSearchModel={setSearchModel}
                  focusRequest={stageFocusRequest}
                  onFocusStage={setStageFocusRequest}
                  onSearch={executeSearch}
                  onAgentSearch={runAgentSearchInBackground}
                  onQuickSearch={handleQuickImageSearch}
                  loading={loading}
                  theme={effectiveTheme}
                  isSemanticAsr={isSemanticAsr}
                  semanticAsrQuery={semanticAsrQuery}
                  setSemanticAsrQuery={setSemanticAsrQuery}
                  onSemanticAsrSearch={executeSemanticAsrSearch}
                  semanticAsrSearchMode={semanticAsrSearchMode}
                  setSemanticAsrSearchMode={setSemanticAsrSearchMode}
                  semanticAsrEmbeddingWeight={semanticAsrEmbeddingWeight}
                  setSemanticAsrEmbeddingWeight={setSemanticAsrEmbeddingWeight}
                  semanticAsrMeilisearchWeight={semanticAsrMeilisearchWeight}
                  setSemanticAsrMeilisearchWeight={setSemanticAsrMeilisearchWeight}
                />
              </div>

              <RightResultsPanel
                searchResults={searchResults}
                teamworkFrames={teamworkFrames}
                trakeFrames={trakeFrames}
                wrongFrames={wrongFrames}
                showTrake={showTrake}
                loading={loading}
                loadingMore={loadingMore}
                hasMore={hasMore}
                onLoadMore={handleLoadMore}
                onPreview={handleOpenVideoPreview}
                sendRealtimeMessage={sendRealtimeMessage}
                username={username}
                userColor={userColor}
                onPushToTrake={handlePushToTrake}
                onReorderTrake={handleReorderTrake}
                onRemoveFromTrake={handleRemoveFromTrake}
                onPreviewTrakeFrame={setTrakePreviewShot}
                correctSubmission={correctSubmission}
                onZoom={setZoomedImage}
                isClustered={isClustered}
                isAmbiguous={resultIsAmbiguous}
                onContext={setContextShot}
                onQuickSearch={handleQuickImageSearch}
                onToggleLock={toggleVideoLock}
                lockedVideoIds={lockedVideos.map(v => v.videoId)}
                setHoveredFrame={setHoveredFrame}
                setIsHoveringTrakePanel={setIsHoveringTrakePanel}
                soloAIQueries={soloAIQueries}
                activeSoloQueryIndex={activeSoloQueryIndex}
                setActiveSoloQueryIndex={setActiveSoloQueryIndex}
                onSoloAISubmit={handleSoloAISubmit}
                editTrakeRowIndex={editTrakeRowIndex}
                onEditTrakeRow={handleEditTrakeRow}
                onCancelEditTrakeRow={handleCancelEditTrakeRow}
                onDeleteTrakeRow={handleDeleteSoloAISubmit}
                onDeleteSoloAISubmit={handleDeleteSoloAISubmit}
              />
              {trakePreviewShot && (
                <TrakeFramePreviewSidebar
                  shot={trakePreviewShot}
                  onClose={() => setTrakePreviewShot(null)}
                  onReplace={handleReplaceTrakeFrame}
                />
              )}
            </div>

            <div className={`${workspaceMode === 'agent' ? 'flex' : 'hidden'} flex-grow min-h-0 w-full overflow-hidden relative`}>
              <AgentWorkspace
                searchModel={metaClipOnly ? ['metaclip2'] : searchModel}
                backgroundAgentJob={backgroundAgentJob}
                onPushQueries={handlePushAgentQueries}
                onZoom={setZoomedImage}
                onPreview={handleOpenVideoPreview}
                onContext={setContextShot}
                onQuickSearch={handleAgentQuickSearch}
                onPushToTeam={handleAgentPushToTeam}
                onPushToTrake={handlePushToTrake}
                onToggleLock={toggleVideoLock}
              />
            </div>
          </div>

          {showUserModal && <UsernameModal onJoin={handleJoinSession} />}
          {activeModal === 'filter' && <ObjectFilterModal onClose={() => setActiveModal(null)} />}
          {activeModal === 'help' && <HelpModal onClose={() => setActiveModal(null)} />}
          {qaPromptShot && (
            <QASubmitModal
              shot={qaPromptShot}
              onClose={() => setQaPromptShot(null)}
              onSubmit={(shot, answer) => {
                setQaPromptShot(null);
                handlePushToTrake(shot, answer);
              }}
            />
          )}
          {activeModal === 'dresLogin' && (
            <DresLoginModal
              onClose={() => setActiveModal(null)}
              sessionId={dresSessionId}
              evaluationId={dresEvaluationId}
              onLogout={handleLogoutDres}
              onLoginSuccess={(sessionId, evaluationId, username) => {
                setDresSessionId(sessionId);
                setDresEvaluationId(evaluationId);
                if (username) {
                  setDresUsername(username);
                  sessionStorage.setItem('dresUsername', username);
                }
                sessionStorage.setItem('dresSessionId', sessionId);
                if (evaluationId) {
                  sessionStorage.setItem('dresEvaluationId', evaluationId);
                } else {
                  sessionStorage.removeItem('dresEvaluationId');
                }
              }}
            />
          )}
          {activeModal === 'video' && previewVideoData && (
            <VideoPreviewModal
              videoId={previewVideoData.videoId}
              initialFrame={previewVideoData.frameId}
              onClose={() => {
                setActiveModal(null);
                setPreviewVideoData(null);
              }}
              socketRef={socketRef}
              sendRealtimeMessage={sendRealtimeMessage}
              username={username}
              userColor={userColor}
              wrongFrames={wrongFrames}
              onPushToTrake={handlePushToTrake}
            />
          )}

          {contextShot && (
            <FrameContextModal
              shotData={contextShot}
              onClose={() => setContextShot(null)}
              onZoom={setZoomedImage}
              onPreview={handleOpenVideoPreview}
              sendRealtimeMessage={sendRealtimeMessage}
              username={username}
              userColor={userColor}
              onContext={setContextShot}
              onQuickSearch={handleQuickImageSearch}
              wrongFrames={wrongFrames}
              correctSubmission={correctSubmission}
            />
          )}

          {zoomedImage && (
            <div
              className="fixed inset-0 bg-black/90 z-[2500] flex items-center justify-center cursor-default p-4"
              onClick={() => setZoomedImage(null)}
            >
              <span
                className="absolute top-4 right-8 text-white text-3xl font-bold hover:text-red-500 hover:rotate-90 duration-300 cursor-pointer bg-black/40 rounded-full w-12 h-12 flex items-center justify-center"
                onClick={() => setZoomedImage(null)}
              >
                &times;
              </span>
              <img
                src={zoomedImage}
                alt="Zoomed Result"
                className="w-full h-full max-w-[90vw] max-h-[90vh] object-contain rounded-2xl shadow-[var(--shadow-heavy)] border border-[var(--border-color)]"
              />
            </div>
          )}

          {lockedVideos.length > 0 && (
            <div className="fixed bottom-0 left-0 right-0 z-[100] bg-[var(--card-bg)] border-t border-[var(--border-color)] backdrop-blur-md">
              <div className="flex items-center gap-3 px-4 py-2 overflow-x-auto">
                <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider flex-shrink-0">
                  <i className="fas fa-lock text-[var(--accent-primary)] mr-1"></i>Locked ({lockedVideos.length})
                </span>
                {lockedVideos.map(v => (
                  <div
                    key={v.videoId}
                    className="flex-shrink-0 flex items-center gap-2 bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-lg px-2 py-1 cursor-pointer hover:border-red-400 group transition-all"
                    onClick={() => toggleVideoLock({ video_id: v.videoId, frame_name: v.frameName, url: v.thumbnailUrl })}
                    title={`Click to unlock ${v.videoId}`}
                  >
                    <img src={v.thumbnailUrl} alt={v.videoId} className="w-8 h-8 rounded object-cover" />
                    <span className="text-[11px] font-mono text-[var(--text-primary)]">{v.videoId}</span>
                    <i className="fas fa-times text-[8px] text-[var(--text-secondary)] group-hover:text-red-500 ml-1"></i>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
