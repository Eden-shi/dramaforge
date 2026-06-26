import { useEffect, useRef, useState } from 'react';
import type { Asset, CostSummary, Job } from '@dramaforge/shared';
import { api, type ProjectDetail } from '../api.js';

const POLL = 1500;
type Step = 'storyboard' | 'image' | 'video' | 'tts' | 'compose';

export function WorkspaceView(props: { projectId: string; onBack: () => void }) {
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [gen, setGen] = useState(false);
  const [stream, setStream] = useState('');
  const [err, setErr] = useState('');
  const [active, setActive] = useState<Job | null>(null);
  const [curEp, setCurEp] = useState(0);
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const load = () => api.getProject(props.projectId).then(setData);
  useEffect(() => { load(); }, [props.projectId]);

  async function runStep(fn: () => Promise<Job>) {
    setErr('');
    try {
      const j = await fn();
      setActive(j);
      poll(j.id);
    } catch (e: any) { setErr(e.message); }
  }
  function poll(jobId: string) {
    if (timers.current[jobId]) return;
    timers.current[jobId] = setInterval(() => {
      api.listJobs(props.projectId).then((jobs) => {
        const j = jobs.find((x) => x.id === jobId);
        if (!j) return;
        setActive(j);
        if (j.status === 'done' || j.status === 'failed') {
          clearInterval(timers.current[jobId]);
          delete timers.current[jobId];
          load();
          if (j.status === 'failed') setErr(j.error || '任务失败');
        }
      });
    }, POLL);
  }
  useEffect(() => () => Object.values(timers.current).forEach(clearInterval), []);

  async function runScript() {
    setGen(true); setErr(''); setStream('');
    try {
      await api.streamScript(props.projectId, (t) => setStream((s) => s + t));
      await load();
    } catch (e: any) { setErr(e.message); } finally { setGen(false); }
  }

  const project = data?.project;
  const episodes = data?.episodes ?? [];
  const ep = episodes[curEp];
  const epShots = ep ? data!.shots.filter((s) => s.episodeId === ep.id) : [];
  const assets = data?.assets ?? [];
  const epAssets = assets.filter((a) => epShots.some((s) => s.id === a.ownerId));
  const final = assets.find((a) => a.kind === 'final' && a.status === 'ready' && a.providerRef === ep?.id);
  const [costs, setCosts] = useState<CostSummary | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergedUrl, setMergedUrl] = useState('');

  useEffect(() => {
    api.getCosts(props.projectId).then(setCosts).catch(() => {});
  }, [props.projectId, data]);

  const busy = !!active && (active.status === 'queued' || active.status === 'running');
  async function handleMerge() {
    setMerging(true);
    setErr('');
    try {
      const r = await api.mergeAll(props.projectId);
      setMergedUrl(r.url);
    } catch (e: any) { setErr(e.message); }
    setMerging(false);
  }

  if (!project) return <p className="muted">加载中…</p>;

  return (
    <div className="workspace">
      <div className="page-head">
        <button className="ghost" onClick={props.onBack}>← 返回</button>
        <div className="grow">
          <h1>{project.title}</h1>
          <p className="muted">{project.topic}</p>
        </div>
        <span className="status" data-st={project.status}>{project.status}</span>
      </div>

      {err && <div className="err">{err}</div>}
      {busy && active && <div className="toast static">任务进行中：{active.type} · {active.progress}%</div>}

      <section className="card step">
        <div className="step-head">
          <h2>① 剧本</h2>
          <button className="primary" disabled={gen} onClick={runScript}>
            {gen ? '生成中…' : episodes.length ? '重新生成剧本' : '生成剧本'}
          </button>
        </div>
        {(stream || episodes.length > 0) && (
          <pre className="script">{stream || episodes.map((e) => `#第${e.index}集\n${e.script}`).join('\n\n')}</pre>
        )}
      </section>

      {episodes.length > 0 && (
        <>
          <EpisodeTabs count={episodes.length} cur={curEp} onPick={setCurEp} />
          <section className="card step">
            <div className="step-head">
              <h2>② 分镜（第{ep.index}集）</h2>
              <button className="ghost" disabled={busy} onClick={() => runStep(() => api.generateStoryboard(props.projectId, ep.id))}>生成分镜</button>
            </div>
            {epShots.length > 0 ? (
              <div className="shots">{epShots.map((s) => <ShotCard key={s.id} shot={s} assets={epAssets} />)}</div>
            ) : <p className="muted">生成后将得到逐镜头的场面/对白/画面提示。</p>}
          </section>

          {epShots.length > 0 && (
            <>
              <section className="card step">
                <div className="step-head">
                  <h2>③ 素材生产（第{ep.index}集）</h2>
                  <div className="step-actions">
                    <button className="ghost" disabled={busy} onClick={() => runStep(() => api.generateImages(props.projectId, ep.id))}>配图</button>
                    <button className="ghost" disabled={busy} onClick={() => runStep(() => api.generateVideo(props.projectId, ep.id))}>视频</button>
                    <button className="ghost" disabled={busy} onClick={() => runStep(() => api.generateTts(props.projectId, ep.id))}>配音</button>
                  </div>
                </div>
                <p className="muted small">无 API Key 时自动用 ffmpeg 合成占位素材，可完整跑通链路。</p>
              </section>

              <section className="card step">
                <div className="step-head">
                  <h2>④ 成片合成（第{ep.index}集）</h2>
                  <button className="primary" disabled={busy} onClick={() => runStep(() => api.compose(props.projectId, ep.id))}>合成成片</button>
                </div>
                {final ? (
                  <div className="final">
                    <video controls className="player" crossOrigin="anonymous">
                      <source src={`${api.finalUrl(props.projectId, ep.id)}?t=${final.updatedAt}`} type="video/mp4" />
                      <track kind="subtitles" srcLang="zh" label="中文字幕" default src={`${api.subtitlesUrl(props.projectId, ep.id)}?t=${final.updatedAt}`} />
                    </video>
                    <a className="primary" href={api.finalUrl(props.projectId, ep.id)} download={`${project.title}-第${ep.index}集.mp4`}>下载成片</a>
                  </div>
                ) : <p className="muted">合成后在此播放与下载本集成片。</p>}
              </section>
            </>
          )}
        </>
      )}

      {episodes.length > 1 && (
        <section className="card step">
          <div className="step-head">
            <h2>全剧合并</h2>
            <button className="primary" disabled={busy || merging} onClick={handleMerge}>
              {merging ? '合并中…' : '合并全剧'}
            </button>
          </div>
          {mergedUrl && (
            <div className="final">
              <video controls className="player" crossOrigin="anonymous">
                <source src={mergedUrl + '?t=' + Date.now()} type="video/mp4" />
              </video>
              <a className="primary" href={mergedUrl} download={`${project.title}-全剧.mp4`}>下载全剧</a>
            </div>
          )}
          {!mergedUrl && <p className="muted small">至少合成2集成片后才能合并为完整剧集。</p>}
        </section>
      )}

      {costs && costs.items.length > 0 && (
        <section className="card step">
          <div className="step-head">
            <h2>费用明细</h2>
            <span className="total-cost">合计：¥{costs.total.toFixed(2)}</span>
          </div>
          <table className="cost-table">
            <thead><tr><th>项目</th><th>数量</th><th>费用</th></tr></thead>
            <tbody>
              {costs.items.map((item, i) => (
                <tr key={i}>
                  <td>{item.label}</td>
                  <td>{item.tokens ? item.tokens.toLocaleString() + ' tokens' : item.shots ? item.shots + ' 镜' : item.count + ' 个'}</td>
                  <td>¥{item.cost.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>总计</td><td>¥{costs.total.toFixed(2)}</td></tr></tfoot>
          </table>
        </section>
      )}
    </div>
  );
}

function EpisodeTabs({ count, cur, onPick }: { count: number; cur: number; onPick: (n: number) => void }) {
  return (
    <div className="tabs">
      {Array.from({ length: count }, (_, i) => (
        <button key={i} className={i === cur ? 'active' : ''} onClick={() => onPick(i)}>第{i + 1}集</button>
      ))}
    </div>
  );
}

function ShotCard({ shot, assets }: { shot: any; assets: Asset[] }) {
  const img = assets.find((a) => a.ownerId === shot.id && a.kind === 'image' && a.status === 'ready');
  const vid = assets.find((a) => a.ownerId === shot.id && a.kind === 'video' && a.status === 'ready');
  return (
    <div className="shot">
      <div className="shot-no">{shot.index}</div>
      <div className="shot-body">
        <div className="shot-meta">{shot.location} · {shot.camera} · {shot.durationSec}s</div>
        <p className="shot-scene">{shot.scene}</p>
        {shot.visualPrompt && <p className="shot-prompt muted">画面：{shot.visualPrompt}</p>}
        {shot.dialogue && <p className="shot-dlg">“{shot.dialogue}”</p>}
        {shot.narration && <p className="muted">〔旁白〕{shot.narration}</p>}
        {vid?.url && <video className="thumb" src={vid.url} controls muted />}
        {img?.url && !vid?.url && <img className="thumb" src={img.url} alt={shot.scene} />}
      </div>
    </div>
  );
}
