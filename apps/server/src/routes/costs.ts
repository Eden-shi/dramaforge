import type { FastifyInstance } from 'fastify';
import type { CostItem, CostSummary } from '@dramaforge/shared';
import { costSummary } from '@dramaforge/shared';
import type { Repo } from '../store/repo.js';

/** 费用汇总路由：汇总项目/单集所有已完成 job 的 costs */
export function costRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/api/projects/:id/costs', async (req, reply) => {
    const id = (req.params as any).id;
    if (!repo.getProject(id)) return reply.code(404).send({ error: '项目不存在' });
    return buildCosts(repo, id);
  });

  app.get('/api/projects/:id/episodes/:eid/costs', async (req, reply) => {
    const id = (req.params as any).id;
    const eid = (req.params as any).eid;
    if (!repo.getProject(id)) return reply.code(404).send({ error: '项目不存在' });
    return buildCosts(repo, id, eid);
  });
}

function buildCosts(repo: Repo, projectId: string, episodeId?: string): CostSummary {
  const jobs = repo.listJobs(projectId).filter((j) => j.status === 'done' && j.result?.costs);
  const all: CostItem[] = [];
  for (const j of jobs) {
    // 如果请求了 episodeId 过滤，则只取匹配 ep 的 job
    if (episodeId && j.payload?.episodeId !== episodeId) continue;
    const items = (j.result?.costs as CostItem[] | undefined) ?? [];
    all.push(...items);
  }
  return costSummary(all);
}
