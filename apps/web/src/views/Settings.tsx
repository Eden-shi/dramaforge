import { useEffect, useState } from 'react';
import type { ProviderInfo, ProviderType } from '@dramaforge/shared';
import { api } from '../api.js';

const TABS: { t: ProviderType; label: string }[] = [
  { t: 'llm', label: '语言模型 · 剧本' },
  { t: 'image', label: '文生图' },
  { t: 'video', label: '视频生成' },
  { t: 'tts', label: '配音 TTS' },
];

export function SettingsView() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [tab, setTab] = useState<ProviderType>('llm');
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => { api.listProviders().then(setProviders); }, []);
  const list = providers.filter((p) => p.type === tab);

  async function save(id: string) {
    const apiKey = keys[id];
    try {
      await api.setProvider(id, { apiKey });
      setProviders(await api.listProviders());
      setSaved(`${id} 已保存`);
      setTimeout(() => setSaved(null), 2000);
    } catch (e: any) {
      setSaved('保存失败：' + e.message);
    }
  }

  return (
    <div className="settings">
      <h1>设置 · 国内平台对接</h1>
      <p className="muted">在此填入各平台的 API Key。未配置的环节会回退到演示模式（Mock）。密钥仅存于本地，不出服务器。</p>

      <div className="tabs">
        {TABS.map((x) => (
          <button key={x.t} className={tab === x.t ? 'active' : ''} onClick={() => setTab(x.t)}>{x.label}</button>
        ))}
      </div>

      <div className="grid">
        {list.map((p) => (
          <div key={p.id} className="card provider">
            <div className="prov-head">
              <strong>{p.name}</strong>
              <span className="chip">{p.vendor}</span>
              <span className={'dot ' + (p.configured ? 'on' : 'off')} title={p.configured ? '已配置' : '未配置'}>
                {p.configured ? '已配置' : '未配置'}
              </span>
            </div>
            <p className="muted small">{p.baseUrl}</p>
            <p className="muted small">默认模型：{p.model}</p>
            <input
              type="password"
              placeholder={p.configured ? '已保存（输入新值可覆盖）' : '粘贴 API Key'}
              value={keys[p.id] ?? ''}
              onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
            />
            <button className="primary" disabled={!keys[p.id]} onClick={() => save(p.id)}>保存</button>
          </div>
        ))}
      </div>
      {saved && <div className="toast">{saved}</div>}
    </div>
  );
}
