import type { Project, Shot, Character } from '@dramaforge/shared';

/** 剧本生成的系统提示词：约束输出为结构化剧本 */
export function scriptSystemPrompt(p: Project): string {
  return [
    '你是一名资深短剧编剧，擅长竖屏短剧（单集1-2分钟，强冲突、快节奏、每集结尾留钩子）。',
    '请基于给定主题创作短剧剧本。要求：',
    '1. 先用 ##角色 列出主要角色及身份定位（每行：角色名｜定位｜一句话外貌）。',
    '2. 再按集输出，每集以 #第N集 标题 开头。',
    '3. 每集包含：场景(地点/时间/内外景)、出场角色、对白、关键动作、结尾钩子。',
    '4. 语言口语化、情绪饱满，符合竖屏短剧受众口味。',
    `题材：${p.genre || '未指定'}；受众：${p.audience || '通用'}；调性：${p.tone || '爽感向'}。`,
    `计划产出 ${p.episodeCount || 3} 集。`,
    '严格按上述结构输出，不要额外解释。',
  ].join('\n');
}

export function scriptUserPrompt(p: Project): string {
  return `主题：${p.topic}\n\n计划产出 ${p.episodeCount} 集。请据此创作完整剧本。`;
}

/** 分镜生成的系统提示词：约束输出为可解析的 JSON 数组 */
export function storyboardSystemPrompt(): string {
  return [
    '你是一名短剧分镜师。给定一集剧本，将其拆分为多个拍摄分镜。',
    '每个分镜包含字段：scene(场景描述), location(内/外景+地点), dialogue(对白,可多行), narration(旁白,可空), visualPrompt(用于文生图的中文画面描述,需具体到人物外貌/服装/表情/构图/光线), camera(镜头景别:特写/近景/中景/全景), durationSec(预估秒数,3-8)。',
    '只输出一个 JSON 数组，不要任何解释、不要 markdown 代码块。',
    '示例：[{"scene":"雨夜天台","location":"外景-高楼天台","dialogue":"这一次我不会再输了","narration":"三年后","visualPrompt":"俯拍,雨夜,短发干练女性立于天台边缘,城市霓虹,湿润地面反光,电影感","camera":"全景","durationSec":5}]',
  ].join('\n');
}

export function storyboardUserPrompt(script: string): string {
  return `剧本：\n${script}\n\n请拆分为分镜（JSON 数组）。`;
}

export interface ParsedShot {
  scene: string;
  location: string;
  dialogue: string;
  narration: string;
  visualPrompt: string;
  camera: string;
  durationSec: number;
}

/** 从 LLM 输出中抽取并容错解析 JSON 分镜数组 */
export function parseShots(text: string): ParsedShot[] {
  const cleaned = stripCodeFence(text).trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    const arr = JSON.parse(slice);
    if (!Array.isArray(arr)) return [];
    return arr.map((s: Partial<ParsedShot>) => ({
      scene: str(s.scene),
      location: str(s.location),
      dialogue: str(s.dialogue),
      narration: str(s.narration),
      visualPrompt: str(s.visualPrompt),
      camera: str(s.camera),
      durationSec: num(s.durationSec, 5),
    }));
  } catch {
    return [];
  }
}

/** 从剧本文本中抽取角色列表（##角色 段） */
export function parseCharacters(text: string): Character[] {
  const m = text.match(/##\s*角色([\s\S]*?)(?=\n#|\n##第|$)/i);
  if (!m) return [];
  const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, 8).map((line) => {
    const parts = line.split(/[｜|]/).map((x) => x.trim());
    return {
      id: 'char_' + Math.random().toString(36).slice(2, 10),
      name: parts[0] || '未命名',
      role: parts[1] || '配角',
      appearance: parts[2] || '',
      voice: '',
    } satisfies Character;
  });
}

function stripCodeFence(t: string): string {
  return t.replace(/```json/gi, '').replace(/```/g, '');
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function num(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export type { Shot };
