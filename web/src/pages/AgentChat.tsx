import { useState, useEffect, useRef } from 'react';
import { Send, User, AlertCircle, ChevronDown, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatSessionItem, WsMessage } from '@/types/api';
import { clearChatHistory, getChatHistory, getChatSessions } from '@/lib/api';
import { WebSocketClient } from '@/lib/ws';
import { Logo } from '@/components/ui/Logo';
import { useHeader } from '@/contexts/HeaderContext';

type TextMessage = {
  id: string;
  role: 'user' | 'agent';
  kind: 'text';
  content: string;
  timestamp: Date;
};

type ToolMessage = {
  id: string;
  role: 'agent';
  kind: 'tool';
  name: string;
  args?: unknown;
  outputText?: string;
  error?: string | null;
  imageBase64?: string | null;
  timestamp: Date;
};

type ChatMessage = TextMessage | ToolMessage;

const PAGE_SIZE = 50;
const PRIMARY_SESSION_ID = '__primary__';

export default function AgentChat() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState(PRIMARY_SESSION_ID);

  const { setCustomContent } = useHeader();
  const wsRef = useRef<WebSocketClient | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingContentRef = useRef('');
  const isPrependingRef = useRef(false);
  const activeSessionIdRef = useRef(PRIMARY_SESSION_ID);

  const parseToolPayload = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as {
        type?: string;
        name?: string;
        args?: unknown;
        output?: string;
        error?: string | null;
      };
      if (parsed.type === 'tool_call' || parsed.type === 'tool_result') {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  };

  const extractToolOutput = (output?: string, error?: string | null) => {
    let imageBase64: string | null = null;
    let outputText = output ?? '';
    if (output) {
      try {
        const parsed = JSON.parse(output) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const record = parsed as Record<string, unknown>;
          const candidate =
            (typeof record.png_base64 === 'string' && record.png_base64) ||
            (typeof record.screenshot_base64 === 'string' && record.screenshot_base64) ||
            (typeof record.image_base64 === 'string' && record.image_base64) ||
            null;
          imageBase64 = candidate;
          const { png_base64, screenshot_base64, image_base64, ...rest } = record;
          if (Object.keys(rest).length > 0) {
            outputText = JSON.stringify(rest, null, 2);
          } else {
            outputText = '';
          }
        } else if (Array.isArray(parsed)) {
          outputText = JSON.stringify(parsed, null, 2);
        }
      } catch {
        outputText = output;
      }
    }
    return {
      outputText,
      error,
      imageBase64,
    };
  };

  const buildToolMessage = (
    payload: {
      type?: string;
      name?: string;
      args?: unknown;
      output?: string;
      error?: string | null;
    },
    timestamp: Date,
  ): ToolMessage => {
    const derived: {
      outputText?: string;
      error?: string | null;
      imageBase64?: string | null;
    } =
      payload.type === 'tool_result' ? extractToolOutput(payload.output, payload.error) : {};
    return {
      id: crypto.randomUUID(),
      role: 'agent',
      kind: 'tool',
      name: payload.name ?? t('common.unknown'),
      args: payload.args,
      outputText: derived.outputText,
      error: derived.error ?? payload.error ?? null,
      imageBase64: derived.imageBase64 ?? null,
      timestamp,
    };
  };

  const mergeToolResult = (
    messagesToUpdate: ChatMessage[],
    payload: { name?: string; output?: string; error?: string | null },
    timestamp: Date,
  ) => {
    const last = messagesToUpdate[messagesToUpdate.length - 1];
    if (last && last.kind === 'tool' && !last.outputText && !last.error) {
      if (!payload.name || last.name === payload.name) {
        const derived = extractToolOutput(payload.output, payload.error);
        const next = [...messagesToUpdate];
        next[next.length - 1] = {
          ...last,
          outputText: derived.outputText,
          error: derived.error ?? last.error ?? null,
          imageBase64: derived.imageBase64 ?? last.imageBase64 ?? null,
          timestamp,
        };
        return next;
      }
    }
    return [
      ...messagesToUpdate,
      buildToolMessage({ type: 'tool_result', ...payload }, timestamp),
    ];
  };

  const loadHistory = async (initial = false) => {
    if (loadingHistory) return;
    if (!initial && !hasMoreHistory) return;
    setLoadingHistory(true);
    const offset = initial ? 0 : historyOffset;
    try {
      const sessionId = activeSessionIdRef.current;
      const response = await getChatHistory({
        offset,
        limit: PAGE_SIZE,
        session: sessionId !== PRIMARY_SESSION_ID ? sessionId : undefined,
      });
      const mapped = response.messages.reduce<ChatMessage[]>((acc, item) => {
        const timestamp = new Date(item.timestamp);
        if (item.role === 'tool') {
          const payload = parseToolPayload(item.content);
          if (!payload) {
            acc.push({
              id: crypto.randomUUID(),
              role: 'agent',
              kind: 'text',
              content: item.content,
              timestamp,
            });
            return acc;
          }
          if (payload.type === 'tool_call') {
            acc.push(buildToolMessage(payload, timestamp));
            return acc;
          }
          if (payload.type === 'tool_result') {
            return mergeToolResult(acc, payload, timestamp);
          }
        }
        acc.push({
          id: crypto.randomUUID(),
          role: item.role === 'user' ? 'user' : 'agent',
          kind: 'text',
          content: item.content,
          timestamp,
        });
        return acc;
      }, []);
      if (mapped.length > 0) {
        if (initial) {
          setMessages(mapped);
          setHistoryOffset(response.messages.length);
        } else {
          const container = messagesContainerRef.current;
          const previousHeight = container?.scrollHeight ?? 0;
          isPrependingRef.current = true;
          setMessages((prev) => [...mapped, ...prev]);
          setHistoryOffset((prev) => prev + response.messages.length);
          setTimeout(() => {
            if (container) {
              container.scrollTop = container.scrollHeight - previousHeight;
            }
            isPrependingRef.current = false;
          }, 0);
        }
      } else if (initial) {
        setHistoryOffset(0);
      }
      setHasMoreHistory(response.has_more);
    } catch {
      setHasMoreHistory(false);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (active) {
      loadHistory(true);
    }
    return () => {
      active = false;
    };
  }, []);

  const loadSessions = async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const items = await getChatSessions();
      setSessions(items);
      if (
        activeSessionIdRef.current !== PRIMARY_SESSION_ID &&
        !items.some((item) => item.session_id === activeSessionIdRef.current)
      ) {
        setActiveSessionId(PRIMARY_SESSION_ID);
      }
    } catch (err: unknown) {
      setSessionsError(
        err instanceof Error ? err.message : t('agent.session_reload_failed'),
      );
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    setMessages([]);
    setHistoryOffset(0);
    setHasMoreHistory(true);
    pendingContentRef.current = '';
    setTyping(false);
    setRunning(false);
    loadHistory(true);
  }, [activeSessionId]);

  useEffect(() => {
    const ws = new WebSocketClient();

    ws.onOpen = () => {
      setConnected(true);
      setError(null);
    };

    ws.onClose = () => {
      setConnected(false);
    };

    ws.onError = () => {
      setError(t('agent.connection_error'));
    };

    ws.onMessage = (msg: WsMessage) => {
      if (activeSessionIdRef.current !== PRIMARY_SESSION_ID) {
        return;
      }
      switch (msg.type) {
        case 'chunk':
          setTyping(true);
          setRunning(true);
          pendingContentRef.current += msg.content ?? '';
          break;

        case 'message':
        case 'done': {
          const content = msg.full_response ?? msg.content ?? pendingContentRef.current;
          if (content) {
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: 'agent',
                kind: 'text',
                content,
                timestamp: new Date(),
              },
            ]);
            setHistoryOffset((prev) => prev + 1);
          }
          pendingContentRef.current = '';
          setTyping(false);
          setRunning(false);
          break;
        }

        case 'tool_call':
          setMessages((prev) => [
            ...prev,
            buildToolMessage(
              {
                type: 'tool_call',
                name: msg.name,
                args: msg.args,
              },
              new Date(),
            ),
          ]);
          break;

        case 'tool_result':
          setMessages((prev) =>
            mergeToolResult(
              prev,
              {
                name: msg.name,
                output: msg.output,
                error: msg.error ?? null,
              },
              new Date(),
            ),
          );
          break;

        case 'error':
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'agent',
              kind: 'text',
              content: `[${t('common.error')}] ${msg.message ?? t('common.unknown_error')}`,
              timestamp: new Date(),
            },
          ]);
          setTyping(false);
          pendingContentRef.current = '';
          setRunning(false);
          break;
        case 'stopped':
          pendingContentRef.current = '';
          setTyping(false);
          setRunning(false);
          break;
      }
    };

    ws.connect();
    wsRef.current = ws;

    return () => {
      ws.disconnect();
    };
  }, [t]);

  useEffect(() => {
    if (isPrependingRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  const isRunning = running || typing;
  const isChannelSession = activeSessionId !== PRIMARY_SESSION_ID;

  const handleSend = () => {
    if (isRunning) return;
    if (isChannelSession) return;
    const trimmed = input.trim();
    if (!trimmed || !wsRef.current?.connected) return;

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'user',
        kind: 'text',
        content: trimmed,
        timestamp: new Date(),
      },
    ]);
    setHistoryOffset((prev) => prev + 1);

    try {
      wsRef.current.sendMessage(trimmed);
      setTyping(true);
      setRunning(true);
      pendingContentRef.current = '';
    } catch {
      setError(t('agent.send_failed'));
      setRunning(false);
    }

    setInput('');
    inputRef.current?.focus();
  };

  const handleStop = () => {
    if (!isRunning) return;
    try {
      wsRef.current?.sendStop();
    } catch {
      setError(t('agent.send_failed'));
    } finally {
      pendingContentRef.current = '';
      setTyping(false);
      setRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isRunning) {
        handleSend();
      }
    }
  };

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container || loadingHistory || !hasMoreHistory) return;
    if (container.scrollTop <= 24) {
      loadHistory();
    }
  };

  const handleClearHistory = async () => {
    if (clearingHistory) return;
    if (isChannelSession) return;
    if (!window.confirm(t('agent.clear_history_confirm'))) return;
    setClearingHistory(true);
    try {
      await clearChatHistory();
      setMessages([]);
      setHistoryOffset(0);
      setHasMoreHistory(false);
      pendingContentRef.current = '';
      setTyping(false);
      setRunning(false);
    } catch {
      setError(t('agent.clear_history_failed'));
    } finally {
      setClearingHistory(false);
    }
  };

  useEffect(() => {
    setCustomContent(
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-white">{t('nav.agent')}</h1>
        <div className="relative">
          <select
            value={activeSessionId}
            onChange={(event) => setActiveSessionId(event.target.value)}
            className="appearance-none rounded-lg bg-gray-950 border border-gray-800 px-3 py-1.5 pr-8 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer min-w-40 max-w-[240px] truncate"
          >
            <option value={PRIMARY_SESSION_ID}>{t('agent.session_primary')}</option>
            {sessionsLoading && (
              <option value="loading" disabled>
                {t('agent.session_loading')}
              </option>
            )}
            {!sessionsLoading && sessions.length === 0 && (
              <option value="empty" disabled>
                {t('agent.session_empty')}
              </option>
            )}
            {!sessionsLoading &&
              sessions.map((session) => (
                <option key={session.session_id} value={session.session_id}>
                  {t('agent.session_channel')} · {session.channel} · {session.sender}
                </option>
              ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
        </div>
        {sessionsError && (
          <div className="text-xs text-red-300">{sessionsError}</div>
        )}
        {isChannelSession && (
          <div className="text-xs text-amber-300 px-2 py-0.5 bg-amber-900/30 border border-amber-800 rounded">
            {t('agent.session_readonly_hint')}
          </div>
        )}
      </div>
    );

    return () => setCustomContent(null);
  }, [t, activeSessionId, sessions, sessionsLoading, sessionsError, isChannelSession, setCustomContent]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Connection status bar */}
      {error && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-700 flex items-center gap-2 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto p-4 space-y-4"
      >
        {loadingHistory && messages.length > 0 && (
          <div className="sticky top-0 z-10 -mt-2 mb-2 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900/95 px-3 py-1 text-xs text-gray-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('agent.loading_more_history')}
            </div>
          </div>
        )}

        {loadingHistory && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <Loader2 className="h-8 w-8 animate-spin mb-3" />
            <p className="text-sm">{t('agent.loading_history')}</p>
          </div>
        )}

        {!loadingHistory && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Logo className="h-16 w-16 mb-4 opacity-50" />
            <p className="text-lg font-medium">{t('agent.empty_title')}</p>
            <p className="text-sm mt-1">{t('agent.empty_hint')}</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-start gap-3 ${
              msg.role === 'user' ? 'flex-row-reverse' : ''
            }`}
          >
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                msg.role === 'user'
                  ? 'bg-blue-600'
                  : 'bg-gray-700'
              }`}
            >
              {msg.role === 'user' ? (
                <User className="h-4 w-4 text-white" />
              ) : (
                <Logo className="h-5 w-5" />
              )}
            </div>
            {msg.kind === 'text' ? (
              <div
                className={`max-w-[75%] rounded-xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-100 border border-gray-700'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                ) : (
                  <div className="prose prose-invert prose-sm max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                )}
                <p
                  className={`text-xs mt-1 ${
                    msg.role === 'user' ? 'text-blue-200' : 'text-gray-500'
                  }`}
                >
                  {msg.timestamp.toLocaleTimeString()}
                </p>
              </div>
            ) : (
              <div className="max-w-[85%] rounded-xl px-4 py-3 bg-gray-900 text-gray-100 border border-gray-700 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-gray-800 px-2 py-0.5 text-gray-300">
                    {t('agent.tool_call')}
                  </span>
                  <span className="text-sm font-medium text-gray-100">{msg.name}</span>
                </div>
                {msg.args !== undefined && (
                  <div>
                    <p className="text-xs text-gray-400">{t('tools.parameters')}</p>
                    <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-gray-950/70 border border-gray-800 px-3 py-2 text-xs text-gray-200">
                      {JSON.stringify(msg.args ?? {}, null, 2)}
                    </pre>
                  </div>
                )}
                {(msg.outputText || msg.error || msg.imageBase64) && (
                  <div>
                    <p className="text-xs text-gray-400">{t('agent.tool_result')}</p>
                    {msg.error && (
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-red-950/60 border border-red-700 px-3 py-2 text-xs text-red-200">
                        {msg.error}
                      </pre>
                    )}
                    {msg.outputText && (
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-950/70 border border-gray-800 px-3 py-2 text-xs text-gray-200">
                        {msg.outputText}
                      </pre>
                    )}
                    {msg.imageBase64 && (
                      <img
                        src={`data:image/png;base64,${msg.imageBase64}`}
                        className="mt-3 max-h-80 w-auto rounded-lg border border-gray-700"
                      />
                    )}
                  </div>
                )}
                <p className="text-xs text-gray-500">{msg.timestamp.toLocaleTimeString()}</p>
              </div>
            )}
          </div>
        ))}

        {typing && (
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
              <Logo className="h-5 w-5" />
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <p className="text-xs text-gray-500 mt-1">{t('agent.typing')}</p>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-800 bg-gray-900 p-4">
        <div className="flex items-center gap-3 max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isChannelSession
                  ? t('agent.session_readonly_hint')
                  : connected
                    ? t('agent.placeholder')
                    : t('agent.connecting')
              }
              disabled={!connected || isRunning || isChannelSession}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
            />
          </div>
          <button
            onClick={isRunning ? handleStop : handleSend}
            disabled={isChannelSession || (!isRunning && (!connected || !input.trim()))}
            title={isRunning ? t('agent.stop') : t('agent.send')}
            className={`flex-shrink-0 rounded-xl p-3 transition-colors ${
              isRunning
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            } disabled:bg-gray-700 disabled:text-gray-500 text-white`}
          >
            {isRunning ? (
              <span className="block h-5 w-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 gap-3 max-w-4xl mx-auto">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                connected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-xs text-gray-500">
              {connected ? t('agent.connected') : t('agent.disconnected')}
            </span>
          </div>
          <button
            onClick={handleClearHistory}
            disabled={clearingHistory || messages.length === 0 || isChannelSession}
            className="text-xs text-red-400 hover:text-red-300 disabled:text-gray-600"
          >
            {t('agent.clear_history')}
          </button>
        </div>
      </div>
    </div>
  );
}
