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
} from '../types/api';
import { clearToken, getToken, setToken } from './auth';

// ---------------------------------------------------------------------------
// Base fetch wrapper
// ---------------------------------------------------------------------------

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
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

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function getTools(): Promise<ToolSpec[]> {
  return apiFetch<ToolSpec[] | { tools: ToolSpec[] }>('/api/tools').then((data) =>
    unwrapField(data, 'tools'),
  );
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
  autonomy_level?: 'read_only' | 'supervised' | 'full';

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
