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
      content: 'Xin chào! Tôi có thể giúp bạn nghiên cứu từ khóa, tra cứu đối tượng hoặc tóm tắt thông tin.',
      options: null,
    },
  ]);
  const [input, setInput] = useState('');
  const [loadingMode, setLoadingMode] = useState(null);
  const [frameLimit, setFrameLimit] = useState(50);
  const [isLimitOpen, setIsLimitOpen] = useState(false);
  const [activeSearchResult, setActiveSearchResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandedOptionIdx, setExpandedOptionIdx] = useState({});
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

  const handleSend = async (mode = 'research') => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      mode,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setLoadingMode(mode);

    try {
      const res = mode === 'search'
        ? await runMultiAgentSearch({ query: text, frame_limit: frameLimit })
        : await sendChatMessage({
          query: text,
          is_research: true,
          session_id: sessionId,
        });

      const assistantMsg = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: mode === 'search'
          ? `Đã phân rã thành ${res.active_modalities || 0} modality và VLM critic đã chọn ${res.selected_count || 0} frame.`
          : (res.content || 'Đã có kết quả:'),
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
      {/* Header — phủ lên vùng Top Bar để panel là một bề mặt độc lập */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-700 bg-[#080f1e] px-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-400/40 bg-violet-500/15 text-violet-300">
            <i className="fas fa-robot text-sm"></i>
          </div>
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 truncate text-xs font-bold text-slate-100">
              AI Research Assistant
              <span className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                Alt+L
              </span>
            </h3>
            <p className="mt-0.5 truncate text-[9px] text-slate-500">Research &amp; multi-modal retrieval</p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleClear}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-xs text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
            title="Clear conversation"
          >
            <i className="fas fa-trash-alt"></i>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            title="Close panel (Alt + L)"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
      </div>

      {/* Messages Area — Tự cuộn mượt mà */}
      <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#0b1324] p-4 text-xs">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1`}>
              <div
                className={`${isUser ? 'max-w-[90%]' : 'w-full max-w-full'} rounded-2xl px-3.5 py-2.5 leading-relaxed break-words shadow-sm ${
                  isUser
                    ? 'bg-[var(--accent-primary)] text-[var(--bg-primary)] font-medium rounded-tr-sm'
                    : 'bg-[var(--glass-bg)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-tl-sm'
                }`}
              >
                {isUser && msg.mode && <div className="mb-1 text-[8px] font-bold uppercase tracking-[0.16em] opacity-65">{msg.mode === 'search' ? 'Multi-modal search' : 'Research'}</div>}
                <div>{msg.content}</div>

                {msg.searchResult && (
                  <button
                    type="button"
                    onClick={() => setActiveSearchResult(msg.searchResult)}
                    className="mt-3 flex w-full items-center gap-3 rounded-xl border border-violet-400/40 bg-violet-500/10 p-3 text-left text-[11px] text-[var(--text-primary)] transition-all hover:border-violet-400/70 hover:bg-violet-500/20"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300"><i className="fas fa-images" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">Mở album kết quả critic</span>
                      <span className="mt-1 flex flex-wrap gap-1 text-[9px] text-[var(--text-secondary)]">
                        {Object.entries(msg.searchResult.modalities || {}).map(([key, value]) => <span key={key} className="rounded bg-black/15 px-1.5 py-0.5">{key.replace('_', ' ')} {value.frames?.length || 0}/{value.candidate_count || 0}</span>)}
                      </span>
                    </span>
                    <span className="rounded-full bg-violet-500/20 px-2 py-1 text-[10px] font-bold text-violet-300">{msg.searchResult.selected_count || 0}</span>
                    <i className="fas fa-chevron-right text-[9px] text-[var(--text-secondary)]" />
                  </button>
                )}

                {/* Danh sách Research Options */}
                {msg.options && msg.options.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-[var(--border-color)]/60 pt-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-primary)] flex items-center gap-1.5 mb-1.5">
                      <i className="fas fa-lightbulb"></i> Các lựa chọn khả năng cao:
                    </div>
                    {msg.options.map((opt, idx) => {
                      const isExpanded = !!expandedOptionIdx[`${msg.id}_${idx}`];
                      return (
                        <div
                          key={idx}
                          className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]/90 overflow-hidden transition-all duration-200"
                        >
                          {/* Option Header Button */}
                          <div
                            onClick={() => toggleOption(msg.id, idx)}
                            className="p-2.5 flex items-start justify-between gap-2 cursor-pointer hover:bg-[var(--glass-bg)] select-none"
                          >
                            <div className="flex items-start gap-2 min-w-0">
                              <span className="w-5 h-5 shrink-0 rounded-md bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] font-bold text-[10px] flex items-center justify-center mt-0.5">
                                {idx + 1}
                              </span>
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
                                  title="Đưa vào ô tìm kiếm"
                                >
                                  <i className="fas fa-arrow-up-right-from-square text-[10px]"></i>
                                </button>
                              )}
                              <i
                                className={`fas fa-chevron-down text-[9px] transition-transform duration-200 ml-1 ${
                                  isExpanded ? 'rotate-180 text-[var(--accent-primary)]' : ''
                                }`}
                              ></i>
                            </div>
                          </div>

                          {/* Collapsible Reason Box */}
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
            <div className="flex items-center gap-2 font-semibold"><i className="fas fa-circle-notch fa-spin" /><span>{loadingMode === 'search' ? 'Đang chạy multi-modal search…' : 'Đang research…'}</span></div>
            {loadingMode === 'search' && <p className="mt-1.5 pl-5 text-[10px] leading-relaxed text-[var(--text-secondary)]">Decompose → retrieve tối đa {frameLimit} frame/modality → critic theo canvas 20 frame. Với 100–200 frame, quá trình có thể mất vài phút.</p>}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box Footer — Cố định ở đáy màn hình */}
      <div className="shrink-0 border-t border-slate-700 bg-[#080f1e] p-3 shadow-[0_-10px_24px_rgba(0,0,0,0.2)]">
        <div className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-1.5">
          <button type="button" onClick={() => handleSend('search')} disabled={loading || !input.trim()} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-violet-400/50 bg-violet-500/20 px-2 text-[10px] font-bold uppercase tracking-wider text-violet-100 transition-colors hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-40" title="Ctrl+Enter: decompose, retrieve each modality, then visually critic"><i className="fas fa-magnifying-glass" /> Search</button>
          <button type="button" onClick={() => handleSend('research')} disabled={loading || !input.trim()} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-blue-400/50 bg-blue-500/15 px-2 text-[10px] font-bold uppercase tracking-wider text-blue-100 transition-colors hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-40" title="Enter: research and suggest likely entities"><i className="fas fa-globe" /> Research</button>
          <div className="relative">
            <button type="button" onClick={() => setIsLimitOpen((value) => !value)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--glass-bg)] px-2 text-[10px] font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]" title="Candidates retrieved per modality; each canvas contains 20 frames"><i className="fas fa-images" /> {frameLimit}<i className={`fas fa-chevron-down text-[8px] transition-transform ${isLimitOpen ? 'rotate-180' : ''}`} /></button>
            {isLimitOpen && <div className="absolute bottom-[calc(100%+6px)] right-0 z-20 min-w-[112px] overflow-hidden rounded-lg border border-slate-600 bg-[#0b1020] py-1 shadow-xl">{[20, 50, 100, 200].map((limit) => <button key={limit} type="button" onClick={() => { setFrameLimit(limit); setIsLimitOpen(false); }} className={`block w-full px-3 py-2 text-left text-[10px] font-semibold ${limit === frameLimit ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>{limit} frames</button>)}</div>}
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
        <div className="mt-1.5 text-right text-[9px] text-[var(--text-secondary)]">Enter: Research · Ctrl+Enter: Search · Shift+Enter: xuống dòng</div>
      </div>
    </div>
    {activeSearchResult && <MultiAgentResultsModal result={activeSearchResult} onClose={() => setActiveSearchResult(null)} onZoom={onZoom} onPreview={onPreview} onContext={onContext} onQuickSearch={onQuickSearch} onToggleLock={onToggleLock} lockedVideoIds={lockedVideoIds} onPushToTeam={onPushToTeam} onPushToTrake={onPushToTrake} onDresSubmit={onDresSubmit} />}
  </>);
}
