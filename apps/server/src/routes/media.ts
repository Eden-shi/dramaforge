import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { newId, type Repo } from '../store/repo.js';
import type { AssetFiles } from '../store/assets.js';

type MediaJobType = 'generate_video' | 'generate_tts' | 'compose_final';

/** 媒体路由：成片/字幕服务 + 视频/配音/合成任务触发（支持单集作用域） */
export function mediaRoutes(
  app: FastifyInstance,
  repo: Repo,
  _assets: AssetFiles,
  dataDir: string,
) {
  // 项目级成片
  app.get('/api/projects/:id/media/final', async (req, reply) =>
    serveMedia(reply, join(dataDir, 'compose', (req.params as any).id), 'final.mp4', 'video/mp4'),
  );
  app.get('/api/projects/:id/media/subtitles', async (req, reply) =>
    serveMedia(reply, join(dataDir, 'compose', (req.params as any).id), 'subs.vtt', 'text/vtt; charset=utf-8'),
  );
  // 单集成片（多集场景，每集独立成片）
  app.get('/api/projects/:id/episodes/:eid/media/final', async (req, reply) =>
    serveMedia(reply, join(dataDir, 'compose', (req.params as any).id, (req.params as any).eid), 'final.mp4', 'video/mp4'),
  );
  app.get('/api/projects/:id/episodes/:eid/media/subtitles', async (req, reply) =>
    serveMedia(reply, join(dataDir, 'compose', (req.params as any).id, (req.params as any).eid), 'subs.vtt', 'text/vtt; charset=utf-8'),
  );

  // 触发：可选 episodeId（缺省则全项目分镜）
  app.post('/api/projects/:id/generate-video', async (req, reply) =>
    enqueue(repo, reply, (req.params as any).id, 'generate_video', bodyEid(req.body)),
  );
  app.post('/api/projects/:id/generate-tts', async (req, reply) =>
    enqueue(repo, reply, (req.params as any).id, 'generate_tts', bodyEid(req.body)),
  );
  app.post('/api/projects/:id/compose', async (req, reply) =>
    enqueue(repo, reply, (req.params as any).id, 'compose_final', bodyEid(req.body)),
  );
}

function bodyEid(body: unknown): string | undefined {
  const b = body as { episodeId?: string } | null;
  const v = b?.episodeId;
  return v && typeof v === 'string' ? v : undefined;
}

async function enqueue(repo: Repo, reply: any, id: string, type: MediaJobType, episodeId?: string) {
  if (!repo.getProject(id)) return reply.code(404).send({ error: '项目不存在' });
  const payload: Record<string, unknown> = { projectId: id };
  if (episodeId) payload.episodeId = episodeId;
  const job = repo.upsertJob({
    id: newId('job_'),
    type,
    status: 'queued',
    projectId: id,
    payload,
    progress: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);
  await repo.flush();
  return job;
}

async function serveMedia(reply: any, dir: string, file: string, type: string) {
  const path = join(dir, file);
  if (!existsSync(path)) return reply.code(404).send({ error: '资源尚未生成' });
  const size = statSync(path).size;
  const range = reply.request.headers.range as string | undefined;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    reply.code(206)
      .header('Content-Range', `bytes ${start}-${end}/${size}`)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', end - start + 1)
      .type(type);
    return reply.send(createReadStream(path, { start, end }));
  }
  reply.header('Accept-Ranges', 'bytes').header('Content-Length', size).type(type);
  return reply.send(createReadStream(path));
}
