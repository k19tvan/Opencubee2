// src/components/StageCard.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { BASE_URL } from '../api';

const MODES = [
  { key: 'text',  icon: 'fas fa-font',        label: 'Text'   },
  { key: 'image', icon: 'fas fa-image',        label: 'Image'  },
];

const getBackendUrl = (path) => {
  return `${BASE_URL.replace(/\/$/, '')}${path}`;
};

export default function StageCard({
  stage,
  index,
  finalQueryPreview = '',
  focusRequest = null,
  onDelete,
  onChange,
  onSearch,
  canDelete = false,
  isReordering = false,
  onReorderPointerDown,
  similarityScopeActive = false,
  onClearSimilarityScope,
}) {
  const [type, setType]               = useState(stage.queryType || 'text');
  const [ocrActive, setOcrActive]     = useState(stage.ocrActive ?? !!stage.ocrText);
  const [asrActive, setAsrActive]     = useState(stage.asrActive ?? !!stage.asrText);
  const [isDragging, setIsDragging]   = useState(false);

  const [queryText,     setQueryText]     = useState(stage.queryText || '');
  const [ocrText,       setOcrText]       = useState(stage.ocrText   || '');
  const [asrText,       setAsrText]       = useState(stage.asrText   || '');
  const [imagePreview,  setImagePreview]  = useState(stage.imagePreview || null);
  const [imageText,     setImageText]     = useState(stage.imageText || '');
  const [tempImageName, setTempImageName] = useState(stage.tempImageName || null);
  const [options, setOptions]             = useState({
    enhance: !!stage.options?.enhance,
    bge_caption: false,
  });

  // Cờ hiệu để trì hoãn việc gọi onSearch cho đến khi nhận được hàm onSearch mới từ parent
  const [shouldSearch, setShouldSearch]   = useState(false);

  const debounceRef = useRef(null);
  const flushRef = useRef(null);
  const queryRef = useRef(null);
  const imageTextRef = useRef(null);
  const ocrRef = useRef(null);
  const asrRef = useRef(null);
  
  // Ref lưu dữ liệu đã gửi lên parent gần nhất để tránh bị ghi đè ngược khi đang gõ
  const lastFlushedRef = useRef({});

  // Gửi dữ liệu lên parent ngay lập tức
  const flushImmediate = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const data = {
      queryType: type,
      queryText,
      ocrActive,
      asrActive,
      ocrText: ocrActive ? ocrText : '',
      asrText: asrActive ? asrText : '',
      tempImageName,
      imageText,
      imagePreview,
      options,
    };
    
    lastFlushedRef.current = data;
    onChange(stage.id, data);
  }, [type, queryText, ocrActive, ocrText, asrActive, asrText, tempImageName, imageText, imagePreview, options, onChange, stage.id]);

  // Đồng bộ hàm flush mới nhất vào ref
  useEffect(() => {
    flushRef.current = flushImmediate;
  }, [flushImmediate]);

  // Debounce cập nhật (250ms)
  const scheduleUpdate = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      flushImmediate();
    }, 250);
  }, [flushImmediate]);

  useEffect(() => {
    scheduleUpdate();
  }, [type, queryText, ocrActive, ocrText, asrActive, asrText, tempImageName, imageText, imagePreview, options, scheduleUpdate]);

  // Đồng bộ props -> state khi dữ liệu bên ngoài thay đổi thực sự
  useEffect(() => {
    const last = lastFlushedRef.current;

    if (stage.queryType && stage.queryType !== type && stage.queryType !== last.queryType) {
      setType(stage.queryType);
    }
    if (stage.queryText !== undefined && stage.queryText !== queryText && stage.queryText !== last.queryText) {
      setQueryText(stage.queryText);
    }
    if (stage.imageText !== undefined && stage.imageText !== imageText && stage.imageText !== last.imageText) {
      setImageText(stage.imageText);
    }
    if (stage.tempImageName !== undefined && stage.tempImageName !== tempImageName && stage.tempImageName !== last.tempImageName) {
      setTempImageName(stage.tempImageName);
    }
    if (stage.imagePreview !== undefined && stage.imagePreview !== imagePreview && stage.imagePreview !== last.imagePreview) {
      setImagePreview(stage.imagePreview);
    }
    if (stage.ocrText !== undefined && stage.ocrText !== ocrText && stage.ocrText !== last.ocrText) {
      setOcrText(stage.ocrText);
      if (stage.ocrActive === undefined) setOcrActive(!!stage.ocrText);
    }
    if (stage.asrText !== undefined && stage.asrText !== asrText && stage.asrText !== last.asrText) {
      setAsrText(stage.asrText);
      if (stage.asrActive === undefined) setAsrActive(!!stage.asrText);
    }
    if (stage.ocrActive !== undefined && stage.ocrActive !== ocrActive && stage.ocrActive !== last.ocrActive) {
      setOcrActive(stage.ocrActive);
    }
    if (stage.asrActive !== undefined && stage.asrActive !== asrActive && stage.asrActive !== last.asrActive) {
      setAsrActive(stage.asrActive);
    }
    if (stage.options !== undefined && stage.options !== last.options) {
      setOptions({
        enhance: !!stage.options?.enhance,
        bge_caption: !!stage.options?.bge_caption,
      });
    }
  }, [stage.queryType, stage.queryText, stage.imageText, stage.tempImageName, stage.imagePreview, stage.ocrText, stage.asrText, stage.ocrActive, stage.asrActive, stage.options]);

  // Lắng nghe cờ hiệu: khi cờ bật, ta tắt cờ đi và gọi hàm onSearch mới nhất nhận từ props
  useEffect(() => {
    if (shouldSearch) {
      setShouldSearch(false);
      if (onSearch) {
        onSearch();
      }
    }
  }, [shouldSearch, onSearch]);

  useEffect(() => {
    if (!focusRequest || focusRequest.stageId !== stage.id) return undefined;

    const focusTarget = () => {
      const targets = {
        query: queryRef.current,
        imageText: imageTextRef.current,
        ocr: ocrRef.current,
        asr: asrRef.current,
      };
      const target = targets[focusRequest.field];
      if (!target) return;
      target.focus();
      if (typeof target.select === 'function') target.select();
    };

    const frameId = window.requestAnimationFrame(focusTarget);
    const timeoutId = window.setTimeout(focusTarget, 40);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [focusRequest, stage.id, type, ocrActive, asrActive]);

  // Kích hoạt tìm kiếm
  const handleSearchTrigger = useCallback(() => {
    if (flushRef.current) {
      flushRef.current(); // Lưu ngay dữ liệu hiện tại lên cha
    }
    setShouldSearch(true); // Đánh dấu để kích hoạt search ở cycle tiếp theo (sau khi render lại)
  }, []);

  const uploadImageFile = async (file) => {
    if (!file) return;
    setImagePreview(URL.createObjectURL(file));
    const fd = new FormData();
    fd.append('image', file);
    try {
      const uploadUrl = getBackendUrl('/upload_image');
      const res = await fetch(uploadUrl, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setTempImageName(data.temp_image_name);
    } catch (err) {
      console.error("Image upload failed:", err);
      toast.error('Image upload failed.');
      setImagePreview(null);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) uploadImageFile(file);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      uploadImageFile(files[0]);
    } else {
      let targetUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      let internalFrameName = null;
      const rawJson = e.dataTransfer.getData('application/json');
      if (rawJson) {
        try {
          const shotData = JSON.parse(rawJson);
          if (shotData && shotData.url) targetUrl = shotData.url;
          if (shotData && shotData.frame_name) internalFrameName = shotData.frame_name;
        } catch {}
      }
      
      if (internalFrameName) {
        // Skip fetching the URL and uploading! Just tell the backend to use the internal frame.
        setTempImageName(`_frame_:${internalFrameName}`);
        // Optionally set the image preview to the targetUrl so the UI looks good
        if (targetUrl) setImagePreview(targetUrl);
        return;
      }

      const htmlContent = e.dataTransfer.getData('text/html');
      if (htmlContent && !targetUrl) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        const img = doc.querySelector('img');
        if (img && img.src) targetUrl = img.src;
      }
      if (targetUrl) {
        try {
          const res = await fetch(targetUrl);
          const blob = await res.blob();
          let filename = "dragged_frame.jpg";
          try {
            const urlObj = new URL(targetUrl);
            const pathParts = urlObj.pathname.split('/');
            filename = pathParts[pathParts.length - 1] || "dragged_frame.jpg";
          } catch {}
          const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
          uploadImageFile(file);
        } catch (err) {
          console.error("Failed to process dragged image from page:", err);
          toast.error("Failed to load dragged image.");
        }
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      e.stopPropagation();
      setOptions((p) => ({ ...p, enhance: !p.enhance, bge_caption: false }));
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearchTrigger();
    }
  };

  const pillCls = (active) =>
    `w-7 h-7 rounded-lg border text-[10px] flex items-center justify-center cursor-pointer transition-all duration-200 ease-spring select-none hover:-translate-y-0.5 active:scale-90 active:translate-y-0
     ${active
       ? 'bg-[var(--text-primary)] border-[var(--text-primary)] text-[var(--bg-primary)] shadow-glow'
       : 'bg-transparent border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg)]'
     }`;

  return (
    <div
      className={`group relative bg-[var(--card-bg)] rounded-lg p-4 border border-[var(--border-color)] hover:border-[var(--border-hover)] hover:shadow-[var(--shadow-heavy)] transition-[border-color,box-shadow,transform,opacity] duration-150 ease-out ${isReordering ? 'scale-[0.985] opacity-80 shadow-[var(--shadow-heavy)] cursor-grabbing' : 'cursor-grab active:cursor-grabbing'}`}
      onPointerDown={(e) => onReorderPointerDown?.(e)}
    >
      <div className="absolute -top-2.5 left-4 bg-[var(--text-primary)] w-5 h-5 rounded-full flex items-center justify-center font-bold text-[9px] text-[var(--bg-primary)] shadow-sm z-10 transition-transform duration-300 ease-spring group-hover:scale-110">
        {index + 1}
      </div>
      {/* Drag handle */}
      <div
        className="absolute -top-3 right-8 w-7 h-7 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] flex items-center justify-center text-[var(--text-secondary)] cursor-grab active:cursor-grabbing hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:scale-110 transition-all z-20 opacity-70 group-hover:opacity-100 touch-none"
        title="Drag to reorder"
        onPointerDown={(e) => onReorderPointerDown?.(e)}
      >
        <i className="fas fa-grip-vertical text-[11px] pointer-events-none"></i>
      </div>
      {canDelete && (
        <button
          className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 transition-all duration-150 cursor-pointer"
          onClick={onDelete}
          title="Delete stage"
        >
          <i className="fas fa-times text-[9px]"></i>
        </button>
      )}
      <div className="flex flex-nowrap items-center justify-between gap-2 mt-2 mb-3 pb-1">
        {MODES.map(({ key, icon, label }) => (
          <button
            key={key}
            className={`${pillCls(type === key)} flex-shrink-0`}
            onClick={() => setType(key)}
            title={label}
            aria-label={label}
          >
            <i className={`${icon} text-[11px]`}></i>
          </button>
        ))}
        <button
          className={`${pillCls(ocrActive)} flex-shrink-0`}
          onClick={() => setOcrActive(!ocrActive)}
          title="OCR"
          aria-label="OCR"
        >
          <i className="fas fa-text-height text-[11px]"></i>
        </button>
        <button
          className={`${pillCls(asrActive)} flex-shrink-0`}
          onClick={() => setAsrActive(!asrActive)}
          title="ASR"
          aria-label="ASR"
        >
          <i className="fas fa-microphone text-[11px]"></i>
        </button>
        <button
          className={`${pillCls(options.enhance)} flex-shrink-0`}
          onClick={() => setOptions((p) => ({ ...p, enhance: !p.enhance, bge_caption: false }))}
          title="Enhance on search (Ctrl + E)"
          aria-label="Enhance on search"
        >
          <i className="fas fa-wand-magic-sparkles text-[11px]"></i>
        </button>
        {similarityScopeActive && (
          <button
            className={`${pillCls(true)} flex-shrink-0`}
            onClick={onClearSimilarityScope}
            title="Return to normal search (search all videos)"
            aria-label="Return to normal search"
          >
            <i className="fas fa-globe text-[11px]"></i>
          </button>
        )}
      </div>

      <div className="space-y-2">
        {type === 'text' && (
          <textarea
            ref={queryRef}
            className="w-full p-3 bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] text-xs focus:outline-none focus:border-[var(--border-hover)] focus:ring-1 focus:ring-white/10 transition-all duration-200 min-h-[60px] resize-y placeholder:text-[var(--text-secondary)]"
            placeholder="Enter your search query..."
            rows="3"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        )}
        {type === 'image' && (
          <div className="space-y-2">
            <label
              className={`relative flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg transition-all duration-200 overflow-hidden cursor-pointer ${
                isDragging
                  ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 scale-[1.02]'
                  : 'border-[var(--border-color)] bg-[var(--glass-bg)] hover:border-[var(--border-hover)] hover:bg-white/5'
              }`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
              onDrop={handleDrop}
            >
              {!imagePreview ? (
                <div className="text-center pointer-events-none">
                  <i className="fas fa-cloud-upload-alt text-lg mb-1"></i>
                  <p className="text-[10px]">Drag & drop image or <strong className="text-[var(--text-primary)]">browse file</strong></p>
                </div>
              ) : (
                <>
                  <img src={imagePreview} className="absolute inset-0 w-full h-full object-cover" alt="Preview" />
                  <button
                    className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center text-[10px] hover:bg-red-500 transition-all cursor-pointer z-10"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setImagePreview(null); setTempImageName(null); }}
                  >
                    <i className="fas fa-times"></i>
                  </button>
                </>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
            <input
              ref={imageTextRef}
              type="text"
              className="w-full px-3 py-2 bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] text-xs focus:outline-none focus:border-[var(--border-hover)] transition-all placeholder:text-[var(--text-secondary)]"
              placeholder="Add text description..."
              value={imageText}
              onChange={(e) => setImageText(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        )}
        {ocrActive && (
          <input
            ref={ocrRef}
            type="text"
            className="w-full px-3 py-2 bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] text-xs focus:outline-none focus:border-[var(--border-hover)] transition-all placeholder:text-[var(--text-secondary)]"
            placeholder="Filter by OCR..."
            value={ocrText}
            onChange={(e) => setOcrText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        )}
        {asrActive && (
          <input
            ref={asrRef}
            type="text"
            className="w-full px-3 py-2 bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] text-xs focus:outline-none focus:border-[var(--border-hover)] transition-all placeholder:text-[var(--text-secondary)]"
            placeholder="Filter by ASR..."
            value={asrText}
            onChange={(e) => setAsrText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        )}
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--glass-bg)] px-3 py-2">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            <i className="fas fa-terminal text-[8px]"></i>
            Final query
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--text-primary)] break-words min-h-[16px]">
            {finalQueryPreview || 'Press Search to update'}
          </p>
        </div>
      </div>
    </div>
  );
}
