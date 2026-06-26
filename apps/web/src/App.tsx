import { useEffect, useState } from 'react';
import { api } from './api.js';
import type { Project } from '@dramaforge/shared';
import { ProjectsView } from './views/Projects.js';
import { WorkspaceView } from './views/Workspace.js';
import { SettingsView } from './views/Settings.js';

type View = { name: 'projects' } | { name: 'workspace'; id: string } | { name: 'settings' };

export function App() {
  const [view, setView] = useState<View>({ name: 'projects' });
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    setLoading(true);
    api.listProjects().then(setProjects).finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => setView({ name: 'projects' })}>
          <span className="logo">▶</span> DramaForge
        </div>
        <nav>
          <button className={view.name === 'projects' ? 'active' : ''} onClick={() => setView({ name: 'projects' })}>
            项目
          </button>
          <button className={view.name === 'settings' ? 'active' : ''} onClick={() => setView({ name: 'settings' })}>
            设置
          </button>
        </nav>
      </header>

      <main className="content">
        {view.name === 'projects' && (
          <ProjectsView
            projects={projects}
            loading={loading}
            onCreated={() => refresh()}
            onOpen={(id) => setView({ name: 'workspace', id })}
            onDeleted={() => refresh()}
          />
        )}
        {view.name === 'workspace' && (
          <WorkspaceView projectId={view.id} onBack={() => setView({ name: 'projects' })} />
        )}
        {view.name === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
