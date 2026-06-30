import { useEffect, useRef, useState } from 'react';
import type { Asset, Character, CostSummary, Episode, Job, Project, ProviderInfo, Shot } from '@dramaforge/shared';
import { api, type ProjectDetail } from '../api.js';

const POLL = 1500;
type Panel = 'overview' | 'script' | 'characters' | 'config' | 'storyboard' | 'assets' | 'final';

export function WorkspaceView(props: { projectId: string; onBack: () => void }) {
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [panel, setPanel] = useState<Panel>('overview');
  const [gen, setGen] = useState(false);
  const [stream, setStream] = useState('');
  const [err, setErr] = useState('');
  const [active, setActive] = useState<Job | null>(null);
  const [curEp, setCurEp] = useState(0);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const load = () => api.getProject(props.projectId).then(setData);
  useEffect(() => { load(); api.listProviders().then(setProviders); }, [props.projectId]);

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
    setMerging(true); setErr('');
    try { setMergedUrl((await api.mergeAll(props.projectId)).url); }
    catch (e: any) { setErr(e.message); }
    setMerging(false);
  }

  async function reparse() {
    if (!confirm('重新解析剧本？会按新的解析规则重新拆分集数和角色。')) return;
    setErr('');
    try {
      const r = await api.reparse(props.projectId);
      await load();
      setErr(`已重新解析：${r.episodes} 集、${r.characters} 个角色`);
    } catch (e: any) { setErr('解析失败: ' + e.message); }
  }

  if (!project) return <p className="muted">加载中...</p>;

  return (
    <div className="workspace">
      <div className="page-head">
        <button className="ghost" onClick={props.onBack}>← 返回</button>
        <div className="grow">
          <h1>{project.title}</h1>
          <p className="muted">{project.topic}</p>
        </div>
        <span className="status" data-st={project.status}>{statusLabel(project.status)}</span>
      </div>

      {err && <div className="err">{err}</div>}
      {busy && active && <div className="toast static">任务进行中：{active.type} · {active.progress}%</div>}

      <div className="ws-layout">
        <aside className="ws-side">
          <nav className="ws-nav">
            <button className={panel === 'overview' ? 'active' : ''} onClick={() => setPanel('overview')}><span className="nav-icon">📊</span>概览</button>
            <button className={panel === 'script' ? 'active' : ''} onClick={() => setPanel('script')}><span className="nav-icon">📖</span>剧本</button>
            <button className={panel === 'characters' ? 'active' : ''} onClick={() => setPanel('characters')}><span className="nav-icon">👥</span>角色</button>
            <button className={panel === 'storyboard' ? 'active' : ''} onClick={() => setPanel('storyboard')}><span className="nav-icon">🎬</span>分镜</button>
            <button className={panel === 'assets' ? 'active' : ''} onClick={() => setPanel('assets')}><span className="nav-icon">🖼️</span>素材</button>
            <button className={panel === 'final' ? 'active' : ''} onClick={() => setPanel('final')}><span className="nav-icon">🎥</span>成片</button>
            <button className={panel === 'config' ? 'active' : ''} onClick={() => setPanel('config')}><span className="nav-icon">⚙️</span>配置</button>
          </nav>
        </aside>

        <main className="ws-main">
          {panel === 'overview' && <OverviewPanel project={project} episodes={episodes} costs={costs} shots={data?.shots ?? []} onGo={setPanel} />}
          {panel === 'script' && (
            <ScriptPanel
              project={project} episodes={episodes} curEp={curEp} setCurEp={setCurEp}
              gen={gen} stream={stream} runScript={runScript}
              busy={busy} reload={load} setErr={setErr} reparse={reparse}
              projectId={props.projectId}
            />
          )}
          {panel === 'characters' && <CharactersPanel project={project} reload={load} setErr={setErr} />}
          {panel === 'storyboard' && (
            <StoryboardPanel
              project={project} episodes={episodes} curEp={curEp} setCurEp={setCurEp}
              ep={ep} epShots={epShots} busy={busy} runStep={runStep}
              projectId={props.projectId} reload={load} setErr={setErr}
            />
          )}
          {panel === 'assets' && (
            <AssetsPanel
              project={project} ep={ep} epShots={epShots} epAssets={epAssets} busy={busy} runStep={runStep}
              episodes={episodes} curEp={curEp} setCurEp={setCurEp} projectId={props.projectId}
            />
          )}
          {panel === 'final' && (
            <FinalPanel
              project={project} ep={ep} episodes={episodes} curEp={curEp} setCurEp={setCurEp}
              final={final} busy={busy} runStep={runStep} merging={merging} mergedUrl={mergedUrl}
              handleMerge={handleMerge} projectId={props.projectId}
            />
          )}
          {panel === 'config' && <ConfigPanel project={project} providers={providers} reload={load} setErr={setErr} />}
        </main>
      </div>

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

// ---------- 概览仪表盘 ----------
function OverviewPanel({ project, episodes, shots, costs, onGo }: {
  project: Project; episodes: Episode[]; shots: Shot[]; costs: CostSummary | null;
  onGo: (p: Panel) => void;
}) {
  const readyShots = shots.filter((s) => true).length;
  const cards = [
    { label: '剧本', value: episodes.length ? `${episodes.length} 集` : '未生成', st: episodes.length ? 'on' : 'off', go: 'script' as Panel },
    { label: '角色', value: `${project.characters.length} 个`, st: 'on', go: 'characters' as Panel },
    { label: '分镜', value: readyShots ? `${readyShots} 镜` : '未生成', st: readyShots ? 'on' : 'off', go: 'storyboard' as Panel },
    { label: '费用', value: costs ? `¥${costs.total.toFixed(2)}` : '¥0', st: 'on', go: 'config' as Panel },
  ];
  return (
    <div className="overview">
      <div className="dash-grid">
        {cards.map((c) => (
          <div key={c.label} className="dash-card" onClick={() => onGo(c.go)}>
            <span className="muted small">{c.label}</span>
            <strong className={'dot ' + c.st}>{c.value}</strong>
          </div>
        ))}
      </div>
      <div className="card step">
        <h2>下一步</h2>
        <p className="muted">{nextHint(project.status, episodes.length)}</p>
        <div className="step-actions" style={{ marginTop: 8 }}>
          <button className="primary" onClick={() => onGo(episodes.length ? 'storyboard' : 'script')}>
            {episodes.length ? '去生成分镜' : '去生成剧本'}
          </button>
        </div>
      </div>
    </div>
  );
}
function nextHint(st: string, ep: number): string {
  if (!ep) return '还没有剧本。可以从 AI 生成，或直接粘贴现成剧本。';
  if (st === 'scripted') return '剧本已就绪，下一步生成分镜。';
  if (st === 'storyboarded') return '分镜已就绪，下一步生产素材（配图/视频/配音）。';
  if (st === 'done') return '成片已完成！可以在「成片」面板预览和下载。';
  return '继续推进流水线。';
}

// ---------- 剧本面板 ----------
function ScriptPanel({ project, episodes, curEp, setCurEp, gen, stream, runScript, busy, reload, setErr, reparse, projectId }: any) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const ep = episodes[curEp];

  async function save() {
    setSaving(true);
    try {
      const re = /#第\s*(\d+)\s*集\s*([\s\S]*?)(?=#第\s*\d+\s*集|$)/g;
      const parts: { index: number; body: string }[] = [];
      let m;
      while ((m = re.exec(draft))) parts.push({ index: parseInt(m[1]), body: (m[2] ?? '').trim() });
      if (!parts.length) parts.push({ index: 1, body: draft.trim() });
      for (const part of parts) {
        const e = (episodes as Episode[]).find((x) => x.index === part.index);
        if (e) await api.updateScript(projectId, e.id, part.body);
      }
      await reload();
      setEditing(false);
    } catch (e: any) { setErr('保存失败: ' + e.message); }
    setSaving(false);
  }

  return (
    <div>
      <section className="card step">
        <div className="step-head">
          <h2>剧本</h2>
          <div className="step-actions">
            <button className="ghost" onClick={reparse}>重新解析</button>
            <button className="primary" disabled={gen || busy} onClick={runScript}>
              {gen ? '生成中...' : episodes.length ? '重新生成剧本' : '生成剧本'}
            </button>
          </div>
        </div>
        {stream && <pre className="script">{stream}</pre>}
        {!stream && episodes.length > 0 && !editing && (
          <>
            <pre className="script">{episodes.map((e: Episode) => `#第${e.index}集\n${e.script}`).join('\n\n')}</pre>
            <div className="script-actions">
              <button className="ghost" onClick={() => { setDraft(episodes.map((e: Episode) => `#第${e.index}集\n${e.script}`).join('\n\n')); setEditing(true); }}>编辑剧本</button>
            </div>
          </>
        )}
        {!stream && editing && (
          <div className="script-block">
            <textarea className="script-editor" rows={25} value={draft}
              onChange={(e) => setDraft(e.target.value)} />
            <div className="script-actions">
              <button className="primary" disabled={saving} onClick={save}>{saving ? '保存中...' : '保存'}</button>
              <button className="ghost" onClick={() => setEditing(false)}>取消</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- 角色面板 ----------
function CharactersPanel({ project, reload, setErr }: { project: Project; reload: () => void; setErr: (s: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Character>(emptyChar());
  function emptyChar(): Character { return { id: '', name: '', role: '配角', appearance: '', voice: '', refAssetId: null }; }

  async function add() {
    if (!draft.name.trim()) return;
    try { await api.addCharacter(project.id, draft); setDraft(emptyChar()); setAdding(false); reload(); }
    catch (e: any) { setErr('添加失败: ' + e.message); }
  }
  async function upd(c: Character, patch: Partial<Character>) {
    try { await api.updateCharacter(project.id, c.id, patch); reload(); }
    catch (e: any) { setErr('保存失败: ' + e.message); }
  }
  async function del(c: Character) {
    if (!confirm(`删除角色「${c.name}」？`)) return;
    try { await api.deleteCharacter(project.id, c.id); reload(); }
    catch (e: any) { setErr('删除失败: ' + e.message); }
  }

  return (
    <section className="card step">
      <div className="step-head">
        <h2>角色管理</h2>
        <button className="primary" onClick={() => setAdding((s) => !s)}>{adding ? '收起' : '+ 添加角色'}</button>
      </div>
      {adding && (
        <div className="char-form">
          <input placeholder="角色名" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input placeholder="定位（主角/反派...）" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
          <input placeholder="外貌设定" value={draft.appearance} onChange={(e) => setDraft({ ...draft, appearance: e.target.value })} />
          <div className="actions"><button className="primary" onClick={add}>添加</button></div>
        </div>
      )}
      <div className="char-list">
        {project.characters.map((c) => (
          <div key={c.id} className="char-card">
            <div className="char-no">{c.role || '配角'}</div>
            <div className="char-body">
              <input className="char-name" defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && upd(c, { name: e.target.value })} />
              <input className="char-role" placeholder="定位" defaultValue={c.role} onBlur={(e) => e.target.value !== c.role && upd(c, { role: e.target.value })} />
              <textarea className="char-app" placeholder="外貌设定" defaultValue={c.appearance} onBlur={(e) => e.target.value !== c.appearance && upd(c, { appearance: e.target.value })} />
            </div>
            <button className="ghost danger" onClick={() => del(c)}>删除</button>
          </div>
        ))}
        {project.characters.length === 0 && <p className="muted">还没有角色。AI 生成剧本后会自动抽取，也可手动添加。</p>}
      </div>
    </section>
  );
}

// ---------- 分镜面板 ----------
function StoryboardPanel({ project, episodes, curEp, setCurEp, ep, epShots, busy, runStep, projectId, reload, setErr }: any) {
  return (
    <div>
      {episodes.length > 0 && <EpisodeTabs count={episodes.length} cur={curEp} onPick={setCurEp} />}
      <section className="card step">
        <div className="step-head">
          <h2>分镜{ep && `（第${ep.index}集）`}</h2>
          <button className="ghost" disabled={busy || !ep} onClick={() => runStep(() => api.generateStoryboard(projectId, ep.id))}>生成/刷新分镜</button>
        </div>
        {epShots.length > 0 ? (
          <div className="shots">{epShots.map((s: Shot) => <ShotEditor key={s.id} shot={s} characters={project.characters} projectId={projectId} reload={reload} setErr={setErr} />)}</div>
        ) : <p className="muted">生成后将得到逐镜头的场景/对白/画面提示，可直接编辑。</p>}
      </section>
    </div>
  );
}
function ShotEditor({ shot, characters, projectId, reload, setErr }: { shot: Shot; characters: Character[]; projectId: string; reload: () => void; setErr: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<Shot>(shot);
  useEffect(() => setS(shot), [shot]);
  async function save() {
    try { await api.updateShot(projectId, shot.id, { scene: s.scene, location: s.location, dialogue: s.dialogue, narration: s.narration, visualPrompt: s.visualPrompt, camera: s.camera, durationSec: s.durationSec, characterIds: s.characterIds }); setOpen(false); reload(); }
    catch (e: any) { setErr('保存失败: ' + e.message); }
  }
  async function del() {
    if (!confirm('删除该分镜？')) return;
    try { await api.deleteShot(projectId, shot.id); reload(); }
    catch (e: any) { setErr('删除失败: ' + e.message); }
  }
  return (
    <div className="shot editable">
      <div className="shot-no">{shot.index}</div>
      <div className="shot-body">
        {open ? (
          <div className="shot-edit">
            <div className="shot-row"><input value={s.scene} onChange={(e) => setS({ ...s, scene: e.target.value })} placeholder="场景" /></div>
            <div className="shot-row"><input value={s.location} onChange={(e) => setS({ ...s, location: e.target.value })} placeholder="地点/内外景" />
              <select value={s.camera} onChange={(e) => setS({ ...s, camera: e.target.value })}>
                {['特写', '近景', '中景', '全景', '远景'].map((c) => <option key={c}>{c}</option>)}
              </select>
              <input type="number" value={s.durationSec} onChange={(e) => setS({ ...s, durationSec: Number(e.target.value) })} /></div>
            <textarea rows={2} value={s.dialogue} onChange={(e) => setS({ ...s, dialogue: e.target.value })} placeholder="对白" />
            <textarea rows={2} value={s.narration} onChange={(e) => setS({ ...s, narration: e.target.value })} placeholder="旁白" />
            <textarea rows={2} value={s.visualPrompt} onChange={(e) => setS({ ...s, visualPrompt: e.target.value })} placeholder="画面提示（文生图用）" />
            <div className="char-pick">
              {characters.map((c) => (
                <label key={c.id} className={s.characterIds.includes(c.id) ? 'on' : ''}>
                  <input type="checkbox" checked={s.characterIds.includes(c.id)} onChange={(e) => setS({ ...s, characterIds: e.target.checked ? [...s.characterIds, c.id] : s.characterIds.filter((x) => x !== c.id) })} />
                  {c.name}
                </label>
              ))}
            </div>
            <div className="step-actions"><button className="primary" onClick={save}>保存</button><button className="ghost" onClick={() => setOpen(false)}>取消</button></div>
          </div>
        ) : (
          <>
            <div className="shot-meta">{shot.location} · {shot.camera} · {shot.durationSec}s</div>
            <p className="shot-scene">{shot.scene}</p>
            {shot.visualPrompt && <p className="shot-prompt muted">画面：{shot.visualPrompt}</p>}
            {shot.dialogue && <p className="shot-dlg">“{shot.dialogue}”</p>}
            {shot.narration && <p className="muted">【旁白】{shot.narration}</p>}
            <div className="step-actions"><button className="ghost" onClick={() => setOpen(true)}>编辑</button><button className="ghost danger" onClick={del}>删除</button></div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- 素材面板 ----------
function AssetsPanel({ project, ep, epShots, epAssets, busy, runStep, episodes, curEp, setCurEp, projectId }: any) {
  return (
    <div>
      {episodes.length > 0 && <EpisodeTabs count={episodes.length} cur={curEp} onPick={setCurEp} />}
      <section className="card step">
        <div className="step-head">
          <h2>素材生产{ep && `（第${ep.index}集）`}</h2>
          <div className="step-actions">
            <button className="ghost" disabled={busy || !ep} onClick={() => runStep(() => api.generateImages(projectId, ep.id))}>配图</button>
            <button className="ghost" disabled={busy || !ep} onClick={() => runStep(() => api.generateVideo(projectId, ep.id))}>视频</button>
            <button className="ghost" disabled={busy || !ep} onClick={() => runStep(() => api.generateTts(projectId, ep.id))}>配音</button>
          </div>
        </div>
        <p className="muted small">无 API Key 时自动用 ffmpeg 合成占位素材，可先整条跑通链路。</p>
        {epShots.length > 0 ? (
          <div className="shots">{epShots.map((s: Shot) => <ShotCard key={s.id} shot={s} assets={epAssets} />)}</div>
        ) : <p className="muted">需要先有分镜。</p>}
      </section>
    </div>
  );
}

// ---------- 成片面板 ----------
function FinalPanel({ project, ep, episodes, curEp, setCurEp, final, busy, runStep, merging, mergedUrl, handleMerge, projectId }: any) {
  return (
    <div>
      {episodes.length > 0 && <EpisodeTabs count={episodes.length} cur={curEp} onPick={setCurEp} />}
      <section className="card step">
        <div className="step-head">
          <h2>成片合成{ep && `（第${ep.index}集）`}</h2>
          <button className="primary" disabled={busy || !ep} onClick={() => runStep(() => api.compose(projectId, ep.id))}>合成本集成片</button>
        </div>
        {final ? (
          <div className="final">
            <video controls className="player" crossOrigin="anonymous">
              <source src={`${api.finalUrl(projectId, ep.id)}?t=${final.updatedAt}`} type="video/mp4" />
              <track kind="subtitles" srcLang="zh" label="中文字幕" default src={`${api.subtitlesUrl(projectId, ep.id)}?t=${final.updatedAt}`} />
            </video>
            <a className="primary" href={api.finalUrl(projectId, ep.id)} download={`${project.title}-第${ep.index}集.mp4`}>下载本集</a>
          </div>
        ) : <p className="muted">合成后在此播放与下载本集成片。</p>}
      </section>

      {episodes.length > 1 && (
        <section className="card step">
          <div className="step-head">
            <h2>全剧合并</h2>
            <button className="primary" disabled={busy || merging} onClick={handleMerge}>{merging ? '合并中...' : '合并全剧'}</button>
          </div>
          {mergedUrl && (
            <div className="final">
              <video controls className="player" crossOrigin="anonymous"><source src={mergedUrl + '?t=' + Date.now()} type="video/mp4" /></video>
              <a className="primary" href={mergedUrl} download={`${project.title}-全剧.mp4`}>下载全剧</a>
            </div>
          )}
          {!mergedUrl && <p className="muted small">至少合成2集成片后才能合并为完整剧集。</p>}
        </section>
      )}
    </div>
  );
}

// ---------- 配置面板 ----------
function ConfigPanel({ project, providers, reload, setErr }: { project: Project; providers: ProviderInfo[]; reload: () => void; setErr: (s: string) => void }) {
  const cfg = project.config;
  const llms = providers.filter((p) => p.type === 'llm');
  const imgs = providers.filter((p) => p.type === 'image');
  const vids = providers.filter((p) => p.type === 'video');
  const tts = providers.filter((p) => p.type === 'tts');
  async function upd(patch: Partial<Project['config']>) {
    try { await api.setProjectConfig(project.id, patch); reload(); }
    catch (e: any) { setErr('保存失败: ' + e.message); }
  }
  return (
    <section className="card step">
      <div className="step-head"><h2>项目配置</h2></div>
      <div className="config-grid">
        <label>语言模型（剧本/分镜）<select value={cfg.llmProviderId ?? ''} onChange={(e) => upd({ llmProviderId: e.target.value })}>
          <option value="">默认（首个已配置）</option>
          {llms.map((p) => <option key={p.id} value={p.id}>{p.name}{p.configured ? '' : '（未配置）'}</option>)}
        </select></label>
        <label>文生图<select value={cfg.imageProviderId ?? ''} onChange={(e) => upd({ imageProviderId: e.target.value })}>
          <option value="">默认（首个已配置）</option>
          {imgs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.configured ? '' : '（未配置）'}</option>)}
        </select></label>
        <label>视频生成<select value={cfg.videoProviderId ?? ''} onChange={(e) => upd({ videoProviderId: e.target.value })}>
          <option value="">默认（首个已配置）</option>
          {vids.map((p) => <option key={p.id} value={p.id}>{p.name}{p.configured ? '' : '（未配置）'}</option>)}
        </select></label>
        <label>配音 TTS<select value={cfg.ttsProviderId ?? ''} onChange={(e) => upd({ ttsProviderId: e.target.value })}>
          <option value="">默认（首个已配置）</option>
          {tts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.configured ? '' : '（未配置）'}</option>)}
        </select></label>
        <label>分辨率<select value={cfg.resolution} onChange={(e) => upd({ resolution: e.target.value })}>
          <option value="1080x1920">1080x1920（竖屏）</option>
          <option value="1920x1080">1920x1080（横屏）</option>
          <option value="720x1280">720x1280（竖屏小）</option>
        </select></label>
        <label>单镜默认时长（秒）<input type="number" min={2} max={30} value={cfg.shotDurationSec} onChange={(e) => upd({ shotDurationSec: Number(e.target.value) })} /></label>
      </div>
      <p className="muted small">留空则自动用「设置」里首个已配置的供应商。这是解决「配了 DeepSeek 但项目没用上」的关键入口。</p>
    </section>
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
        {shot.dialogue && <p className="shot-dlg">“{shot.dialogue}”</p>}
        {vid?.url && <video className="thumb" src={vid.url} controls muted />}
        {img?.url && !vid?.url && <img className="thumb" src={img.url} alt={shot.scene} />}
      </div>
    </div>
  );
}

function statusLabel(s: string): string {
  return ({ draft: '草稿', scripted: '已有剧本', storyboarded: '已分镜', producing: '生产中', composing: '合成中', done: '成片完成', failed: '失败' } as Record<string, string>)[s] ?? s;
}
