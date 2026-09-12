import React, { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './store';
import { GuestSidebar } from './components/GuestSidebar';
import { FloorCanvas } from './components/FloorCanvas';
import { ConstraintPanel } from './components/ConstraintPanel';
import { exportPlaceCards } from './export';
import { createSampleProject, emptyProject } from './sample';
import { lastProjectId, listProjects, loadProject } from './db';
import { Project } from './types';

function Toolbar() {
  const { state, addTable } = useStore();
  const { project } = state;
  const roundCount = project.floor.tables.filter((t) => t.shape.kind === 'round').length;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderBottom: '1px solid #ddd' }}>
      <strong>{project.name}</strong>
      <span style={{ color: '#888', fontSize: 12 }}>已自动保存到 IndexedDB（离线可用）</span>
      <button
        onClick={() =>
          addTable({
            id: `T-${Date.now().toString(36)}`,
            label: `T${roundCount + 1 + project.floor.tables.filter((t) => t.shape.kind === 'rect').length}`,
            shape: { kind: 'round', radius: 80 },
            center: { x: 400, y: 400 },
            rotationDeg: 0,
            capacity: 8,
            isHead: false,
            allowsChildren: true,
          })
        }
      >
        + 圆桌
      </button>
      <button onClick={() => exportPlaceCards(project)}>导出桌卡</button>
      <span style={{ marginLeft: 'auto', fontSize: 12, color: '#a76' }}>
        禁占区仅做几何重叠检查，不构成消防/安全认证
      </span>
    </div>
  );
}

function Main() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Toolbar />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <GuestSidebar />
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          <FloorCanvas />
          <p style={{ fontSize: 12, color: '#777' }}>
            操作：左侧选中宾客 → 点击空椅子入座；点击已坐椅子查看/换座；拖动桌子调整布局；紫色为锁定席位，绿色为儿童椅。
          </p>
        </div>
        <ConstraintPanel />
      </div>
    </div>
  );
}

export default function App() {
  const [initial, setInitial] = useState<Project | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const id = await lastProjectId();
        const existing = id ? await loadProject(id) : undefined;
        setInitial(existing ?? createSampleProject());
      } catch {
        setInitial(createSampleProject());
      }
    })();
  }, []);

  if (!initial) return <div style={{ padding: 24 }}>加载中…</div>;
  return (
    <StoreProvider initial={initial}>
      <Main />
    </StoreProvider>
  );
}
