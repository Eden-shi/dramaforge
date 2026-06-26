// 共享领域模型 —— 实体

export type ProjectStatus =
  | 'draft'
  | 'scripted'
  | 'storyboarded'
  | 'producing'
  | 'composing'
  | 'done'
  | 'failed';

export type AssetKind = 'image' | 'video' | 'audio' | 'subtitle' | 'final';

export type AssetStatus = 'pending' | 'queued' | 'generating' | 'ready' | 'failed';

/** 角色：用于跨镜头形象/音色一致性 */
export interface Character {
  id: string;
  name: string;
  role: string; // 主角/反派/配角
  appearance: string; // 外貌描述（文生图/图生视频一致）
  voice: string; // 音色偏好（TTS）
  refAssetId?: string | null;
}

export interface ProjectConfig {
  llmProviderId?: string;
  imageProviderId?: string;
  videoProviderId?: string;
  ttsProviderId?: string;
  shotDurationSec: number;
  resolution: string; // 1080x1920 竖屏
}

export interface Project {
  id: string;
  title: string;
  topic: string;
  genre: string;
  audience: string;
  tone: string;
  episodeCount: number;
  status: ProjectStatus;
  characters: Character[];
  config: ProjectConfig;
  createdAt: number;
  updatedAt: number;
}

export interface Episode {
  id: string;
  projectId: string;
  index: number;
  title: string;
  synopsis: string;
  script: string;
  createdAt: number;
  updatedAt: number;
}

export interface Shot {
  id: string;
  episodeId: string;
  projectId: string;
  index: number;
  scene: string;
  location: string;
  characterIds: string[];
  dialogue: string;
  narration: string;
  visualPrompt: string;
  camera: string;
  durationSec: number;
}

export interface Asset {
  id: string;
  projectId: string;
  ownerId: string;
  ownerType: 'shot' | 'character' | 'project';
  kind: AssetKind;
  status: AssetStatus;
  providerId?: string;
  providerRef?: string;
  prompt: string;
  url?: string;
  durationSec?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}
