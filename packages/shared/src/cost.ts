/// 费用模型：每步 AI 调用产生的成本和整个项目的汇总

export type CostItemKind = 'llm_token_in' | 'llm_token_out' | 'image' | 'video' | 'tts' | 'compose';

/** 单笔费用明细 */
export interface CostItem {
  kind: CostItemKind;
  label: string;
  shots?: number;
  tokens?: number;
  count?: number;
  durationSec?: number;
  cost: number;
}

/** 项目级费用汇总 */
export interface CostSummary {
  items: CostItem[];
  total: number;
}

export const PRICING = {
  llmInput: 1.0,
  llmOutput: 2.0,
  image: 0.5,
  video: 4.0,
  tts: 0.3,
  compose: 0.05,
} as const;

export function estimateLlmCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * PRICING.llmInput + outputTokens * PRICING.llmOutput) / 1_000_000;
}

export function costSummary(items: CostItem[]): CostSummary {
  const total = items.reduce((s, i) => s + i.cost, 0);
  return { items, total: Math.round(total * 100) / 100 };
}
