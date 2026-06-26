import type {
  ProviderConfig,
  ProviderInfo,
  ProviderType,
} from '@dramaforge/shared';
import { DESCRIPTORS } from './descriptors.js';
import {
  MockLLMProvider,
  type LLMProvider,
  type ImageProvider,
  type VideoProvider,
  type TTSProvider,
} from './base.js';

/**
 * Provider 注册表：维护各厂商的可用配置（含 key），并解析出可用实例。
 * 自用阶段配置存于本地；演进 SaaS 时替换为带用户隔离的后端存储即可。
 */
export class ProviderRegistry {
  private configs = new Map<string, ProviderConfig>();

  constructor(initial: ProviderConfig[] = []) {
    for (const c of initial) this.configs.set(c.id, this.mergeDefaults(c));
  }

  /** 列出全部厂商元信息（不下发密钥） */
  list(type?: ProviderType): ProviderInfo[] {
    return DESCRIPTORS.filter((d) => !type || d.type === type).map((d) => {
      const c = this.configs.get(d.id);
      return {
        id: d.id,
        type: d.type,
        name: d.name,
        vendor: d.vendor,
        baseUrl: c?.baseUrl ?? d.defaultBaseUrl,
        model: c?.model ?? d.defaultModel,
        configured: Boolean(c?.apiKey),
        capabilities: d.capabilities,
      };
    });
  }

  /** 持久化所需：导出含密钥的全部配置 */
  exportAll(): ProviderConfig[] {
    return [...this.configs.values()];
  }

  /** 更新某个 provider 的配置（key/model/baseUrl） */
  configure(id: string, patch: Partial<ProviderConfig>): ProviderInfo | null {
    const desc = DESCRIPTORS.find((d) => d.id === id);
    if (!desc) return null;
    const prev = this.configs.get(id) ?? this.mergeDefaults({ id } as ProviderConfig);
    const next: ProviderConfig = {
      ...prev,
      type: desc.type,
      name: desc.name,
      vendor: desc.vendor,
      capabilities: desc.capabilities,
      apiKey: patch.apiKey !== undefined ? patch.apiKey : prev.apiKey,
      model: patch.model ?? prev.model,
      baseUrl: patch.baseUrl ?? prev.baseUrl,
      configured: Boolean(patch.apiKey !== undefined ? patch.apiKey : prev.apiKey),
    };
    this.configs.set(id, next);
    const { apiKey: _k, ...info } = next;
    return info;
  }

  /** 获取可用实例；无 key 时 llm 回退 mock，其余返回 null */
  resolveLLM(id?: string): LLMProvider {
    const cfg = this.configs.get(id ?? '');
    const desc = DESCRIPTORS.find((d) => d.id === id);
    if (cfg && desc && cfg.apiKey) {
      const inst = desc.create(cfg);
      if (inst) return inst as LLMProvider;
    }
    return new MockLLMProvider(desc?.name ?? '演示');
  }

  resolveImage(id?: string): ImageProvider | null {
    return this.resolveTyped<ImageProvider>('image', id);
  }
  resolveVideo(id?: string): VideoProvider | null {
    return this.resolveTyped<VideoProvider>('video', id);
  }
  resolveTTS(id?: string): TTSProvider | null {
    return this.resolveTyped<TTSProvider>('tts', id);
  }

  private resolveTyped<T>(type: ProviderType, id?: string): T | null {
    const cfg = id ? this.configs.get(id) : this.firstConfigured(type);
    const desc = DESCRIPTORS.find((d) => d.id === cfg?.id);
    if (cfg && desc && cfg.apiKey && desc.type === type) {
      return (desc.create(cfg) as T) ?? null;
    }
    return null;
  }

  private firstConfigured(type: ProviderType): ProviderConfig | undefined {
    for (const c of this.configs.values()) {
      const desc = DESCRIPTORS.find((d) => d.id === c.id);
      if (desc?.type === type && c.apiKey) return c;
    }
    return undefined;
  }

  private mergeDefaults(c: ProviderConfig): ProviderConfig {
    const desc = DESCRIPTORS.find((d) => d.id === c.id);
    return {
      ...c,
      type: desc?.type ?? c.type,
      name: desc?.name ?? c.name,
      vendor: desc?.vendor ?? c.vendor,
      baseUrl: c.baseUrl ?? desc?.defaultBaseUrl,
      model: c.model ?? desc?.defaultModel,
      configured: Boolean(c.apiKey),
      capabilities: desc?.capabilities ?? c.capabilities ?? [],
    };
  }
}
