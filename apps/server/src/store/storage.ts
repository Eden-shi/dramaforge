import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  Asset,
  Episode,
  Job,
  Project,
  ProviderConfig,
} from '@dramaforge/shared';

/**
 * 存储抽象。当前为 JSON 文件实现（零原生依赖、单机自用）；
 * 接口稳定，后续可无缝替换为 SQLite/Postgres。
 */
export interface Storage {
  load(): Promise<DBShape>;
  save(data: DBShape): Promise<void>;
  saveProviders(p: ProviderConfig[]): Promise<void>;
}

export interface DBShape {
  projects: Project[];
  episodes: Episode[];
  shots: any[];
  assets: Asset[];
  jobs: Job[];
  providers: ProviderConfig[];
}

export class JsonStorage implements Storage {
  constructor(private dir: string) {}

  private get dbPath() {
    return this.dir + '/db.json';
  }
  private get providersPath() {
    return this.dir + '/providers.json';
  }

  async load(): Promise<DBShape> {
    const [db, providers] = await Promise.all([
      this.readJson<DBShape>(this.dbPath, emptyDb),
      this.readJson<ProviderConfig[]>(this.providersPath, []),
    ]);
    return { ...db, providers };
  }

  async save(data: DBShape): Promise<void> {
    const { providers: _p, ...rest } = data;
    await this.writeJson(this.dbPath, rest);
  }

  async saveProviders(p: ProviderConfig[]): Promise<void> {
    await this.writeJson(this.providersPath, p);
  }

  private async readJson<T>(path: string, fallback: T | (() => T)): Promise<T> {
    try {
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return typeof fallback === 'function' ? (fallback as () => T)() : fallback;
    }
  }

  private async writeJson(path: string, data: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
  }
}

export function emptyDb(): DBShape {
  return { projects: [], episodes: [], shots: [], assets: [], jobs: [], providers: [] };
}
