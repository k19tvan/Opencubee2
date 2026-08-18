// src/components/ChatbotPanel.jsx
import React, { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { sendChatMessage } from '../api';

export default function ChatbotPanel({
  isOpen,
  onClose,
  onApplyQuery,
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
  const [isResearch, setIsResearch] = useState(true); // Mặc định Research là ON
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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await sendChatMessage({
        query: text,
        is_research: isResearch,
        session_id: sessionId,
      });

      const assistantMsg = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: res.content || 'Đã có kết quả:',
        options: res.options || null,
        isResearch: res.is_research,
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
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: 'Đã xóa hội thoại. Bạn có thể bắt đầu nghiên cứu mới!',
        options: null,
      },
    ]);
  };

  return (
    <div
      className={`fixed top-[52px] bottom-0 right-0 h-[calc(100vh-52px)] w-full sm:w-[380px] md:w-[420px] lg:w-1/4 min-w-[320px] max-w-[500px] z-[75] pointer-events-auto bg-[var(--card-bg)] border-l border-[var(--border-color)] shadow-[-12px_0_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl flex flex-col transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header — Nằm ngay dưới Top Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--glass-bg)] shrink-0 h-[48px]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent-primary)]/20 border border-[var(--accent-primary)]/30 flex items-center justify-center text-[var(--accent-primary)] shrink-0">
            <i className="fas fa-robot text-xs"></i>
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5 truncate">
              AI Research Assistant
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--glass-bg)] border border-[var(--border-color)] text-[var(--text-secondary)]">
                Alt+L
              </span>
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleClear}
            className="w-7 h-7 rounded-lg text-[var(--text-secondary)] hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center text-xs transition-colors"
            title="Clear conversation"
          >
            <i className="fas fa-trash-alt"></i>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg)] flex items-center justify-center text-xs transition-colors"
            title="Close panel (Alt + L)"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
      </div>

      {/* Messages Area — Tự cuộn mượt mà */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-xs custom-scrollbar">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1`}>
              <div
                className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 leading-relaxed break-words shadow-sm ${
                  isUser
                    ? 'bg-[var(--accent-primary)] text-[var(--bg-primary)] font-medium rounded-tr-sm'
                    : 'bg-[var(--glass-bg)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-tl-sm'
                }`}
              >
                <div>{msg.content}</div>

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
          <div className="flex items-center gap-2 text-xs text-[var(--accent-primary)] p-2 animate-pulse">
            <i className="fas fa-circle-notch fa-spin"></i>
            <span>{isResearch ? 'Đang tra cứu internet & phân tích...' : 'Đang trả lời...'}</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box Footer — Cố định ở đáy màn hình */}
      <div className="p-3 border-t border-[var(--border-color)] bg-[var(--card-bg)] shrink-0">
        <div className="flex items-center justify-between mb-2">
          {/* Nút bật/tắt Research Mode */}
          <button
            type="button"
            onClick={() => setIsResearch((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${
              isResearch
                ? 'bg-blue-500/20 border border-blue-400 text-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.3)]'
                : 'bg-[var(--glass-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <i className="fas fa-globe"></i>
            <span>Research: {isResearch ? 'ON' : 'OFF'}</span>
            <span className={`w-1.5 h-1.5 rounded-full ${isResearch ? 'bg-blue-400 animate-pulse' : 'bg-gray-500'}`}></span>
          </button>
          <span className="text-[9px] text-[var(--text-secondary)]">Enter để gửi</span>
        </div>

        <div className="relative flex items-center bg-[var(--glass-bg)] border border-[var(--border-color)] rounded-xl focus-within:border-[var(--border-hover)] focus-within:ring-1 focus-within:ring-white/10 transition-all">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Hỏi bất kỳ điều gì hoặc nhập chủ đề research..."
            rows="2"
            className="w-full bg-transparent px-3 py-2 text-xs text-[var(--text-primary)] outline-none resize-none placeholder:text-[var(--text-secondary)]"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="mr-2 w-8 h-8 rounded-lg bg-[var(--accent-primary)] text-[var(--bg-primary)] flex items-center justify-center hover:opacity-90 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0"
            title="Gửi tin nhắn"
          >
            <i className="fas fa-paper-plane text-xs"></i>
          </button>
        </div>
      </div>
    </div>
  );
}