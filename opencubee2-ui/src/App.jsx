// src/App.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import toast, { Toaster } from 'react-hot-toast'; // Installed via npm i react-hot-toast
import TopToolbar from './components/TopToolbar';
import LeftSearchPanel from './components/LeftSearchPanel';
import RightResultsPanel from './components/RightResultsPanel';
import AgentRunView from './components/AgentRunView';
import UsernameModal from './components/modals/UsernameModal';
import ObjectFilterModal from './components/modals/ObjectFilterModal';
import VideoPreviewModal from './components/modals/VideoPreviewModal';
import FrameContextModal from './components/modals/FrameContextModal';
import HelpModal from './components/modals/HelpModal';
import DresLoginModal from './components/modals/DresLoginModal';
import DresSubmitModal from './components/modals/DresSubmitModal';
import { BASE_URL, enhanceQuery, searchSingle, searchTemporal, startAgentSearch, getWsUrl, DRES_BASE_URL } from './api';
import { getImageUrl } from './utils/imageUrl'; // Imported from separate utility to keep Fast Refresh functional

// WS now derives from the same backend origin as the REST API (see api.js),
// so the agent stream and /agent/start always hit the same server.

const createEmptyStage = () => ({
  id: Date.now(),
  queryText: '',
  ocrText: '',
  asrText: '',
  ocrActive: false,
  asrActive: false,
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

const getShotKey = (shot = {}) => shot.filepath || shot.frame_name || shot.url || '';

const cloneState = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const createHistoryId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const createAgentTabId = () => `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const THEME_OPTIONS = ['normal', 'dark', 'light', 'blue', 'neon', 'jujutsu', 'random'];
const RANDOM_THEME_OPTIONS = ['normal', 'dark', 'light', 'blue', 'neon', 'jujutsu'];
export const SEARCH_MODEL_OPTIONS = [
  { value: 'beit3', label: 'BEiT-3', icon: 'fas fa-cubes' },
  { value: 'bge', label: 'BGE-VL', icon: 'fas fa-language' },
  { value: 'jina_v5_omni', label: 'Jina v5', icon: 'fas fa-globe' },
  { value: 'metaclip2', label: 'MetaCLIP 2', icon: 'fas fa-bolt' },
];
export const DEFAULT_SEARCH_MODEL = ['beit3'];

const normalizeSearchModel = (values, fallback = []) => {
  if (!Array.isArray(values)) {
    const valStr = String(values);
    if (valStr === 'all') return ['bge', 'beit3', 'jina_v5_omni', 'metaclip2'];
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

const createAgentTitle = (prompt = '') => {
  const cleaned = prompt.replace(/\s+/g, ' ').trim();
  return cleaned.length > 28 ? `${cleaned.slice(0, 28)}...` : cleaned || 'Agent Search';
};

const inferAgentStatusFromLog = (message = '', currentStatus = 'starting') => {
  if (/ERROR|failed|halted/i.test(message)) return 'failed';
  if (/MATCH_FOUND|Selected MATCH_FOUND/i.test(message)) return 'found';
  if (/GIVE_UP|Selected GIVE_UP/i.test(message)) return 'gave_up';
  if (/Inspecting|Compiling|Canvas/i.test(message)) return 'inspecting';
  if (/Executing|search|Retrieving|Found/i.test(message)) return 'searching';
  if (/Thought|Formulating|Selected/i.test(message)) return 'thinking';
  return currentStatus;
};

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

  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('videoSearchTheme') || 'dark';
    return THEME_OPTIONS.includes(savedTheme) ? savedTheme : 'dark';
  });
  const [randomTheme, setRandomTheme] = useState(() => RANDOM_THEME_OPTIONS[Math.floor(Math.random() * RANDOM_THEME_OPTIONS.length)]);
  const effectiveTheme = theme === 'random' ? randomTheme : theme;
  const [showTrake, setShowTrake] = useState(false);
  const [isClustered, setIsClustered] = useState(false);
  const [isAmbiguous, setIsAmbiguous] = useState(false);

  // Mobile responsive menu toggle
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [workspaceTabs, setWorkspaceTabs] = useState([]);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState('manual');

  const [activeModal, setActiveModal] = useState(null);
  const [previewVideoData, setPreviewVideoData] = useState(null);
  const [zoomedImage, setZoomedImage] = useState(null);
  const [contextShot, setContextShot] = useState(null);

  const [stages, setStages] = useState([createEmptyStage()]);
  const [searchModel, setSearchModel] = useState(DEFAULT_SEARCH_MODEL);
  const [stageFocusRequest, setStageFocusRequest] = useState(null);

  const [searchResults, setSearchResults] = useState([]);
  const [lastFinalQueries, setLastFinalQueries] = useState([]);
  const [resultIsAmbiguous, setResultIsAmbiguous] = useState(false);
  const [teamworkFrames, setTeamworkFrames] = useState([]);
  const [trakeFrames, setTrakeFrames] = useState([]);
  const [wrongFrames, setWrongFrames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [timingInfo, setTimingInfo] = useState(null);
  const [correctSubmission, setCorrectSubmission] = useState(null);

  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('opencubee_muted') === 'true';
  });
  const isMutedRef = useRef(isMuted);
  const playingAudioRef = useRef(null);

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

  // DRES Submit Mode (KIS, QA, Trake)
  const [dresSessionId, setDresSessionId] = useState(() => sessionStorage.getItem('dresSessionId') || null);
  const [dresEvaluationId, setDresEvaluationId] = useState(() => sessionStorage.getItem('dresEvaluationId') || null);
  const [dresUsername, setDresUsername] = useState(() => sessionStorage.getItem('dresUsername') || null);
  const [dresMode, setDresMode] = useState('KIS');
  const [isHoveringTrakePanel, setIsHoveringTrakePanel] = useState(false);
  const [hoveredFrame, setHoveredFrame] = useState(null);
  const [openDresSubmit, setOpenDresSubmit] = useState(null);

  const socketRef = useRef(null);
  const latestWorkspaceRef = useRef(null);
  const submittedStagesRef = useRef(null);
  const submittedSearchModelRef = useRef(DEFAULT_SEARCH_MODEL);
  const activeAgentRun = workspaceTabs.find((tab) => tab.id === activeWorkspaceTab);

  latestWorkspaceRef.current = {
    stages,
    searchModel,
    searchResults,
    lastFinalQueries,
    resultIsAmbiguous,
    isClustered,
    isAmbiguous,
    timingInfo,
    page,
    hasMore,
    contextShot,
  };

  const updateHistoryDepths = (store = readWorkspaceHistory()) => {
    const currentIndex = store.entries.findIndex((entry) => entry.id === store.currentId);
    setGoBackDepth(currentIndex > 0 ? Math.min(currentIndex, MAX_GO_BACK_STEPS - 1) : 0);
    setGoForwardDepth(currentIndex >= 0 ? store.entries.length - currentIndex - 1 : 0);
  };

  const restoreWorkspaceSnapshot = (snapshot) => {
    setStages(snapshot.stages || [createEmptyStage()]);
    submittedStagesRef.current = snapshot.submittedStages || snapshot.stages || null;
    setSearchModel(normalizeSearchModel(snapshot.searchModel, DEFAULT_SEARCH_MODEL));
    submittedSearchModelRef.current = normalizeSearchModel(snapshot.submittedSearchModel || snapshot.searchModel, DEFAULT_SEARCH_MODEL);
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
      if (key === 'arrowleft' || key === 'backspace') {
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
        const latestStage = latestWorkspaceRef.current?.stages?.at(-1);
        const willActivate = !(latestStage?.ocrActive ?? !!latestStage?.ocrText);
        updateLatestStage((stage) => ({ ...stage, ocrActive: !(stage.ocrActive ?? !!stage.ocrText) }));
        if (willActivate) focusLatestStageField('ocr');
      } else if (key === 'y') {
        event.preventDefault();
        const latestStage = latestWorkspaceRef.current?.stages?.at(-1);
        const willActivate = !(latestStage?.asrActive ?? !!latestStage?.asrText);
        updateLatestStage((stage) => ({ ...stage, asrActive: !(stage.asrActive ?? !!stage.asrText) }));
        if (willActivate) focusLatestStageField('asr');
      } else if (key === 'i') {
        event.preventDefault();
        const latestStage = latestWorkspaceRef.current?.stages?.at(-1);
        const nextField = latestStage?.queryType === 'image' ? 'query' : 'imageText';
        updateLatestStage((stage) => ({ ...stage, queryType: stage.queryType === 'image' ? 'text' : 'image' }));
        focusLatestStageField(nextField);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        const nextStage = createEmptyStage();
        setStagesWithHistory((prev) => [...prev, nextStage]);
        setStageFocusRequest({ stageId: nextStage.id, field: 'query', token: Date.now() });
      } else if (event.key === '-') {
        event.preventDefault();
        setStagesWithHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
      } else if (key === 'r') {
        event.preventDefault();
        executeReset();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!username) return;

    const wsUrl = getWsUrl();
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => console.info(`[ws] connected: ${wsUrl}`);
    ws.onerror = () => console.error(`[ws] connection error: ${wsUrl} — agent/teamwork updates will not arrive`);
    ws.onclose = (e) => console.warn(`[ws] closed (code ${e.code}): ${wsUrl}`);

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const { type, data } = message;

      if (type === 'new_frame') {
        if (!data?.shot) return;
        const mappedData = {
          ...data,
          shot: {
            ...data.shot,
            url: data.shot.url?.startsWith('data:image')
              ? data.shot.url
              : (getImageUrl(data.shot.frame_name || data.shot.url) || data.shot.url)
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
              : (getImageUrl(frame.shot?.frame_name || frame.shot?.url) || frame.shot?.url),
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
      } else if (type === 'wrong_frames_sync') {
        const mappedData = (data || []).map(shot => ({
          ...shot,
          url: getImageUrl(shot.frame_name)
        }));
        setWrongFrames(mappedData);
      } else if (type === 'trake_sync') {
        const mappedData = (data || []).map(shot => ({
          ...shot,
          url: getImageUrl(shot.frame_name)
        }));
        setTrakeFrames(mappedData);
      } else if (type === 'trake_add') {
        const mappedShot = {
          ...data.shot,
          url: data.shot.url?.startsWith('data:image')
            ? data.shot.url
            : (getImageUrl(data.shot.frame_name || data.shot.url) || data.shot.url)
        };
        setTrakeFrames(prev => {
          if (prev.some(s => s.filepath === mappedShot.filepath)) return prev;
          return [...prev, mappedShot];
        });
      } else if (type === 'trake_remove') {
        setTrakeFrames(prev => prev.filter(s => s.filepath !== data.filepath));
      } else if (type === 'global_correct_submission') {
        const mappedShot = {
          ...data.shot,
          url: data.shot.url?.startsWith('data:image')
            ? data.shot.url
            : (getImageUrl(data.shot.frame_name || data.shot.url) || data.shot.url)
        };
        setCorrectSubmission(mappedShot);
        setTeamworkFrames([{ shot: mappedShot, user: { name: 'SYSTEM', color: '#10b981' } }]);

        try {
          const audio = new Audio('/phonk1.MP3');
          audio.volume = 1.0;
          audio.muted = isMutedRef.current;
          playingAudioRef.current = audio;
          audio.play().catch(e => console.log("Audio play failed:", e));
        } catch (e) { }
      } else if (type === 'agent_log') {
        setWorkspaceTabs((prev) => prev.map((tab) => {
          if (tab.id !== data.tab_id) return tab;
          const nextStatus = inferAgentStatusFromLog(data.message, tab.status);
          return {
            ...tab,
            status: nextStatus,
            logs: [
              ...(tab.logs || []),
              { message: data.message, receivedAt: Date.now() },
            ],
          };
        }));
      } else if (type === 'agent_observation' || type === 'agent_observation_grid') {
        setWorkspaceTabs((prev) => prev.map((tab) => {
          if (tab.id !== data.tab_id) return tab;
          const observation = {
            step: data.step || (tab.observations?.length || 0) + 1,
            image: data.image,
            shots: (data.shots || []).map((shot) => ({
              ...shot,
              url: getImageUrl(shot.url || shot.frame_name),
            })),
            receivedAt: Date.now(),
          };
          const withoutSameStep = (tab.observations || []).filter((item) => (
            item.step !== observation.step || item.image !== observation.image
          ));
          return {
            ...tab,
            status: 'inspecting',
            observations: [...withoutSameStep, observation],
          };
        }));
      } else if (type === 'agent_final') {
        setWorkspaceTabs((prev) => prev.map((tab) => {
          if (tab.id !== data.tab_id) return tab;
          return {
            ...tab,
            status: data.status === 'MATCH_FOUND' ? 'found' : data.status === 'GIVE_UP' ? 'gave_up' : tab.status,
            final: {
              ...data,
              shot: data.shot ? {
                ...data.shot,
                url: getImageUrl(data.shot.url || data.shot.frame_name),
              } : null,
            },
          };
        }));
      }
    };
    return () => ws.close();
  }, [username]);

  const addTeamworkFrameLocal = (shot) => {
    if (!shot) return;
    const shotWithUrl = { ...shot, url: getImageUrl(shot.frame_name || shot.url) || shot.url };
    const incomingKey = getShotKey(shotWithUrl);
    setTeamworkFrames((prev) => {
      if (incomingKey && prev.some((frame) => getShotKey(frame.shot) === incomingKey)) return prev;
      return [{ shot: shotWithUrl, user: { name: username, color: userColor } }, ...prev];
    });
  };

  const handlePushToTrake = (shot) => {
    if (!shot) return;
    const shotWithUrl = { ...shot, url: getImageUrl(shot.frame_name || shot.url) || shot.url };

    // Add locally first
    setTrakeFrames(prev => {
      if (prev.some(s => s.filepath === shotWithUrl.filepath)) return prev;
      return [...prev, shotWithUrl];
    });

    // Broadcast via WS
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'trake_add',
        data: { shot: shotWithUrl }
      }));
    }
    toast.success('Pinned to Trake Panel');
    setShowTrake(true); // Auto-open Trake panel
  };

  const removeTeamworkFrameLocal = (shotToRemove) => {
    if (!shotToRemove) return;
    const removeKey = getShotKey(shotToRemove);
    setTeamworkFrames((prev) => prev.filter((frame) => {
      const shot = frame.shot || {};
      return !(
        (removeKey && getShotKey(shot) === removeKey) ||
        (shotToRemove.filepath && shot.filepath === shotToRemove.filepath) ||
        (shotToRemove.frame_name && shot.frame_name === shotToRemove.frame_name) ||
        (shotToRemove.url && shot.url === shotToRemove.url)
      );
    }));
  };

  const handleLogoutDres = () => {
    setDresSessionId(null);
    setDresEvaluationId(null);
    setDresUsername(null);
    sessionStorage.removeItem('dresSessionId');
    sessionStorage.removeItem('dresEvaluationId');
    sessionStorage.removeItem('dresUsername');
    toast.success('Logged out from DRES');
  };

  const handleJoinSession = (name, color) => {
    setUsername(name);
    setUserColor(color);
    sessionStorage.setItem('username', name);
    sessionStorage.setItem('userColor', color);
    setShowUserModal(false);
    toast.success(`Welcome, ${name}!`);
  };

  const handleInstantDresSubmit = useCallback(async (shot) => {
    if (!dresSessionId || !dresEvaluationId) {
      toast.error('DRES is not logged in.');
      return;
    }

    if (dresMode === 'QA') {
      if (!shot) {
        toast.error('No frame selected for QA.');
        return;
      }
      setOpenDresSubmit(shot);
      return;
    }

    if (dresMode === 'Trake') {
      if (!trakeFrames || trakeFrames.length === 0) return;
      const loadingToast = toast.loading('Submitting Trake to DRES...');
      try {
        const { getVideoInfo } = await import('./api');
        const info = await getVideoInfo(trakeFrames[0].video_id);
        const fps = info?.fps || 25;
        const time = trakeFrames[0].frame_id / fps;
        const ms = Math.floor(time * 1000);

        const payload = {
          answerSets: [{
            answers: [{
              mediaItemName: trakeFrames[0].video_id,
              start: ms,
              end: ms
            }]
          }]
        };

        const res = await fetch(`${DRES_BASE_URL}/api/v2/submit/${dresEvaluationId}?session=${dresSessionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const resText = await res.text();
        if (!res.ok) throw new Error(resText || res.statusText);

        let resData = {};
        try { resData = JSON.parse(resText); } catch (e) { }

        if (resData.submission === 'CORRECT') {
          setTeamworkFrames([{ shot: trakeFrames[0], user: { name: username || 'ME', color: userColor || '#10b981' } }]);
          toast.success('Trake Submit CORRECT!', { id: loadingToast });
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
              type: 'global_correct_submission',
              data: { shot: trakeFrames[0] }
            }));
          }
        } else if (resData.submission === 'WRONG') {
          toast.error(`Trake Submit WRONG`, { id: loadingToast });
          setWrongFrames(prev => [trakeFrames[0], ...prev]);
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
              type: 'global_wrong_submission',
              data: { shot: trakeFrames[0] }
            }));
          }
        } else {
          toast.success(`Trake Submitted: ${resData.submission || 'OK'}`, { id: loadingToast });
        }
      } catch (err) {
        toast.error(`Trake Submit Error: ${err.message}`, { id: loadingToast });
      }
      return;
    }

    if (dresMode === 'KIS') {
      if (!shot) {
        toast.error('No frame selected for KIS.');
        return;
      }
      const loadingToast = toast.loading('Submitting KIS to DRES...');
      try {
        const { getVideoInfo } = await import('./api');
        const info = await getVideoInfo(shot.video_id);
        const fps = info?.fps || 25;
        const time = shot.frame_id / fps;
        const ms = Math.floor(time * 1000);

        const payload = {
          answerSets: [{
            answers: [{
              mediaItemName: shot.video_id,
              start: ms,
              end: ms
            }]
          }]
        };

        const res = await fetch(`${DRES_BASE_URL}/api/v2/submit/${dresEvaluationId}?session=${dresSessionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const resText = await res.text();
        if (!res.ok) {
          throw new Error(resText || res.statusText);
        }
        let resData = {};
        try { resData = JSON.parse(resText); } catch (e) { }

        if (resData.submission === 'CORRECT') {
          setCorrectSubmission(shot);
          toast.success('KIS Submit CORRECT!', { id: loadingToast });
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
              type: 'global_correct_submission',
              data: { shot: shot }
            }));
          }
        } else if (resData.submission === 'WRONG') {
          toast.error(`KIS Submit WRONG`, { id: loadingToast });
          setWrongFrames(prev => [shot, ...prev]);
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
              type: 'global_wrong_submission',
              data: { shot: shot }
            }));
          }
        } else {
          toast.success(`KIS Submitted: ${resData.submission || 'OK'}`, { id: loadingToast });
        }
      } catch (err) {
        toast.error(`KIS Submit Error: ${err.message}`, { id: loadingToast });
      }
    }
  }, [dresSessionId, dresEvaluationId, dresMode, trakeFrames, username, userColor]);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Ignore if input/textarea is focused, except if we still want to allow Trake submit
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
        return;
      }

      // Ctrl + Shift + Space
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        if (isHoveringTrakePanel) {
          // Instant Trake submission
          handleInstantDresSubmit(null);
        } else if (hoveredFrame) {
          // Instant KIS/QA submission
          handleInstantDresSubmit(hoveredFrame);
        }
      }

      // Ctrl + G for Cluster toggle
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyG') {
        e.preventDefault();
        setIsClustered(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleInstantDresSubmit, hoveredFrame, isHoveringTrakePanel]);

  useEffect(() => {
    const handleQaCorrect = (e) => {
      const shot = e.detail?.shot;
      if (shot) setTeamworkFrames([{ shot, user: { name: username || 'ME', color: userColor || '#10b981' } }]);
    };
    window.addEventListener('dres-qa-correct', handleQaCorrect);
    return () => window.removeEventListener('dres-qa-correct', handleQaCorrect);
  }, [username, userColor]);

  const performSearch = async (pageNumber = 1, overrideStages = null, captureHistory = true) => {
    const requestedSearchModel = pageNumber === 1
      ? normalizeSearchModel(searchModel)
      : submittedSearchModelRef.current || normalizeSearchModel(searchModel);

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
      const activeSearchModel = requestedSearchModel;
      const activeStages = pageNumber === 1
        ? await enhanceStagesForSearch(sourceStages, activeSearchModel)
        : submittedStagesRef.current || sourceStages;
      const modelPayload = buildSearchModelPayload(activeSearchModel);
      if (pageNumber === 1) {
        submittedStagesRef.current = activeStages;
        submittedSearchModelRef.current = activeSearchModel;
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
          ...(lockedVideos.length > 0 ? { video_ids: lockedVideos.map(v => v.videoId) } : {}),
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

      if (isMobileMenuOpen) setIsMobileMenuOpen(false); // Close mobile sidebar on search

    } catch (error) {
      toast.error("Search failed: " + error.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Change this part inside handleQuickImageSearch:
  const handleQuickImageSearch = async (shot) => {
    setActiveWorkspaceTab('manual');
    setLoading(true);
    setSearchResults([]);
    setTimingInfo(null);


    const controller = new AbortController();
    // Set a 15-second timeout to abort the upload if the server hangs
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      let imageUrl;
      if (shot.url?.startsWith('data:image')) {
        imageUrl = shot.url;
      } else {
        imageUrl = getImageUrl(shot.url || shot.frame_name);

        // Proxy external URLs (like Google Images) to bypass CORS
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

      // Pass the abort signal to the fetch request
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        body: fd,
        signal: controller.signal
      });

      clearTimeout(timeoutId); // Clear timeout if upload succeeded

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

      const updatedStages = stages.map((stg, idx) => {
        if (idx === 0) {
          return {
            ...stg,
            queryType: 'image',
            tempImageName: uploadData.temp_image_name,
            imagePreview: shot.url,
            imageText: '',
            queryText: '',
            ocrActive: false,
            asrActive: false,
            ocrText: '',
            asrText: '',
          };
        }
        return stg;
      });

      await performSearch(1, updatedStages, false);

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

  const handleStartAgentSearch = async (prompt) => {
    const trimmedPrompt = (prompt || '').trim();
    if (!trimmedPrompt) {
      toast.error('Enter a query before starting Agent Search.');
      return;
    }

    const tabId = createAgentTabId();
    const nextTab = {
      id: tabId,
      prompt: trimmedPrompt,
      title: createAgentTitle(trimmedPrompt),
      status: 'starting',
      logs: [],
      observations: [],
      final: null,
      createdAt: Date.now(),
    };

    setWorkspaceTabs((prev) => [...prev, nextTab]);
    setActiveWorkspaceTab(tabId);
    setIsMobileMenuOpen(false);

    try {
      await startAgentSearch({ tab_id: tabId, prompt: trimmedPrompt });
      toast.success('Agent Search started.');
    } catch (error) {
      setWorkspaceTabs((prev) => prev.map((tab) => (
        tab.id === tabId
          ? {
            ...tab,
            status: 'failed',
            logs: [
              ...tab.logs,
              { message: `Failed to start agent: ${error.message}`, receivedAt: Date.now() },
            ],
          }
          : tab
      )));
      toast.error(`Agent Search failed: ${error.message}`);
    }
  };

  const closeAgentTab = (tabId) => {
    setWorkspaceTabs((prev) => prev.filter((tab) => tab.id !== tabId));
    if (activeWorkspaceTab === tabId) {
      setActiveWorkspaceTab('manual');
    }
  };

  const handleOpenVideoPreview = (videoId, frameId) => {
    if (!videoId) return;
    setPreviewVideoData({ videoId, frameId });
    setActiveModal('video');
  };

  const executeReset = () => {
    const nextStages = [createEmptyStage()];
    submittedStagesRef.current = null;
    submittedSearchModelRef.current = DEFAULT_SEARCH_MODEL;
    setStages(nextStages);
    setSearchModel(DEFAULT_SEARCH_MODEL);
    setSearchResults([]);
    setLastFinalQueries([]);
    setResultIsAmbiguous(false);
    setTimingInfo(null);
    setPage(1);
    setHasMore(false);
    setLoadingMore(false);
    setContextShot(null);
  };

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

  return (
    <div className={`theme-${effectiveTheme} flex flex-col w-full h-screen overflow-hidden ${effectiveTheme === 'jujutsu' ? 'bg-[#050505]' : 'bg-[var(--bg-primary)]'} text-[var(--text-primary)] transition-colors duration-1000 ease-smooth relative`}>
      {theme === 'random' && (
        <div
          key={effectiveTheme}
          className="theme-shift-wash"
          aria-hidden="true"
        />
      )}

      {openDresSubmit && dresSessionId && (
        <DresSubmitModal
          shot={openDresSubmit}
          sessionId={dresSessionId}
          evaluationId={dresEvaluationId}
          onClose={() => setOpenDresSubmit(null)}
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

          <TopToolbar
            username={username}
            userColor={userColor}
            theme={theme}
            setTheme={setTheme}
            showTrake={showTrake}
            setShowTrake={setShowTrake}
            isClustered={isClustered}
            setIsClustered={setIsClusteredWithHistory}
            isAmbiguous={isAmbiguous}
            setIsAmbiguous={setIsAmbiguousWithHistory}
            searchModel={searchModel}
            setSearchModel={setSearchModel}
            autoTranslate={autoTranslate}
            setAutoTranslate={setAutoTranslate}
            dresMode={dresMode}
            setDresMode={setDresMode}
            dresSessionId={dresSessionId}
            dresUsername={dresUsername}
            onOpenDresLogin={() => setActiveModal('dresLogin')}
            onLogoutDres={handleLogoutDres}
            onOpenModal={setActiveModal}
            onGoBack={goBackOneStep}
            onGoForward={goForwardOneStep}
            canGoBack={goBackDepth > 0}
            canGoForward={goForwardDepth > 0}
            goBackDepth={goBackDepth}
            goForwardDepth={goForwardDepth}
            onReset={handleResetSearch}
            onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            timingInfo={timingInfo}
            isMuted={isMuted}
            setIsMuted={setIsMuted}
          />

          <div className={`flex flex-col flex-grow pt-[72px] h-[calc(100vh-72px)] w-full overflow-hidden ${effectiveTheme === 'jujutsu' ? 'bg-transparent' : 'bg-[var(--bg-primary)]'} relative transition-colors duration-700 ease-smooth`}>
            <div className="flex-shrink-0 h-[46px] border-b border-[var(--border-color)] bg-[var(--card-bg)] flex items-center gap-2 px-3 overflow-x-auto backdrop-blur-xl">
              <button
                className={`h-8 flex items-center gap-2 px-3 rounded-lg border text-xs font-bold transition-all whitespace-nowrap ${activeWorkspaceTab === 'manual'
                  ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg)]'
                  }`}
                onClick={() => setActiveWorkspaceTab('manual')}
              >
                <i className="fas fa-search text-[11px]"></i>
                Manual Search
              </button>
              {workspaceTabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`h-8 flex items-center gap-2 px-3 rounded-lg border text-xs font-bold transition-all whitespace-nowrap ${activeWorkspaceTab === tab.id
                    ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg)]'
                    }`}
                  onClick={() => setActiveWorkspaceTab(tab.id)}
                  title={tab.prompt}
                >
                  <i className={`fas ${tab.status === 'starting' || tab.status === 'thinking' || tab.status === 'searching' || tab.status === 'inspecting' ? 'fa-circle-notch fa-spin' : tab.status === 'found' ? 'fa-check-circle text-emerald-400' : tab.status === 'failed' ? 'fa-triangle-exclamation text-red-400' : 'fa-brain'} text-[11px]`}></i>
                  Agent: {tab.title}
                  <span
                    className="w-5 h-5 rounded-md flex items-center justify-center hover:bg-red-500/15 hover:text-red-400"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeAgentTab(tab.id);
                    }}
                    title="Close tab"
                  >
                    <i className="fas fa-times text-[10px]"></i>
                  </span>
                </button>
              ))}
            </div>

            <div className="flex flex-row flex-grow min-h-0 w-full overflow-hidden relative">
              {activeWorkspaceTab === 'manual' ? (
                <>
                  {/* Mobile Sidebar Overlay */}
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
                      onSearch={executeSearch}
                      onAgentSearch={handleStartAgentSearch}
                      onQuickSearch={handleQuickImageSearch}
                      loading={loading}
                      theme={effectiveTheme}
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
                    socket={socketRef.current}
                    username={username}
                    userColor={userColor}
                    onTeamworkAddLocal={addTeamworkFrameLocal}
                    onTeamworkRemoveLocal={removeTeamworkFrameLocal}
                    onPushToTrake={handlePushToTrake}
                    correctSubmission={correctSubmission}
                    onZoom={setZoomedImage}
                    isClustered={isClustered}
                    isAmbiguous={resultIsAmbiguous}
                    onContext={setContextShot}
                    onQuickSearch={handleQuickImageSearch}
                    onToggleLock={toggleVideoLock}
                    lockedVideoIds={lockedVideos.map(v => v.videoId)}
                    dresMode={dresMode}
                    setHoveredFrame={setHoveredFrame}
                    setIsHoveringTrakePanel={setIsHoveringTrakePanel}
                    onDresSubmit={handleInstantDresSubmit}
                  />
                </>
              ) : (
                <AgentRunView
                  run={activeAgentRun}
                  socket={socketRef.current}
                  username={username}
                  userColor={userColor}
                  onTeamworkAddLocal={addTeamworkFrameLocal}
                  onZoom={setZoomedImage}
                  onPreview={handleOpenVideoPreview}
                  onContext={setContextShot}
                  onQuickSearch={handleQuickImageSearch}
                  onToggleLock={toggleVideoLock}
                  lockedVideoIds={lockedVideos.map(v => v.videoId)}
                />
              )}
            </div>
          </div>

          {showUserModal && <UsernameModal onJoin={handleJoinSession} />}
          {activeModal === 'filter' && <ObjectFilterModal onClose={() => setActiveModal(null)} />}
          {activeModal === 'help' && <HelpModal onClose={() => setActiveModal(null)} />}
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
              socket={socketRef.current}
              username={username}
              userColor={userColor}
              wrongFrames={wrongFrames}
              onDresSubmit={handleInstantDresSubmit}
            />
          )}

          {contextShot && (
            <FrameContextModal
              shotData={contextShot}
              onClose={() => setContextShot(null)}
              onZoom={setZoomedImage}
              onPreview={handleOpenVideoPreview}
              socket={socketRef.current}
              username={username}
              userColor={userColor}
              onSubmitDres={handleInstantDresSubmit}
              onContext={setContextShot}
              onQuickSearch={handleQuickImageSearch}
            />
          )}

          {zoomedImage && (
            <div
              className="fixed inset-0 bg-black/90 z-[2500] flex items-center justify-center cursor-default animate-fadeIn p-4 backdrop-blur-sm"
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
                className="max-w-[90vw] max-h-[90vh] object-contain rounded-2xl shadow-[var(--shadow-heavy)] border border-[var(--border-color)] animate-scaleIn"
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
