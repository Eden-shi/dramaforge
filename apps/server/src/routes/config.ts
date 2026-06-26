import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ProviderRegistry } from '../providers/registry.js';
import { newId, type Repo } from '../store/repo.js';

const setProvider = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
});

export function configRoutes(app: FastifyInstance, repo: Repo, registry: ProviderRegistry) {
  app.get('/api/providers', async () => registry.list());

  app.put('/api/providers/:id', async (req, reply) => {
    const id = (req.params as any).id;
    const body = setProvider.parse(req.body);
    const info = registry.configure(id, body);
    if (!info) return reply.code(404).send({ error: '未知 Provider' });
    repo.setProviders(registry.exportAll());
    await repo.flush();
    return info;
  });

  app.get('/api/jobs', async (req) => repo.listJobs((req.query as any).projectId));
  app.get('/api/jobs/:id', async (req, reply) => {
    const job = repo.getJob((req.params as any).id);
    if (!job) return reply.code(404).send({ error: '任务不存在' });
    return job;
  });

  // 触发整集图片生成（异步）
  app.post('/api/projects/:id/generate-images', async (req, reply) => {
    const id = (req.params as any).id;
    if (!repo.getProject(id)) return reply.code(404).send({ error: '项目不存在' });
    const episodeId = (req.body as any)?.episodeId as string | undefined;
    const payload: Record<string, unknown> = { projectId: id };
    if (episodeId) payload.episodeId = episodeId;
    const job = repo.upsertJob({
      id: newId('job_'),
      type: 'generate_image',
      status: 'queued',
      projectId: id,
      payload,
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any);
    await repo.flush();
    return job;
  });
}
