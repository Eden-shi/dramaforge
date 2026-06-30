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

/**
 * 从剧本文本中抽取角色列表。兼容多种常见写法：
 *  - ##角色 / ## 角色 / 【角色】/ 🎭 主要角色 / 角色设定 / 角色列表 / 角色介绍
 *  - 表格（含表头分隔行）：列用 | 或制表符分隔
 *  - 列表：每行 "角色名｜定位｜外貌" 或 "角色名：定位"
 */
export function parseCharacters(text: string): Character[] {
  // 1) 定位角色区块起点
  const startRe = /(?:#{1,3}\s*|【|🎭\s*|^\s*)(主要\s*)?角色[\s：:】]*(?:设定|列表|介绍)?\s*\n/im;
  const startM = text.match(startRe);
  if (!startM) {
    // 退而求其次：尝试 "🎭 主要角色" 这种 emoji 开头的
    const emoji = text.match(/🎭\s*主要\s*角色[^\n]*\n/);
    if (!emoji) return [];
    return parseCharBlock(text.slice(emoji.index! + emoji[0].length));
  }
  const blockStart = (startM.index ?? 0) + startM[0].length;
  // 角色块到下一个章节标题结束（# 第N集 / 第N集：/ ## 任意标题 / 📖）
  const rest = text.slice(blockStart);
  const endM = rest.match(/\n(?:#{1,3}\s|第\s*\d+\s*[集章节]|📖|🎭|[\u4e00-\u9fa5]{0,6}(?:剧本|分集|大纲|剧情))/);
  const block = endM ? rest.slice(0, endM.index) : rest;
  return parseCharBlock(block);
}

function parseCharBlock(block: string): Character[] {
  const lines = block.split('\n').map((l) => l.replace(/\r/g, '').trim()).filter(Boolean);
  if (!lines.length) return [];
  const chars: Character[] = [];

  // 判断是否为 markdown 表格：首行有 | 且后续行是分隔符
  // 表格判定：markdown(|) 或 制表符分隔的多列；需至少 2 行有同样多列
  const detectCols = (line: string): number => {
    if (line.includes('|')) return line.split('|').length;
    if (line.includes('\t')) return line.split('\t').length;
    return 0;
  };
  const hasSep = (line: string): boolean => Boolean(line.match(/^\s*\|?[\s:|-]+\|?\s*$/));
  const col0 = detectCols(lines[0]);
  const isTable = col0 >= 2 && (
    hasSep(lines[1] ?? '')
    || lines.slice(1, 4).filter((l) => detectCols(l) === col0).length >= 2
  );
  if (isTable) {
    // 表头列：找 name/角色/名字、role/定位/身份、appearance/外貌/设定/描述/简介
    const headerCells = splitCells(lines[0]);
    const nameCol = headerCells.findIndex((h) => /角色|名字|姓名|name/i.test(h));
    const roleCol = headerCells.findIndex((h) => /定位|身份|角色定位|role|类型/i.test(h));
    const appearCol = headerCells.findIndex((h) => /外貌|外形|设定|描述|特征|appearance|简介/i.test(h));
    for (let i = 1; i < lines.length; i++) {
      if (hasSep(lines[i])) continue; // 分隔行
      const cells = splitCells(lines[i]);
      if (cells.length < 1) continue;
      let name = (nameCol >= 0 ? cells[nameCol] : cells[0])?.trim() || '';
      // 跳过表头（角色/名字/姓名/name 等）
      if (!name || /^(角色|名字|姓名|name|人物)$/i.test(name)) continue;
      // 表头未明确指定 role 列时，不臆测第 2 列就是 role；把除 name 之外的所有列拼成 appearance
      let role = '';
      let appearance = '';
      if (roleCol >= 0) {
        role = (cells[roleCol] ?? '').trim();
        const usedCols = new Set<number>([nameCol >= 0 ? nameCol : 0, roleCol]);
        if (appearCol >= 0) appearance = (cells[appearCol] ?? '').trim();
        else appearance = cells.filter((_, idx) => !usedCols.has(idx)).map((c) => c.trim()).filter(Boolean).join('，');
      } else {
        // 没有定位列：第 1 列之后的所有内容作为 appearance
        const nameIdx = nameCol >= 0 ? nameCol : 0;
        if (appearCol >= 0) appearance = (cells[appearCol] ?? '').trim();
        else appearance = cells.filter((_, idx) => idx !== nameIdx).map((c) => c.trim()).filter(Boolean).join('，');
      }
      // 从 "名字（定位）" 格式中拆出 name 和 role（若 role 仍为空）
      const nameParen = name.match(/^([^（(]+)\s*[（(]\s*([^）)]+)[）)]/);
      if (nameParen) {
        name = nameParen[1].trim();
        if (!role) role = nameParen[2].trim();
      }
      // 角色定位通常是短语（如"师父""徒弟""主角"），设定列才是长描述；
      // 当定位列就是长描述（>20 字）时，把它整个作为 appearance
      if (role.length > 20 && !appearance) {
        chars.push(makeChar(name, '', role));
      } else {
        chars.push(makeChar(name, role, appearance));
      }
    }
    if (chars.length) return chars.slice(0, 12);
  }

  // 列表格式：每行一个角色
  for (const line of lines.slice(0, 20)) {
    // 支持 "角色名｜定位｜外貌" / "角色名: 定位" / "角色名（定位）" / "角色名 - 定位"
    const cleaned = line.replace(/^[-*•·]\s*/, '').replace(/^【|】$/g, '').trim();
    if (!cleaned || cleaned.length < 2) continue;
    // 遇到明显非角色行（分集标记）就停
    if (/^第\s*\d+\s*[集章节]/.test(cleaned)) break;
    const parts = cleaned.split(/[｜|]/).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) {
      chars.push(makeChar(parts[0], parts[1], parts.slice(2).join('，')));
      continue;
    }
    // 括号格式：名字（定位）
    const paren = cleaned.match(/^([^\s（(：:]+)\s*[（(]\s*([^）)]+)[）)]\s*(.*)$/);
    if (paren) {
      chars.push(makeChar(paren[1].trim(), paren[2].trim(), paren[3].trim()));
      continue;
    }
    // 冒号格式：名字：定位
    const colon = cleaned.match(/^([^：:]{1,12})[：:]\s*(.+)$/);
    if (colon) {
      chars.push(makeChar(colon[1].trim(), colon[2].trim(), ''));
      continue;
    }
    // 纯名字行（长度合理且不像正文）
    if (cleaned.length <= 8 && !/[，。！？]/.test(cleaned)) {
      chars.push(makeChar(cleaned, '', ''));
    }
  }
  return chars.slice(0, 12);
}

function splitCells(line: string): string[] {
  // 同时支持 markdown | 分隔 和 制表符分隔
  if (line.includes('\t') && !line.includes('|')) {
    return line.split('\t').map((c) => c.trim());
  }
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

function makeChar(name: string, role: string, appearance: string): Character {
  return {
    id: 'char_' + Math.random().toString(36).slice(2, 10),
    name: name || '未命名',
    role: role || '配角',
    appearance: appearance || '',
    voice: '',
  } satisfies Character;
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

/**
 * 将剧本文本按集拆分。兼容多种常见写法：
 *  - # 第1集 / ## 第1集 / 第1集 / 第一集 / 第1章 / 第01集：标题 / 第1集 标题
 *  - 排除"结尾字幕""预告""番外"等非正文（通过排除词）
 * 返回 [{ title, body }]，若无法识别任何集标记则返回 [{ title: '第1集', body: 全文 }]
 */
export function splitEpisodesByText(script: string): { title: string; body: string }[] {
  const cn = '零一二三四五六七八九十百';
  // 匹配集/章/节标记，序号可以是阿拉伯数字或中文数字
  const re = new RegExp(
    '(?:^|\\n)\\s*(?:#{1,3}\\s*)?' +
    '第\\s*([0-9]+|[' + cn + ']+)\\s*' +
    '([集章节])' +
    '(?:\\s*[：:－-]?\\s*([^\\n]{0,40}))?',
    'g'
  );
  const parts: { title: string; body: string }[] = [];
  let lastIdx = 0;
  let lastTitle = '';
  let lastHeaderEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script))) {
    const full = m[0];
    // 排除非正剧集：结尾字幕/预告/番外/花絮/彩蛋
    const ctx = full + (script.slice(m.index, m.index + 60));
    if (/(结尾字幕|预告|番外|花絮|彩蛋|简介|简介|梗概|概要|剧情介绍)/.test(ctx)) continue;
    if (lastTitle) {
      parts.push({ title: lastTitle, body: script.slice(lastHeaderEnd, m.index).trim() });
    } else {
      // 第一集之前的内容（角色表、设定等）作为"前言"，单独存为第0段（可选）
      const preface = script.slice(0, m.index).trim();
      if (preface.length > 20) parts.push({ title: '前言', body: preface });
    }
    lastTitle = buildEpTitle(m[1], m[2], m[3]);
    lastHeaderEnd = m.index + full.length;
  }
  if (lastTitle) parts.push({ title: lastTitle, body: script.slice(lastHeaderEnd).trim() });
  if (!parts.length) parts.push({ title: '第1集', body: script.trim() });
  return parts;
}

function buildEpTitle(num: string, unit: string, subtitle?: string): string {
  return '第' + (num || '1') + (unit || '集') + (subtitle ? ' ' + subtitle.trim() : '');
}
