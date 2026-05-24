import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Send,
  User,
  AlertCircle,
  ChevronDown,
  Shield,
  Loader2,
  Image as ImageIcon,
  Sparkles,
  Code2,
  PenSquare,
  Lock,
  Paperclip,
  File as FileIcon,
  PanelRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStatus } from '@/hooks/useApi';
import type {
  ApprovalDecision,
  SessionAutonomyLevel,
  SessionExecutionPolicy,
  WsMessage,
} from '@/types/api';
import {
  CHAT_SESSIONS_UPDATED_EVENT,
  getChatHistory,
  getChatSessions,
  type UploadedChatAttachment,
  uploadChatAttachments,
} from '@/lib/api';
import { WebSocketClient } from '@/lib/ws';
import { Logo } from '@/components/ui/Logo';
import { useWorkspacePanel } from '@/components/layout/Layout';
import {
  WORKSPACE_ATTACH_EVENT,
  type WorkspaceAttachmentEventDetail,
} from '@/lib/workspace';
import { useNotify } from '@/hooks/useNotify';

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
  status: 'running' | 'done';
  name: string;
  args?: unknown;
  outputText?: string;
  error?: string | null;
  imageBase64?: string | null;
  timestamp: Date;
};

type ApprovalMessage = {
  id: string;
  role: 'agent';
  kind: 'approval';
  requestId: string;
  toolName: string;
  args?: unknown;
  status: 'pending' | 'running' | 'done' | 'error' | 'denied' | 'expired';
  approvalMode?: 'once' | 'always';
  outputText?: string;
  errorText?: string | null;
  imageBase64?: string | null;
  timestamp: Date;
  updatedAt?: Date;
};

type ReasoningMessage = {
  id: string;
  role: 'agent';
  kind: 'reasoning';
  content: string;
  timestamp: Date;
};

type ChatMessage = TextMessage | ToolMessage | ApprovalMessage | ReasoningMessage;
type RolePresetId = 'general' | 'code' | 'writing';
type PendingAttachment =
  | {
      id: string;
      sourceKind: 'image' | 'file';
      name: string;
      mimeType: string;
      size: number;
      localPath: string;
      composerToken: string;
    };
type RuntimeProgress =
  | {
      kind: 'thinking';
      round: number;
    }
  | {
      kind: 'tool_calls';
      count: number;
      seconds: number;
    }
  | {
      kind: 'tool_start';
      toolName: string;
      hint?: string;
    }
  | {
      kind: 'tool_finished';
      toolName: string;
      seconds: number;
      success: boolean;
    };
type InlineAttachment = {
  kind: 'image' | 'file';
  path: string;
  name: string;
};

const PAGE_SIZE = 50;
const TASK_SESSION_PREFIX = 'task:';
const CHANNEL_SESSION_PREFIX = 'channel:';
const AUTO_SCROLL_THRESHOLD = 64;
const HISTORY_LOAD_THRESHOLD = 24;
const IMAGE_DATA_URL_PATTERN = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/;
const ROLE_PRESET_MESSAGE_PATTERN =
  /^\[Role preset:[^\n]+\]\nFollow this behavior for the rest of this conversation:[\s\S]*?\n\nUser request:\s*/;
const sharedWebSocketClient = new WebSocketClient();
const COMPOSER_ATTACHMENT_TOKEN_PREFIX = '[ATTACHMENT:';
const FILE_TOKEN_PREFIX = '[FILE:';
const ATTACHMENT_TOKEN_PATTERN = /\[(IMAGE|FILE):([^\]]+)\]/g;
const COMPOSER_CARET_ANCHOR = '\u200B';
const DEFAULT_SESSION_POLICY: SessionExecutionPolicy = {
  autonomy_level: 'supervised',
  effective_autonomy_level: 'supervised',
};
const SESSION_POLICY_STORAGE_KEY_PREFIX = 'zeroclaw:agent-session-policy:';
const EXECUTION_PRESETS: {
  id: SessionAutonomyLevel;
  labelKey: string;
  descriptionKey: string;
}[] = [
  {
    id: 'supervised',
    labelKey: 'agent.execution_supervised_name',
    descriptionKey: 'agent.execution_supervised_description',
  },
  {
    id: 'full',
    labelKey: 'agent.execution_full_name',
    descriptionKey: 'agent.execution_full_description',
  },
];

const ROLE_PRESETS: {
  id: RolePresetId;
  nameKey: string;
  descriptionKey: string;
  icon: typeof Sparkles;
  guidance: string;
}[] = [
  {
    id: 'general',
    nameKey: 'agent.role_general_name',
    descriptionKey: 'agent.role_general_description',
    icon: Sparkles,
    guidance: '',
  },
  {
    id: 'code',
    nameKey: 'agent.role_code_name',
    descriptionKey: 'agent.role_code_description',
    icon: Code2,
    guidance:
      'Respond as a software engineering assistant. Prioritize concrete implementation steps, code-level analysis, debugging details, and explicit trade-offs. Keep the answer practical and concise.',
  },
  {
    id: 'writing',
    nameKey: 'agent.role_writing_name',
    descriptionKey: 'agent.role_writing_description',
    icon: PenSquare,
    guidance:
      'Respond as a writing and synthesis assistant. Improve clarity, structure, and tone. When the request is exploratory, organize information clearly, separate facts from assumptions, and produce concise reusable output.',
  },
];

const normalizeImagePayload = (value?: string | null) => {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith('data:image/')) {
    return raw.replace(/\s+/g, '');
  }
  return raw.replace(/\s+/g, '');
};

const findImagePayloadInText = (text: string) => {
  const matched = text.match(IMAGE_DATA_URL_PATTERN)?.[0];
  if (!matched) {
    return {
      image: null as string | null,
      cleanedText: text,
    };
  }
  const image = normalizeImagePayload(matched);
  const cleanedText = text.replace(matched, '[image data]').trim();
  return { image, cleanedText };
};

const buildImageSrc = (imagePayload: string) =>
  imagePayload.startsWith('data:image/')
    ? imagePayload
    : `data:image/png;base64,${imagePayload}`;

const isImageMimeType = (mimeType: string) => mimeType.startsWith('image/');

const buildComposerAttachmentToken = (attachmentId: string) =>
  `${COMPOSER_ATTACHMENT_TOKEN_PREFIX}${attachmentId}]`;

const buildOutgoingAttachmentToken = (
  attachment: Pick<PendingAttachment, 'mimeType' | 'localPath'>,
  visionSupported: boolean,
) =>
  isImageMimeType(attachment.mimeType) && visionSupported
    ? `[IMAGE:${attachment.localPath}]`
    : `${FILE_TOKEN_PREFIX}${attachment.localPath}]`;

const parseComposerSegments = (value: string) => {
  const segments: Array<
    | { type: 'text'; value: string }
    | { type: 'attachment'; kind: 'image' | 'file'; path: string; token: string }
  > = [];
  let cursor = 0;
  let matched: RegExpExecArray | null;
  ATTACHMENT_TOKEN_PATTERN.lastIndex = 0;

  while ((matched = ATTACHMENT_TOKEN_PATTERN.exec(value)) !== null) {
    const [token, rawKind, rawPath] = matched;
    if (matched.index > cursor) {
      segments.push({
        type: 'text',
        value: value.slice(cursor, matched.index),
      });
    }
    const path = (rawPath ?? '').trim();
    if (path) {
      segments.push({
        type: 'attachment',
        kind: rawKind === 'IMAGE' ? 'image' : 'file',
        path,
        token,
      });
    }
    cursor = matched.index + token.length;
  }

  if (cursor < value.length) {
    segments.push({
      type: 'text',
      value: value.slice(cursor),
    });
  }

  return segments;
};

const splitAttachmentPath = (value: string) =>
  value.split(/[/\\]/).filter(Boolean).pop() ?? value;

const extractInlineAttachments = (value: string) => {
  const attachments: InlineAttachment[] = [];
  const cleanedText = parseComposerSegments(value)
    .map((segment) => {
      if (segment.type === 'text') {
        return segment.value;
      }
      attachments.push({
        kind: segment.kind,
        path: segment.path,
        name: splitAttachmentPath(segment.path),
      });
      return '';
    })
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
  return { cleanedText, attachments };
};

const normalizeAttachmentInput = (value: string) =>
  value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n');

const uploadedAttachmentToPending = (attachment: UploadedChatAttachment): PendingAttachment => {
  const id = crypto.randomUUID();
  const localPath = attachment.local_path;
  return {
    id,
    sourceKind: isImageMimeType(attachment.mime_type) ? 'image' : 'file',
    name: attachment.name,
    mimeType: attachment.mime_type || 'application/octet-stream',
    size: attachment.size,
    localPath,
    composerToken: buildComposerAttachmentToken(id),
  };
};

const serializeComposerElement = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').split(COMPOSER_CARET_ANCHOR).join('');
  }
  if (node instanceof HTMLElement && node.dataset.attachmentToken) {
    return node.dataset.attachmentToken;
  }
  if (node instanceof HTMLElement && node.tagName === 'BR') {
    return '\n';
  }
  return Array.from(node.childNodes)
    .map(serializeComposerElement)
    .join('');
};

const readComposerValue = (root: HTMLDivElement | null) => {
  if (!root) {
    return '';
  }
  return normalizeAttachmentInput(
    Array.from(root.childNodes)
      .map(serializeComposerElement)
      .join(''),
  );
};

const placeCaretAtEnd = (root: HTMLDivElement | null) => {
  if (!root) {
    return;
  }
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
};

const insertLineBreakAtCursor = () => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const br = document.createElement('br');
  range.insertNode(br);
  range.setStartAfter(br);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const createComposerAttachmentChip = (attachment: PendingAttachment) => {
  const chip = document.createElement('span');
  chip.contentEditable = 'false';
  chip.dataset.attachmentToken = attachment.composerToken;
  chip.dataset.attachmentId = attachment.id;
  chip.className =
    'mx-0.5 inline-block max-w-[240px] align-baseline rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[11px] leading-4 text-blue-100 whitespace-nowrap';
  chip.textContent = attachment.name;
  return chip;
};

const selectionInsideComposer = (root: HTMLDivElement, selection: Selection) => {
  if (selection.rangeCount === 0) {
    return false;
  }
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  return container === root || root.contains(container);
};

const insertAttachmentHtmlAtCursor = (attachment: PendingAttachment) => {
  const html = `<span contenteditable="false" data-attachment-token="${escapeHtml(attachment.composerToken)}" data-attachment-id="${escapeHtml(attachment.id)}" class="mx-0.5 inline-block max-w-[240px] align-baseline rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[11px] leading-4 text-blue-100 whitespace-nowrap">${escapeHtml(attachment.name)}</span>`;
  return document.execCommand('insertHTML', false, html);
};

const placeCaretAfterAttachmentChip = (root: HTMLDivElement, attachmentId: string) => {
  const chip = root.querySelector<HTMLElement>(`[data-attachment-id="${attachmentId}"]`);
  if (!chip) {
    return;
  }
  let anchorNode = chip.nextSibling;
  if (!(anchorNode instanceof Text)) {
    anchorNode = document.createTextNode(COMPOSER_CARET_ANCHOR);
    chip.parentNode?.insertBefore(anchorNode, chip.nextSibling);
  } else if (!anchorNode.textContent?.includes(COMPOSER_CARET_ANCHOR)) {
    anchorNode.textContent = `${COMPOSER_CARET_ANCHOR}${anchorNode.textContent ?? ''}`;
  }
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.setStart(anchorNode, Math.min(1, anchorNode.textContent?.length ?? 0));
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

const findAttachmentChipFromNode = (root: HTMLDivElement, node: Node | null) => {
  if (!node) {
    return null;
  }
  const element =
    node instanceof HTMLElement
      ? node
      : node.parentElement;
  if (!element) {
    return null;
  }
  const chip = element.closest<HTMLElement>('[data-attachment-id]');
  if (!chip || !root.contains(chip)) {
    return null;
  }
  return chip;
};

const normalizeComposerSelection = (root: HTMLDivElement | null) => {
  if (!root) {
    return;
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return;
  }
  const anchorNode = selection.anchorNode;
  const chip = findAttachmentChipFromNode(root, anchorNode);
  const attachmentId = chip?.dataset.attachmentId;
  if (attachmentId) {
    placeCaretAfterAttachmentChip(root, attachmentId);
  }
};

const insertAttachmentChipAtCursor = (root: HTMLDivElement, attachment: PendingAttachment) => {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  if (!selectionInsideComposer(root, selection)) {
    placeCaretAtEnd(root);
  }
  if (selection.rangeCount === 0) {
    return;
  }
  if (insertAttachmentHtmlAtCursor(attachment)) {
    placeCaretAfterAttachmentChip(root, attachment.id);
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const chip = createComposerAttachmentChip(attachment);
  const anchorNode = document.createTextNode(COMPOSER_CARET_ANCHOR);
  range.insertNode(anchorNode);
  range.insertNode(chip);
  range.setStart(anchorNode, 1);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

const UserMessageText = ({
  content,
  t,
}: {
  content: string;
  t: (key: string) => string;
}) => {
  const { cleanedText, attachments } = extractInlineAttachments(content);

  return (
    <div className="space-y-2">
      {cleanedText ? (
        <p className="whitespace-pre-wrap text-[15px] leading-8 text-gray-100 wrap-break-word">
          {cleanedText}
        </p>
      ) : null}
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment, index) => (
            <span
              key={`${attachment.kind}-${attachment.path}-${index}`}
              title={attachment.path}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-gray-700/80 bg-gray-900/80 px-3 py-1 text-xs text-gray-200"
            >
              {attachment.kind === 'image' ? (
                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-gray-300" />
              ) : (
                <FileIcon className="h-3.5 w-3.5 shrink-0 text-gray-300" />
              )}
              <span className="shrink-0">
                {attachment.kind === 'image'
                  ? t('agent.attachment_image_inline')
                  : t('agent.attachment_file_inline')}
              </span>
              <span className="truncate text-gray-400">{attachment.name}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const sanitizeHistoryContent = (role: string, content: string) => {
  if (role === 'system') {
    return null;
  }

  if (role === 'user') {
    const cleaned = content.replace(ROLE_PRESET_MESSAGE_PATTERN, '').trim();
    return cleaned || content.trim();
  }

  return content;
};

const toSingleLinePreview = (value: string, maxLength = 96) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trimEnd()}...`
    : normalized;
};

const summarizeApprovalArgs = (args: unknown) => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return '';
  }
  const record = args as Record<string, unknown>;
  if (typeof record.command === 'string') {
    return toSingleLinePreview(record.command);
  }
  if (typeof record.file_path === 'string') {
    return toSingleLinePreview(record.file_path);
  }
  return toSingleLinePreview(JSON.stringify(record));
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
        imageBase64 = normalizeImagePayload(candidate);
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
    if (!imageBase64) {
      const extracted = findImagePayloadInText(outputText);
      imageBase64 = extracted.image;
      outputText = extracted.cleanedText;
    }
  }
  return {
    outputText,
    error,
    imageBase64,
  };
};

const ToolMessageItem = ({ msg, t }: { msg: ToolMessage; t: any }) => {
  const [expanded, setExpanded] = useState(
    msg.status === 'running' || Boolean(msg.error),
  );
  const previewText = msg.error
    ? toSingleLinePreview(msg.error)
    : msg.outputText
      ? toSingleLinePreview(msg.outputText)
      : msg.imageBase64
        ? t('agent.tool_image_result')
        : '';

  useEffect(() => {
    if (msg.status === 'running' || msg.error) {
      setExpanded(true);
      return;
    }
    if (msg.status === 'done') {
      setExpanded(false);
    }
  }, [msg.status, msg.error]);

  return (
    <div className="w-full border-l border-gray-800/80 pl-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start justify-between gap-3 py-1.5 text-left transition-colors hover:bg-white/2"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="pl-5 text-[10px] uppercase tracking-[0.18em] text-gray-600">
            {t('agent.runtime_status')}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <ChevronDown className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : '-rotate-90'}`} />
            <span className="truncate font-mono text-[11px] text-gray-300">
              {msg.name}
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                msg.status === 'running'
                  ? 'border border-blue-500/15 bg-blue-500/10 text-blue-200'
                  : msg.error
                    ? 'border border-red-500/15 bg-red-500/10 text-red-200'
                    : 'border border-emerald-500/15 bg-emerald-500/10 text-emerald-200'
              }`}
            >
              {msg.status === 'running'
                ? t('doctor.running_short')
                : msg.error
                  ? t('common.error')
                  : t('agent.tool_done_short')}
            </span>
            {msg.args !== undefined && (
              <span className="shrink-0 rounded-full border border-gray-700/70 px-2 py-0.5 text-[10px] text-gray-400">
                {t('agent.tool_params_short')}
              </span>
            )}
          </div>
          {previewText && (
            <p className="pl-5 text-[11px] leading-5 text-gray-500">
              {previewText}
            </p>
          )}
        </div>
        <span className="shrink-0 pt-4 text-[10px] text-gray-600">
          {msg.timestamp.toLocaleTimeString()}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2.5 py-3 pl-5">
          {msg.status === 'running' && (
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{t('doctor.running_short')}</span>
            </div>
          )}
          {msg.args !== undefined && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('tools.parameters')}</p>
              <pre className="whitespace-pre-wrap wrap-break-word border-l border-gray-800/80 pl-3 text-[11px] text-gray-400 font-mono">
                {JSON.stringify(msg.args ?? {}, null, 2)}
              </pre>
            </div>
          )}
          {(msg.outputText || msg.error || msg.imageBase64) && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('agent.tool_result')}</p>
              {msg.error && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-break-word border-l border-red-900/40 pl-3 text-[11px] text-red-300 font-mono">
                  {msg.error}
                </pre>
              )}
              {msg.outputText && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-break-word border-l border-gray-800/80 pl-3 text-[11px] text-gray-400 font-mono">
                  {msg.outputText}
                </pre>
              )}
              {msg.imageBase64 && (
                <img
                  src={buildImageSrc(msg.imageBase64)}
                  className="mt-2 max-h-80 w-auto rounded border border-gray-800/50"
                  alt="Tool Result"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const mergeApprovalToolResult = (
  msg: ApprovalMessage,
  payload: { output?: string; error?: string | null },
  timestamp: Date,
): ApprovalMessage => {
  const derived = extractToolOutput(payload.output, payload.error);
  return {
    ...msg,
    status: derived.error ? 'error' : 'done',
    outputText: derived.outputText,
    errorText: derived.error ?? null,
    imageBase64: derived.imageBase64 ?? null,
    updatedAt: timestamp,
  };
};

const ApprovalMessageItem = ({
  msg,
  t,
  connected,
  onRespond,
}: {
  msg: ApprovalMessage;
  t: any;
  connected: boolean;
  onRespond: (requestId: string, decision: ApprovalDecision) => void;
}) => {
  const [expanded, setExpanded] = useState(msg.status === 'pending' || msg.status === 'running');
  const previewText =
    msg.errorText
      ? toSingleLinePreview(msg.errorText)
      : msg.outputText
        ? toSingleLinePreview(msg.outputText)
        : msg.imageBase64
          ? t('agent.tool_image_result')
          : summarizeApprovalArgs(msg.args);

  useEffect(() => {
    if (msg.status === 'pending' || msg.status === 'running' || msg.status === 'error') {
      setExpanded(true);
      return;
    }
    setExpanded(false);
  }, [msg.status]);

  const statusLabel =
    msg.status === 'pending'
      ? t('agent.approval_pending')
      : msg.status === 'running'
        ? t('doctor.running_short')
        : msg.status === 'done'
          ? t('agent.tool_done_short')
          : msg.status === 'error'
            ? t('common.error')
          : msg.status === 'denied'
            ? t('agent.approval_denied')
            : t('agent.approval_expired');
  const statusClass =
    msg.status === 'pending'
      ? 'border border-amber-500/15 bg-amber-500/10 text-amber-200'
      : msg.status === 'running'
        ? 'border border-blue-500/15 bg-blue-500/10 text-blue-200'
        : msg.status === 'done'
          ? 'border border-emerald-500/15 bg-emerald-500/10 text-emerald-200'
          : msg.status === 'error'
            ? 'border border-red-500/15 bg-red-500/10 text-red-200'
        : 'border border-gray-700/80 bg-gray-800/80 text-gray-300';

  return (
    <div className="w-full border-l border-amber-500/20 pl-4">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start justify-between gap-3 py-1.5 text-left transition-colors hover:bg-white/2"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="pl-5 text-[10px] uppercase tracking-[0.18em] text-gray-600">
            {t('agent.runtime_status')}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <ChevronDown
              className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : '-rotate-90'}`}
            />
            <span className="truncate font-mono text-[11px] text-gray-300">
              {msg.toolName}
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${statusClass}`}>
              {statusLabel}
            </span>
          </div>
          <p className="pl-5 text-[11px] leading-5 text-gray-500">
            {msg.status === 'pending'
              ? t('agent.approval_summary_pending', { tool: msg.toolName })
              : msg.status === 'running'
                ? msg.approvalMode === 'always'
                  ? t('agent.approval_summary_approved_always', { tool: msg.toolName })
                  : t('agent.approval_summary_approved_once', { tool: msg.toolName })
                : msg.status === 'done'
                  ? msg.approvalMode === 'always'
                    ? t('agent.approval_result_always')
                    : t('agent.approval_result_once')
                  : msg.status === 'error'
                    ? t('common.error')
                    : msg.status === 'denied'
                    ? t('agent.approval_summary_denied', { tool: msg.toolName })
                    : t('agent.approval_summary_expired', { tool: msg.toolName })}
          </p>
          {previewText && (
            <p className="pl-5 text-[11px] leading-5 text-gray-600">{previewText}</p>
          )}
        </div>
        <span className="shrink-0 pt-4 text-[10px] text-gray-600">
          {(msg.updatedAt ?? msg.timestamp).toLocaleTimeString()}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 py-3 pl-5">
          {msg.status === 'running' && (
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{t('doctor.running_short')}</span>
            </div>
          )}
          {msg.args !== undefined && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                {t('tools.parameters')}
              </p>
              <pre className="whitespace-pre-wrap wrap-break-word border-l border-gray-800/80 pl-3 text-[11px] font-mono text-gray-400">
                {JSON.stringify(msg.args ?? {}, null, 2)}
              </pre>
            </div>
          )}

          {msg.status === 'pending' ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onRespond(msg.requestId, 'no')}
                disabled={!connected}
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 transition-colors hover:border-gray-600 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('agent.approval_action_deny')}
              </button>
              <button
                type="button"
                onClick={() => onRespond(msg.requestId, 'yes')}
                disabled={!connected}
                className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-100 transition-colors hover:border-blue-400/40 hover:bg-blue-500/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('agent.approval_action_once')}
              </button>
              <button
                type="button"
                onClick={() => onRespond(msg.requestId, 'always')}
                disabled={!connected}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('agent.approval_action_always')}
              </button>
              <span className="text-[11px] text-gray-500">
                {t('agent.approval_hint')}
              </span>
            </div>
          ) : (
            <>
              {msg.status === 'denied' || msg.status === 'expired' ? (
                <p className="text-[11px] leading-5 text-gray-500">
                  {msg.status === 'denied'
                    ? t('agent.approval_result_denied')
                    : t('agent.approval_result_expired')}
                </p>
              ) : null}

              {(msg.outputText || msg.errorText || msg.imageBase64) && (
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                    {t('agent.tool_result')}
                  </p>
                  {msg.errorText && (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-break-word border-l border-red-900/40 pl-3 text-[11px] font-mono text-red-300">
                      {msg.errorText}
                    </pre>
                  )}
                  {msg.outputText && (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-break-word border-l border-gray-800/80 pl-3 text-[11px] font-mono text-gray-400">
                      {msg.outputText}
                    </pre>
                  )}
                  {msg.imageBase64 && (
                    <img
                      src={buildImageSrc(msg.imageBase64)}
                      className="mt-2 max-h-80 w-auto rounded border border-gray-800/50"
                      alt="Tool Result"
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const ReasoningMessageItem = ({ msg, t }: { msg: ReasoningMessage; t: any }) => (
  <div className="w-full border-l border-purple-500/20 pl-4 py-1">
    <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-purple-200/35">
      {t('agent.progress_thinking', { round: 1 })}
    </div>
    <div className="prose prose-invert prose-sm max-w-none text-gray-500 wrap-break-word [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_li]:marker:text-gray-700">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
    </div>
    <p className="mt-2 text-[11px] text-purple-200/25">{msg.timestamp.toLocaleTimeString()}</p>
  </div>
);

export default function AgentChat() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [activeRoleId, setActiveRoleId] = useState<RolePresetId>('general');
  const [sessionPolicy, setSessionPolicy] = useState<SessionExecutionPolicy>(DEFAULT_SESSION_POLICY);
  const [executionMenuOpen, setExecutionMenuOpen] = useState(false);
  const [runtimeProgress, setRuntimeProgress] = useState<RuntimeProgress | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<PendingAttachment[]>([]);
  const workspacePanel = useWorkspacePanel();
  const notify = useNotify();
  const notifyError = useCallback((message: string, key?: string) => {
    notify.error(message, key ? { key } : undefined);
  }, [notify]);

  const wsRef = useRef<WebSocketClient>(sharedWebSocketClient);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingContentRef = useRef('');
  const streamingMessageIdRef = useRef<string | null>(null);
  const isPrependingRef = useRef(false);
  const activeSessionIdRef = useRef('');
  const handledSidebarActionRef = useRef('');
  const executionMenuRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);
  const pendingSessionAutonomyRef = useRef<SessionAutonomyLevel | null>(null);
  const syncComposerStateFromDom = useCallback((root: HTMLDivElement | null = inputRef.current) => {
    const nextValue = readComposerValue(root);
    setInput(nextValue);
    setAttachedFiles((prev) =>
      prev.filter((attachment) => nextValue.includes(attachment.composerToken)),
    );
    if (root) {
      root.dataset.empty = nextValue ? 'false' : 'true';
    }
    return nextValue;
  }, []);

  const resetComposer = useCallback(() => {
    setInput('');
    setAttachedFiles([]);
    const root = inputRef.current;
    if (!root) {
      return;
    }
    root.replaceChildren();
    root.dataset.empty = 'true';
  }, []);

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
      status: payload.type === 'tool_result' ? 'done' : 'running',
      name: payload.name ?? t('common.unknown'),
      args: payload.args,
      outputText: derived.outputText,
      error: derived.error ?? payload.error ?? null,
      imageBase64: derived.imageBase64 ?? null,
      timestamp,
    };
  };

  const buildApprovalMessage = (
    requestId: string,
    toolName: string,
    args: unknown,
    timestamp: Date,
  ): ApprovalMessage => ({
    id: crypto.randomUUID(),
    role: 'agent',
    kind: 'approval',
    requestId,
    toolName,
    args,
    status: 'pending',
    approvalMode: undefined,
    outputText: undefined,
    errorText: null,
    imageBase64: null,
    timestamp,
  });

  const toolInvocationMatches = (
    toolName: string,
    toolArgs: unknown,
    candidateName: string,
    candidateArgs: unknown,
  ) =>
    toolName === candidateName &&
    JSON.stringify(toolArgs ?? null) === JSON.stringify(candidateArgs ?? null);

  const approvalMatchesPendingTool = (
    entry: ChatMessage | undefined,
    toolName: string,
    args: unknown,
  ) =>
    entry?.kind === 'tool' &&
    entry.status === 'running' &&
    toolInvocationMatches(toolName, args, entry.name, entry.args);

  const findLatestMatchingApprovalIndex = (
    messagesToUpdate: ChatMessage[],
    toolName?: string,
    args?: unknown,
  ) => {
    for (let index = messagesToUpdate.length - 1; index >= 0; index -= 1) {
      const entry = messagesToUpdate[index];
      if (entry?.kind !== 'approval') {
        continue;
      }
      if (entry.status === 'denied' || entry.status === 'expired') {
        continue;
      }
      if (
        toolName &&
        !toolInvocationMatches(toolName, args, entry.toolName, entry.args)
      ) {
        continue;
      }
      return index;
    }
    return -1;
  };

  const findLatestRunningToolIndex = (
    messagesToUpdate: ChatMessage[],
    toolName?: string,
  ) => {
    for (let index = messagesToUpdate.length - 1; index >= 0; index -= 1) {
      const entry = messagesToUpdate[index];
      if (entry?.kind !== 'tool' || entry.status !== 'running') {
        continue;
      }
      if (!toolName || entry.name === toolName) {
        return index;
      }
    }
    return -1;
  };

  const mergeToolCall = (
    messagesToUpdate: ChatMessage[],
    payload: { name?: string; args?: unknown },
    timestamp: Date,
  ) => {
    const approvalIndex = findLatestMatchingApprovalIndex(
      messagesToUpdate,
      payload.name,
      payload.args,
    );
    if (approvalIndex >= 0) {
      const next = [...messagesToUpdate];
      const approval = next[approvalIndex] as ApprovalMessage;
      next[approvalIndex] = {
        ...approval,
        status: approval.status === 'pending' ? 'pending' : 'running',
        updatedAt: timestamp,
      };
      return next;
    }

    return [...messagesToUpdate, buildToolMessage({ type: 'tool_call', ...payload }, timestamp)];
  };

  const mergeToolResult = (
    messagesToUpdate: ChatMessage[],
    payload: { name?: string; output?: string; error?: string | null },
    timestamp: Date,
  ) => {
    const approvalIndex = findLatestMatchingApprovalIndex(messagesToUpdate, payload.name);
    if (approvalIndex >= 0) {
      const next = [...messagesToUpdate];
      next[approvalIndex] = mergeApprovalToolResult(
        next[approvalIndex] as ApprovalMessage,
        payload,
        timestamp,
      );
      return next;
    }

    const runningToolIndex = findLatestRunningToolIndex(messagesToUpdate, payload.name);
    if (runningToolIndex >= 0) {
      const runningTool = messagesToUpdate[runningToolIndex] as ToolMessage;
      const derived = extractToolOutput(payload.output, payload.error);
      const next = [...messagesToUpdate];
      next[runningToolIndex] = {
        ...runningTool,
        status: 'done',
        outputText: derived.outputText,
        error: derived.error ?? runningTool.error ?? null,
        imageBase64: derived.imageBase64 ?? runningTool.imageBase64 ?? null,
        timestamp,
      };
      return next;
    }

    return [
      ...messagesToUpdate,
      buildToolMessage({ type: 'tool_result', ...payload }, timestamp),
    ];
  };

  const appendReasoningMessage = (
    messagesToUpdate: ChatMessage[],
    content: string,
    timestamp: Date,
    append = false,
  ) => {
    const normalized = append ? content : content.trim();
    if (!normalized) {
      return messagesToUpdate;
    }
    const last = messagesToUpdate[messagesToUpdate.length - 1];
    if (append && last && last.kind === 'reasoning') {
      return [
        ...messagesToUpdate.slice(0, -1),
        {
          ...last,
          content: `${last.content}${normalized}`,
          timestamp,
        },
      ];
    }
    if (
      last &&
      last.kind === 'reasoning' &&
      last.content.trim() === normalized
    ) {
      return messagesToUpdate;
    }
    return [
      ...messagesToUpdate,
      {
        id: crypto.randomUUID(),
        role: 'agent' as const,
        kind: 'reasoning' as const,
        content: normalized,
        timestamp,
      },
    ];
  };

  const upsertStreamingAgentMessage = (
    messagesToUpdate: ChatMessage[],
    content: string,
    timestamp: Date,
  ) => {
    const streamingId = streamingMessageIdRef.current;
    if (streamingId) {
      let found = false;
      const next = messagesToUpdate.map((message) => {
        if (message.id === streamingId && message.kind === 'text' && message.role === 'agent') {
          found = true;
          return {
            ...message,
            content,
            timestamp,
          };
        }
        return message;
      });
      if (found) {
        return next;
      }
    }

    const nextId = crypto.randomUUID();
    streamingMessageIdRef.current = nextId;
    return [
      ...messagesToUpdate,
      {
        id: nextId,
        role: 'agent' as const,
        kind: 'text' as const,
        content,
        timestamp,
      },
    ];
  };

  const clearStreamingAgentMessage = (messagesToUpdate: ChatMessage[]) => {
    const streamingId = streamingMessageIdRef.current;
    if (!streamingId) {
      return messagesToUpdate;
    }
    return messagesToUpdate.filter((message) => message.id !== streamingId);
  };

  const isTaskSessionId = (sessionId: string) => sessionId.startsWith(TASK_SESSION_PREFIX);
  const isChannelSessionId = (sessionId: string) => sessionId.startsWith(CHANNEL_SESSION_PREFIX);
  const sessionPolicyStorageKey = (sessionId: string) =>
    `${SESSION_POLICY_STORAGE_KEY_PREFIX}${sessionId}`;
  const loadStoredSessionAutonomy = (sessionId: string): SessionAutonomyLevel | null => {
    if (!isTaskSessionId(sessionId)) {
      return null;
    }
    try {
      const value = window.localStorage.getItem(sessionPolicyStorageKey(sessionId));
      return value === 'supervised' || value === 'full' ? value : null;
    } catch {
      return null;
    }
  };
  const persistStoredSessionAutonomy = (sessionId: string, autonomy: SessionAutonomyLevel) => {
    if (!isTaskSessionId(sessionId)) {
      return;
    }
    try {
      window.localStorage.setItem(sessionPolicyStorageKey(sessionId), autonomy);
    } catch {
      // Ignore storage failures and fall back to in-memory session state.
    }
  };
  const pickDefaultSession = useCallback(
    (items: Awaited<ReturnType<typeof getChatSessions>>) =>
      items.find((item) => item.kind === 'task') ?? items[0] ?? null,
    [],
  );

  const loadHistory = async (initial = false) => {
    if (!activeSessionIdRef.current) return;
    if (loadingHistory) return;
    if (!initial && !hasMoreHistory) return;
    setLoadingHistory(true);
    const offset = initial ? 0 : historyOffset;
    try {
      const sessionId = activeSessionIdRef.current;
      const response = await getChatHistory({
        offset,
        limit: PAGE_SIZE,
        session: sessionId,
      });
      const mapped = response.messages.reduce<ChatMessage[]>((acc, item) => {
        const timestamp = new Date(item.timestamp);
        const sanitizedContent = sanitizeHistoryContent(item.role, item.content);
        if (sanitizedContent === null) {
          return acc;
        }
        if (item.role === 'reasoning') {
          return appendReasoningMessage(acc, sanitizedContent, timestamp);
        }
        if (item.role === 'tool') {
          const payload = parseToolPayload(sanitizedContent);
          if (!payload) {
            acc.push({
              id: crypto.randomUUID(),
              role: 'agent',
              kind: 'text',
              content: sanitizedContent,
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
          content: sanitizedContent,
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

  const { data: runtimeStatus } = useStatus();
  const visionSupported = runtimeStatus?.vision_supported ?? false;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  }, []);

  const updateAutoScrollState = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return false;
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceToBottom <= AUTO_SCROLL_THRESHOLD;
    shouldAutoScrollRef.current = isAtBottom;
    return isAtBottom;
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsError(null);
    try {
      const items = await getChatSessions();
      const params = new URLSearchParams(location.search);
      const sessionParam = params.get('session');

      if (
        location.pathname === '/agent' &&
        (!sessionParam || sessionParam === 'primary')
      ) {
        const defaultSession = pickDefaultSession(items);
        if (defaultSession) {
          navigate(`/agent?session=${encodeURIComponent(defaultSession.session_id)}`, {
            replace: true,
          });
          return;
        }
      }

      if (
        activeSessionIdRef.current &&
        !items.some((item) => item.session_id === activeSessionIdRef.current)
      ) {
        navigate('/agent', { replace: true });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('agent.session_reload_failed');
      setSessionsError(message);
      notifyError(message, 'agent:sessions:reload');
    }
  }, [location.pathname, location.search, navigate, notifyError, pickDefaultSession, t]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const handleSessionsUpdated = () => {
      void loadSessions();
    };
    window.addEventListener(CHAT_SESSIONS_UPDATED_EVENT, handleSessionsUpdated);
    return () => {
      window.removeEventListener(CHAT_SESSIONS_UPDATED_EVENT, handleSessionsUpdated);
    };
  }, [loadSessions]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    if (!isTaskSessionId(activeSessionId)) {
      pendingSessionAutonomyRef.current = null;
      setSessionPolicy(DEFAULT_SESSION_POLICY);
      return;
    }

    const storedAutonomy = loadStoredSessionAutonomy(activeSessionId);
    pendingSessionAutonomyRef.current = storedAutonomy;
    setSessionPolicy(
      storedAutonomy
        ? {
            autonomy_level: storedAutonomy,
            effective_autonomy_level: storedAutonomy,
          }
        : DEFAULT_SESSION_POLICY,
    );
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) return;
    shouldAutoScrollRef.current = true;
    setMessages([]);
    setHistoryOffset(0);
    setHasMoreHistory(true);
    pendingContentRef.current = '';
    streamingMessageIdRef.current = null;
    setRuntimeProgress(null);
    setTyping(false);
    setRunning(false);
    resetComposer();
    void loadHistory(true);
  }, [activeSessionId, resetComposer]);

  useEffect(() => {
    const ws = wsRef.current;
    const isTaskSession = isTaskSessionId(activeSessionId);

    ws.onOpen = () => {
      setConnected(true);
      setError(null);
      const sessionId = activeSessionIdRef.current;
      const storedAutonomy = loadStoredSessionAutonomy(sessionId);
      if (storedAutonomy && isTaskSessionId(sessionId)) {
        pendingSessionAutonomyRef.current = storedAutonomy;
        try {
          ws.sendSessionPolicyUpdate(storedAutonomy);
        } catch {
          pendingSessionAutonomyRef.current = null;
        }
      }
      if (isTaskSessionId(activeSessionIdRef.current)) {
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };

    ws.onClose = () => {
      setConnected(false);
    };

    ws.onError = () => {
      setError(t('agent.connection_error'));
    };

    ws.onMessage = (msg: WsMessage) => {
      if (!isTaskSessionId(activeSessionIdRef.current)) {
        return;
      }
      switch (msg.type) {
        case 'progress':
          setRunning(true);
          if (msg.progress_kind === 'thinking') {
            setRuntimeProgress({
              kind: 'thinking',
              round: msg.round ?? 1,
            });
          } else if (msg.progress_kind === 'tool_calls') {
            setRuntimeProgress({
              kind: 'tool_calls',
              count: msg.count ?? 0,
              seconds: msg.seconds ?? 0,
            });
          } else if (msg.progress_kind === 'tool_start') {
            setRuntimeProgress({
              kind: 'tool_start',
              toolName: msg.tool_name ?? t('common.unknown'),
              hint: msg.hint,
            });
          } else if (msg.progress_kind === 'tool_finished') {
            setRuntimeProgress({
              kind: 'tool_finished',
              toolName: msg.tool_name ?? t('common.unknown'),
              seconds: msg.seconds ?? 0,
              success: msg.success ?? true,
            });
          }
          break;

        case 'reasoning':
          setMessages((prev) =>
            appendReasoningMessage(
              prev,
              msg.content ?? '',
              new Date(),
              msg.append ?? false,
            ),
          );
          break;

        case 'chunk':
          setTyping(true);
          setRunning(true);
          pendingContentRef.current += msg.content ?? '';
          setMessages((prev) =>
            upsertStreamingAgentMessage(prev, pendingContentRef.current, new Date()),
          );
          break;

        case 'draft_clear':
          setRuntimeProgress(null);
          pendingContentRef.current = '';
          setMessages((prev) => clearStreamingAgentMessage(prev));
          streamingMessageIdRef.current = null;
          break;

        case 'message':
        case 'done': {
          const hadStreamingMessage = streamingMessageIdRef.current !== null;
          const content = msg.full_response ?? msg.content ?? pendingContentRef.current;
          if (content) {
            setMessages((prev) => upsertStreamingAgentMessage(prev, content, new Date()));
            if (msg.type === 'done' || !hadStreamingMessage) {
              setHistoryOffset((prev) => prev + 1);
            }
          }
          pendingContentRef.current = '';
          streamingMessageIdRef.current = null;
          setRuntimeProgress(null);
          setTyping(false);
          setRunning(false);
          break;
        }

        case 'tool_call':
          setMessages((prev) =>
            mergeToolCall(
              prev,
              {
                name: msg.name,
                args: msg.args,
              },
              new Date(),
            ),
          );
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
          streamingMessageIdRef.current = null;
          setRuntimeProgress(null);
          setRunning(false);
          setMessages((prev) =>
            prev.map((entry) =>
              entry.kind === 'approval' && entry.status === 'pending'
                ? { ...entry, status: 'expired', updatedAt: new Date() }
                : entry,
            ),
          );
          break;
        case 'stopped':
          pendingContentRef.current = '';
          streamingMessageIdRef.current = null;
          setRuntimeProgress(null);
          setTyping(false);
          setMessages((prev) =>
            prev.map((entry) =>
              entry.kind === 'approval' && entry.status === 'pending'
                ? { ...entry, status: 'expired', updatedAt: new Date() }
                : entry,
            ),
          );
          break;
        case 'session_policy':
          {
            const requested =
              msg.autonomy_level ?? DEFAULT_SESSION_POLICY.autonomy_level;
            const effective =
              msg.effective_autonomy_level ?? DEFAULT_SESSION_POLICY.effective_autonomy_level;
            const pendingAutonomy = pendingSessionAutonomyRef.current;
            if (
              pendingAutonomy &&
              requested !== pendingAutonomy &&
              effective !== pendingAutonomy
            ) {
              break;
            }
            if (
              pendingAutonomy &&
              (requested === pendingAutonomy || effective === pendingAutonomy)
            ) {
              pendingSessionAutonomyRef.current = null;
            }
            setSessionPolicy({
              autonomy_level: requested,
              effective_autonomy_level: effective,
            });
          }
          break;
        case 'approval_request':
          if (msg.request_id && msg.tool_name) {
            const requestId = msg.request_id;
            const toolName = msg.tool_name;
            setMessages((prev) => {
              const approvalMessage = buildApprovalMessage(
                requestId,
                toolName,
                msg.arguments,
                new Date(),
              );
              if (approvalMatchesPendingTool(prev[prev.length - 1], toolName, msg.arguments)) {
                return [...prev.slice(0, -1), approvalMessage];
              }
              return [...prev, approvalMessage];
            });
          }
          break;
      }
    };

    ws.setSession(isTaskSession ? activeSessionId : null);

    if (isTaskSession) {
      setConnected(ws.connected);
      ws.connect();
    } else {
      ws.disconnect();
      setConnected(false);
    }

    return () => {
      ws.onOpen = null;
      ws.onClose = null;
      ws.onError = null;
      ws.onMessage = null;
    };
  }, [activeSessionId, t]);

  useEffect(() => {
    if (isPrependingRef.current) return;
    if (!shouldAutoScrollRef.current) return;
    requestAnimationFrame(() => scrollToBottom());
  }, [messages, typing, runtimeProgress, scrollToBottom]);

  useEffect(() => {
    if (!executionMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!executionMenuRef.current?.contains(event.target as Node)) {
        setExecutionMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [executionMenuOpen]);

  const isRunning = running || typing;
  const hasRunningTool = messages.some((msg) => msg.kind === 'tool' && msg.status === 'running');
  const isChannelSession = isChannelSessionId(activeSessionId);
  const isTaskSession = isTaskSessionId(activeSessionId);
  const hasConversationStarted = messages.length > 0;
  const activeRole = ROLE_PRESETS.find((role) => role.id === activeRoleId) ?? ROLE_PRESETS[0]!;
  const ActiveRoleIcon = activeRole.icon;
  const canAdjustExecution = isTaskSession && !isRunning && connected;
  const selectedExecutionPreset =
    EXECUTION_PRESETS.find((preset) => preset.id === sessionPolicy.autonomy_level) ??
    EXECUTION_PRESETS[1]!;

  const groupedMessages = useMemo(() => {
    const groups: {
      id: string;
      role: 'user' | 'agent';
      messages: ChatMessage[];
    }[] = [];

    for (const msg of messages) {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.role === msg.role && msg.role === 'agent') {
        lastGroup.messages.push(msg);
      } else {
        groups.push({
          id: `group-${msg.id}`,
          role: msg.role,
          messages: [msg],
        });
      }
    }
    return groups;
  }, [messages]);

  const runtimeStatusLabel = useMemo(() => {
    if (!runtimeProgress) {
      return null;
    }
    switch (runtimeProgress.kind) {
      case 'thinking':
        return t('agent.progress_thinking', { round: runtimeProgress.round });
      case 'tool_calls':
        return t('agent.progress_tool_calls', {
          count: runtimeProgress.count,
          seconds: runtimeProgress.seconds,
        });
      case 'tool_start':
        return t('agent.progress_tool_start', {
          tool: runtimeProgress.toolName,
          hint: runtimeProgress.hint ?? '',
        }).trim();
      case 'tool_finished':
        return t(
          runtimeProgress.success
            ? 'agent.progress_tool_finished_success'
            : 'agent.progress_tool_finished_error',
          {
            tool: runtimeProgress.toolName,
            seconds: runtimeProgress.seconds,
          },
        );
    }
  }, [runtimeProgress, t]);
  const showTypingIndicator = typing && !hasRunningTool && !pendingContentRef.current;

  useEffect(() => {
    if (location.pathname !== '/agent') return;

    const params = new URLSearchParams(location.search);
    const sessionParam = params.get('session');

    if (!sessionParam || sessionParam === 'primary') {
      handledSidebarActionRef.current = '';
      if (activeSessionIdRef.current) {
        setActiveSessionId('');
      }
      shouldAutoScrollRef.current = true;
      setMessages([]);
      setHistoryOffset(0);
      setHasMoreHistory(true);
      pendingContentRef.current = '';
      streamingMessageIdRef.current = null;
      setRuntimeProgress(null);
      setTyping(false);
      setRunning(false);
      resetComposer();
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    const nextSessionId = sessionParam;
    handledSidebarActionRef.current = nextSessionId;
    if (nextSessionId !== activeSessionIdRef.current) {
      setActiveSessionId(nextSessionId);
    }
  }, [location.pathname, location.search, navigate]);

  const handleSelectRole = async (nextRoleId: RolePresetId) => {
    if (!isTaskSession || hasConversationStarted || loadingHistory || isRunning) {
      return;
    }
    if (nextRoleId === activeRoleId) {
      return;
    }
    setActiveRoleId(nextRoleId);
    resetComposer();
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSelectExecution = (nextLevel: SessionAutonomyLevel) => {
    if (!canAdjustExecution) return;
    const previousPolicy = sessionPolicy;
    try {
      pendingSessionAutonomyRef.current = nextLevel;
      persistStoredSessionAutonomy(activeSessionIdRef.current, nextLevel);
      setSessionPolicy({
        autonomy_level: nextLevel,
        effective_autonomy_level: nextLevel,
      });
      wsRef.current.sendSessionPolicyUpdate(nextLevel);
      setExecutionMenuOpen(false);
    } catch {
      pendingSessionAutonomyRef.current = null;
      setSessionPolicy(previousPolicy);
      notifyError(t('agent.send_failed'), 'agent:session-policy:update');
    }
  };

  const handleApprovalResponse = (requestId: string, decision: ApprovalDecision) => {
    try {
      wsRef.current.sendApprovalResponse(requestId, decision);
      setMessages((prev) =>
        prev.map((entry) =>
          entry.kind === 'approval' && entry.requestId === requestId
            ? {
                ...entry,
                status: decision === 'no' ? 'denied' : 'running',
                approvalMode:
                  decision === 'always' ? 'always' : decision === 'yes' ? 'once' : undefined,
                updatedAt: new Date(),
              }
            : entry,
        ),
      );
    } catch {
      notifyError(t('agent.send_failed'), 'agent:approval:response');
    }
  };

  const appendPendingAttachments = useCallback((nextAttachments: PendingAttachment[]) => {
    if (nextAttachments.length === 0) {
      return;
    }
    const root = inputRef.current;
    if (!root) {
      return;
    }
    const existingPaths = new Set(attachedFiles.map((item) => item.localPath));
    const uniqueAttachments = nextAttachments.filter((attachment, index, collection) => {
      const firstIndex = collection.findIndex((item) => item.localPath === attachment.localPath);
      return firstIndex === index && !existingPaths.has(attachment.localPath);
    });
    if (uniqueAttachments.length === 0) {
      return;
    }
    root.focus();
    uniqueAttachments.forEach((attachment) => {
      insertAttachmentChipAtCursor(root, attachment);
    });
    const nextValue = readComposerValue(root);
    setInput(nextValue);
    setAttachedFiles((prev) => {
      const existing = new Set(prev.map((item) => item.localPath));
      return [...prev, ...uniqueAttachments.filter((item) => !existing.has(item.localPath))].filter(
        (attachment) => nextValue.includes(attachment.composerToken),
      );
    });
    root.dataset.empty = nextValue ? 'false' : 'true';
  }, [attachedFiles]);

  const uploadAndAttachFiles = useCallback(
    async (files: globalThis.File[]) => {
      if (files.length === 0 || !activeSessionIdRef.current) {
        return;
      }
      const uploaded = await uploadChatAttachments(activeSessionIdRef.current, files);
      appendPendingAttachments(uploaded.map(uploadedAttachmentToPending));
      setError(null);
    },
    [appendPendingAttachments],
  );

  useEffect(() => {
    const handleWorkspaceAttachment = (event: Event) => {
      if (!isTaskSession || isChannelSession) {
        return;
      }
      const detail = (event as CustomEvent<WorkspaceAttachmentEventDetail>).detail;
      if (!detail?.localPath) {
        return;
      }
      const id = crypto.randomUUID();
      appendPendingAttachments([
        {
          id,
          sourceKind: detail.kind,
          name: detail.name,
          mimeType: detail.mimeType || 'application/octet-stream',
          size: detail.size,
          localPath: detail.localPath,
          composerToken: buildComposerAttachmentToken(id),
        },
      ]);
      setError(null);
    };

    window.addEventListener(WORKSPACE_ATTACH_EVENT, handleWorkspaceAttachment);
    return () => {
      window.removeEventListener(WORKSPACE_ATTACH_EVENT, handleWorkspaceAttachment);
    };
  }, [appendPendingAttachments, isChannelSession, isTaskSession]);

  const handlePickAttachment = async () => {
    if (isChannelSession || isRunning || !connected) {
      return;
    }
    fileInputRef.current?.click();
  };

  const handleAttachmentSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) {
      return;
    }
    try {
      await uploadAndAttachFiles(files);
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : t('agent.upload_attachment_failed'),
        'agent:attachment:upload',
      );
    }
  };

  const handleInputPaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (isChannelSession || isRunning || !connected) {
      return;
    }
    const imageFiles = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is globalThis.File => Boolean(file));
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    try {
      await uploadAndAttachFiles(imageFiles);
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : t('agent.upload_attachment_failed'),
        'agent:attachment:upload',
      );
    }
  };

  useEffect(() => {
    if (location.pathname !== '/agent') {
      return;
    }
    const params = new URLSearchParams(location.search);
    const sessionParam = params.get('session');
    if (!sessionParam || sessionParam === 'primary') {
      workspacePanel.close();
    }
  }, [location.pathname, location.search, workspacePanel]);

  const handleSend = () => {
    if (isRunning) return;
    if (!isTaskSession) return;
    const composerValue = readComposerValue(inputRef.current);
    const currentAttachments = attachedFiles.filter((attachment) =>
      composerValue.includes(attachment.composerToken),
    );
    let outgoingComposerValue = composerValue;
    for (const attachment of currentAttachments) {
      outgoingComposerValue = outgoingComposerValue.split(attachment.composerToken).join(
        buildOutgoingAttachmentToken(attachment, visionSupported),
      );
    }
    const trimmed = outgoingComposerValue.trim();
    if ((!trimmed && currentAttachments.length === 0) || !wsRef.current?.connected) return;

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

    let outgoingContent = trimmed;
    if (messages.length === 0 && activeRole.guidance) {
      outgoingContent = [
        `[Role preset: ${t(activeRole.nameKey)}]`,
        `Follow this behavior for the rest of this conversation: ${activeRole.guidance}`,
        '',
        `User request: ${outgoingContent}`,
      ].join('\n');
    }

    try {
      wsRef.current.sendMessage(
        outgoingContent,
        currentAttachments.map((attachment) => attachment.localPath),
      );
      setTyping(true);
      setRunning(true);
      setRuntimeProgress({
        kind: 'thinking',
        round: 1,
      });
      pendingContentRef.current = '';
    } catch {
      notifyError(t('agent.send_failed'), 'agent:send');
      setRuntimeProgress(null);
      setRunning(false);
    }

    resetComposer();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      placeCaretAtEnd(inputRef.current);
    });
  };

  const handleStop = () => {
    if (!isRunning) return;
    try {
      wsRef.current?.sendStop();
    } catch {
      notifyError(t('agent.send_failed'), 'agent:stop');
    } finally {
      pendingContentRef.current = '';
      streamingMessageIdRef.current = null;
      setRuntimeProgress(null);
      setTyping(false);
      setRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isComposingRef.current || e.nativeEvent.isComposing) {
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isRunning) {
        handleSend();
      }
      return;
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      insertLineBreakAtCursor();
      syncComposerStateFromDom();
    }
  };

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    updateAutoScrollState();
    if (loadingHistory || !hasMoreHistory) return;
    if (container.scrollTop <= HISTORY_LOAD_THRESHOLD) {
      void loadHistory();
    }
  };
  const canSelectRole = isTaskSession && !hasConversationStarted && !loadingHistory && !isRunning;
  const showCenteredRoleSelector = canSelectRole;
  const executionControl = !isChannelSession ? (
    <div ref={executionMenuRef} className="relative">
      <button
        type="button"
        onClick={() => setExecutionMenuOpen((open) => !open)}
        disabled={!connected}
        className={`inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          executionMenuOpen
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
            : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600 hover:bg-gray-700/60'
        }`}
      >
        <Shield className="h-3.5 w-3.5" />
        <span>{t(selectedExecutionPreset.labelKey)}</span>
        <ChevronDown
          className={`h-3 w-3 transition-transform ${executionMenuOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {executionMenuOpen && (
        <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-20 w-[320px] rounded-2xl border border-gray-800 bg-gray-900/98 p-2 shadow-2xl shadow-black/40 backdrop-blur">
          <div className="border-b border-gray-800 px-3 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Shield className="h-4 w-4 text-emerald-300" />
              {t('agent.execution_title')}
            </div>
          </div>

          <div className="space-y-1 p-2">
            {EXECUTION_PRESETS.map((preset) => {
              const isActive = preset.id === sessionPolicy.autonomy_level;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectExecution(preset.id)}
                  disabled={!canAdjustExecution}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    isActive
                      ? 'border-emerald-500/40 bg-emerald-500/10'
                      : 'border-transparent bg-transparent hover:border-gray-800 hover:bg-gray-800/80'
                  }`}
                >
                  <p className="text-xs font-medium text-white">{t(preset.labelKey)}</p>
                  <p className="mt-1 text-[11px] leading-4 text-gray-400">
                    {t(preset.descriptionKey)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="flex h-screen min-h-0 flex-col bg-gray-950">
      {error && (
        <div className="flex items-center gap-2 border-b border-red-700 bg-red-900/30 px-4 py-2 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {(isTaskSession || runtimeStatusLabel) && (
        <div className="h-16 border-b border-gray-800 bg-gray-950/95 px-6 backdrop-blur">
          <div className="flex h-full w-full items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center">
              {runtimeStatusLabel && (
                <div className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-blue-100">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-300" />
                  <span className="font-medium">{t('agent.runtime_status')}</span>
                  <span className="truncate text-blue-100/80">{runtimeStatusLabel}</span>
                </div>
              )}
            </div>

            {isTaskSession && (
              <div className="ml-auto flex items-center gap-2">
                <div className="inline-flex h-9 items-center gap-2 rounded-xl border border-gray-800 bg-gray-900/80 px-3 text-sm text-gray-200">
                  <ActiveRoleIcon className="h-4 w-4 text-blue-300" />
                  <span>{t(activeRole.nameKey)}</span>
                  {hasConversationStarted && (
                    <span className="inline-flex items-center text-gray-500">
                      <Lock className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/deerclaw-settings')}
                  className="inline-flex h-9 w-9 items-center justify-center text-gray-500 transition-colors hover:text-white"
                  title={t('nav.deerclaw_settings')}
                >
                  <Logo className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/permissions')}
                  className="inline-flex h-9 w-9 items-center justify-center text-gray-500 transition-colors hover:text-white"
                  title={t('nav.permissions')}
                >
                  <Shield className="h-4 w-4 text-emerald-300" />
                </button>
                <button
                  type="button"
                  onClick={workspacePanel.toggle}
                  className="inline-flex h-9 w-9 items-center justify-center text-gray-500 transition-colors hover:text-white"
                  title={
                    workspacePanel.open
                      ? t('agent.workspace_close')
                      : t('agent.workspace_open')
                  }
                >
                  <PanelRight className={`h-4 w-4 ${workspacePanel.open ? 'text-emerald-300' : ''}`} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="relative flex-1 overflow-y-auto p-6"
        >
          <div className="flex h-full w-full flex-col space-y-6">
            {sessionsError && (
              <p className="text-center text-xs text-red-300">{sessionsError}</p>
            )}

            {loadingHistory && messages.length > 0 && (
              <div className="sticky top-0 z-10 -mt-2 mb-2 flex justify-center">
                <div className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900/95 px-3 py-1 text-xs text-gray-300">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('agent.loading_more_history')}
                </div>
              </div>
            )}

            {loadingHistory && messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-gray-400">
                <Loader2 className="mb-3 h-8 w-8 animate-spin" />
                <p className="text-sm">{t('agent.loading_history')}</p>
              </div>
            )}

            {!loadingHistory && messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center text-gray-500">
                <Logo className="mb-4 h-16 w-16 opacity-50" />
                <p className="text-lg font-medium">{t('agent.empty_title')}</p>
                <p className="mt-1 text-sm">{t('agent.empty_hint')}</p>
                {showCenteredRoleSelector && (
                  <div className="mt-8 grid w-full max-w-3xl gap-3 text-left md:grid-cols-3">
                    {ROLE_PRESETS.map((role) => {
                      const Icon = role.icon;
                      const isActive = role.id === activeRoleId;
                      return (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => void handleSelectRole(role.id)}
                          disabled={!canSelectRole}
                          className={`rounded-2xl border px-4 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            isActive
                              ? 'border-blue-500/40 bg-blue-500/10'
                              : 'border-gray-800 bg-gray-950/70 hover:border-gray-700 hover:bg-gray-900/70'
                          }`}
                          title={t(role.descriptionKey)}
                        >
                          <div className="flex items-center gap-2 text-white">
                            <Icon
                              className={`h-4 w-4 ${
                                isActive ? 'text-blue-300' : 'text-gray-400'
                              }`}
                            />
                            <span className="text-sm font-medium">
                              {t(role.nameKey)}
                            </span>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-gray-400">
                            {t(role.descriptionKey)}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {groupedMessages.map((group, index) => {
              const isLastGroup = index === groupedMessages.length - 1;
              const showInlineTypingIndicator =
                showTypingIndicator && group.role === 'agent' && isLastGroup;

              return (
                <div key={group.id} className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        group.role === 'user' ? 'bg-blue-600' : 'bg-gray-700'
                      }`}
                    >
                      {group.role === 'user' ? (
                        <User className="h-4 w-4 text-white" />
                      ) : (
                        <Logo className="h-5 w-5" />
                      )}
                    </div>

                    <div className="w-full min-w-0 flex-1 space-y-4">
                      {group.messages.map((msg) => {
                        if (msg.kind === 'reasoning') {
                          return <ReasoningMessageItem key={msg.id} msg={msg} t={t} />;
                        }

                        if (msg.kind === 'tool') {
                          return <ToolMessageItem key={msg.id} msg={msg} t={t} />;
                        }

                        if (msg.kind === 'approval') {
                          return (
                            <ApprovalMessageItem
                              key={msg.id}
                              msg={msg}
                              t={t}
                              connected={connected}
                              onRespond={handleApprovalResponse}
                            />
                          );
                        }

                        return (
                          <div
                            key={msg.id}
                            className="w-full max-w-full text-gray-100"
                          >
                            {msg.role === 'user' ? (
                              <UserMessageText content={msg.content} t={t} />
                            ) : (
                              <div className="prose prose-invert max-w-none text-[15px] leading-8 wrap-break-word [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-4 [&_li]:my-1 [&_ul]:my-4 [&_ol]:my-4 [&_h1]:mt-8 [&_h2]:mt-7 [&_h3]:mt-6">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                              </div>
                            )}
                            <p
                              className="mt-2 text-xs text-gray-500"
                            >
                              {msg.timestamp.toLocaleTimeString()}
                            </p>
                          </div>
                        );
                      })}

                      {showInlineTypingIndicator && (
                        <div className="rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 w-fit">
                          <div className="flex items-center gap-1">
                            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0ms' }} />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
                          </div>
                          <p className="mt-1 text-xs text-gray-500">{t('agent.typing')}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {showTypingIndicator && groupedMessages[groupedMessages.length - 1]?.role !== 'agent' && (
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-700">
                  <Logo className="h-5 w-5" />
                </div>
                <div className="rounded-xl border border-gray-700 bg-gray-800 px-4 py-3">
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0ms' }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{t('agent.typing')}</p>
                </div>
              </div>
            )}
          </div>
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-gray-800 bg-gray-900 p-4">
        <div className="w-full px-2 xl:px-4">
          <div className="relative rounded-xl border border-gray-700 bg-gray-800 transition-colors focus-within:border-blue-500">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleAttachmentSelected(event);
              }}
            />
            {!input && (
              <div className="pointer-events-none absolute left-4 right-4 top-3 text-sm text-gray-500">
                {isChannelSession
                  ? t('agent.session_view_only_hint')
                  : connected
                    ? t('agent.placeholder')
                    : t('agent.connecting')}
              </div>
            )}
            <div
              ref={inputRef}
              contentEditable={!isChannelSession && connected && !isRunning}
              suppressContentEditableWarning
              data-empty={input ? 'false' : 'true'}
              onBeforeInput={() => {
                normalizeComposerSelection(inputRef.current);
              }}
              onInput={(event) => {
                syncComposerStateFromDom(event.currentTarget);
              }}
              onCompositionStart={() => {
                isComposingRef.current = true;
                normalizeComposerSelection(inputRef.current);
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
                syncComposerStateFromDom();
              }}
              onPaste={(event) => {
                void handleInputPaste(event);
              }}
              onKeyDown={handleKeyDown}
              onClick={() => {
                requestAnimationFrame(() => normalizeComposerSelection(inputRef.current));
              }}
              onMouseUp={() => {
                requestAnimationFrame(() => normalizeComposerSelection(inputRef.current));
              }}
              className="min-h-[44px] max-h-[200px] overflow-y-auto whitespace-pre-wrap wrap-break-word px-4 pt-3 pb-2 text-sm leading-5 text-white outline-none focus:outline-none focus-visible:outline-none focus:ring-0"
              style={{ outline: 'none', boxShadow: 'none', border: 'none' }}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handlePickAttachment}
                  disabled={!connected || isRunning || isChannelSession}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
                  title={t('agent.upload_attachment')}
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                {executionControl}
              </div>

              <button
                onClick={isRunning ? handleStop : handleSend}
                disabled={
                  isChannelSession ||
                  (!isRunning && (!connected || (!input.trim() && attachedFiles.length === 0)))
                }
                title={isRunning ? t('agent.stop') : t('agent.send')}
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  isRunning
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : (input.trim() || attachedFiles.length > 0) && connected && !isChannelSession
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-gray-700/50 text-gray-500'
                } disabled:cursor-not-allowed`}
              >
                {isRunning ? (
                  <span className="block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
