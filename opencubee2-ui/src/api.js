// src/api.js

export const BASE_URL = import.meta.env.VITE_BACKEND_BASE_URL || `http://${window.location.hostname}:2108`;
export const VIDEO_BACKEND_BASE_URL = import.meta.env.VITE_VIDEO_BACKEND_BASE_URL || BASE_URL;
export const DRES_BASE_URL = import.meta.env.VITE_DRES_BASE_URL || 'http://192.168.28.151:5000';

export function getWsUrl() {
  // Derive ws(s):// from the REST base; fall back to same-origin if BASE_URL is relative.
  if (/^https?:/i.test(BASE_URL)) {
    return `${BASE_URL.replace(/^http/i, 'ws').replace(/\/$/, '')}/ws`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${BASE_URL.replace(/\/$/, '')}/ws`;
}

async function handleResponse(response) {
  if (!response.ok) {
    let errorMessage = `HTTP Error: ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.detail || errorMessage;
    } catch {
      // Bỏ qua nếu response không phải là JSON
    }
    throw new Error(errorMessage);
  }
  return response.json();
}

/**
 * Tìm kiếm đơn tầng (Single Stage Search)
 */
export async function searchSingle(searchData, imageFile = null) {
  const formData = new FormData();
  formData.append('search_data', JSON.stringify(searchData));

  if (imageFile) {
    formData.append('query_image', imageFile, imageFile.name);
  }

  const response = await fetch(`${BASE_URL}/search`, {
    method: 'POST',
    body: formData,
  });
  return handleResponse(response);
}

/**
 * Tìm kiếm đa tầng (Temporal Search)
 */
export async function searchTemporal(temporalPayload) {
  const response = await fetch(`${BASE_URL}/temporal_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(temporalPayload),
  });
  return handleResponse(response);
}

/**
 * Tìm kiếm Semantic ASR
 */
export async function searchSemanticAsr(payload) {
  const response = await fetch(`${BASE_URL}/search_semantic_asr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse(response);
}

/**
 * Tải ảnh cục bộ tạm thời lên server
 */
export async function uploadImage(file) {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`${BASE_URL}/upload_image`, {
    method: 'POST',
    body: formData,
  });
  return handleResponse(response);
}

/**
 * Tìm kiếm hình ảnh bằng từ khóa qua Google
 */
export async function googleImageSearch(query) {
  const response = await fetch(`${BASE_URL}/google_images?q=${encodeURIComponent(query)}`);
  const urls = await handleResponse(response);
  return { image_urls: urls };
}

export async function enhanceQuery(payload) {
  const response = await fetch(`${BASE_URL}/enhance_query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(payload),
  });
  return handleResponse(response);
}

export async function sendAgentMessage(payload) {
  const response = await fetch(`${BASE_URL}/agent/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse(response);
}

export async function selectAgentOption(payload) {
  const response = await fetch(`${BASE_URL}/agent/option`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse(response);
}

export async function sendAgentFeedback(payload) {
  const response = await fetch(`${BASE_URL}/agent/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse(response);
}

export async function deleteAgentSession(sessionId) {
  if (!sessionId) return { deleted: false };
  const response = await fetch(`${BASE_URL}/agent/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  return handleResponse(response);
}

export async function getAgentEvents(sessionId, afterId = 0) {
  const url = new URL(`${BASE_URL}/agent/sessions/${encodeURIComponent(sessionId)}/events`);
  url.searchParams.set('after_id', String(afterId));
  const response = await fetch(url.toString(), { cache: 'no-store' });
  return handleResponse(response);
}

/**
 * Lấy thông tin video (đặc biệt là FPS)
 */
export async function getVideoInfo(videoId) {
  const response = await fetch(`${VIDEO_BACKEND_BASE_URL.replace(/\/$/, '')}/video_info/${encodeURIComponent(videoId)}`);
  return handleResponse(response);
}

export function getVideoUrl(videoId) {
  return `${VIDEO_BACKEND_BASE_URL.replace(/\/$/, '')}/videos/${encodeURIComponent(videoId)}`;
}

export function getVideoThumbnailUrl(videoId, frame, width = 160) {
  const params = new URLSearchParams({
    frame: String(Math.max(0, Math.round(frame))),
    width: String(width),
  });
  return `${VIDEO_BACKEND_BASE_URL.replace(/\/$/, '')}/video_thumbnail/${encodeURIComponent(videoId)}?${params.toString()}`;
}

/**
 * Fetch similar frames for a given frame name using the backend's /similar endpoint
 */
export async function getSimilarFrames(frameName, limit = 15, threshold = 0.95) {
  const url = new URL(`${BASE_URL}/similar`);
  url.searchParams.append('frame_name', frameName);
  url.searchParams.append('limit', limit);
  url.searchParams.append('threshold', threshold);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });
  return handleResponse(response);
}

// --- SoloAI Submissions ---

export async function uploadSoloAIZip(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${BASE_URL}/soloai/upload_zip`, {
    method: 'POST',
    body: formData,
  });
  return handleResponse(response);
}

export async function getSoloAIQueries() {
  const response = await fetch(`${BASE_URL}/soloai/queries`);
  return handleResponse(response);
}

export async function submitSoloAI(payload) {
  const response = await fetch(`${BASE_URL}/soloai/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse(response);
}

export async function deleteSoloAISubmit(payload) {
  const response = await fetch(`${BASE_URL}/soloai/submit`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse(response);
}

export async function createSoloAIQuery(queryName) {
  const response = await fetch(`${BASE_URL}/soloai/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query_name: queryName }),
  });
  return handleResponse(response);
}

export async function deleteSoloAIQuery(queryName) {
  const response = await fetch(`${BASE_URL}/soloai/query/${encodeURIComponent(queryName)}`, {
    method: 'DELETE',
  });
  return handleResponse(response);
}
