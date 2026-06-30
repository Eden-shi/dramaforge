import type { ProviderConfig, ProviderProtocol } from "@dramaforge/shared";
import type { LLMProvider, ImageProvider, VideoProvider, TTSProvider, ProviderDescriptor } from "./base.js";
import { CompatLLM, AsyncImageProvider, AsyncVideoProvider, HttpTTS, fromCfg } from "./descriptors.js";

/**
 * 根据协议模板实例化适配器。
 * - openai_compat: LLM / TTS / 同步图（通过 CompatLLM + HttpTTS + CompatImage）
 * - dashscope_async: 图（通义万相风格）
 * - kling_async / jimeng_async: 视频（可灵/即梦风格）
 */
export function createByProtocol(
  cfg: ProviderConfig,
  protocol: ProviderProtocol,
): LLMProvider | ImageProvider | VideoProvider | TTSProvider | null {
  const base = fromCfg(cfg);
  switch (protocol) {
    case 'openai_compat':
      switch (cfg.type) {
        case 'llm': return new CompatLLM(base);
        case 'tts':  return new HttpTTS({ ...base, voice: cfg.capabilities?.find((c) => c.startsWith('voice:'))?.slice(6) ?? 'default' });
        case 'image': return new CompatImage(base);
        default: return null;
      }
    case 'dashscope_async': return cfg.type === 'image' ? new AsyncImageProvider(base, 'dashscope') : null;
    case 'kling_async': return cfg.type === 'video' ? new AsyncVideoProvider(base, 'kling') : null;
    case 'jimeng_async': return cfg.type === 'video' ? new AsyncVideoProvider(base, 'jimeng') : null;
    case 'minimax_async': 
      if (cfg.type === 'video') return new AsyncVideoProvider(base, 'minimax');
      if (cfg.type === 'tts') return new HttpTTS({ ...base, voice: cfg.capabilities?.find((c) => c.startsWith('voice:'))?.slice(6) ?? 'male-qn-qingse' });
      return null;
    default: return null;
  }
}

/** OpenAI 同步文生图适配器（DALL-E 风格：POST 直接返回 url/base64） */
class CompatImage implements ImageProvider {
  type = 'image' as const;
  constructor(private cfg: { apiKey: string; baseUrl: string; model: string }) {}
  async textToImage(prompt: string, _opts?: import("./base.js").ImageOptions): Promise<import("./base.js").ImageResult> {
    const url = this.cfg.baseUrl.replace(/\/+$/, "") + "/images/generations";
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({ model: this.cfg.model, prompt, n: 1, size: "1024x1024" }),
    });
    if (!resp.ok) throw new Error(`文生图失败 ${resp.status}`);
    const j: any = await resp.json();
    const imgUrl = j.data?.[0]?.url ?? j.data?.[0]?.b64_json;
    if (!imgUrl) throw new Error("文生图返回异常");
    return { url: imgUrl };
  }
}