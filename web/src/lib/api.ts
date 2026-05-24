import type {
  StatusResponse,
  ToolSpec,
  CronJob,
  Integration,
  DiagResult,
  MemoryEntry,
  CostSummary,
  CliTool,
  HealthSnapshot,
  SkillSpec,
  SkillInstallResult,
  SkillAuditResult,
  SkillMarketItem,
  ChatHistoryResponse,
  ChatSessionItem,
} from '../types/api';
import { clearToken, getToken, setToken } from './auth';
import { notifyError } from './notifications';

// ---------------------------------------------------------------------------
// Base fetch wrapper
// ---------------------------------------------------------------------------

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

export const CHAT_SESSIONS_UPDATED_EVENT = 'zeroclaw-chat-sessions-updated';

export function emitChatSessionsUpdated(): void {
  window.dispatchEvent(new Event(CHAT_SESSIONS_UPDATED_EVENT));
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (
    options.body &&
    typeof options.body === 'string' &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, { ...options, headers });

  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new Event('zeroclaw-unauthorized'));
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API ${response.status}: ${text || response.statusText}`);
  }

  // Some endpoints may return 204 No Content
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

function unwrapField<T>(value: T | Record<string, T>, key: string): T {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && key in value) {
    const unwrapped = (value as Record<string, T | undefined>)[key];
    if (unwrapped !== undefined) {
      return unwrapped;
    }
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

export async function pair(code: string): Promise<{ token: string }> {
  const response = await fetch('/pair', {
    method: 'POST',
    headers: { 'X-Pairing-Code': code },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Pairing failed (${response.status}): ${text || response.statusText}`);
  }

  const data = (await response.json()) as { token: string };
  setToken(data.token);
  return data;
}

// ---------------------------------------------------------------------------
// Public health (no auth required)
// ---------------------------------------------------------------------------

export async function getPublicHealth(): Promise<{ require_pairing: boolean; paired: boolean }> {
  const response = await fetch('/health');
  if (!response.ok) {
    throw new Error(`Health check failed (${response.status})`);
  }
  return response.json() as Promise<{ require_pairing: boolean; paired: boolean }>;
}

// ---------------------------------------------------------------------------
// Status / Health
// ---------------------------------------------------------------------------

export function getStatus(): Promise<StatusResponse> {
  return apiFetch<StatusResponse>('/api/status');
}

export function getHealth(): Promise<HealthSnapshot> {
  return apiFetch<HealthSnapshot | { health: HealthSnapshot }>('/api/health').then((data) =>
    unwrapField(data, 'health'),
  );
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function getConfig(): Promise<string> {
  return apiFetch<string | { format?: string; content: string }>('/api/config').then((data) =>
    typeof data === 'string' ? data : data.content,
  );
}

export function putConfig(toml: string): Promise<void> {
  return apiFetch<void>('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/toml' },
    body: toml,
  });
}

export function getConfigForm<T = Record<string, unknown>>(): Promise<T> {
  return apiFetch<T>('/api/config/form');
}

export function putConfigForm<T = Record<string, unknown>>(config: T): Promise<void> {
  return apiFetch<void>('/api/config/form', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function getTools(): Promise<ToolSpec[]> {
  return apiFetch<ToolSpec[] | { tools: ToolSpec[] }>('/api/tools').then((data) =>
    unwrapField(data, 'tools'),
  );
}

// ---------------------------------------------------------------------------
// Chat history
// ---------------------------------------------------------------------------

export function getChatHistory(params?: {
  offset?: number;
  limit?: number;
  session?: string;
}): Promise<ChatHistoryResponse> {
  const search = new URLSearchParams();
  if (params?.offset !== undefined) {
    search.set('offset', String(params.offset));
  }
  if (params?.limit !== undefined) {
    search.set('limit', String(params.limit));
  }
  if (params?.session) {
    search.set('session', params.session);
  }
  const query = search.toString();
  const path = query ? `/api/chat/history?${query}` : '/api/chat/history';
  return apiFetch<ChatHistoryResponse>(path);
}

export function getChatSessions(): Promise<ChatSessionItem[]> {
  return apiFetch<ChatSessionItem[] | { sessions: ChatSessionItem[] }>(
    '/api/chat/sessions',
  ).then((data) => unwrapField(data, 'sessions'));
}

export function createChatSession(): Promise<{ session_id: string }> {
  return apiFetch<{ session_id: string }>('/api/chat/sessions', {
    method: 'POST',
  });
}

export function deleteChatSession(sessionId: string): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export type UploadedChatAttachment = {
  name: string;
  mime_type: string;
  size: number;
  local_path: string;
};

export type ChatWorkspaceFile = {
  name: string;
  mime_type: string;
  size: number;
  workspace_path: string;
  local_path: string;
  relative_path: string;
  kind: 'image' | 'text' | 'file' | 'directory';
  text_preview?: string | null;
  image_data_url?: string | null;
};

export type ChatWorkspaceResponse = {
  scope_path: string;
  files: ChatWorkspaceFile[];
};

export type ChatWorkspacePreview = {
  name: string;
  mime_type: string;
  size: number;
  workspace_path: string;
  local_path: string;
  relative_path: string;
  kind: 'image' | 'text' | 'file' | 'directory';
  html_preview?: string | null;
  text_preview?: string | null;
  outline_preview?: string | null;
  image_data_url?: string | null;
  preview_source?: string | null;
};

export async function openChatWorkspaceFolder(sessionId: string, relativePath: string): Promise<void> {
  try {
    return await apiFetch<void>('/api/chat/workspace/open-folder', {
      method: 'POST',
      body: JSON.stringify({
        session: sessionId || null,
        path: relativePath,
      }),
    });
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '打开文件夹失败');
    throw error;
  }
}

export async function uploadChatAttachments(
  sessionId: string,
  files: globalThis.File[],
): Promise<UploadedChatAttachment[]> {
  const token = getToken();
  const headers = new Headers();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file, file.name);
  }

  const search = new URLSearchParams();
  if (sessionId) {
    search.set('session', sessionId);
  }
  let response: Response;
  try {
    response = await fetch(`/api/chat/attachments${search.toString() ? `?${search.toString()}` : ''}`, {
      method: 'POST',
      headers,
      body: formData,
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : 'unknown network error';
    throw new Error(`无法连接本地附件上传接口: ${detail}`);
  }

  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new Event('zeroclaw-unauthorized'));
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let detail = text || response.statusText;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      detail = parsed.error || parsed.message || detail;
    } catch {
      // Fall back to raw response text when the server didn't return JSON.
    }
    throw new Error(`附件上传失败 (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { files: UploadedChatAttachment[] };
  return data.files ?? [];
}

export function getChatWorkspace(sessionId: string): Promise<ChatWorkspaceResponse> {
  const search = new URLSearchParams();
  if (sessionId) {
    search.set('session', sessionId);
  }
  return apiFetch<ChatWorkspaceResponse>(
    `/api/chat/workspace${search.toString() ? `?${search.toString()}` : ''}`,
  );
}

export function getChatWorkspacePreview(
  sessionId: string,
  relativePath: string,
): Promise<ChatWorkspacePreview> {
  const search = new URLSearchParams();
  if (sessionId) {
    search.set('session', sessionId);
  }
  search.set('path', relativePath);
  return apiFetch<ChatWorkspacePreview>(`/api/chat/workspace/preview?${search.toString()}`);
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

export function getCronJobs(): Promise<CronJob[]> {
  return apiFetch<CronJob[] | { jobs: CronJob[] }>('/api/cron').then((data) =>
    unwrapField(data, 'jobs'),
  );
}

export function addCronJob(body: {
  name?: string;
  command: string;
  schedule: string;
  enabled?: boolean;
}): Promise<CronJob> {
  return apiFetch<CronJob | { status: string; job: CronJob }>('/api/cron', {
    method: 'POST',
    body: JSON.stringify(body),
  }).then((data) => (typeof (data as { job?: CronJob }).job === 'object' ? (data as { job: CronJob }).job : (data as CronJob)));
}

export function deleteCronJob(id: string): Promise<void> {
  return apiFetch<void>(`/api/cron/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export function getIntegrations(): Promise<Integration[]> {
  return apiFetch<Integration[] | { integrations: Integration[] }>('/api/integrations').then(
    (data) => unwrapField(data, 'integrations'),
  );
}

// ---------------------------------------------------------------------------
// Doctor / Diagnostics
// ---------------------------------------------------------------------------

export function runDoctor(): Promise<DiagResult[]> {
  return apiFetch<DiagResult[] | { results: DiagResult[]; summary?: unknown }>('/api/doctor', {
    method: 'POST',
    body: JSON.stringify({}),
  }).then((data) => (Array.isArray(data) ? data : data.results));
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export function getMemory(
  query?: string,
  category?: string,
): Promise<MemoryEntry[]> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (category) params.set('category', category);
  const qs = params.toString();
  return apiFetch<MemoryEntry[] | { entries: MemoryEntry[] }>(`/api/memory${qs ? `?${qs}` : ''}`).then(
    (data) => unwrapField(data, 'entries'),
  );
}

export function storeMemory(
  key: string,
  content: string,
  category?: string,
): Promise<void> {
  return apiFetch<unknown>('/api/memory', {
    method: 'POST',
    body: JSON.stringify({ key, content, category }),
  }).then(() => undefined);
}

export function deleteMemory(key: string): Promise<void> {
  return apiFetch<void>(`/api/memory/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export function getCost(): Promise<CostSummary> {
  return apiFetch<CostSummary | { cost: CostSummary }>('/api/cost').then((data) =>
    unwrapField(data, 'cost'),
  );
}

// ---------------------------------------------------------------------------
// CLI Tools
// ---------------------------------------------------------------------------

export function getCliTools(): Promise<CliTool[]> {
  return apiFetch<CliTool[] | { cli_tools: CliTool[] }>('/api/cli-tools').then((data) =>
    unwrapField(data, 'cli_tools'),
  );
}

export function getSkills(): Promise<SkillSpec[]> {
  return apiFetch<SkillSpec[] | { skills: SkillSpec[] }>('/api/skills').then((data) =>
    unwrapField(data, 'skills'),
  );
}

export function installSkill(source: string): Promise<SkillInstallResult> {
  return apiFetch<SkillInstallResult>('/api/skills', {
    method: 'POST',
    body: JSON.stringify({ source }),
  });
}

export function auditSkill(source: string): Promise<SkillAuditResult> {
  return apiFetch<SkillAuditResult>('/api/skills/audit', {
    method: 'POST',
    body: JSON.stringify({ source }),
  });
}

export function removeSkill(name: string): Promise<void> {
  return apiFetch<void>(`/api/skills/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

export function getSkillMarket(): Promise<SkillMarketItem[]> {
  return apiFetch<SkillMarketItem[] | { items: SkillMarketItem[] }>('/api/skills/market').then(
    (data) => unwrapField(data, 'items'),
  );
}

export function installSkillFromMarket(
  marketId: string,
  acknowledgeRisk: boolean,
): Promise<SkillInstallResult> {
  return apiFetch<SkillInstallResult>('/api/skills/market/install', {
    method: 'POST',
    body: JSON.stringify({ market_id: marketId, acknowledge_risk: acknowledgeRisk }),
  });
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export async function getOnboardStatus(): Promise<{ configured: boolean }> {
  const response = await fetch('/api/onboard');
  if (!response.ok) {
    throw new Error(`Onboard check failed (${response.status})`);
  }
  return response.json();
}

export interface OnboardInit {
  tier: string;
  provider: string;
  api_key?: string;
  api_url?: string;
  model?: string;

  // Project Context
  user_name?: string;
  timezone?: string;
  agent_name?: string;
  communication_style?: string;

  // Memory
  memory_backend: string;
  memory_postgres_url?: string;
  memory_qdrant_url?: string;
  memory_qdrant_api_key?: string;
  memory_auto_save?: boolean;

  // Channels
  telegram_token?: string;
  telegram_allowed_users?: string;
  discord_token?: string;
  discord_guild_id?: string;
  discord_allowed_users?: string; // Comma separated
  channels_config?: Record<string, unknown>;

  // Tunnel
  enable_tunnel?: boolean;
  tunnel_provider?: 'cloudflare' | 'ngrok' | 'tailscale' | 'custom';
  tunnel_cloudflare_token?: string;
  tunnel_ngrok_auth_token?: string;
  tunnel_ngrok_domain?: string;
  tunnel_tailscale_funnel?: boolean;
  tunnel_custom_command?: string;

  // Tool Mode
  tool_mode?: 'sovereign' | 'composio';
  composio_api_key?: string;
  secrets_encrypt?: boolean;
  autonomy_level?: 'supervised' | 'full';

  // Hardware
  hardware_enabled?: boolean;
  hardware_transport?: 'native' | 'serial' | 'probe' | 'none';
  serial_port?: string;
  baud_rate?: number;
  probe_target?: string;
  workspace_datasheets?: boolean;
}

export async function onboardInit(body: OnboardInit): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : 'unknown network error';
    throw new Error(`Cannot reach local API /api/onboard: ${detail}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Onboard failed (${response.status}): ${text}`);
  }
}
