import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { getVideoInfo, getVideoThumbnailUrl, getVideoUrl } from '../../api';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const THUMB_WIDTH = 112;
const THUMB_GAP = 4;
const THUMB_STEP = THUMB_WIDTH + THUMB_GAP;

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return '00:00.000';
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(3).padStart(6, '0')}`;
};

export default function VideoPreviewModal({ videoId, initialFrame, onClose, socket, username, userColor, onDresSubmit, wrongFrames = [] }) {
  const videoRef = useRef(null);
  const timelineRef = useRef(null);
  const dragRef = useRef(null);
  const didDragRef = useRef(false);
  const initialSeekDoneRef = useRef(false);
  const [fps, setFps] = useState(25);
  const [frameCount, setFrameCount] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(Number(initialFrame) || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [fineScrub, setFineScrub] = useState(true);
  const [metadataReady, setMetadataReady] = useState(false);
  const [infoReady, setInfoReady] = useState(false);
  const [thumbnailsEnabled, setThumbnailsEnabled] = useState(false);
  const [timelineWidth, setTimelineWidth] = useState(0);

  const maxFrame = useMemo(() => {
    if (frameCount > 0) return frameCount - 1;
    if (duration > 0 && fps > 0) return Math.max(0, Math.round(duration * fps) - 1);
    return Math.max(Number(initialFrame) || 0, currentFrame, 1);
  }, [currentFrame, duration, fps, frameCount, initialFrame]);

  const currentTime = fps > 0 ? currentFrame / fps : 0;
  const videoSrc = useMemo(() => getVideoUrl(videoId), [videoId]);

  const thumbnailInterval = useMemo(() => {
    if (!duration) return fineScrub ? 1 : 2;
    const targetCount = fineScrub ? 420 : 220;
    const rawInterval = duration / targetCount;
    const minimum = fineScrub ? 0.5 : 2;
    return Math.max(minimum, Math.ceil(rawInterval * 2) / 2);
  }, [duration, fineScrub]);

  const timelineFrames = useMemo(() => {
    if (!duration || !fps) return [];
    const count = Math.min(500, Math.ceil(duration / thumbnailInterval) + 1);
    return Array.from({ length: count }, (_, index) => {
      const time = Math.min(index * thumbnailInterval, duration);
      const frame = clamp(Math.round(time * fps), 0, maxFrame);
      return { frame, time };
    });
  }, [duration, fps, maxFrame, thumbnailInterval]);

  const seekToFrame = useCallback((frame, shouldPause = true) => {
    const video = videoRef.current;
    if (!video || !fps) return;
    const nextFrame = clamp(Math.round(frame), 0, maxFrame);
    if (shouldPause) video.pause();
    video.currentTime = nextFrame / fps;
    setCurrentFrame(nextFrame);
  }, [fps, maxFrame]);

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(e => console.warn('Video playback delayed or prevented:', e));
    } else {
      video.pause();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchInfo = async () => {
      try {
        const info = await getVideoInfo(videoId);
        if (cancelled) return;
        if (info?.fps) setFps(info.fps);
        if (info?.frame_count) setFrameCount(info.frame_count);
        if (info?.duration) setDuration(info.duration);
      } catch (error) {
        console.warn('Failed to get video info, using defaults', error);
        toast.error('Video metadata unavailable; using default FPS.');
      } finally {
        if (!cancelled) setInfoReady(true);
      }
    };
    fetchInfo();
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    if (!metadataReady || !infoReady || initialSeekDoneRef.current) return;
    seekToFrame(Number(initialFrame) || 0, false);
    initialSeekDoneRef.current = true;
    
    // Auto-play after seeking to initial frame
    const video = videoRef.current;
    if (video && video.paused) {
      video.play().catch(e => console.warn('Autoplay failed:', e));
    }
  }, [infoReady, initialFrame, metadataReady, seekToFrame]);

  useEffect(() => {
    if (metadataReady) {
      const timer = setTimeout(() => setThumbnailsEnabled(true), 300);
      return () => clearTimeout(timer);
    }
  }, [metadataReady]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const element = timelineRef.current;
    if (!element) return undefined;
    const updateWidth = () => setTimelineWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seekToFrame(currentFrame - (event.shiftKey ? 10 : 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        seekToFrame(currentFrame + (event.shiftKey ? 10 : 1));
      } else if (event.code === 'Space') {
        event.preventDefault();
        handlePlayPause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentFrame, handlePlayPause, onClose, seekToFrame]);

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      setDuration(video.duration);
      setFrameCount((previous) => previous || Math.round(video.duration * fps));
    }
    video.playbackRate = playbackRate;
    setMetadataReady(true);
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !fps) return;
    setCurrentFrame(clamp(Math.round(video.currentTime * fps), 0, maxFrame));
  };

  const handleTimelinePointerDown = (event) => {
    videoRef.current?.pause();
    didDragRef.current = false;
    dragRef.current = {
      x: event.clientX,
      frame: currentFrame,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleTimelinePointerMove = (event) => {
    if (!dragRef.current) return;
    if (Math.abs(event.clientX - dragRef.current.x) > 3) {
      didDragRef.current = true;
    }
    const pixelsPerSecond = THUMB_STEP / thumbnailInterval;
    const deltaSeconds = (dragRef.current.x - event.clientX) / pixelsPerSecond;
    seekToFrame(dragRef.current.frame + deltaSeconds * fps);
  };

  const handleTimelinePointerUp = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleTimelineWheel = (event) => {
    event.preventDefault();
    const delta = event.deltaX || event.deltaY;
    const seconds = (delta / 100) * thumbnailInterval;
    seekToFrame(currentFrame + seconds * fps);
  };

  const handlePushFrame = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      toast.error('Teamwork connection is not ready.');
      return;
    }

    const frame = clamp(Math.round(video.currentTime * fps), 0, maxFrame);
    let url;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context || !canvas.width || !canvas.height) {
        throw new Error('Video frame is not ready.');
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      url = canvas.toDataURL('image/jpeg', 0.8);
    } catch (error) {
      console.error('Failed to capture video frame:', error);
      toast.error('Could not capture the current video frame.');
      return;
    }

    const frameName = `${videoId}_${String(frame).padStart(6, '0')}.webp`;

    socket.send(JSON.stringify({
      type: 'new_frame',
      data: {
        shot: {
          video_id: videoId,
          frame_id: frame,
          url,
          filepath: `dynamic-frame-${videoId}-${frame}`,
          frame_name: frameName,
        },
        user: { name: username, color: userColor },
      },
    }));
    toast.success('Frame sent to Teamwork Panel!');
  };

  const handleSubmitFrame = () => {
    const video = videoRef.current;
    if (!video || !onDresSubmit) return;
    const frame = clamp(Math.round(video.currentTime * fps), 0, maxFrame);
    
    // Create a mock shot object for DRES submission and Teamwork
    const mockShot = {
      video_id: videoId,
      frame_id: frame,
      frame_name: `${videoId}_${String(frame).padStart(6, '0')}.webp`,
      filepath: `dynamic-frame-${videoId}-${frame}`,
      url: getVideoThumbnailUrl(videoId, frame, 480)
    };
    
    onDresSubmit(mockShot, false);
  };

  const stripPosition = currentTime / thumbnailInterval * THUMB_STEP;
  const stripTranslate = timelineWidth / 2 - stripPosition - THUMB_WIDTH / 2;

  return (
    <div className="fixed inset-0 bg-black/95 z-[2100] flex items-center justify-center p-3 backdrop-blur-sm">
      <button
        type="button"
        className="absolute top-4 right-6 text-white text-2xl hover:text-red-500 hover:rotate-90 duration-200 cursor-pointer z-[2102] bg-black/50 rounded-full w-10 h-10 flex items-center justify-center"
        onClick={onClose}
        title="Close (Esc)"
        aria-label="Close"
      >
        &times;
      </button>

      <div className="flex flex-col items-center w-full max-w-[92vw] gap-3">
        <div className="relative flex items-center justify-center w-full min-h-0">
          <video
            ref={videoRef}
            src={videoSrc}
            className="max-h-[64vh] max-w-full rounded-xl shadow-2xl border border-white/15 bg-black cursor-pointer"
            crossOrigin="anonymous"
            playsInline
            fetchPriority="high"
            autoPlay={true}
            onClick={handlePlayPause}
            onDoubleClick={(event) => event.currentTarget.requestFullscreen?.()}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onSeeked={handleTimeUpdate}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
          {!isPlaying && (
            <button
              type="button"
              onClick={handlePlayPause}
              className="absolute w-16 h-16 rounded-full bg-black/60 border border-white/30 text-white text-xl hover:bg-[var(--accent-primary)] hover:scale-105 transition"
              aria-label="Play video"
            >
              <i className="fas fa-play ml-1"></i>
            </button>
          )}
        </div>

        <div className="w-full max-w-6xl rounded-xl border border-white/10 bg-slate-950/90 px-4 py-3 shadow-2xl">
          <div className="flex items-center gap-2 sm:gap-3">
            <button type="button" className="video-control-button" onClick={() => seekToFrame(currentFrame - 10)} title="Back 10 frames">
              <i className="fas fa-backward"></i>
            </button>
            <button type="button" className="video-control-button" onClick={() => seekToFrame(currentFrame - 1)} title="Back 1 frame">
              <i className="fas fa-step-backward"></i>
            </button>
            <button type="button" className="w-11 h-11 shrink-0 rounded-xl bg-[var(--accent-primary)] text-white hover:brightness-110 active:scale-95" onClick={handlePlayPause} title={isPlaying ? 'Pause' : 'Play'}>
              <i className={`fas ${isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
            </button>
            <button type="button" className="video-control-button" onClick={() => seekToFrame(currentFrame + 1)} title="Forward 1 frame">
              <i className="fas fa-step-forward"></i>
            </button>
            <button type="button" className="video-control-button" onClick={() => seekToFrame(currentFrame + 10)} title="Forward 10 frames">
              <i className="fas fa-forward"></i>
            </button>

            <div className="flex-1 min-w-[120px] px-1 sm:px-3">
              <input
                type="range"
                min="0"
                max={maxFrame}
                step="1"
                value={currentFrame}
                onChange={(event) => seekToFrame(Number(event.target.value))}
                className="w-full accent-[var(--accent-primary)] cursor-pointer"
                aria-label="Frame scrubber"
              />
            </div>

            <div className="min-w-[105px] sm:min-w-[145px] text-right font-mono text-[11px] text-slate-200">
              <div>Frame {currentFrame} / {maxFrame}</div>
              <div className="text-slate-400">{formatTime(currentTime)} · {fps.toFixed(2)} fps</div>
            </div>
          </div>

          <div
            ref={timelineRef}
            className="video-thumbnail-timeline mt-3"
            onPointerDown={handleTimelinePointerDown}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={handleTimelinePointerUp}
            onPointerCancel={handleTimelinePointerUp}
            onWheel={handleTimelineWheel}
            title="Drag or scroll to scrub through the video"
          >
            <div className="video-timeline-playhead" />
            <div
              className="absolute inset-y-0 left-0 flex gap-1 will-change-transform"
              style={{ transform: `translate3d(${stripTranslate}px, 0, 0)` }}
            >
              {timelineFrames.map(({ frame, time }) => (
                <button
                  key={`${frame}-${time}`}
                  type="button"
                  className="relative shrink-0 w-28 h-16 bg-slate-800 overflow-hidden border border-white/10 hover:border-white/50"
                  onClick={() => {
                    if (!didDragRef.current) seekToFrame(frame);
                  }}
                  title={`Frame ${frame} · ${formatTime(time)}`}
                >
                  {thumbnailsEnabled && (
                    <img
                      src={getVideoThumbnailUrl(videoId, frame, THUMB_WIDTH * 2)}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      className="w-full h-full object-cover pointer-events-none animate-fadeIn"
                    />
                  )}
                  {wrongFrames.some(w => w.video_id === videoId && Math.abs(w.frame_id - frame) <= (fps * thumbnailInterval / 2)) && (
                    <div className="absolute top-0 right-0 px-1 py-0.5 rounded-bl bg-red-600/90 z-10" title="Wrong Submission Near Here">
                      <span className="text-[8px] font-bold text-white">WRONG</span>
                    </div>
                  )}
                  <span className="absolute bottom-0 inset-x-0 bg-black/65 px-1 py-0.5 text-[9px] font-mono text-slate-100">
                    {formatTime(time)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`px-3 py-2 rounded-lg border text-xs font-semibold ${fineScrub ? 'bg-[var(--accent-primary)] text-white border-transparent' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}
                onClick={() => setFineScrub((value) => !value)}
                title="Fine shows denser timeline thumbnails; overview covers more time"
              >
                <i className="fas fa-sliders mr-2"></i>{fineScrub ? 'Fine timeline' : 'Overview timeline'}
              </button>
              {[0.25, 0.5, 1, 2].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  className={`px-3 py-2 rounded-lg border text-xs font-semibold ${playbackRate === rate ? 'bg-white text-slate-950 border-white' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}
                  onClick={() => setPlaybackRate(rate)}
                >
                  {rate}x
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-[var(--accent-primary)]/20 border border-[var(--accent-primary)]/50 text-[var(--accent-primary)] text-xs font-bold uppercase tracking-wider hover:bg-[var(--accent-primary)] hover:text-white active:scale-95 disabled:opacity-40"
                onClick={handleSubmitFrame}
                disabled={!onDresSubmit}
              >
                <i className="fas fa-paper-plane mr-2"></i>Submit
              </button>
              
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-white/10 border border-white/10 text-white text-xs font-bold uppercase tracking-wider hover:bg-[var(--accent-primary)] hover:border-transparent active:scale-95 disabled:opacity-40"
                onClick={handlePushFrame}
                disabled={!socket}
              >
                <i className="fas fa-users mr-2"></i>Push to Team
              </button>
            </div>
          </div>

          <p className="mt-2 text-center text-[10px] text-slate-500">
            Drag/scroll timeline · ←/→ one frame · Shift+←/→ ten frames · Space play/pause · Double-click video fullscreen
          </p>
        </div>
      </div>
    </div>
  );
}
