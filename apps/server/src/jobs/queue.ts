import type { Job, JobType } from '@dramaforge/shared';
import { newId, type Repo } from '../store/repo.js';

/** 任务处理器：处理一个 queued 任务，返回结果 */
export type JobHandler = (job: Job, repo: Repo) => Promise<Record<string, unknown>>;

/**
 * 进程内任务队列：自用阶段足够；演进 SaaS 时替换为 Redis/BullMQ 等分布式队列。
 * 串行执行，确保写库不竞争；视频/图片任务本就慢，串行更稳。
 */
export class JobQueue {
  private handlers = new Map<JobType, JobHandler>();
  private active = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private repo: Repo) {}

  register(type: JobType, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  enqueue(type: JobType, projectId: string, payload: Record<string, unknown> = {}): Job {
    const job: Job = {
      id: newId('job_'),
      type,
      status: 'queued',
      projectId,
      payload,
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.repo.upsertJob(job);
    return job;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.timer = setInterval(() => void this.tick(), 1500);
  }

  stop() {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (!this.active) return;
    const job = this.repo
      .listJobs()
 .reverse()
      .find((j) => j.status === 'queued');
    if (!job) return;
    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = 'failed';
      job.error = `未注册处理器: ${job.type}`;
      this.repo.upsertJob(job);
      return;
    }
    job.status = 'running';
    job.startedAt = Date.now();
    this.repo.upsertJob(job);
    try {
      const result = await handler(job, this.repo);
      job.result = result;
      job.status = 'done';
      job.progress = 100;
    } catch (e: any) {
      job.status = 'failed';
      job.error = e?.message ?? String(e);
    } finally {
      job.finishedAt = Date.now();
      this.repo.upsertJob(job);
      await this.repo.flush();
    }
  }
}
