import type {
  ProviderConfig,
  ProviderInfo,
  ProviderType,
} from '@dramaforge/shared';

export interface ImageResult {
  url: string; width?: number; height?: number;
}
export interface VideoTaskResult {
  taskId: string;
  status: 'submitted' | 'running' | 'succeeded' | 'failed';
  url?: string; durationSec?: number;
}
export interface TtsResult {
  url: string; durationSec?: number;
}
export interface LLMOptions {
  temperature?: number; maxTokens?: number; systemPrompt?: string;
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'; content: string;
}
export interface LLMProvider {
  type: 'llm';
  chat(messages: ChatMessage[], opts?: LLMOptions): Promise<string>;
  chatStream(messages: ChatMessage[], opts?: LLMOptions): AsyncIterable<string>;
}
export interface ImageProvider {
  type: 'image';
  textToImage(prompt: string, opts?: ImageOptions): Promise<ImageResult>;
}
export interface VideoProvider {
  type: 'video';
  submit(opts: VideoOptions): Promise<VideoTaskResult>;
  fetch(taskId: string): Promise<VideoTaskResult>;
}
export interface TTSProvider {
  type: 'tts';
  synthesize(text: string, opts?: TtsOptions): Promise<TtsResult>;
}
export interface ImageOptions {
  width?: number; height?: number; style?: string; refImageUrl?: string;
}
export interface VideoOptions {
  prompt: string; imageUrl?: string; durationSec?: number; width?: number; height?: number;
}
export interface TtsOptions {
  voice?: string; speed?: number;
}
export interface ProviderDescriptor {
  type: ProviderType; id: string; name: string; vendor: string;
  defaultBaseUrl?: string; defaultModel?: string;
  capabilities: string[];
  create(config: ProviderConfig): LLMProvider | ImageProvider | VideoProvider | TTSProvider | null;
}
export function toInfo(c: ProviderConfig): ProviderInfo {
  const { apiKey: _omit, ...info } = c;
  return { ...info, configured: Boolean(c.apiKey) };
}
export class MockLLMProvider implements LLMProvider {
  type = 'llm' as const;
  constructor(private label = '\u6f14\u793a') {}
  async chat(messages: ChatMessage[]): Promise<string> {
    let out = '';
    for await (const d of this.chatStream(messages)) out += d;
    return out;
  }
  async *chatStream(messages: ChatMessage[]): AsyncIterable<string> {
    const last = messages[messages.length - 1]?.content ?? '';
    const sample = this.sample(last, messages);
    const chunks = sample.match(/[\s\S]{1,12}/g) ?? [sample];
    for (const c of chunks) {
      await delay(18);
      yield c;
    }
  }
  private sample(seed: string, messages: ChatMessage[]): string {
    const all = messages.map((m) => m.content).join(' ');
    if (/分镜|JSON/.test(all)) return this.sampleShots();
    const n = Math.max(1, Number(/\u8ba1\u5212\u4ea7\u51fa\s*(\d+)\s*\u96c6/.exec(all)?.[1] ?? 1) || 1);
    return [
      `\u3010${this.label}剧本 \u00b7 mock\u3011`,
      ``,
      `题材：${seed.slice(0, 30)}`,
      ``,
      `##角色`,
      `林晚｜主角｜短发干练女性，眼神坚毅`,
      `苏然｜反派｜西装男，伪善微笑`,
      ``,
      ...Array.from({ length: n }, (_, i) => this.sampleEpisode(i + 1)),
      ``,
      `\uff08\u6ce8\uff1a\u8bf7\u5728\u300c\u8bbe\u7f6e\u300d\u9875\u586b\u5165\u56fd\u5185 API Key\uff0c\u5373\u53ef\u751f\u6210\u771f\u5b9e\u5267\u672c\u3001\u5206\u955c\u4e0e\u7d20\u6750\u3002\uff09`,
    ].join('\n');
  }
  private sampleEpisode(i: number): string {
    return [
      `#\u7b2c${i}集 ${i === 1 ? '\u547d\u8fd0\u7684\u56de\u65cb' : '\u6697\u6d41\u6d8c\u52a8'}`,
      ``,
      `\u573a\u666f\u4e00：${i === 1 ? '\u96e8\u591c\uff0c\u5973\u4e3b\u6797\u665a\u72ec\u81ea\u7ad9\u5728\u5929\u53f0\u8fb9\u7f18\u3002' : '\u6e05\u6668\uff0c\u6797\u665a\u5728\u529e\u516c\u5ba4\u6253\u5f00\u4e00\u4efd\u4fe1\u5c01\u3002'}`,
      `\u6797\u665a：${i === 1 ? '\u8fd9\u4e00\u6b21\uff0c\u6211\u4e0d\u4f1a\u518d\u8f93\u4e86\u3002' : '\u8fd9\u53ea\u662f\u5f00\u59cb\u3002'}`,
      ``,
      `\u573a\u666f\u4e8c：${i === 1 ? '\u82cf\u7136\u9012\u4e0a\u4e00\u676f\u9152\uff0c\u7b11\u5bb9\u80cc\u540e\u85cf\u7740\u7b97\u8ba1\u3002' : '\u82cf\u7136\u5728\u8f66\u91cc\u6253\u7535\u8bdd\uff0c\u795e\u60c5\u9634\u90c1\u3002'}`,
      `\u82cf\u7136：${i === 1 ? '\u656c\u6211\u4eec\u7684\u5408\u4f5c\u3002' : '\u5979\u6bd4\u6211\u60f3\u8c61\u4e2d\u5f3a\u3002'}`,
      ``,
    ].join('\n');
  }
  private sampleShots(): string {
    const shots = [
      { scene: '\u96e8\u591c\u5929\u53f0', location: '\u5916\u666f-\u9ad8\u697c\u5929\u53f0', dialogue: '\u8fd9\u4e00\u6b21\uff0c\u6211\u4e0d\u4f1a\u518d\u8f93\u4e86\u3002', narration: '\u4e09\u5e74\u524d\uff0c\u5979\u4e00\u65e0\u6240\u6709\u3002', visualPrompt: '\u4fd1\u62cd\uff0c\u96e8\u591c\uff0c\u77ed\u53d1\u5e72\u7ec3\u5973\u6027\u7acb\u4e8e\u5929\u53f0\u8fb9\u7f18\uff0c\u57ce\u5e02\u9713\u8679\uff0c\u6e7f\u6da6\u5730\u9762\u53cd\u5149\uff0c\u7535\u5f71\u611f\uff0c\u7ad6\u5c4f\u6784\u56fe', camera: '\u5168\u666f', durationSec: 4 },
      { scene: '\u56de\u5fc6-\u8ba2\u5a5a\u5bb4', location: '\u5185\u666f-\u5bb4\u4f1a\u5385', dialogue: '\u8fd9\u676f\u9152\uff0c\u656c\u6211\u4eec\u7684\u672a\u6765\u3002', narration: '\u8c01\u80fd\u60f3\u5230\uff0c\u90a3\u662f\u5669\u68a6\u7684\u5f00\u59cb\u3002', visualPrompt: '\u6696\u5149\u5bb4\u4f1a\u5385\uff0c\u5973\u4e3b\u8eab\u7740\u767d\u88d9\u4e3e\u676f\uff0c\u5bf9\u9762\u7537\u5b50\u4e0e\u53e6\u4e00\u5973\u5b50\u4ea4\u6362\u773c\u795e\uff0c\u7279\u5199\u9152\u676f\uff0c\u7ad6\u5c4f', camera: '\u7279\u5199', durationSec: 5 },
      { scene: '\u91cd\u751f\u60ca\u9192', location: '\u5185\u666f-\u5367\u5ba4', dialogue: '\u6211\u56de\u6765\u4e86\u2026\u2026', narration: '\u4e09\u5e74\u524d\u3002\u4e00\u5207\u8fd8\u6765\u5f97\u53ca\u3002', visualPrompt: '\u6e05\u6668\u67d4\u5149\uff0c\u5973\u4e3b\u731b\u7136\u4ece\u5e8a\u4e0a\u5750\u8d77\uff0c\u60ca\u6050\u53c8\u575a\u5b9a\u7684\u795e\u60c5\uff0c\u9006\u5149\uff0c\u7ad6\u5c4f', camera: '\u8fd1\u666f', durationSec: 4 },
    ];
    return JSON.stringify(shots);
  }
}
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
