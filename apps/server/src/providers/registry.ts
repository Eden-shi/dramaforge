import type {
  CustomProviderInput,
  ProviderConfig,
  ProviderInfo,
  ProviderProtocol,
  ProviderType,
} from '@dramaforge/shared';
import { DESCRIPTORS } from './descriptors.js';
import {
  MockLLMProvider,
  type LLMProvider,
  type ImageProvider,
  type VideoProvider,
  type ProviderDescriptor,
  type TTSProvider,
} from './base.js';
import { createByProtocol } from './custom_factory.js';

/**
 * Provider 注册表：维护各厂商的可用配置（含 key），并解析出可用实例。
 * 自用阶段配置存于本地；演进 SaaS 时替换为带用户隔离的后端存储即可。
 */
export class ProviderRegistry {
  private configs = new Map<string, ProviderConfig>();
  private customDescriptors = new Map<string, ProviderDescriptor>();

  constructor(initial: ProviderConfig[] = []) {
    for (const c of initial) this.configs.set(c.id, this.mergeDefaults(c));
  }

  /** 列出全部厂商元信息（不下发密钥） */
  private allDescriptors(): ProviderDescriptor[] {
    return [...DESCRIPTORS, ...this.customDescriptors.values()];
  }

  addCustom(input: CustomProviderInput, idHint?: string): ProviderInfo {
    const id = idHint ?? ('custom_' + Math.random().toString(36).slice(2, 12));
    const desc: ProviderDescriptor = {
      type: input.type, id, name: input.name, vendor: '自定义',
      defaultBaseUrl: input.baseUrl, defaultModel: input.model,
      capabilities: input.capabilities ?? defaultCapabilities(input.type),
      create: (cfg) => createByProtocol(cfg, input.protocol),
    };
    this.customDescriptors.set(id, desc);
    this.configs.set(id, this.mergeDefaults({
      id, type: input.type, name: input.name, vendor: '自定义',
      custom: true, protocol: input.protocol,
      baseUrl: input.baseUrl, model: input.model,
      apiKey: input.apiKey, configured: Boolean(input.apiKey),
      capabilities: desc.capabilities,
    } as ProviderConfig));
    return this.toInfo(id)!;
  }

  removeCustom(id: string): boolean {
    if (!this.customDescriptors.has(id)) return false;
    this.customDescriptors.delete(id);
    this.configs.delete(id);
    return true;
  }

  isCustom(id: string): boolean {
    return this.customDescriptors.has(id);
  }

  list(type?: ProviderType): ProviderInfo[] {
    return this.allDescriptors().filter((d) => !type || d.type === type).map((d) => {
      const c = this.configs.get(d.id);
      return {
        id: d.id, type: d.type, name: d.name, vendor: d.vendor,
        custom: this.isCustom(d.id),
        protocol: this.configs.get(d.id)?.protocol,
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

  private toInfo(id: string): ProviderInfo | null {
    const desc = this.allDescriptors().find((d) => d.id === id);
    if (!desc) return null;
    const c = this.configs.get(id);
    return {
      id: desc.id, type: desc.type, name: desc.name, vendor: desc.vendor,
      custom: this.isCustom(id),
      protocol: c?.protocol,
      baseUrl: c?.baseUrl ?? desc.defaultBaseUrl,
      model: c?.model ?? desc.defaultModel,
      configured: Boolean(c?.apiKey),
      capabilities: desc.capabilities,
    };
  }

  /** 更新某个 provider 的配置（key/model/baseUrl） */
  configure(id: string, patch: Partial<ProviderConfig>): ProviderInfo | null {
    const desc = this.allDescriptors().find((d) => d.id === id);
    if (!desc) return null;
    const prev = this.configs.get(id) ?? this.mergeDefaults({ id } as ProviderConfig);
    const next: ProviderConfig = {
      ...prev,
      type: desc.type,
      name: desc.name,
      vendor: desc.vendor,
      custom: this.isCustom(id),
      protocol: prev.protocol,
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
    const cfg = id ? this.configs.get(id) : this.firstConfigured('llm');
    const desc = this.allDescriptors().find((d) => d.id === cfg?.id);
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
    const desc = this.allDescriptors().find((d) => d.id === cfg?.id);
    if (cfg && desc && cfg.apiKey && desc.type === type) {
      return (desc.create(cfg) as T) ?? null;
    }
    return null;
  }

  private firstConfigured(type: ProviderType): ProviderConfig | undefined {
    for (const c of this.configs.values()) {
      const desc = this.allDescriptors().find((d) => d.id === c.id);
      if (desc?.type === type && c.apiKey) return c;
    }
    return undefined;
  }

  private mergeDefaults(c: ProviderConfig): ProviderConfig {
    const desc = this.allDescriptors().find((d) => d.id === c.id);
    return {
      ...c,
      type: desc?.type ?? c.type,
      name: desc?.name ?? c.name,
      vendor: desc?.vendor ?? c.vendor,
      custom: this.isCustom(c.id) || c.custom,
      protocol: c.protocol ?? (this.isCustom(c.id) ? (c as any).protocol : undefined),
      baseUrl: c.baseUrl ?? desc?.defaultBaseUrl,
      model: c.model ?? desc?.defaultModel,
      configured: Boolean(c.apiKey),
      capabilities: desc?.capabilities ?? c.capabilities ?? [],
    };
  }
}

function defaultCapabilities(type: ProviderType): string[] {
  switch (type) {
    case 'llm': return ['chat', 'script', 'storyboard'];
    case 'image': return ['text2image'];
    case 'video': return ['text2video', 'image2video'];
    case 'tts': return ['tts'];
  }
}
