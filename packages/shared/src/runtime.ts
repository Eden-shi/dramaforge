// 共享领域模型 —— 任务、Provider、流式事件

export type JobType =
  | 'generate_script'
  | 'generate_storyboard'
  | 'generate_image'
  | 'generate_video'
  | 'generate_tts'
  | 'compose_final';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  projectId: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  progress: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export type ProviderType = 'llm' | 'image' | 'video' | 'tts';

/** Provider 元信息（不含密钥，可下发前端） */
export interface ProviderInfo {
  id: string;
  type: ProviderType;
  name: string;
  vendor: string;
  baseUrl?: string;
  model?: string;
  configured: boolean;
  capabilities: string[];
}

/** Provider 配置（含密钥，仅后端持有） */
export interface ProviderConfig extends ProviderInfo {
  apiKey?: string;
}

/** 前端可提交的 Provider 设置 */
export interface ProviderSettingsInput {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  enabled?: boolean;
}

export interface StreamEvent {
  type: 'delta' | 'done' | 'error';
  text?: string;
  error?: string;
}

export interface ApiError {
  error: string;
  detail?: string;
}

export interface GenerateScriptInput {
  projectId: string;
  episodeCount?: number;
}
export interface GenerateStoryboardInput {
  episodeId: string;
}
