/**
 * Returns the source-video frame encoded in a keyframe name.
 *
 * Search results can contain an index frame_id that differs from the rendered
 * keyframe.  For DRES timestamps, the rendered keyframe name is authoritative:
 * K11_V012_0120_010605.webp represents source-video frame 10605.
 */
export const getDresFrameNumber = (shot = {}) => {
  const frameName = String(shot?.frame_name || '').split(/[\\/]/).pop().split('?')[0];
  const nameWithoutExtension = frameName.replace(/\.[^.]+$/, '');
  const parts = nameWithoutExtension.split('_');
  const encodedFrame = parts.length >= 4 ? parts.at(-1) : null;

  if (encodedFrame && /^\d+$/.test(encodedFrame)) {
    return Number.parseInt(encodedFrame, 10);
  }

  const indexedFrame = Number(shot?.frame_id);
  return Number.isFinite(indexedFrame) ? indexedFrame : 0;
};
