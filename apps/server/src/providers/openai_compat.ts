// OpenAI 兼容协议封装：通义千问(DashScope)、智谱、DeepSeek、MiniMax、月之暗面
// 均提供 /chat/completions（SSE 流式）端点，仅鉴权头与默认 model 不同。

import type { ChatMessage, LLMOptions } from './base.js';

export interface CompatConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** 流式：逐段产出增量文本 */
export async function* compatChatStream(
  cfg: CompatConfig,
  messages: ChatMessage[],
  opts: LLMOptions = {},
): AsyncIterable<string> {
  const sys = opts.systemPrompt
    ? [{ role: 'system' as const, content: opts.systemPrompt }]
    : [];
  const url = trim(cfg.baseUrl) + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [...sys, ...messages],
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens,
      stream: true,
    }),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`LLM 请求失败 ${resp.status}: ${await safeText(resp)}`);
  }
  for await (const data of sseEvents(resp.body)) {
    if (data === '[DONE]') return;
    try {
      const delta = JSON.parse(data).choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) yield delta;
    } catch {
      /* 忽略心跳/非 JSON */
    }
  }
}

/** 非流式：聚合为完整文本 */
export async function compatChat(
  cfg: CompatConfig,
  messages: ChatMessage[],
  opts: LLMOptions = {},
): Promise<string> {
  let out = '';
  for await (const d of compatChatStream(cfg, messages, opts)) out += d;
  return out;
}

/** 解析 SSE 字节流，逐条 yield `data:` 后的内容 */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const line = raw.replace(/\r$/, '').trim();
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('data:')) {
          yield line.slice(5).trim();
        }
      }
    }
    if (buffer.startsWith('data:')) yield buffer.slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}

function trim(s: string): string {
  return s.replace(/\/+$/, '');
}
