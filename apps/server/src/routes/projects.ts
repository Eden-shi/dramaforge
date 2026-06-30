import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Project } from '@dramaforge/shared';
import { newId, type Repo } from '../store/repo.js';
import { parseCharacters } from '../prompt/templates.js';
import { splitEpisodesByText } from '../prompt/templates.js';
import { Pipeline } from '../pipeline/pipeline.js';
import { streamSse } from './sse.js';

const createProject = z.object({
  title: z.string().min(1),
  topic: z.string().min(1),
  genre: z.string().optional(),
  audience: z.string().optional(),
  tone: z.string().optional(),
  episodeCount: z.number().int().min(1).max(30).default(3),
  scriptBody: z.string().optional(),
});

export function projectRoutes(
  app: FastifyInstance,
  repo: Repo,
  pipeline: Pipeline,
) {
  app.get('/api/projects', async () => repo.listProjects());

  app.post('/api/projects', async (req, reply) => {
    const body = createProject.parse(req.body);
    const now = Date.now();
    const project: Project = {
      id: newId('proj_'),
      title: body.title,
      topic: body.topic,
      genre: body.genre ?? '',
      audience: body.audience ?? '',
      tone: body.tone ?? '',
      episodeCount: body.episodeCount,
      status: 'draft',
      characters: [],
      config: { shotDurationSec: 5, resolution: '1080x1920' },
      createdAt: now,
      updatedAt: now,
    };
    repo.upsertProject(project);

    // 手动剧本：直接解析并保存
    if (body.scriptBody?.trim()) {
      const characters = parseCharacters(body.scriptBody);
      project.characters = characters.length ? characters : project.characters;
      project.status = 'scripted';
      repo.upsertProject(project);

      const episodes = splitEpisodesByText(body.scriptBody);
      episodes.forEach(({ title, body: script }, i) => {
        repo.upsertEpisode({
          id: newId('ep_'),
          projectId: project.id,
          index: i + 1,
          title: title || `第${i + 1}集`,
          synopsis: '',
          script,
          createdAt: now,
          updatedAt: now,
        });
      });
    }

    await repo.flush();
    reply.code(201);
    return project;
  });

  app.get('/api/projects/:id', async (req, reply) => {
    const p = repo.getProject((req.params as any).id);
    if (!p) return reply.code(404).send({ error: '项目不存在' });
    return {
      project: p,
      episodes: repo.episodesByProject(p.id),
      shots: repo.shotsByProject(p.id),
      assets: repo.assetsByProject(p.id),
    };
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    repo.deleteProject((req.params as any).id);
    await repo.flush();
    reply.code(204);
  });

  // 流式生成剧本
  app.post('/api/projects/:id/generate-script', async (req, reply) => {
    const id = (req.params as any).id;
    if (!repo.getProject(id)) return reply.code(404).send({ error: '项目不存在' });
    return streamSse(reply, async (send) => {
      try {
        for await (const delta of pipeline.streamScript(id)) await send({ type: 'delta', text: delta });
        await send({ type: 'done' });
      } catch (e: any) {
        await send({ type: 'error', error: e?.message ?? String(e) });
      }
    });
  });

  // 手动更新剧本
  app.put('/api/projects/:id/episodes/:episodeId/script', async (req, reply) => {
    const { id, episodeId } = req.params as any;
    const ep = repo.getEpisode(episodeId);
    if (!ep || ep.projectId !== id) return reply.code(404).send({ error: '剧集不存在' });
    const { script } = req.body as { script: string };
    if (script == null) return reply.code(400).send({ error: 'script 是必须项' });
    ep.script = script;
    ep.updatedAt = Date.now();
    repo.upsertEpisode(ep);
    repo.replaceShots(episodeId, []);
    const project = repo.getProject(id);
    if (project && project.status !== 'draft' && project.status !== 'scripted') {
      project.status = 'scripted';
      repo.upsertProject(project);
    }
    await repo.flush();
    return { ok: true };
  });

  // 异步生成分镜
  app.post('/api/projects/:id/generate-storyboard', async (req, reply) => {
    const id = (req.params as any).id;
    const episodeId = String((req.body as any)?.episodeId ?? '');
    const ep = repo.getEpisode(episodeId);
    if (!ep || ep.projectId !== id) return reply.code(400).send({ error: '需要有效的 episodeId' });
    const job = repo.upsertJob({
      id: newId('job_'),
      type: 'generate_storyboard',
      status: 'queued',
      projectId: id,
      payload: { episodeId },
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any);
    await repo.flush();
    return job;
  });
}

