import { useState } from 'react';
import type { Project } from '@dramaforge/shared';
import { api, deleteProject } from '../api.js';

const GENRES = ['都市', '古装', '玄幻', '穿越', '重生', '复仇', '霸道总裁', '赘婿/逆袭', '悬疑', '仙侠', '甜宠/言情', '年代/怀旧', '民间传说', '科幻', '末日', '其他'];
const AUDIENCES = ['全年龄', '18-25 年轻人', '25-40 女性', '25-40 男性', '40+ 中老年'];
const TONES = ['爽感/快节奏', '虐心/催泪', '甜宠/温馨', '热血/激情', '悬疑/烧脑', '搞笑/轻松', '励志/正能量'];

export function ProjectsView(props: {
  projects: Project[];
  loading: boolean;
  onCreated: () => void;
  onOpen: (id: string) => void;
  onDeleted: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [genre, setGenre] = useState('逆袭');
  const [audience, setAudience] = useState('全年龄');
  const [tone, setTone] = useState('爽感/快节奏');
  const [episodes, setEpisodes] = useState(3);
  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [scriptBody, setScriptBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function reset() {
    setStep(0); setTitle(''); setTopic(''); setScriptBody(''); setMode('ai'); setErr('');
    setGenre('逆袭'); setAudience('全年龄'); setTone('爽感/快节奏'); setEpisodes(3);
  }

  async function submit() {
    if (!title.trim() || !topic.trim()) { setErr('请填写标题与主题'); setStep(0); return; }
    if (mode === 'manual' && !scriptBody.trim()) { setErr('手动模式需粘贴剧本正文'); setStep(1); return; }
    setBusy(true); setErr('');
    try {
      await api.createProject({ title, topic, genre, audience, tone, episodeCount: episodes, scriptBody: mode === 'manual' ? scriptBody : undefined } as any);
      setShowForm(false); reset(); props.onCreated();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  function remove(p: Project, e: React.MouseEvent) {
    e.stopPropagation();
    if (confirm(`删除「${p.title}」？此操作不可撤销。`)) deleteProject(p.id).then(props.onDeleted);
  }

  const canNext0 = title.trim() && topic.trim();

  return (
    <div className="projects">
      <div className="page-head">
        <div>
          <h1>我的项目</h1>
          <p className="muted">从一个主题开始，生成剧本 → 分镜 → 素材 → 成片。</p>
        </div>
        <button className="primary" onClick={() => { setShowForm((s) => !s); reset(); }}>
          {showForm ? '收起' : '+ 新建项目'}
        </button>
      </div>

      {showForm && (
        <div className="card form stepper">
          <div className="stepper-head">
            {[0, 1, 2].map((n) => (
              <div key={n} className={'stepper-dot ' + (step >= n ? 'on' : '')}>
                <span>{n + 1}</span>{n === 0 ? '基本信息' : n === 1 ? '剧本来源' : '确认'}
              </div>
            ))}
          </div>

          {step === 0 && (
            <div className="form-grid">
              <label>标题<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：重生之我是霸总" /></label>
              <label className="full">主题 / 题材一句话<textarea rows={4} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="重生复仇：女主遭未婚夫与闺蜜联手陷害致死，重生回三年前逆袭" /></label>
              <label>题材标签
                <select value={genre} onChange={(e) => setGenre(e.target.value)}>
                  {GENRES.map((g) => <option key={g}>{g}</option>)}
                </select>
              </label>
              <label>目标受众
                <select value={audience} onChange={(e) => setAudience(e.target.value)}>
                  {AUDIENCES.map((a) => <option key={a}>{a}</option>)}
                </select>
              </label>
              <label>调性
                <select value={tone} onChange={(e) => setTone(e.target.value)}>
                  {TONES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
              <label>集数<input type="number" min={1} max={30} value={episodes} onChange={(e) => setEpisodes(Number(e.target.value))} /></label>
            </div>
          )}

          {step === 1 && (
            <div className="form-grid">
              <div className="full mode-pick">
                <button className={'mode-card ' + (mode === 'ai' ? 'on' : '')} onClick={() => setMode('ai')}>
                  <strong>AI 自动生成</strong>
                  <span className="muted small">由语言模型根据主题创作剧本</span>
                </button>
                <button className={'mode-card ' + (mode === 'manual' ? 'on' : '')} onClick={() => setMode('manual')}>
                  <strong>粘贴现成剧本</strong>
                  <span className="muted small">粘贴正文，自动按「第N集」拆分</span>
                </button>
                {mode === 'manual' && (
                  <textarea className="full" rows={16} value={scriptBody}
                    onChange={(e) => setScriptBody(e.target.value)}
                    placeholder="粘贴剧本正文。无需手动分集，系统会自动识别「第1集」「第一集」「#第1集」等标记并拆分；也会自动抽取角色表（支持表格/列表/括号格式）。" />
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="form-grid">
              <div className="full confirm-box">
                <div className="confirm-row"><span className="muted">标题</span><strong>{title}</strong></div>
                <div className="confirm-row"><span className="muted">主题</span><span>{topic}</span></div>
                <div className="confirm-row"><span className="muted">题材</span><span className="chip">{genre}</span></div>
                <div className="confirm-row"><span className="muted">受众</span><span>{audience}</span></div>
                <div className="confirm-row"><span className="muted">调性</span><span>{tone}</span></div>
                <div className="confirm-row"><span className="muted">集数</span><span>{episodes} 集</span></div>
                <div className="confirm-row"><span className="muted">剧本</span><strong>{mode === 'ai' ? 'AI 自动生成' : '手动粘贴（' + scriptBody.length + ' 字）'}</strong></div>
              </div>
            </div>
          )}

          <div className="form-grid">
            {err && <span className="err full">{err}</span>}
            <div className="full actions">
              {step > 0 && <button className="ghost" disabled={busy} onClick={() => setStep(step - 1)}>上一步</button>}
              {step < 2 && <button className="primary" disabled={!canNext0} onClick={() => setStep(step + 1)}>下一步</button>}
              {step === 2 && <button className="primary" disabled={busy} onClick={submit}>{busy ? '创建中..' : '创建'}</button>}
            </div>
          </div>
        </div>
      )}

      {props.loading ? (
        <p className="muted">加载中..</p>
      ) : props.projects.length === 0 ? (
        <div className="empty">还没有项目，点右上角「新建项目」开始。</div>
      ) : (
        <div className="grid">
          {props.projects.map((p) => (
            <div key={p.id} className="card proj" onClick={() => props.onOpen(p.id)}>
              <div className="proj-top">
                <span className="status" data-st={p.status}>{statusLabel(p.status)}</span>
                <span className="chip">{p.genre || '未分类'}</span>
              </div>
              <h3>{p.title}</h3>
              <p className="topic">{p.topic}</p>
              <div className="proj-foot">
                <span>{p.episodeCount} 集</span>
                <span className="muted">{(p.characters || []).length} 角色</span>
                <span className="muted">{new Date(p.updatedAt).toLocaleDateString('zh-CN')}</span>
                <button className="ghost danger" onClick={(e) => remove(p, e)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function statusLabel(s: string): string {
  return ({ draft: '草稿', scripted: '已有剧本', storyboarded: '已分镜', producing: '生产中', composing: '合成中', done: '成片完成', failed: '失败' } as Record<string, string>)[s] ?? s;
}
