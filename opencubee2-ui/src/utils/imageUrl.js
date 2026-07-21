/**
 * Generates the full URL for a keyframe image served by your asset server.
 * By default, images are served by the local UI host at /keyframes/<file>.
 * Set VITE_ASSET_BASE_URL when a separate local image host is preferred.
 */
export const getImageUrl = (filename) => {
  if (!filename) return '';
  if (/^(https?:|data:|blob:)/.test(filename)) return filename;

  const baseUrl = import.meta.env.VITE_ASSET_BASE_URL || '/keyframes';
  const normalized = String(filename).replace(/^\/keyframes\//, '').split(/[\\/]/).pop();
  if (!normalized || normalized.startsWith('/')) return filename;
  return `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(normalized)}`;
};
