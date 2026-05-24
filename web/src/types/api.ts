export interface StatusResponse {
  provider: string | null;
  model: string;
  temperature: number;
  uptime_seconds: number;
  gateway_port: number;
  locale: string;
  memory_backend: string;
  paired: boolean;
  channels: Record<string, boolean>;
  health: HealthSnapshot;
  vision_supported: boolean;
}

export interface HealthSnapshot {
  pid: number;
  updated_at: string;
  uptime_seconds: number;
  components: Record<string, ComponentHealth>;
}

export interface ComponentHealth {
  status: string;
  updated_at: string;
  last_ok: string | null;
  last_error: string | null;
  restart_count: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: any;
  operation?: 'read' | 'act';
}

export interface CronJob {
  id: string;
  name: string | null;
  command: string;
  next_run: string;
  last_run: string | null;
  last_status: string | null;
  enabled: boolean;
}

export interface Integration {
  name: string;
  description: string;
  category: string;
  status: 'Available' | 'Active' | 'ComingSoon';
}

export interface DiagResult {
  severity: 'ok' | 'warn' | 'error';
  category: string;
  message: string;
}

export interface MemoryEntry {
  id: string;
  key: string;
  content: string;
  category: string;
  timestamp: string;
  session_id: string | null;
  score: number | null;
}

export interface CostSummary {
  session_cost_usd: number;
  daily_cost_usd: number;
  monthly_cost_usd: number;
  total_tokens: number;
  request_count: number;
  by_model: Record<string, ModelStats>;
}

export interface ModelStats {
  model: string;
  cost_usd: number;
  total_tokens: number;
  request_count: number;
}

export interface CliTool {
  name: string;
  path: string;
  version: string | null;
  category: string;
}

export interface SkillTool {
  name: string;
  description: string;
  kind: string;
  command: string;
  args: Record<string, string>;
}

export interface SkillSpec {
  name: string;
  description: string;
  version: string;
  author: string | null;
  tags: string[];
  tools: SkillTool[];
  prompts: string[];
  location: string | null;
}

export interface SkillInstallResult {
  status: string;
  installed_dir: string;
  files_scanned: number;
}

export interface SkillAuditResult {
  status: string;
  files_scanned: number;
  findings: string[];
  clean: boolean;
}

export interface SkillMarketItem {
  id: string;
  name: string;
  description: string;
  source: string;
  publisher: string;
  tags: string[];
  risk_level: string;
  verified: boolean;
}

export interface SSEEvent {
  type: string;
  timestamp?: string;
  [key: string]: any;
}

export type SessionAutonomyLevel = 'supervised' | 'full';
export type ApprovalDecision = 'yes' | 'no' | 'always';

export interface SessionExecutionPolicy {
  autonomy_level: SessionAutonomyLevel;
  effective_autonomy_level: SessionAutonomyLevel;
}

export interface WsMessage {
  type:
    | 'message'
    | 'chunk'
    | 'draft_clear'
    | 'progress'
    | 'reasoning'
    | 'tool_call'
    | 'tool_result'
    | 'done'
    | 'error'
    | 'stopped'
    | 'session_policy'
    | 'approval_request';
  content?: string;
  full_response?: string;
  name?: string;
  args?: any;
  output?: string;
  error?: string | null;
  message?: string;
  append?: boolean;
  progress_kind?: 'thinking' | 'tool_calls' | 'tool_start' | 'tool_finished';
  round?: number;
  count?: number;
  seconds?: number;
  success?: boolean;
  tool_name?: string;
  hint?: string;
  autonomy_level?: SessionAutonomyLevel;
  effective_autonomy_level?: SessionAutonomyLevel;
  request_id?: string;
  arguments?: any;
}

export interface ChatHistoryMessage {
  role: string;
  content: string;
  timestamp: string;
}

export interface ChatHistoryResponse {
  messages: ChatHistoryMessage[];
  offset: number;
  limit: number;
  has_more: boolean;
}

export interface ChatSessionItem {
  session_id: string;
  kind: 'task' | 'channel';
  title: string;
  channel: string | null;
  sender: string | null;
  thread_ts: string | null;
  last_role: string;
  last_message: string;
  last_timestamp: string;
  message_count: number;
}
