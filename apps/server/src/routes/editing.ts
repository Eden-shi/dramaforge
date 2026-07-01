import type { FastifyInstance } from 'fastify';
import type { Project } from '@dramaforge/shared';
import type { Repo } from '../store/repo.js';
import { newId } from '../store/repo.js';
import { parseCharacters, splitEpisodesByText } from '../prompt/templates.js';

/**
 * 编辑类路由：角色 / 分集 / 分镜 CRUD、重新解析剧本、项目配置。
 * 与 projects.ts 的生成类路由分离，职责清晰。
 */
export function editingRoutes(app: FastifyInstance, repo: Repo) {
  // ---------- A1 重新解析剧本 ----------
  // 把项目当前所有分集正文拼回全文，用新解析逻辑重新拆集 + 重新抽角色
  app.post('/api/projects/:id/reparse', async (req, reply) => {
    const id = (req.params as any).id;
    const project = repo.getProject(id);
    if (!project) return reply.code(404).send({ error: '项目不存在' });
    const eps = repo.episodesByProject(id);
    // 把各集正文拼回（含前言），以便角色段能被识别
    const full = eps.map((e) => `# ${e.title}\n${e.script}`).join('\n\n');
    // 先抽角色（基于全文）
    const characters = parseCharacters(full);
    if (characters.length) project.characters = characters;
    // 重新拆集：删除旧分集，按 splitEpisodesByText 重建
    // 注意：要保留旧分集的 id？为了简单，重新生成 id，同时清理对应分镜/资产引用
    const parsed = splitEpisodesByText(full);
    // 过滤"前言"：前言不占集位
    const realEps = parsed.filter((p) => {
      // 前言、剧名标题、纯元信息段不计入集数
      if (/^前言/.test(p.title)) return false;
      if (/^(题材|集数|核心设定|剧情简介|故事梗概)[：:]/m.test(p.body)) return false;
      if (/《[^》]+》[\s\n]*$/.test(p.title)) return false; // "第N集 《剧名》" 这种纯剧名标题
      return true;
    });
    // 清旧分集的分镜
    for (const old of eps) repo.replaceShots(old.id, []);
    // 删旧分集：直接操作 repo——repo 没有删除分集方法，这里用 upsert 重写整组
    // 采用：先标记，再用 repo 内部能力。为避免新增 repo 方法过多，这里通过 replaceEpisodes。
    repo.replaceEpisodes(id, realEps.map((p, i) => ({
      id: newId('ep_'),
      projectId: id,
      index: i + 1,
      title: p.title,
      synopsis: '',
      script: p.body,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })));
    project.status = 'scripted';
    repo.upsertProject(project);
    await repo.flush();
    return { ok: true, characters: (repo.getProject(id)?.characters ?? []).length, episodes: realEps.length };
  });

  // ---------- B3/D1 项目配置 ----------
  app.put('/api/projects/:id/config', async (req, reply) => {
    const id = (req.params as any).id;
    const project = repo.getProject(id);
    if (!project) return reply.code(404).send({ error: '项目不存在' });
    const body = req.body as Partial<Project['config']>;
    project.config = { ...project.config, ...body };
    repo.upsertProject(project);
    await repo.flush();
    return { ok: true, config: project.config };
  });

  // ---------- A2 角色 CRUD ----------
  app.post('/api/projects/:id/characters', async (req, reply) => {
    const id = (req.params as any).id;
    const project = repo.getProject(id);
    if (!project) return reply.code(404).send({ error: '项目不存在' });
    const body = req.body as any;
    const c = {
      id: newId('char_'),
      name: String(body.name ?? '未命名'),
      role: String(body.role ?? '配角'),
      appearance: String(body.appearance ?? ''),
      voice: String(body.voice ?? ''),
      refAssetId: null,
    };
    project.characters.push(c);
    repo.upsertProject(project);
    await repo.flush();
    reply.code(201);
    return c;
  });

  app.put('/api/projects/:id/characters/:charId', async (req, reply) => {
    const { id, charId } = req.params as any;
    const project = repo.getProject(id);
    if (!project) return reply.code(404).send({ error: '项目不存在' });
    const c = project.characters.find((x) => x.id === charId);
    if (!c) return reply.code(404).send({ error: '角色不存在' });
    const body = req.body as any;
    if (body.name !== undefined) c.name = String(body.name);
    if (body.role !== undefined) c.role = String(body.role);
    if (body.appearance !== undefined) c.appearance = String(body.appearance);
    if (body.voice !== undefined) c.voice = String(body.voice);
    if (body.refAssetId !== undefined) c.refAssetId = body.refAssetId;
    repo.upsertProject(project);
    await repo.flush();
    return { ok: true };
  });

  app.delete('/api/projects/:id/characters/:charId', async (req, reply) => {
    const { id, charId } = req.params as any;
    const project = repo.getProject(id);
    if (!project) return reply.code(404).send({ error: '项目不存在' });
    project.characters = project.characters.filter((x) => x.id !== charId);
    repo.upsertProject(project);
    await repo.flush();
    reply.code(204);
  });

  // ---------- A3 分集 CRUD ----------
  app.post('/api/projects/:id/episodes', async (req, reply) => {
    const id = (req.params as any).id;
    const project = repo.getProject(id);
    if (!project) return reply.code(404).send({ error: '项目不存在' });
    const eps = repo.episodesByProject(id);
    const body = req.body as any;
    const ep = {
      id: newId('ep_'),
      projectId: id,
      index: eps.length + 1,
      title: String(body.title ?? `第${eps.length + 1}集`),
      synopsis: '',
      script: String(body.script ?? ''),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    repo.upsertEpisode(ep);
    await repo.flush();
    reply.code(201);
    return ep;
  });

  app.delete('/api/projects/:id/episodes/:epId', async (req, reply) => {
    const { id, epId } = req.params as any;
    const ep = repo.getEpisode(epId);
    if (!ep || ep.projectId !== id) return reply.code(404).send({ error: '分集不存在' });
    repo.deleteEpisode(epId);
    // 重排 index
    const eps = repo.episodesByProject(id);
    eps.forEach((e, i) => { e.index = i + 1; repo.upsertEpisode(e); });
    await repo.flush();
    reply.code(204);
  });

  // 分集排序：传 episodeId 顺序数组
  app.post('/api/projects/:id/episodes/reorder', async (req, reply) => {
    const id = (req.params as any).id;
    const order = (req.body as any).order as string[];
    if (!Array.isArray(order)) return reply.code(400).send({ error: '需要 order 数组' });
    order.forEach((epId, i) => {
      const e = repo.getEpisode(epId);
      if (e && e.projectId === id) { e.index = i + 1; repo.upsertEpisode(e); }
    });
    await repo.flush();
    return { ok: true };
  });

  // ---------- A4 分镜 CRUD ----------
  app.put('/api/projects/:id/shots/:shotId', async (req, reply) => {
    const { id, shotId } = req.params as any;
    const body = req.body as any;
    const allShots = repo.shotsByProject(id);
    const s = allShots.find((x) => x.id === shotId);
    if (!s) return reply.code(404).send({ error: '分镜不存在' });
    for (const k of ['scene', 'location', 'dialogue', 'narration', 'visualPrompt', 'camera']) {
      if (body[k] !== undefined) (s as any)[k] = String(body[k]);
    }
    if (body.durationSec !== undefined) s.durationSec = Number(body.durationSec) || s.durationSec;
    if (body.characterIds !== undefined) s.characterIds = body.characterIds;
    repo.upsertShot(s);
    await repo.flush();
    return { ok: true };
  });

  app.delete('/api/projects/:id/shots/:shotId', async (req, reply) => {
    const { id, shotId } = req.params as any;
    repo.deleteShot(shotId);
    await repo.flush();
    reply.code(204);
  });

  app.post('/api/projects/:id/episodes/:epId/shots', async (req, reply) => {
    const { id, epId } = req.params as any;
    const ep = repo.getEpisode(epId);
    if (!ep || ep.projectId !== id) return reply.code(404).send({ error: '分集不存在' });
    const shots = repo.shotsByEpisode(epId);
    const body = req.body as any;
    const s = {
      id: newId('shot_'),
      episodeId: epId,
      projectId: id,
      index: shots.length + 1,
      scene: String(body.scene ?? ''),
      location: String(body.location ?? ''),
      characterIds: body.characterIds ?? [],
      dialogue: String(body.dialogue ?? ''),
      narration: String(body.narration ?? ''),
      visualPrompt: String(body.visualPrompt ?? ''),
      camera: String(body.camera ?? '中景'),
      durationSec: Number(body.durationSec) || 5,
    };
    repo.upsertShot(s);
    await repo.flush();
    reply.code(201);
    return s;
  });
}
