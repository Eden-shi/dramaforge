import { nanoid } from 'nanoid';
import type {
  Asset,
  Episode,
  Job,
  Project,
  ProviderConfig,
  Shot,
} from '@dramaforge/shared';
import { JsonStorage, type DBShape, type Storage } from './storage.js';

export class Repo {
  private data: DBShape;
  private dirty = false;

  constructor(private storage: Storage) {
    this.data = {
      projects: [],
      episodes: [],
      shots: [],
      assets: [],
      jobs: [],
      providers: [],
    };
  }

  async init() {
    this.data = await this.storage.load();
  }

  markDirty() {
    this.dirty = true;
  }

  async flush() {
    if (!this.dirty) return;
    await this.storage.save(this.data);
    await this.storage.saveProviders(this.data.providers);
    this.dirty = false;
  }

  // ---- projects ----
  listProjects(): Project[] {
    return [...this.data.projects].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  getProject(id: string): Project | undefined {
    return this.data.projects.find((p) => p.id === id);
  }
  upsertProject(p: Project) {
    const i = this.data.projects.findIndex((x) => x.id === p.id);
    p.updatedAt = Date.now();
    if (i >= 0) this.data.projects[i] = p;
    else this.data.projects.push(p);
    this.markDirty();
    return p;
  }
  deleteProject(id: string) {
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    this.data.episodes = this.data.episodes.filter((e) => e.projectId !== id);
    this.data.shots = this.data.shots.filter((s) => s.projectId !== id);
    this.data.assets = this.data.assets.filter((a) => a.projectId !== id);
    this.markDirty();
  }

  // ---- episodes ----
  episodesByProject(projectId: string): Episode[] {
    return this.data.episodes
      .filter((e) => e.projectId === projectId)
      .sort((a, b) => a.index - b.index);
  }
  getEpisode(id: string) {
    return this.data.episodes.find((e) => e.id === id);
  }
  upsertEpisode(e: Episode) {
    const i = this.data.episodes.findIndex((x) => x.id === e.id);
    e.updatedAt = Date.now();
    if (i >= 0) this.data.episodes[i] = e;
    else this.data.episodes.push(e);
    this.markDirty();
    return e;
  }
  /** 用新数组整体替换某项目的全部分集（旧分集会被删除） */
  replaceEpisodes(projectId: string, episodes: Episode[]) {
    this.data.episodes = this.data.episodes.filter((e) => e.projectId !== projectId);
    this.data.episodes.push(...episodes);
    this.markDirty();
  }
  deleteEpisode(id: string) {
    this.data.episodes = this.data.episodes.filter((e) => e.id !== id);
    // 级联删除该集的分镜
    this.data.shots = this.data.shots.filter((s) => s.episodeId !== id);
    this.markDirty();
  }

  // ---- shots ----
  shotsByEpisode(episodeId: string): Shot[] {
    return this.data.shots
      .filter((s) => s.episodeId === episodeId)
      .sort((a, b) => a.index - b.index);
  }
  shotsByProject(projectId: string): Shot[] {
    return this.data.shots
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => a.index - b.index);
  }
  replaceShots(episodeId: string, shots: Shot[]) {
    this.data.shots = this.data.shots.filter((s) => s.episodeId !== episodeId);
    this.data.shots.push(...shots);
    this.markDirty();
  }
  upsertShot(s: Shot) {
    const i = this.data.shots.findIndex((x) => x.id === s.id);
    if (i >= 0) this.data.shots[i] = s;
    else this.data.shots.push(s);
    this.markDirty();
    return s;
  }
  deleteShot(id: string) {
    this.data.shots = this.data.shots.filter((s) => s.id !== id);
    this.markDirty();
  }

  // ---- assets ----
  assetsByProject(projectId: string): Asset[] {
    return this.data.assets.filter((a) => a.projectId === projectId);
  }
  upsertAsset(a: Asset) {
    const i = this.data.assets.findIndex((x) => x.id === a.id);
    a.updatedAt = Date.now();
    if (i >= 0) this.data.assets[i] = a;
    else this.data.assets.push(a);
    this.markDirty();
    return a;
  }

  // ---- jobs ----
  listJobs(projectId?: string): Job[] {
    return (projectId ? this.data.jobs.filter((j) => j.projectId === projectId) : this.data.jobs)
      .slice(-100)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  getJob(id: string) {
    return this.data.jobs.find((j) => j.id === id);
  }
  upsertJob(j: Job) {
    const i = this.data.jobs.findIndex((x) => x.id === j.id);
    j.updatedAt = Date.now();
    if (i >= 0) this.data.jobs[i] = j;
    else this.data.jobs.push(j);
    this.markDirty();
    return j;
  }

  // ---- providers ----
  getProviders(): ProviderConfig[] {
    return this.data.providers;
  }
  setProviders(p: ProviderConfig[]) {
    this.data.providers = p;
    this.markDirty();
  }
}

export function newId(prefix = '') {
  return prefix + nanoid(12);
}

export function createStorage(dir: string): Storage {
  return new JsonStorage(dir);
}
