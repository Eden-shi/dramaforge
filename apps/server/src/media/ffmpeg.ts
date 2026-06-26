import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';

let cached: string | null | undefined;

/**
 * 定位 ffmpeg。优先级：
 * 1) 项目内置 tools/ffmpeg(.exe)
 * 2) PATH 中的 ffmpeg
 * 3) 常见内置位置（剪映 / Blender 等自带的 ffmpeg）
 */
export function findFfmpeg(): string | null {
  if (cached !== undefined) return cached;
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const here = new URL('.', import.meta.url);
  const projTools = new URL(`../../tools/${exe}`, here);
  const cands: string[] = [fileUrlToPath(projTools)];
  const inPath = which(exe);
  if (inPath) cands.push(inPath);
  cands.push(...bundledCandidates());
  cached = cands.find((p) => existsSync(p)) ?? null;
  return cached;
}

/** 若不存在则抛出友好错误（含获取指引） */
export function requireFfmpeg(): string {
  const f = findFfmpeg();
  if (f) return f;
  throw new Error(
    '未找到 ffmpeg。请将 ffmpeg.exe 放入 dramaforge/tools/ 目录，或加入系统 PATH，或安装剪映（自带 ffmpeg）。',
  );
}

/** 运行 ffmpeg，传参数组；解析 stderr 的总时长（秒）与最后时间戳。 */
export async function runFfmpeg(
  bin: string,
  args: string[],
  opts: { logTag?: string } = {},
): Promise<{ durationSec?: number; code: number }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    p.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) {
        const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-8).join(' | ');
        return reject(new Error(`ffmpeg 退出码 ${code}${opts.logTag ? `（${opts.logTag}）` : ''}: ${tail}`));
      }
      resolve({ durationSec: parseDuration(stderr), code: 0 });
    });
  });
}

/** 用「解码到 null」的方式探测媒体时长（无需 ffprobe） */
export async function probeDuration(bin: string, file: string): Promise<number | undefined> {
  try {
    const r = await runFfmpeg(bin, ['-hide_banner', '-i', file, '-f', 'null', '-'], {
      logTag: 'probe',
    });
    return r.durationSec;
  } catch {
    return undefined;
  }
}

/** 从 ffmpeg stderr 末尾 time= 取时长 */
function parseDuration(stderr: string): number | undefined {
  const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function fileUrlToPath(u: URL): string {
  return process.platform === 'win32' ? u.pathname.replace(/^\//, '').replace(/\//g, '\\') : u.pathname;
}

function which(exe: string): string | null {
  try {
    const r =
      process.platform === 'win32'
        ? spawnSync('where', [exe], { windowsHide: true })
        : spawnSync('which', [exe]);
    if (r.status === 0) {
 const out = r.stdout.toString().split(/\r?\n/).filter(Boolean)[0];
      return out || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 常见内置 ffmpeg 位置（剪映 / Blender / OBS 等） */
function bundledCandidates(): string[] {
  if (process.platform !== 'win32') return [];
  const home = homedir();
  const out: string[] = [];
  const la = `${home}\\AppData\\Local`;
  // 剪映：版本号目录会变，扫描一层
  const jy = `${la}\\JianyingPro\\Apps`;
  if (existsSync(jy)) {
    try {
      for (const v of readdirSync(jy)) {
        const p = `${jy}\\${v}\\ffmpeg.exe`;
        if (existsSync(p)) out.push(p);
      }
    } catch {
      /* ignore */
    }
  }
  out.push(`${la}\\Programs\\Blender\\ffmpeg.exe`);
  out.push(`${la}\\obs-studio\\bin\\64bit\\ffmpeg.exe`);
  return out;
}

/** 选择可用的 H.264 硬件/软件编码器（硬件优先，回退软件） */
let encCache: string | null | undefined;
export async function pickH264Encoder(bin: string): Promise<string> {
  if (encCache !== undefined) return encCache as string;
  const order = ['h264_qsv', 'h264_amf', 'h264_nvenc', 'h264_mf', 'mpeg4'];
  for (const enc of order) {
    try {
      await runFfmpeg(bin, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=black:s=160x160:d=1',
        '-frames:v', '5', '-c:v', enc, '-f', 'null', '-',
      ]);
      encCache = enc;
      return enc;
    } catch {
      /* 尝试下一个 */
    }
  }
  encCache = 'mpeg4';
  return 'mpeg4';
}
