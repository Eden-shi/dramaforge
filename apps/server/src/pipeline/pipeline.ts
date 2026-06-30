import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Asset, Character, CostItem, Episode, Job, Project, Shot } from "@dramaforge/shared";
import { estimateLlmCost, PRICING, costSummary, type CostItemKind } from "@dramaforge/shared";
import { newId, type Repo } from "../store/repo.js";
import { ProviderRegistry } from "../providers/registry.js";
import { JobQueue } from "../jobs/queue.js";
import { AssetFiles } from "../store/assets.js";
import { MockImageProvider, MockTTSProvider, MockVideoProvider } from "../providers/mock_media.js";
import { findFfmpeg, pickH264Encoder, probeDuration, requireFfmpeg, runFfmpeg } from "../media/ffmpeg.js";
import {
  parseCharacters,
  parseShots,
  scriptSystemPrompt,
  scriptUserPrompt,
  storyboardSystemPrompt,
  storyboardUserPrompt,
} from "../prompt/templates.js";
import { splitEpisodesByText } from "../prompt/templates.js";

export class Pipeline {
  constructor(
    private repo: Repo,
    private registry: ProviderRegistry,
    private queue: JobQueue,
    private assets: AssetFiles,
    private dataDir: string,
  ) {}

  registerSteps() {
    this.queue.register('generate_storyboard', (j) => this.stepStoryboard(j));
    this.queue.register('generate_image', (j) => this.stepMedia(j, 'image'));
    this.queue.register('generate_video', (j) => this.stepMedia(j, 'video'));
    this.queue.register('generate_tts', (j) => this.stepMedia(j, 'audio'));
    this.queue.register('compose_final', (j) => this.stepCompose(j));
  }

  // ---------- 剧本：流式 ----------
  async *streamScript(projectId: string): AsyncIterable<string> {
    const project = this.repo.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    const llm = this.registry.resolveLLM(project.config.llmProviderId);
    let full = '';
    const start = Date.now();
    let outTokens = 0;
    for await (const delta of llm.chatStream(
      [{ role: 'user', content: scriptUserPrompt(project) }],
      { systemPrompt: scriptSystemPrompt(project), temperature: 0.85, maxTokens: 4096 },
    )) {
      full += delta;
      outTokens += delta.length;
      yield delta;
    }
    const elapsed = Date.now() - start;
    const inTokens = Math.round(elapsed * 6);
    const characters = parseCharacters(full);
    project.characters = characters.length ? characters : project.characters;
    project.status = 'scripted';
    this.repo.upsertProject(project);
    splitEpisodesByText(full).forEach((ep, i) =>
      this.repo.upsertEpisode({
        id: newId('ep_'),
        projectId: project.id,
        index: i + 1,
        title: ep.title || `第${i + 1}集`,
        synopsis: '',
        script: ep.body,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as Episode),
    );
    await this.repo.flush();
    const cost: CostItem = {
      kind: 'llm_token_out',
      label: '剧本生成',
      cost: estimateLlmCost(inTokens, outTokens),
      tokens: inTokens + outTokens,
    };
    const last = this.repo.listJobs(projectId)[0];
    if (last) {
      last.result ??= {};
      last.result.costs = [cost];
      last.result.totalCost = costSummary([cost]).total;
      this.repo.upsertJob(last);
      await this.repo.flush();
    }
  }

  // ---------- 分镜（异步 job） ----------
  async stepStoryboard(job: Job): Promise<Record<string, unknown>> {
    const episodeId = String(job.payload.episodeId ?? '');
    const ep = this.repo.getEpisode(episodeId);
    if (!ep) throw new Error('剧集不存在');
    const project = this.repo.getProject(ep.projectId);
    if (!project) throw new Error('项目不存在');
    const llm = this.registry.resolveLLM(project.config.llmProviderId);
    const raw = await llm.chat(
      [{ role: 'user', content: storyboardUserPrompt(ep.script) }],
      { systemPrompt: storyboardSystemPrompt(), temperature: 0.6 },
    );
    const parsed = parseShots(raw);
    const projectCharacters = project.characters;
    const shots: Shot[] = parsed.map((s, i) => ({
      id: newId('shot_'),
      episodeId: ep.id,
      projectId: project.id,
      index: i + 1,
      characterIds: [],
      ...s,
    }));
    for (const s of shots) {
      const matched = projectCharacters.filter((c) =>
        s.dialogue.includes(c.name) || s.narration?.includes(c.name),
      );
      s.characterIds = matched.map((c) => c.id);
    }
    this.repo.replaceShots(ep.id, shots);
    project.status = 'storyboarded';
    this.repo.upsertProject(project);
    const cost: CostItem = {
      kind: 'llm_token_out',
      label: `分镜生成-第${ep.index}集`,
      cost: estimateLlmCost(Math.round(raw.length * 0.4), raw.length),
    };
    return {
      count: shots.length,
      costs: [cost],
      totalCost: costSummary([cost]).total,
    };
  }

  // ---------- 素材生产（图/视频/配音） ----------
  async stepMedia(job: Job, kind: Asset['kind']): Promise<Record<string, unknown>> {
    const projectId = String(job.payload.projectId ?? job.projectId);
    const project = this.repo.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    const cfg = project.config;
    const episodeId = String(job.payload.episodeId ?? '');
    const scope = episodeId
      ? this.repo.shotsByEpisode(episodeId)
      : this.repo.shotsByProject(projectId);
    const shots = scope.filter((s) => s.projectId === projectId);
    const costs: CostItem[] = [];
    let done = 0;
    for (const s of shots) {
      try {
        let a: Asset;
        if (kind === 'image') a = await this.genImage(project, s, cfg.imageProviderId);
        else if (kind === 'video') a = await this.genVideo(project, s, cfg.videoProviderId);
        else a = await this.genTts(project, s, cfg.ttsProviderId);
        await this.assets.materialize(a);
        this.repo.upsertAsset(a);
      } catch (e: any) {
        this.repo.upsertAsset(this.failAsset(projectId, s.id, 'shot', kind, '', e));
      }
      done++;
      job.progress = shots.length ? Math.round((done / shots.length) * 100) : 100;
      this.repo.upsertJob(job);
    }
    const unitPrice = PRICING[(kind === 'audio' ? 'tts' : kind === 'image' ? 'image' : 'video') as keyof typeof PRICING] ?? 0;
    const label = kind === 'image' ? '配图' : kind === 'video' ? '视频' : '配音';
    const kindName = kind === 'audio' ? 'tts' : kind;
    costs.push({ kind: kindName as CostItemKind, label, shots: shots.length, count: done, cost: done * unitPrice });
    return { done, total: shots.length, costs, totalCost: costSummary(costs).total };
  }

  // ---------- 成片合成 ----------
  async stepCompose(job: Job): Promise<Record<string, unknown>> {
    const projectId = String(job.payload.projectId ?? job.projectId);
    const episodeId = String(job.payload.episodeId ?? '');
    const project = this.repo.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    const ff = requireFfmpeg();
    const enc = await pickH264Encoder(ff);
    const shots = episodeId
      ? this.repo.shotsByEpisode(episodeId).filter((s) => s.projectId === projectId)
      : this.repo.shotsByProject(projectId);
    if (!shots.length) throw new Error('尚无分镜，无法合成成片');
    const composeKey = episodeId ? join(projectId, episodeId) : projectId;
    const work = join(this.dataDir, 'compose', composeKey);
    await mkdir(work, { recursive: true });
    const [w, h] = project.config.resolution.split('x').map((x) => Number(x) || 1080);
    const segs: string[] = [];
    const timeline: { shot: Shot; start: number; dur: number }[] = [];
    let t = 0;
    let i = 0;
    let totalDur = 0;
    for (const s of shots) {
      const videoA = this.latest(projectId, s.id, 'video');
      const imgA = this.latest(projectId, s.id, 'image');
      const audioA = this.latest(projectId, s.id, 'audio');
      const visual =
        (videoA && (await this.assets.materialize(videoA))) ||
        (imgA && (await this.assets.materialize(imgA))) ||
        null;
      const audio = audioA && (await this.assets.materialize(audioA));
      let dur = s.durationSec;
      if (audio) dur = (await probeDuration(ff, audio)) ?? s.durationSec;
      if (!visual && !audio) { i++; continue; }
      dur = Math.max(1, Math.round(dur));
      totalDur += dur;
      const seg = join(work, `seg_${String(i).padStart(3, '0')}.mp4`);
      const args = ['-y', '-hide_banner', '-loglevel', 'error'];
      if (visual) {
        if (videoA) args.push('-i', visual);
        else args.push('-loop', '1', '-i', visual, '-t', String(dur));
      } else {
        args.push('-f', 'lavfi', '-i', `color=c=0x101418:s=${w}x${h}:r=25:d=${dur}`);
      }
      if (audio) args.push('-i', audio);
      args.push('-filter:v', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25`);
      args.push('-c:v', enc, '-pix_fmt', 'yuv420p');
      if (audio) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
      args.push('-r', '25', '-t', String(dur), seg);
      await runFfmpeg(ff, args, { logTag: `compose-seg${i}` });
      segs.push(seg);
      timeline.push({ shot: s, start: t, dur });
      t += dur; i++;
      job.progress = Math.round((i / shots.length) * 90);
      this.repo.upsertJob(job);
    }
    if (!segs.length) throw new Error('没有任何可用素材');
    const listFile = join(work, 'list.txt');
    await writeFile(listFile, segs.map((p) => "file '" + p.replace(/'/g, "'\\\\''") + "'").join('\n'), 'utf-8');
    const finalPath = join(work, 'final.mp4');
    await runFfmpeg(ff, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c', 'copy', finalPath,
    ], { logTag: 'compose-concat' });
    const owner = episodeId || projectId;
    const finalAsset = this.asset(projectId, owner, 'final', project.title, '', false);
    finalAsset.ownerType = 'project';
    finalAsset.url = episodeId
      ? `/api/projects/${projectId}/episodes/${episodeId}/media/final`
      : `/api/projects/${projectId}/media/final`;
    finalAsset.providerRef = episodeId;
    finalAsset.durationSec = await probeDuration(ff, finalPath);
    this.repo.upsertAsset(finalAsset);
    await writeFile(join(work, 'subs.vtt'), buildVtt(timeline), 'utf-8');
    const parent = episodeId ? this.repo.getEpisode(episodeId) : null;
    if (parent) {
      parent.synopsis = `已合成 ${segs.length} 段, ${finalAsset.durationSec?.toFixed(1)}s`;
      this.repo.upsertEpisode(parent);
    }
    project.status = 'done';
    this.repo.upsertProject(project);
    const composeCost: CostItem = { kind: 'compose', label: '成片合成' + (episodeId ? '-第' + (parent?.index ?? '') + '集' : ''), durationSec: totalDur, cost: totalDur * PRICING.compose };
    return { segments: segs.length, durationSec: finalAsset.durationSec, encoder: enc, episodeId: episodeId || undefined, costs: [composeCost], totalCost: costSummary([composeCost]).total };
  }

  // ---------- 辅助 ----------
  private ff(): string { return requireFfmpeg(); }
  private tmpDir(projectId: string): string { return join(this.dataDir, 'work', projectId); }
  private latest(projectId: string, ownerId: string, kind: Asset['kind']): Asset | undefined {
    return this.repo
      .assetsByProject(projectId)
      .filter((a) => a.ownerType === 'shot' && a.ownerId === ownerId && a.kind === kind && a.status === 'ready')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
  }
  private asset(projectId: string, ownerId: string, kind: Asset['kind'], prompt: string, url: string, isMock: boolean): Asset {
    return { id: newId('asset_'), projectId, ownerId, ownerType: kind === 'final' ? 'project' : 'shot', kind, status: 'ready', prompt, url, providerId: isMock ? 'mock' : undefined, createdAt: Date.now(), updatedAt: Date.now() };
  }
  private failAsset(projectId: string, ownerId: string, ownerType: Asset['ownerType'], kind: Asset['kind'], prompt: string, e: unknown): Asset {
    return { id: newId('asset_'), projectId, ownerId, ownerType, kind, status: 'failed', prompt, error: (e as any)?.message ?? String(e), createdAt: Date.now(), updatedAt: Date.now() };
  }
  private characterRefImg(project: Project, s: Shot): { character: Character; url: string } | null {
    for (const cid of s.characterIds) {
      const c = project.characters.find((x) => x.id === cid);
      if (c?.refAssetId) {
        const a = this.repo.assetsByProject(project.id).find((x) => x.id === c.refAssetId && x.status === 'ready');
        if (a?.url) return { character: c, url: a.url };
      }
    }
    return null;
  }
  private enhancePrompt(project: Project, s: Shot, base: string): string {
    if (!s.characterIds.length) return base;
    const chars = project.characters.filter((c) => s.characterIds.includes(c.id));
    if (!chars.length) return base;
    const descs = chars.map((c) => c.name + '（' + c.appearance + '）').join('；');
    return base + '【角色外貌：' + descs + '】';
  }
  private async genImage(project: Project, s: Shot, providerId?: string): Promise<Asset> {
    const base = s.visualPrompt || s.scene;
    const prompt = this.enhancePrompt(project, s, base);
    const provider = this.registry.resolveImage(providerId);
    const refInfo = this.characterRefImg(project, s);
    if (provider) {
      try {
        const r = await provider.textToImage(prompt, { refImageUrl: refInfo?.url });
        return this.asset(project.id, s.id, 'image', prompt, r.url, false);
      } catch { /* fall through */ }
    }
    const mock = new MockImageProvider(this.ff(), this.tmpDir(project.id));
    const r = await mock.textToImage(prompt, { refImageUrl: refInfo?.url });
    return this.asset(project.id, s.id, 'image', prompt, r.url, true);
  }
  private async genVideo(project: Project, s: Shot, providerId?: string): Promise<Asset> {
    const base = s.visualPrompt || s.scene;
    const prompt = this.enhancePrompt(project, s, base);
    const provider = this.registry.resolveVideo(providerId);
    const refInfo = this.characterRefImg(project, s);
    if (provider) {
      try {
        const r = await provider.submit({ prompt, imageUrl: refInfo?.url, durationSec: s.durationSec });
        if (r.status === 'submitted' || r.status === 'running') {
          const polled = await this.pollVideo(provider, r.taskId);
          return this.asset(project.id, s.id, 'video', prompt, polled.url ?? '', false);
        }
        return this.asset(project.id, s.id, 'video', prompt, r.url ?? '', false);
      } catch { /* fall through */ }
    }
    const mock = new MockVideoProvider(this.ff(), this.tmpDir(project.id));
    const r = await mock.submit({ prompt, imageUrl: refInfo?.url, durationSec: s.durationSec });
    return this.asset(project.id, s.id, 'video', prompt, r.url ?? '', true);
  }
  private async genTts(project: Project, s: Shot, providerId?: string): Promise<Asset> {
    const text = [s.dialogue, s.narration].filter(Boolean).join('\n');
    if (!text.trim()) return this.failAsset(project.id, s.id, 'shot', 'audio', text, new Error('无文本'));
    const provider = this.registry.resolveTTS(providerId);
    if (provider) {
      try {
        const r = await provider.synthesize(text);
        return this.asset(project.id, s.id, 'audio', text.slice(0, 80), r.url, false);
      } catch { /* fall through */ }
    }
    const mock = new MockTTSProvider(this.ff(), this.tmpDir(project.id));
    const r = await mock.synthesize(text);
    return this.asset(project.id, s.id, 'audio', text.slice(0, 80), r.url, true);
  }
  private pollVideo(provider: { fetch(t: string): Promise<{ status: string; url?: string; durationSec?: number }> }, taskId: string) {
    return new Promise<{ url?: string; durationSec?: number }>((resolve, reject) => {
      const start = Date.now();
      const tick = async () => {
        try {
          const r = await provider.fetch(taskId);
          if (r.status.includes('succ') || r.url) return resolve({ url: r.url, durationSec: r.durationSec });
          if (r.status.includes('fail')) return reject(new Error('视频生成失败'));
        } catch (e) { return reject(e); }
        if (Date.now() - start > 6 * 60 * 1000) return reject(new Error('视频生成超时'));
        setTimeout(tick, 4000);
      };
      void tick();
    });
  }
}

function buildVtt(timeline: { shot: Shot; start: number; dur: number }[]): string {
  const lines = ['WEBVTT', ''];
  let idx = 1;
  for (const { shot, start, dur } of timeline) {
    const text = [shot.dialogue, shot.narration].filter(Boolean).join('\n');
    if (!text.trim()) continue;
    lines.push(String(idx++), vtt(start) + ' --> ' + vtt(start + dur), text, '');
  }
  return lines.join('\n');
}

function vtt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return '00:' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
}

void findFfmpeg;