import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Asset } from '@dramaforge/shared';

/**
 * 资源文件管理：把远端 URL 或 data: URI 落盘到本地文件，供 ffmpeg/合成消费。
 * 按 projectId 隔离目录；按 assetId.ext 缓存，避免重复下载。
 */
export class AssetFiles {
  constructor(private rootDir: string) {}

  projectDir(projectId: string): string {
    return join(this.rootDir, 'assets', projectId);
  }

  /** 保存二进制为本地文件，返回绝对路径 */
  async save(projectId: string, assetId: string, ext: string, buf: Buffer): Promise<string> {
    const dir = this.projectDir(projectId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${assetId}.${ext}`);
    await writeFile(path, buf);
    return path;
  }

  /** 把 asset.url（data: 或 http(s)）物化为本地文件，返回绝对路径；已存在则直接返回 */
  async materialize(a: Asset): Promise<string | null> {
    if (!a.url) return null;
    const ext = guessExt(a);
    const target = join(this.projectDir(a.projectId), `${a.id}.${ext}`);
    if (existsSync(target)) return target;
    await mkdir(this.projectDir(a.projectId), { recursive: true });
    let buf: Buffer;
    if (a.url.startsWith('data:')) {
      buf = Buffer.from(a.url.split(',')[1] ?? '', 'base64');
    } else if (/^https?:\/\//.test(a.url)) {
      const resp = await fetch(a.url);
      if (!resp.ok) throw new Error(`下载资源失败 ${resp.status}: ${a.url}`);
      buf = Buffer.from(await resp.arrayBuffer());
    } else {
      return null;
    }
    await writeFile(target, buf);
    return target;
  }

  /** 读取本地文件为 Buffer（用于 mp4 等结果回传/服务） */
  async read(a: Asset): Promise<Buffer | null> {
    const p = await this.localPath(a);
    if (!p || !existsSync(p)) return null;
    return readFile(p);
  }

  async localPath(a: Asset): Promise<string | null> {
    if (!a.url) return null;
    const ext = guessExt(a);
    const p = join(this.projectDir(a.projectId), `${a.id}.${ext}`);
    return existsSync(p) ? p : null;
  }
}

function guessExt(a: Asset): string {
  if (a.kind === 'video') return 'mp4';
  if (a.kind === 'audio') return 'mp3';
  if (a.kind === 'image') return 'png';
  return 'bin';
}
