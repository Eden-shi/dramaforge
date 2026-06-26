// Mock 媒体 Provider：无 API Key 时用 ffmpeg 合成占位素材，
// 使整条链路（图→视频→配音→合成）可在零 Key 下端到端跑通与验证。

import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ImageOptions,
  ImageProvider,
  ImageResult,
  TTSProvider,
  TtsResult,
  VideoProvider,
  VideoTaskResult,
  VideoOptions,
} from './base.js';
import { pickH264Encoder, runFfmpeg } from '../media/ffmpeg.js';

let SEQ = 0;

export class MockImageProvider implements ImageProvider {
  type = 'image' as const;
  constructor(private ffmpeg: string, private dir: string) {}
  async textToImage(prompt: string, opts?: ImageOptions): Promise<ImageResult> {
    await mkdir(this.dir, { recursive: true });
    const n = ++SEQ;
    // 用 0xRRGGBB 十六进制色（该 ffmpeg 不支持 hsl() 表达式）
    const hex = `0x${((n * 47 + 30) * 0x9e3779b1 % 0xffffff & 0xffffff).toString(16).padStart(6, '0')}`;
    const file = join(this.dir, `mock_img_${n}.png`);
    // 无 drawtext 的 ffmpeg：用纯色背景 + 半透明叠加表达“分镜占位”
    await runFfmpeg(this.ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=${hex}:s=${opts?.width ?? 1080}x${opts?.height ?? 1920}:d=1`,
      '-frames:v', '1', '-update', '1', file,
    ], { logTag: 'mock-image' });
    // 读取为 data URI 返回（与真实 provider 返回 url 形态一致）
    const { readFile } = await import('node:fs/promises');
    const b64 = (await readFile(file)).toString('base64');
    await unlink(file).catch(() => {});
    return { url: `data:image/png;base64,${b64}`, width: opts?.width, height: opts?.height };
  }
}

export class MockVideoProvider implements VideoProvider {
  type = 'video' as const;
  constructor(private ffmpeg: string, private dir: string) {}
  async submit(opts: VideoOptions): Promise<VideoTaskResult> {
    const n = ++SEQ;
    const enc = await pickH264Encoder(this.ffmpeg);
    const out = join(this.dir, `mock_video_${n}.mp4`);
    await mkdir(this.dir, { recursive: true });
    const dur = Math.max(1, Math.round(opts.durationSec ?? 5));
    const color = `0x${(n * 222771 % 0xffffff).toString(16).padStart(6, '0')}`;
    // 若提供了参考图，则以其为画面（图生视频）；否则用纯色
    const input = await this.imageInput(opts.imageUrl);
    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    if (input) {
      args.push('-loop', '1', '-i', input, '-t', String(dur), '-r', '24');
    } else {
      args.push('-f', 'lavfi', '-i', `color=c=${color}:s=540x960:r=24:d=${dur}`);
    }
    args.push('-f', 'lavfi', '-i', `sine=f=${330 + (n % 5) * 110}:d=${dur}`);
    args.push('-c:v', enc, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', out);
    await runFfmpeg(this.ffmpeg, args, { logTag: 'mock-video' });
    // 读取为 data URI 作为 url 返回（与真实 provider 提交后取回的 url 形态一致）
    const { readFile } = await import('node:fs/promises');
    const b64 = (await readFile(out)).toString('base64');
    return { taskId: `mock_${n}`, status: 'succeeded', url: `data:video/mp4;base64,${b64}`, durationSec: dur };
  }
  async fetch(taskId: string): Promise<VideoTaskResult> {
    // mock 直接同步完成；fetch 仅回放已完成状态
    return { taskId, status: 'succeeded' };
  }
  private async imageInput(url?: string): Promise<string | null> {
    if (!url || !url.startsWith('data:')) return null;
    const n = ++SEQ;
    const file = join(this.dir, `mock_ref_${n}.png`);
    await mkdir(this.dir, { recursive: true });
    await writeFile(file, Buffer.from(url.split(',')[1] ?? '', 'base64'));
    return file;
  }
}

export class MockTTSProvider implements TTSProvider {
  type = 'tts' as const;
  constructor(private ffmpeg: string, private dir: string) {}
  async synthesize(text: string): Promise<TtsResult> {
    const n = ++SEQ;
    const out = join(this.dir, `mock_tts_${n}.mp3`);
    await mkdir(this.dir, { recursive: true });
    // 用文本长度估算配音时长（≈ 每字 0.28s），生成等长音调占位；统一 AAC/m4a
    const dur = Math.max(1, Math.min(60, Math.round((text?.length ?? 8) * 0.28)));
    const m4a = out.replace(/\.mp3$/, '.m4a');
    await runFfmpeg(this.ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `sine=f=${300 + (n % 7) * 60}:d=${dur}`,
      '-c:a', 'aac', '-b:a', '96k', m4a,
    ], { logTag: 'mock-tts' });
    const { readFile } = await import('node:fs/promises');
    const b64 = (await readFile(m4a)).toString('base64');
    await unlink(m4a).catch(() => {});
    return { url: `data:audio/mp4;base64,${b64}`, durationSec: dur };
  }
}
