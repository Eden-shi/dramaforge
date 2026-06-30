import type { ProviderConfig } from '@dramaforge/shared';
import { compatChat, compatChatStream } from './openai_compat.js';
import type {
  LLMProvider,
  ImageProvider,
  ImageResult,
  ImageOptions,
  ProviderDescriptor,
  VideoOptions,
  VideoProvider,
  VideoTaskResult,
  TTSProvider,
  TtsResult,
  TtsOptions,
  ChatMessage,
  LLMOptions,
} from './base.js';

export class CompatLLM implements LLMProvider {
  type = 'llm' as const;
  constructor(private cfg: { apiKey: string; baseUrl: string; model: string }) {}
  chat(m: ChatMessage[], o?: LLMOptions) {
    return compatChat(this.cfg, m, o);
  }
  chatStream(m: ChatMessage[], o?: LLMOptions) {
    return compatChatStream(this.cfg, m, o);
  }
}

// ---------- 文生图 ----------
// 通义万相 / 智谱 CogView / 即梦 等大多为「提交任务 → 轮询/回调取图」。
// 这里给出统一异步轮询骨架；各厂商差异收敛在 create() 内的 endpoint/model。
export class AsyncImageProvider implements ImageProvider {
  type = 'image' as const;
  constructor(
    private cfg: { apiKey: string; baseUrl: string; model: string },
    private vendor: 'dashscope' | 'zhipu' | 'jimeng' | 'generic',
  ) {}
  async textToImage(prompt: string, opts?: ImageOptions): Promise<ImageResult> {
    const task = await this.submit(prompt, opts);
    const url = await this.poll(task);
    return { url, width: opts?.width, height: opts?.height };
  }
  private async submit(prompt: string, _opts?: ImageOptions): Promise<string> {
    const url = this.cfg.baseUrl.replace(/\/+$/, '') + '/services/aigc/text2image/image-synthesis';
    const resp = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: this.cfg.model, input: { prompt }, parameters: { size: '1024*1024' } }),
    });
    if (!resp.ok) throw new Error(`文生图提交失败 ${resp.status}: ${await safeText(resp)}`);
    const json: any = await resp.json();
    return json.output?.task_id ?? json.task_id ?? json.request_id;
  }
  private async poll(taskId: string): Promise<string> {
    const base = this.cfg.baseUrl.replace(/\/+$/, '');
    for (let i = 0; i < 120; i++) {
      const resp = await fetch(`${base}/tasks/${taskId}`, { headers: this.headers() });
      const json: any = await resp.json().catch(() => ({}));
      const status = json.output?.task_status ?? json.status ?? 'PENDING';
      const urls: string[] = json.output?.results?.map((r: any) => r.url ?? r.b64) ?? [];
      if (status.toUpperCase().includes('SUCC')) return urls[0];
      if (status.toUpperCase().includes('FAIL')) throw new Error('文生图任务失败');
      await delay(2000);
    }
    throw new Error('文生图任务超时');
  }
  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.cfg.apiKey}`,
      'X-DashScope-Async': 'enable',
    };
  }
}

// ---------- 图生/文生视频 ----------
// 可灵(Kling, 快手) / 即梦(Dreamina, 字节) / 智谱 CogVideoX / MiniMax 海螺 / Vidu
// 均为异步任务：submit → fetch(taskId)。
export class AsyncVideoProvider implements VideoProvider {
  type = 'video' as const;
  constructor(
    private cfg: { apiKey: string; baseUrl: string; model: string },
    private vendor: 'kling' | 'jimeng' | 'cogvideo' | 'minimax' | 'vidu' | 'wanx' | 'generic',
  ) {}
  async submit(opts: VideoOptions): Promise<VideoTaskResult> {
    const url = this.cfg.baseUrl.replace(/\/+$/, '') + '/videos/generations';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        prompt: opts.prompt,
        image_url: opts.imageUrl,
        duration: opts.durationSec ?? 5,
      }),
    });
    if (!resp.ok) throw new Error(`视频提交失败 ${resp.status}: ${await safeText(resp)}`);
    const json: any = await resp.json();
    return { taskId: json.id ?? json.task_id ?? json.data?.task_id, status: 'submitted' };
  }
  async fetch(taskId: string): Promise<VideoTaskResult> {
    const base = this.cfg.baseUrl.replace(/\/+$/, '');
    const resp = await fetch(`${base}/videos/generations/${taskId}`, {
      headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
    });
    const json: any = await resp.json().catch(() => ({}));
    const st = (json.status ?? json.data?.status ?? 'running').toLowerCase();
    const url = json.url ?? json.video_url ?? json.data?.video?.url;
    const duration = json.duration ?? json.data?.video?.duration;
    return {
      taskId,
      status: st.includes('succ') ? 'succeeded' : st.includes('fail') ? 'failed' : 'running',
      url,
      durationSec: duration,
    };
  }
}

// ---------- TTS ----------
// MiniMax 语音 / 智谱 / Azure / 火山引擎（CosyVoice 走 DashScope）
export class HttpTTS implements TTSProvider {
  type = 'tts' as const;
  constructor(private cfg: { apiKey: string; baseUrl: string; model: string; voice: string }) {}
  async synthesize(text: string, opts?: TtsOptions): Promise<TtsResult> {
    const url = this.cfg.baseUrl.replace(/\/+$/, '') + '/audio/speech';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        input: text,
        voice: opts?.voice ?? this.cfg.voice,
        speed: opts?.speed ?? 1,
        response_format: 'mp3',
      }),
    });
    if (!resp.ok) throw new Error(`TTS 失败 ${resp.status}: ${await safeText(resp)}`);
    // 二进制音频：落盘后返回本地 url（由调用方处理）；这里返回 data: 前缀占位
    const buf = Buffer.from(await resp.arrayBuffer());
    return { url: 'data:audio/mp3;base64,' + buf.toString('base64') };
  }
}

export function fromCfg(c: ProviderConfig) {
  return {
    apiKey: c.apiKey ?? '',
    baseUrl: c.baseUrl ?? '',
    model: c.model ?? '',
  };
}

export const DESCRIPTORS: ProviderDescriptor[] = [
  {
    type: 'llm',
    id: 'dashscope-qwen',
    name: '通义千问 Qwen',
    vendor: '阿里',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    capabilities: ['chat', 'script', 'storyboard'],
    create: (c) => (c.apiKey ? new CompatLLM(fromCfg(c)) : null),
  },
  {
    type: 'llm',
    id: 'deepseek',
    name: 'DeepSeek',
    vendor: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    capabilities: ['chat', 'script', 'storyboard'],
    create: (c) => (c.apiKey ? new CompatLLM(fromCfg(c)) : null),
  },
  {
    type: 'llm',
    id: 'zhipu-glm',
    name: '智谱 GLM',
    vendor: '智谱',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    capabilities: ['chat', 'script', 'storyboard'],
    create: (c) => (c.apiKey ? new CompatLLM(fromCfg(c)) : null),
  },
  {
    type: 'llm',
    id: 'minimax-text',
    name: 'MiniMax abab',
    vendor: 'MiniMax',
    defaultBaseUrl: 'https://api.minimax.chat/v1',
    defaultModel: 'abab6.5s-chat',
    capabilities: ['chat', 'script'],
    create: (c) => (c.apiKey ? new CompatLLM(fromCfg(c)) : null),
  },
  {
    type: 'llm',
    id: 'moonshot-kimi',
    name: '月之暗面 Kimi',
    vendor: 'Moonshot',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    capabilities: ['chat', 'script'],
    create: (c) => (c.apiKey ? new CompatLLM(fromCfg(c)) : null),
  },
  {
    type: 'image',
    id: 'dashscope-wanx',
    name: '通义万相',
    vendor: '阿里',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    defaultModel: 'wanx-v1',
    capabilities: ['text2image'],
    create: (c) => (c.apiKey ? new AsyncImageProvider(fromCfg(c), 'dashscope') : null),
  },
  {
    type: 'image',
    id: 'zhipu-cogview',
    name: '智谱 CogView',
    vendor: '智谱',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'cogview-3-plus',
    capabilities: ['text2image'],
    create: (c) => (c.apiKey ? new AsyncImageProvider(fromCfg(c), 'zhipu') : null),
  },
  {
    type: 'video',
    id: 'kling',
    name: '可灵 Kling',
    vendor: '快手',
    defaultBaseUrl: 'https://api.klingai.com/v1',
    defaultModel: 'kling-v1',
    capabilities: ['text2video', 'image2video'],
    create: (c) => (c.apiKey ? new AsyncVideoProvider(fromCfg(c), 'kling') : null),
  },
  {
    type: 'video',
    id: 'jimeng-dreamina',
    name: '即梦 Dreamina',
    vendor: '字节',
    defaultBaseUrl: 'https://visual.volcengineapi.com/v1',
    defaultModel: 'dreamina-v1',
    capabilities: ['text2video', 'image2video'],
    create: (c) => (c.apiKey ? new AsyncVideoProvider(fromCfg(c), 'jimeng') : null),
  },
  {
    type: 'video',
    id: 'zhipu-cogvideox',
    name: '智谱 CogVideoX',
    vendor: '智谱',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'cogvideox-2',
    capabilities: ['text2video', 'image2video'],
    create: (c) => (c.apiKey ? new AsyncVideoProvider(fromCfg(c), 'cogvideo') : null),
  },
  {
    type: 'video',
    id: 'minimax-hailuo',
    name: 'MiniMax 海螺',
    vendor: 'MiniMax',
    defaultBaseUrl: 'https://api.minimax.chat/v1',
    defaultModel: 'video-01',
    capabilities: ['text2video'],
    create: (c) => (c.apiKey ? new AsyncVideoProvider(fromCfg(c), 'minimax') : null),
  },
  {
    type: 'tts',
    id: 'minimax-voice',
    name: 'MiniMax 语音',
    vendor: 'MiniMax',
    defaultBaseUrl: 'https://api.minimax.chat/v1',
    defaultModel: 'speech-01-hd',
    capabilities: ['tts'],
    create: (c) => (c.apiKey ? new HttpTTS({ ...fromCfg(c), voice: 'male-qn-qingse' }) : null),
  },
];

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}
