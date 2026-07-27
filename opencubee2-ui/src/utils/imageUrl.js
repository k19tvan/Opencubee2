// src/utils/imageUrl.js
import { BASE_URL } from '../api';

/**
 * Generates the full URL for a keyframe image served by your asset server.
 * By default, images are served by the backend tunnel at /keyframes/<file>.
 * Set VITE_ASSET_BASE_URL when a separate image host is preferred.
 */
export const getImageUrl = (filename) => {
  if (!filename) return '';
  if (/^(https?:|data:|blob:)/.test(filename)) return filename;

  const baseUrl = import.meta.env.VITE_ASSET_BASE_URL || `${BASE_URL}/keyframes`;
  let normalized = String(filename).replace(/^\/keyframes\//, '').split(/[\\/]/).pop();
  if (!normalized || normalized.startsWith('/')) return filename;
  normalized = normalized.replace(/\.(jpg|jpeg|png)$/i, '.webp');
  return `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(normalized)}`;
};
