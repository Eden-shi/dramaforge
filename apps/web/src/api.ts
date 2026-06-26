import type { CostSummary,
  Asset,
  Episode,
  Job,
  Project,
  ProviderInfo,
  Shot,
  StreamEvent,
} from '@dramaforge/shared';

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await errMsg(r));
  return r.json() as Promise<T>;
}
async function jpost<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await errMsg(r));
  return (r.status === 204 ? undefined : await r.json()) as T;
}
async function jput<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await errMsg(r));
  return r.json() as Promise<T>;
}
async function errMsg(r: Response): Promise<string> {
  const body: any = await r.json().catch(() => ({}));
  return body?.error ?? r.statusText;
}

export interface ProjectDetail {
  project: Project;
  episodes: Episode[];
  shots: Shot[];
  assets: Asset[];
}

export const api = {
  listProjects: () => jget<Project[]>('/api/projects'),
  createProject: (b: Partial<Project>) => jpost<Project>('/api/projects', b),
  getProject: (id: string) => jget<ProjectDetail>(`/api/projects/${id}`),
  deleteProject: (id: string) => jpost<void>(`/api/projects/${id}`.replace('POST', 'DELETE')),
  listProviders: () => jget<ProviderInfo[]>('/api/providers'),
  setProvider: (id: string, b: { apiKey?: string; model?: string; baseUrl?: string }) =>
    jput<ProviderInfo>(`/api/providers/${id}`, b),
  listJobs: (projectId?: string) =>
    jget<Job[]>(`/api/jobs${projectId ? `?projectId=${projectId}` : ''}`),
  /** SSE 流式生成剧本 */
  streamScript(id: string, onDelta: (t: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const ctrl = new AbortController();
      fetch(`/api/projects/${id}/generate-script`, { method: 'POST', signal: ctrl.signal })
        .then(async (resp) => {
          if (!resp.body) return resolve();
          const reader = resp.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() ?? '';
            for (const part of parts) {
              const line = part.split('\n').find((l) => l.startsWith('data:'));
              if (!line) continue;
              const ev = JSON.parse(line.slice(5).trim()) as StreamEvent;
              if (ev.type === 'delta' && ev.text) onDelta(ev.text);
              else if (ev.type === 'error') reject(new Error(ev.error));
              else if (ev.type === 'done') resolve();
            }
          }
          resolve();
        })
        .catch(reject);
    });
  },
  generateStoryboard: (id: string, episodeId: string) =>
    jpost<Job>(`/api/projects/${id}/generate-storyboard`, { episodeId }),
  generateImages: (id: string, episodeId?: string) =>
    jpost<Job>(`/api/projects/${id}/generate-images`, episodeId ? { episodeId } : {}),
  generateVideo: (id: string, episodeId?: string) =>
    jpost<Job>(`/api/projects/${id}/generate-video`, episodeId ? { episodeId } : {}),
  generateTts: (id: string, episodeId?: string) =>
    jpost<Job>(`/api/projects/${id}/generate-tts`, episodeId ? { episodeId } : {}),
  compose: (id: string, episodeId?: string) =>
    jpost<Job>(`/api/projects/${id}/compose`, episodeId ? { episodeId } : {}),
  finalUrl: (id: string, episodeId?: string) =>
    episodeId ? `/api/projects/${id}/episodes/${episodeId}/media/final` : `/api/projects/${id}/media/final`,
  subtitlesUrl: (id: string, episodeId?: string) =>
    episodeId ? `/api/projects/${id}/episodes/${episodeId}/media/subtitles` : `/api/projects/${id}/media/subtitles`,
  getCosts: (projectId: string) =>
    jget<CostSummary>(`/api/projects/${projectId}/costs`),
  getEpisodeCosts: (projectId: string, episodeId: string) =>
    jget<CostSummary>(`/api/projects/${projectId}/episodes/${episodeId}/costs`),
  mergeAll: (projectId: string) =>
    jpost<{ segments: number; durationSec?: number; url: string }>(`/api/projects/${projectId}/merge`),
  mergedUrl: (projectId: string) =>
    `/api/projects/${projectId}/media/merged`,
};

export const deleteProject = (id: string) =>
  fetch(`/api/projects/${id}`, { method: 'DELETE' }).then((r) => (r.ok ? undefined : Promise.reject(r)));
