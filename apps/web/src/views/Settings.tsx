import { useEffect, useState } from 'react';
import type { CustomProviderInput, ProviderInfo, ProviderProtocol, ProviderType } from '@dramaforge/shared';
import { api } from '../api.js';

const TABS: { t: ProviderType; label: string }[] = [
  { t: 'llm', label: '语言模型 · 剧本' },
  { t: 'image', label: '文生图' },
  { t: 'video', label: '视频生成' },
  { t: 'tts', label: '配音 TTS' },
];

const PROTOCOLS: { id: ProviderProtocol; label: string; hint: string; examples: string }[] = [
  { id: 'openai_compat', label: 'OpenAI 兼容协议', hint: '标准 /v1/chat/completions 接口，同步返回', examples: 'DeepSeek、通义 Qwen、智谱 GLM、硅基流动、OpenRouter、MiniMax、Kimi、零一万物、Yi、StepFun 等' },
  { id: 'dashscope_async', label: '通义异步（文生图）', hint: '提交任务→轮询 task_id', examples: '通义万相 wanx-v1' },
  { id: 'kling_async', label: '可灵异步（视频）', hint: 'POST 提交→GET 轮询', examples: '可灵 Kling 全系' },
  { id: 'jimeng_async', label: '即梦异步（视频）', hint: '火山引擎风格异步任务', examples: '即梦 Dreamina、火山引擎方舟视频模型' },
  { id: 'minimax_async', label: 'MiniMax 异步（视频+TTS）', hint: 'MiniMax 海螺视频 / 语音合成', examples: 'MiniMax video-01、speech-01-hd' },
];

export function SettingsView() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [tab, setTab] = useState<ProviderType>('llm');
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<string | null>(null);

  // Custom provider form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formProtocol, setFormProtocol] = useState<ProviderProtocol>('openai_compat');
  const [formBusy, setFormBusy] = useState(false);

  useEffect(() => { api.listProviders().then(setProviders); }, []);
  const list = providers.filter((p) => p.type === tab);

  async function save(id: string) {
    const apiKey = keys[id];
    try {
      await api.setProvider(id, { apiKey });
      setProviders(await api.listProviders());
      setSaved(id + ' 已保存');
      setTimeout(() => setSaved(null), 2000);
    } catch (e: any) {
      setSaved('保存失败：' + e.message);
    }
  }

  async function addCustom() {
    if (!formName.trim() || !formBaseUrl.trim()) return;
    setFormBusy(true);
    try {
      const payload: CustomProviderInput = {
        name: formName.trim(),
        type: tab,
        protocol: formProtocol,
        baseUrl: formBaseUrl.trim(),
        model: formModel.trim() || undefined,
        apiKey: formApiKey.trim() || undefined,
      };
      await fetch('/api/providers/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); });
      setFormName(''); setFormBaseUrl(''); setFormModel(''); setFormApiKey('');
      setShowForm(false);
      setProviders(await api.listProviders());
      setSaved('已添加自定义供应商');
      setTimeout(() => setSaved(null), 2000);
    } catch (e: any) {
      setSaved('添加失败：' + e.message);
    } finally { setFormBusy(false); }
  }

  async function test(id: string) {
    setTesting(id); setTestResult((r) => ({ ...r, [id]: '' }));
    try {
      const r = await api.testProvider(id);
      setTestResult((tr) => ({ ...tr, [id]: r.ok ? ('OK ' + (r.reply || '成功')) : ('X ' + (r.error || '失败')) }));
    } catch (e) {
      setTestResult((tr) => ({ ...tr, [id]: 'X ' + (e.message || '失败') }));
    } finally { setTesting(null); }
  }

  async function removeCustom(id: string) {
    if (!confirm('确认删除此自定义供应商？')) return;
    try {
      await fetch('/api/providers/custom/' + id, { method: 'DELETE' });
      setProviders(await api.listProviders());
      setSaved('已删除');
      setTimeout(() => setSaved(null), 2000);
    } catch (e: any) {
      setSaved('删除失败：' + e.message);
    }
  }

  return (
    <div className="settings">
      <h1>设置 · 国内平台对接</h1>
      <p className="muted">在此填写各平台的 API Key。未配置的环节会回退到演示模式（Mock）。密钥仅存于本地，不出服务器。</p>

      <div className="tabs" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        {TABS.map((x) => (
          <button key={x.t} className={tab === x.t ? 'active' : ''} onClick={() => setTab(x.t)}>{x.label}</button>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <button className="ghost" onClick={() => setShowForm(s => !s)}>
            {showForm ? '收起' : '+ 添加自定义'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="custom-form" style={{ marginBottom: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="form-grid">
            <label className="grid-label">
              名称
              <input placeholder="例如 硅基流动" value={formName} onChange={(e) => setFormName(e.target.value)} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--muted)' }}>
              协议模板
              <select value={formProtocol} onChange={(e) => setFormProtocol(e.target.value as ProviderProtocol)}>
                {PROTOCOLS.filter((p) => {
                  // 根据当前类型显示可用的协议
                  return (
                    (tab === 'llm' && p.id === 'openai_compat') ||
                    (tab === 'image' && (p.id === 'openai_compat' || p.id === 'dashscope_async')) ||
                    (tab === 'tts' && (p.id === 'openai_compat' || p.id === 'minimax_async')) ||
                    (tab === 'video' && (p.id === 'openai_compat' || p.id === 'kling_async' || p.id === 'jimeng_async' || p.id === 'minimax_async'))
                  );
                }).map((p) => (
                  <option key={p.id} value={p.id} title={p.hint}>{p.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--muted)' }}>
              Base URL
              <input placeholder="https://api.siliconflow.cn/v1" value={formBaseUrl} onChange={(e) => setFormBaseUrl(e.target.value)}
  style={{ fontFamily: 'monospace', fontSize: 13 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--muted)' }}>
              模型名（可选）
              <input placeholder="deepseek-ai/DeepSeek-V3" value={formModel} onChange={(e) => setFormModel(e.target.value)}
  style={{ fontFamily: 'monospace', fontSize: 13 }} />
            </label>
            <label className="full">
              API Key
              <input type="password" placeholder="sk-..." value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} />
            </label>
          </div>
          <p className="muted small" >
            {PROTOCOLS.find((p) => p.id === formProtocol)?.hint}
          </p>
          <div className="actions">
            <button className="ghost" onClick={() => setShowForm(false)}>取消</button>
            <button className="primary" disabled={formBusy || !formName || !formBaseUrl} onClick={addCustom}>
              {formBusy ? '添加中…' : '确认添加'}
            </button>
          </div>
        </div>
      )}

      <div className="grid">
        {list.map((p) => (
          <div key={p.id} className="card provider">
            <div className="prov-head">
              <strong>{p.name}</strong>
              <span className="chip">{p.vendor}</span>
              {p.custom && <span className="chip" style={{ borderColor: 'var(--accent)' }}>自定义</span>}
              <span className={'dot ' + (p.configured ? 'on' : 'off')}>
                {p.configured ? '已配置' : '未配置'}
              </span>
              {p.custom && (
                <button className="ghost danger" style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 8px' }}
                  onClick={() => removeCustom(p.id)}>删除供应商</button>
              )}
            </div>
            <p className="muted small">{p.baseUrl}</p>
            <p className="muted small">模型：{p.model || '默认'}</p>
            {p.protocol && <p className="muted small" style={{ fontSize: 11 }}>协议：{p.protocol}</p>}
            <div className="prov-key-row">
              <input
                type={showKey === p.id ? 'text' : 'password'}
                placeholder={p.configured ? '已配置，输入新值可覆盖' : '粘贴 API Key'}
                value={keys[p.id] ?? ''}
                onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                style={{ flex: 1 }}
              />
              <span className="toggle-vis"
                onClick={() => setShowKey((prev) => (prev === p.id ? null : p.id))}>
                {showKey === p.id ? '隐藏' : '显示'}
              </span>
            </div>
            <div className="prov-actions">
              <button className="primary" disabled={testing != null} onClick={() => save(p.id)}>{keys[p.id] ? "保存 Key" : "更新"}</button>
              <button className="ghost" disabled={testing === p.id || !p.configured} onClick={() => test(p.id)}>{testing === p.id ? "测试中..." : "测试连通性"}</button>
              {p.configured && (
                <button className="ghost danger" disabled={testing != null}
                  onClick={async () => {
                    if (!confirm(`确认清除「${p.name}」的 API Key 吗？`)) return;
                    setKeys((k) => ({ ...k, [p.id]: '' }));
                    try {
                      await api.setProvider(p.id, { apiKey: '' });
                      setProviders(await api.listProviders());
                      setSaved('已清除 ' + p.name);
                      setTimeout(() => setSaved(null), 2000);
                    } catch (e: any) {
                      setSaved('清除失败：' + e.message);
                    }
                  }}>清除 Key</button>
              )}
            </div>
            {testResult[p.id] && <p className="prov-test-result" style={{ color: testResult[p.id].startsWith("OK") ? "var(--ok)" : "var(--err)" }}>{testResult[p.id]}</p>}
          </div>
        ))}
      </div>
      {saved && <div className="toast">{saved}</div>}
      {list.length === 0 && !showForm && <p className="muted">当前分类暂无可用供应商，点击右上角"添加自定义"自行配置。</p>}
    </div>
  );
}
