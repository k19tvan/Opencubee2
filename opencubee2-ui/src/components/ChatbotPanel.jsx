// src/components/ChatbotPanel.jsx
import { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { runMultiAgentSearch, sendChatMessage } from '../api';
import MultiAgentResultsModal from './MultiAgentResultsModal';

export default function ChatbotPanel({
  isOpen,
  onClose,
  onApplyQuery,
  onZoom,
  onPreview,
  onContext,
  onQuickSearch,
  onToggleLock,
  lockedVideoIds,
  onPushToTeam,
  onPushToTrake,
  onDresSubmit,
}) {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Xin chào! Tôi có thể giúp bạn nghiên cứu từ khóa, tra cứu đối tượng hoặc thực hiện tìm kiếm đa tác nhân lặp (Multi-Agent K-Loops).',
      options: null,
    },
  ]);
  const [input, setInput] = useState('');
  const [loadingMode, setLoadingMode] = useState(null);
  const [frameLimit, setFrameLimit] = useState(50);
  const [kIterations, setKIterations] = useState(3);
  const [isLimitOpen, setIsLimitOpen] = useState(false);
  const [isKOpen, setIsKOpen] = useState(false);
  const [activeSearchResult, setActiveSearchResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandedOptionIdx, setExpandedOptionIdx] = useState({});
  const [selectedOptions, setSelectedOptions] = useState({});
  const [sessionId] = useState(() => `session_${Date.now()}`);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const toggleOption = (msgId, optIdx) => {
    setExpandedOptionIdx((prev) => {
      const key = `${msgId}_${optIdx}`;
      return { ...prev, [key]: !prev[key] };
    });
  };

  const toggleSelectOption = (msgId, optText) => {
    setSelectedOptions((prev) => {
      const currentList = prev[msgId] || [];
      const exists = currentList.includes(optText);
      const updated = exists ? currentList.filter((item) => item !== optText) : [...currentList, optText];
      return { ...prev, [msgId]: updated };
    });
  };

  const handleSend = async (mode = 'research', customQuery = null, customOptions = null) => {
    const text = (customQuery !== null ? customQuery : input).trim();
    if (!text || loading) return;

    const chosenOpts = customOptions !== null ? customOptions : [];

    const userMsg = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      mode,
      selectedOptions: chosenOpts,
    };

    setMessages((prev) => [...prev, userMsg]);
    if (customQuery === null) setInput('');
    setLoading(true);
    setLoadingMode(mode);

    try {
      const res = mode === 'search'
        ? await runMultiAgentSearch({
            query: text,
            selected_options: chosenOpts,
            use_research: true,
            k_iterations: kIterations,
            frame_limit: frameLimit,
          })
        : await sendChatMessage({
            query: text,
            is_research: true,
            session_id: sessionId,
          });

      const assistantMsg = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: mode === 'search'
          ? `Hoàn tất ${res.completed_iterations || kIterations} vòng lặp Multi-Agent. VLM critic đã chọn tổng cộng ${res.selected_count || 0} frame.`
          : (res.content || 'Đã có kết quả nghiên cứu:'),
        options: mode === 'research' ? (res.options || null) : null,
        searchResult: mode === 'search' ? res : null,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      toast.error(`Chat error: ${err.message}`);
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'assistant',
          content: `Có lỗi xảy ra: ${err.message}`,
        },
      ]);
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e.ctrlKey || e.metaKey ? 'search' : 'research');
    }
  };

  const handleClear = () => {
    setActiveSearchResult(null);
    setExpandedOptionIdx({});
    setSelectedOptions({});
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: 'Đã xóa hội thoại. Bạn có thể bắt đầu nghiên cứu mới!',
        options: null,
      },
    ]);
  };

  return (<>
    <div
      className={`fixed inset-y-0 right-0 z-[1800] flex h-[100dvh] w-full min-w-[320px] max-w-[520px] flex-col border-l border-slate-700 bg-[#0b1324] shadow-[-16px_0_48px_rgba(0,0,0,0.6)] transition-transform duration-300 ease-in-out sm:w-[400px] md:w-[440px] lg:w-[480px] ${
        isOpen ? 'pointer-events-auto translate-x-0' : 'pointer-events-none translate-x-full'
      }`}
      aria-hidden={!isOpen}
    >
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-700 bg-[#080f1e] px-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-400/40 bg-violet-500/15 text-violet-300">
            <i className="fas fa-robot text-sm"></i>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-bold text-xs text-[var(--text-primary)]">
              <span>AI Multi-Agent Retrieval</span>
              <span className="rounded bg-violet-500/20 px-1 py-0.2 text-[9px] font-mono text-violet-300">K-Loop</span>
            </div>
            <p className="text-[10px] text-[var(--text-secondary)] truncate">Research · FG-CLIP2 · Critic Loop</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleClear}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            title="Xóa đoạn chat"
          >
            <i className="fas fa-trash-can text-xs"></i>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <i className="fas fa-xmark text-sm"></i>
          </button>
        </div>
      </div>

      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const msgSelectedOpts = selectedOptions[msg.id] || [];

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`${isUser ? 'max-w-[90%]' : 'w-full max-w-full'} rounded-2xl px-3.5 py-2.5 leading-relaxed break-words shadow-sm ${
                  isUser
                    ? 'bg-[var(--accent-primary)] text-[var(--bg-primary)] font-medium rounded-tr-sm'
                    : 'bg-[var(--glass-bg)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-tl-sm'
                }`}
              >
                {isUser && msg.mode && (
                  <div className="mb-1 text-[8px] font-bold uppercase tracking-[0.16em] opacity-65">
                    {msg.mode === 'search' ? `Multi-Agent (K=${kIterations})` : 'Research'}
                  </div>
                )}
                <div>{msg.content}</div>

                {isUser && msg.selectedOptions && msg.selectedOptions.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {msg.selectedOptions.map((opt, i) => (
                      <span key={i} className="rounded bg-black/25 px-1.5 py-0.5 text-[9px] font-semibold">
                        ✓ {opt}
                      </span>
                    ))}
                  </div>
                )}

                {msg.searchResult && (
                  <button
                    type="button"
                    onClick={() => setActiveSearchResult(msg.searchResult)}
                    className="mt-3 flex w-full items-center gap-3 rounded-xl border border-violet-400/40 bg-violet-500/10 p-3 text-left text-[11px] text-[var(--text-primary)] transition-all hover:border-violet-400/70 hover:bg-violet-500/20"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300"><i className="fas fa-images" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">Mở album kết quả ({msg.searchResult.completed_iterations || kIterations} loops)</span>
                      <span className="mt-1 flex flex-wrap gap-1 text-[9px] text-[var(--text-secondary)]">
                        {Object.entries(msg.searchResult.modalities || {}).map(([key, value]) => (
                          <span key={key} className="rounded bg-black/15 px-1.5 py-0.5">
                            {key.replace('_', ' ')}: {value.frames?.length || 0} selected
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="rounded-full bg-violet-500/20 px-2 py-1 text-[10px] font-bold text-violet-300">{msg.searchResult.selected_count || 0}</span>
                    <i className="fas fa-chevron-right text-[9px] text-[var(--text-secondary)]" />
                  </button>
                )}

                {/* Danh sách Research Options */}
                {msg.options && msg.options.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-[var(--border-color)]/60 pt-2.5">
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-primary)] flex items-center gap-1.5">
                        <i className="fas fa-lightbulb"></i> Các lựa chọn khả năng cao:
                      </span>
                      {msgSelectedOpts.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const lastUserQuery = messages.filter((m) => m.role === 'user').slice(-1)[0]?.content || '';
                            handleSend('search', lastUserQuery, msgSelectedOpts);
                          }}
                          className="rounded-md bg-violet-500/20 border border-violet-400/50 px-2 py-0.5 text-[9px] font-bold text-violet-200 hover:bg-violet-500/30 transition-all flex items-center gap-1"
                        >
                          <i className="fas fa-play text-[8px]" /> Chạy Multi-Agent ({msgSelectedOpts.length})
                        </button>
                      )}
                    </div>

                    {msg.options.map((opt, idx) => {
                      const isExpanded = !!expandedOptionIdx[`${msg.id}_${idx}`];
                      const isSelected = msgSelectedOpts.includes(opt.option);

                      return (
                        <div
                          key={idx}
                          className={`rounded-xl border transition-all duration-200 overflow-hidden ${
                            isSelected
                              ? 'border-violet-400/70 bg-violet-500/10'
                              : 'border-[var(--border-color)] bg-[var(--card-bg)]/90'
                          }`}
                        >
                          <div
                            onClick={() => toggleOption(msg.id, idx)}
                            className="p-2.5 flex items-start justify-between gap-2 cursor-pointer hover:bg-[var(--glass-bg)] select-none"
                          >
                            <div className="flex items-start gap-2 min-w-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSelectOption(msg.id, opt.option);
                                }}
                                className={`w-5 h-5 shrink-0 rounded-md font-bold text-[10px] flex items-center justify-center mt-0.5 border transition-all ${
                                  isSelected
                                    ? 'bg-violet-500 border-violet-400 text-white'
                                    : 'bg-[var(--glass-bg)] border-[var(--border-color)] text-[var(--text-secondary)]'
                                }`}
                                title="Chọn thực thể này cho Search"
                              >
                                {isSelected ? '✓' : idx + 1}
                              </button>
                              <span className="font-semibold text-[11px] text-[var(--text-primary)] leading-tight break-words">
                                {opt.option}
                              </span>
                            </div>

                            <div className="flex items-center gap-1 shrink-0 text-[var(--text-secondary)]">
                              {onApplyQuery && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onApplyQuery(opt.option);
                                    toast.success(`Đã đưa vào Search: "${opt.option}"`);
                                  }}
                                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--accent-primary)]/20 hover:text-[var(--accent-primary)] transition-colors"
                                  title="Đưa vào ô tìm kiếm chính"
                                >
                                  <i className="fas fa-arrow-up-right-from-square text-[10px]"></i>
                                </button>
                              )}
                              <i
                                className={`fas fa-chevron-down text-[9px] transition-transform duration-200 ml-1 ${
                                  isExpanded ? 'rotate-180 text-[var(--accent-primary)]' : ''
                                }`}
                              />
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="px-3 py-2 border-t border-[var(--border-color)]/60 bg-[var(--glass-bg)]/50 text-[11px] text-[var(--text-secondary)] leading-relaxed animate-fadeIn">
                              <strong className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-primary)] block mb-1">
                                Lý do:
                              </strong>
                              {opt.reason}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--glass-bg)] p-3 text-xs text-[var(--accent-primary)]">
            <div className="flex items-center gap-2 font-semibold">
              <i className="fas fa-circle-notch fa-spin" />
              <span>{loadingMode === 'search' ? `Đang chạy Multi-Agent (${kIterations} loops)…` : 'Đang research thực thể…'}</span>
            </div>
            {loadingMode === 'search' && (
              <p className="mt-1.5 pl-5 text-[10px] leading-relaxed text-[var(--text-secondary)]">
                Decompose → FG-CLIP2 + Meilisearch → Canvas critic 3 ảnh/lô → Loop feedback.
              </p>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box Footer */}
      <div className="shrink-0 border-t border-slate-700 bg-[#080f1e] p-3 shadow-[0_-10px_24px_rgba(0,0,0,0.2)]">
        <div className="mb-2 grid grid-cols-[1fr_1fr_auto_auto] gap-1.5">
          <button
            type="button"
            onClick={() => handleSend('search')}
            disabled={loading || !input.trim()}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-violet-400/50 bg-violet-500/20 px-2 text-[10px] font-bold uppercase tracking-wider text-violet-100 transition-colors hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-40"
            title="Ctrl+Enter: Chạy Multi-Agent lặp K vòng"
          >
            <i className="fas fa-magnifying-glass" /> Search
          </button>
          <button
            type="button"
            onClick={() => handleSend('research')}
            disabled={loading || !input.trim()}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-blue-400/50 bg-blue-500/15 px-2 text-[10px] font-bold uppercase tracking-wider text-blue-100 transition-colors hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            title="Enter: Nghiên cứu đối tượng / bối cảnh"
          >
            <i className="fas fa-globe" /> Research
          </button>

          {/* K iterations dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsKOpen((v) => !v)}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-violet-400/40 bg-violet-500/15 px-2 text-[10px] font-bold text-violet-200 transition-colors hover:bg-violet-500/25"
              title="Số vòng lặp Multi-Agent (K)"
            >
              <span>K={kIterations}</span>
              <i className={`fas fa-chevron-down text-[8px] transition-transform ${isKOpen ? 'rotate-180' : ''}`} />
            </button>
            {isKOpen && (
              <div className="absolute bottom-[calc(100%+6px)] right-0 z-20 min-w-[90px] overflow-hidden rounded-lg border border-slate-600 bg-[#0b1020] py-1 shadow-xl">
                {[1, 2, 3, 4, 5].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setKIterations(k);
                      setIsKOpen(false);
                    }}
                    className={`block w-full px-3 py-1.5 text-left text-[10px] font-semibold ${
                      k === kIterations ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    K = {k} {k === 3 ? '(Default)' : ''}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Frame limit dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsLimitOpen((v) => !v)}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--glass-bg)] px-2 text-[10px] font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              title="Số lượng frame lấy mỗi modality"
            >
              <i className="fas fa-images" /> {frameLimit}
              <i className={`fas fa-chevron-down text-[8px] transition-transform ${isLimitOpen ? 'rotate-180' : ''}`} />
            </button>
            {isLimitOpen && (
              <div className="absolute bottom-[calc(100%+6px)] right-0 z-20 min-w-[100px] overflow-hidden rounded-lg border border-slate-600 bg-[#0b1020] py-1 shadow-xl">
                {[20, 50, 100, 200].map((limit) => (
                  <button
                    key={limit}
                    type="button"
                    onClick={() => {
                      setFrameLimit(limit);
                      setIsLimitOpen(false);
                    }}
                    className={`block w-full px-3 py-1.5 text-left text-[10px] font-semibold ${
                      limit === frameLimit ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {limit} frames
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="relative flex items-center bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-xl focus-within:border-[var(--border-hover)] focus-within:ring-1 focus-within:ring-white/10 transition-all">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Nhập mô tả cảnh cần tìm hoặc nội dung cần research…"
            rows="2"
            className="w-full bg-transparent px-3 py-2 text-xs text-[var(--text-primary)] outline-none resize-none placeholder:text-[var(--text-secondary)]"
          />
        </div>
        <div className="mt-1.5 text-right text-[9px] text-[var(--text-secondary)]">
          Enter: Research · Ctrl+Enter: Search · Shift+Enter: xuống dòng
        </div>
      </div>
    </div>
    {activeSearchResult && (
      <MultiAgentResultsModal
        result={activeSearchResult}
        onClose={() => setActiveSearchResult(null)}
        onZoom={onZoom}
        onPreview={onPreview}
        onContext={onContext}
        onQuickSearch={onQuickSearch}
        onToggleLock={onToggleLock}
        lockedVideoIds={lockedVideoIds}
        onPushToTeam={onPushToTeam}
        onPushToTrake={onPushToTrake}
        onDresSubmit={onDresSubmit}
      />
    )}
  </>);
}
