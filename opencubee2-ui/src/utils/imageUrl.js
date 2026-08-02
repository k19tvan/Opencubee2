// src/utils/imageUrl.js
import { BASE_URL } from '../api';

/**
 * Generates the full URL for a keyframe image.
 *
 * The backend is the source of truth: it resolves the exact keyframe selected
 * by search.  Do not use the UI's `/keyframes` mount here, because that mount
 * can be an out-of-date copy and show a different image for the same frame
 * name after a submission.
 *
 * A non-local VITE_ASSET_BASE_URL is still supported for deployments that
 * intentionally maintain a synchronized, separate image host.
 */
export const getImageUrl = (filename) => {
  if (!filename) return '';
  if (/^(https?:|data:|blob:)/.test(filename)) return filename;

  const configuredAssetBase = import.meta.env.VITE_ASSET_BASE_URL?.replace(/\/$/, '');
  const baseUrl = configuredAssetBase && configuredAssetBase !== '/keyframes'
    ? configuredAssetBase
    : `${BASE_URL}/keyframes`;
  let normalized = String(filename).replace(/^\/keyframes\//, '').split(/[\\/]/).pop();
  if (!normalized || normalized.startsWith('/')) return filename;
  return `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(normalized)}`;
};
