import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { createStorage, Repo } from './store/repo.js';
import { AssetFiles } from './store/assets.js';
import { ProviderRegistry } from './providers/registry.js';
import { JobQueue } from './jobs/queue.js';
import { Pipeline } from './pipeline/pipeline.js';
import { projectRoutes } from './routes/projects.js';
import { configRoutes } from './routes/config.js';
import { mediaRoutes } from './routes/media.js';
import { costRoutes } from './routes/costs.js';
import { mergeRoutes } from './routes/merge.js';

export async function buildServer() {
  const here = dirname(fileURLToPath(import.meta.url));
  // here = apps/server/{src|dist}；上溯三级到 monorepo 根目录
  const root = resolve(here, '..', '..', '..');
  const dataDir = process.env.DRAMAFORGE_DATA
    ? resolve(process.env.DRAMAFORGE_DATA)
    : resolve(root, 'data');
  const webDist = resolve(root, 'apps/web/dist');

  const storage = createStorage(dataDir);
  const repo = new Repo(storage);
  await repo.init();

  const registry = new ProviderRegistry(repo.getProviders());
  const queue = new JobQueue(repo);
  const assets = new AssetFiles(dataDir);
  const pipeline = new Pipeline(repo, registry, queue, assets, dataDir);
  pipeline.registerSteps();
  queue.start();

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));
  projectRoutes(app, repo, pipeline);
  configRoutes(app, repo, registry);
  mediaRoutes(app, repo, assets, dataDir);
  costRoutes(app, repo);
  mergeRoutes(app, repo, dataDir);

  // 资源：远端 url 直接返回；本地 data: 由前端处理
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: '未找到' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
