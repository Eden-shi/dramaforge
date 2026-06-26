import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId, type Repo } from '../store/repo.js';
import { findFfmpeg, pickH264Encoder, requireFfmpeg, runFfmpeg, probeDuration } from '../media/ffmpeg.js';

/** 多集合并路由：将所有单集成片 concat 为完整剧集 mp4 */
export function mergeRoutes(app: FastifyInstance, repo: Repo, dataDir: string) {
  app.post('/api/projects/:id/merge', async (req, reply) => {
    const id = (req.params as any).id;
    const project = repo.getProject(id);
    if (!project) return reply.code(404).send({ error: '项目不存在' });
    const episodes = repo.episodesByProject(id);
    if (!episodes.length) return reply.code(400).send({ error: '项目没有剧集' });

    const ff = requireFfmpeg();
    const finals: string[] = [];
    for (const ep of episodes) {
      const fp = join(dataDir, 'compose', id, ep.id, 'final.mp4');
      if (existsSync(fp)) finals.push(fp);
    }
    if (!finals.length) return reply.code(400).send({ error: '尚无任何单集成片，先合成单集成片' });
    if (finals.length === 1) return reply.code(200).send({ message: '仅一集成片，无需合并', url: `/api/projects/${id}/media/merged` });

    const work = join(dataDir, 'compose', id, 'merge');
    await mkdir(work, { recursive: true });
    const listFile = join(work, 'list.txt');
    await writeFile(listFile, finals.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8');
    const enc = await pickH264Encoder(ff);
    const mergedPath = join(work, 'merged.mp4');
    await runFfmpeg(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', mergedPath], { logTag: 'merge' });
    const dur = await probeDuration(ff, mergedPath);
    // 注册 merge 路由
    // (merged.mp4 通过 /api/projects/:id/media/merged 提供服务，见下面)
    return { segments: finals.length, durationSec: dur, url: `/api/projects/${id}/media/merged` };
  });

  // 合并后的全剧成片服务
  app.get('/api/projects/:id/media/merged', async (req, reply) => {
    const id = (req.params as any).id;
    const fp = join(dataDir, 'compose', id, 'merge', 'merged.mp4');
    if (!existsSync(fp)) return reply.code(404).send({ error: '合并成片尚未生成，先执行 merge' });
    const size = stats(fp).size;
    const range = (req.headers as any).range as string | undefined;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Accept-Ranges', 'bytes').header('Content-Length', end - start + 1).type('video/mp4');
      return reply.send(createReadStream(fp, { start, end }));
    }
    reply.header('Accept-Ranges', 'bytes').header('Content-Length', size).type('video/mp4');
    return reply.send(createReadStream(fp));
  });
}

// 需要显式导入 statSync，但 Fastify 在 reply.header 链中
import { statSync } from 'node:fs';
const stats = statSync;
