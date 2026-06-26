import { useState } from 'react';
import type { Project } from '@dramaforge/shared';
import { api, deleteProject } from '../api.js';

const GENRES = ['甜宠', '复仇', '穿越', '重生', '霸总', '逆袭', '悬疑', '古言', '现言', '其他'];

export function ProjectsView(props: {
  projects: Project[];
  loading: boolean;
  onCreated: () => void;
  onOpen: (id: string) => void;
  onDeleted: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [genre, setGenre] = useState('逆袭');
  const [audience, setAudience] = useState('25-40 女性');
  const [tone, setTone] = useState('爽感向、节奏快');
  const [episodes, setEpisodes] = useState(3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!title.trim() || !topic.trim()) {
      setErr('请填写标题与主题');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.createProject({ title, topic, genre, audience, tone, episodeCount: episodes } as any);
      setShowForm(false);
      setTitle('');
      setTopic('');
      props.onCreated();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function remove(p: Project, e: React.MouseEvent) {
    e.stopPropagation();
    if (confirm(`删除「${p.title}」？此操作不可撤销。`)) deleteProject(p.id).then(props.onDeleted);
  }

  return (
    <div className="projects">
      <div className="page-head">
        <div>
          <h1>我的项目</h1>
          <p className="muted">从一个主题开始，生成剧本 → 分镜 → 素材 → 成片。</p>
        </div>
        <button className="primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? '收起' : '＋ 新建项目'}
        </button>
      </div>

      {showForm && (
        <div className="card form">
          <label>标题<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：重生之我是霸总" /></label>
          <label className="full">主题 / 题材一句话<textarea rows={2} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="重生复仇：女主被未婚夫与闺蜜联手陷害致死，重生回三年前逆袭" /></label>
          <label>题材标签
            <select value={genre} onChange={(e) => setGenre(e.target.value)}>
              {GENRES.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <label>目标受众<input value={audience} onChange={(e) => setAudience(e.target.value)} /></label>
          <label>调性<input value={tone} onChange={(e) => setTone(e.target.value)} /></label>
          <label>集数<input type="number" min={1} max={30} value={episodes} onChange={(e) => setEpisodes(Number(e.target.value))} /></label>
          {err && <span className="err full">{err}</span>}
          <div className="full actions">
            <button className="primary" disabled={busy} onClick={submit}>{busy ? '创建中…' : '创建'}</button>
          </div>
        </div>
      )}

      {props.loading ? (
        <p className="muted">加载中…</p>
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
