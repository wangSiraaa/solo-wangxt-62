import React, { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './store';
import { GuestSidebar } from './components/GuestSidebar';
import { FloorCanvas } from './components/FloorCanvas';
import { ConstraintPanel } from './components/ConstraintPanel';
import { canPrint, exportPlaceCards } from './export';
import { createSampleProject } from './sample';
import { lastProjectId, loadProject } from './db';
import { Project } from './types';

function Toolbar() {
  const { state, addTable, removeTables, addWalkIn, lockAllSeated, mutate } = useStore();
  const { project, solving, lastSolve, resultConsumed } = state;
  const [printError, setPrintError] = useState<string | null>(null);

  const hasUnconsumedResult =
    !resultConsumed && (lastSolve?.status === 'optimal' || lastSolve?.status === 'feasible');

  const onPrint = () => {
    const err = canPrint({ solving, hasUnconsumedResult });
    setPrintError(err);
    if (!err) exportPlaceCards(project);
  };

  // 演示：9 人家庭到场，剩余最大桌容量 8 → 必无解
  const demoBigFamily = () => {
    mutate((proj) => ({
      ...proj,
      guests: [
        ...proj.guests,
        ...Array.from({ length: 9 }, (_, i) => ({
          id: `G-${String(proj.nextGuestSeq + i).padStart(4, '0')}`,
          displayName: `大家成员${i + 1}`,
          nameIndex: 1,
          rsvp: 'confirmed' as const,
          isChild: false,
          familyId: 'F-大家',
          note: '演示：家庭容量不足',
        })),
      ],
      nextGuestSeq: proj.nextGuestSeq + 9,
    }));
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderBottom: '1px solid #ddd', flexWrap: 'wrap' }}>
      <strong>{project.name}</strong>
      <span style={{ fontSize: 12, background: '#eef', borderRadius: 4, padding: '1px 6px' }}>
        布局 v{project.layoutVersion}
      </span>
      <span style={{ color: '#888', fontSize: 12 }}>已自动保存到 IndexedDB（离线可用）</span>
      <button
        onClick={() =>
          addTable({
            id: `T-${Date.now().toString(36)}`,
            label: `T${project.floor.tables.length + 1}`,
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
      <button onClick={lockAllSeated}>锁定全部已入席</button>
      <button onClick={() => removeTables(['T-3', 'T-4'])}>演示：撤掉 T3/T4</button>
      <button onClick={() => addWalkIn(`临时到场-${project.guests.filter((g) => g.rsvp === 'walkin').length + 1}`)}>
        + 临时到场
      </button>
      <button onClick={demoBigFamily}>演示：9人家庭到场</button>
      <button onClick={onPrint}>打印桌卡</button>
      {printError && <span style={{ color: '#a00', fontSize: 12 }}>{printError}</span>}
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
