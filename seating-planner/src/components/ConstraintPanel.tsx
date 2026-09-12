import React, { useState } from 'react';
import { estimatePenalty, useStore } from '../store';
import { guestLabel, seatKey } from '../types';
import { SwapChainPanel } from './SwapChainPanel';
import { CateringPanel } from './CateringPanel';

export function ConstraintPanel() {
  const {
    state,
    addAvoid,
    removeAvoid,
    addPreference,
    removePreference,
    runSolver,
    applySolution,
    dismissResult,
    undo,
    canUndo,
    clearAutoSnapshot,
  } = useStore();
  const { project, lastSolve, solving, autoSnapshot } = state;
  const [avoidA, setAvoidA] = useState('');
  const [avoidB, setAvoidB] = useState('');
  const [prefGuest, setPrefGuest] = useState('');
  const [prefWeight, setPrefWeight] = useState(1);

  const guestById = new Map(project.guests.map((g) => [g.id, g]));
  const headTable = project.floor.tables.find((t) => t.isHead) ?? project.floor.tables[0];
  const name = (id: string) => {
    const g = guestById.get(id);
    return g ? `${guestLabel(g)} [${g.id}]` : id;
  };

  const currentPenalty = estimatePenalty(project);
  const assignedCount = project.assignments.length;

  // 手工方案与自动快照的差异
  const diff = autoSnapshot
    ? (() => {
        const snapMap = new Map(autoSnapshot.assignments.map((a) => [a.guestId, seatKey(a.seat)]));
        const curMap = new Map(project.assignments.map((a) => [a.guestId, seatKey(a.seat)]));
        const ids = new Set([...snapMap.keys(), ...curMap.keys()]);
        let changed = 0;
        for (const id of ids) if (snapMap.get(id) !== curMap.get(id)) changed++;
        return changed;
      })()
    : 0;

  return (
    <div style={{ width: 340, overflowY: 'auto', padding: 8, borderLeft: '1px solid #ddd' }}>
      <h3>约束与求解</h3>

      <section>
        <h4>明确避让（硬约束）</h4>
        {project.avoidPairs.map((ap) => (
          <div key={ap.id} style={{ fontSize: 13, marginBottom: 4 }}>
            🚫 {name(ap.a)} ↔ {ap.b && name(ap.b)}
            <div style={{ color: '#888' }}>{ap.reason}</div>
            <button onClick={() => removeAvoid(ap.id)}>删除</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <select value={avoidA} onChange={(e) => setAvoidA(e.target.value)}>
            <option value="">宾客 A</option>
            {project.guests.map((g) => (
              <option key={g.id} value={g.id}>
                {guestLabel(g)} [{g.id}]
              </option>
            ))}
          </select>
          <select value={avoidB} onChange={(e) => setAvoidB(e.target.value)}>
            <option value="">宾客 B</option>
            {project.guests.map((g) => (
              <option key={g.id} value={g.id}>
                {guestLabel(g)} [{g.id}]
              </option>
            ))}
          </select>
          <button
            disabled={!avoidA || !avoidB || avoidA === avoidB}
            onClick={() => addAvoid(avoidA, avoidB, '手工添加')}
          >
            添加避让
          </button>
        </div>
      </section>

      <section style={{ marginTop: 12 }}>
        <h4>靠近主桌偏好（软约束，可放宽）</h4>
        {project.preferences.map((p) => (
          <div key={p.id} style={{ fontSize: 13, marginBottom: 4 }}>
            ⭐ {name(p.guestId)} → 靠近「
            {project.floor.tables.find((t) => t.id === p.targetTableId)?.label}」权重 {p.weight}
            <button style={{ marginLeft: 6 }} onClick={() => removePreference(p.id)}>
              删除
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 4 }}>
          <select value={prefGuest} onChange={(e) => setPrefGuest(e.target.value)}>
            <option value="">选择宾客</option>
            {project.guests
              .filter((g) => g.rsvp === 'confirmed')
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {guestLabel(g)} [{g.id}]
                </option>
              ))}
          </select>
          <input
            type="number"
            min={0}
            step={0.5}
            value={prefWeight}
            style={{ width: 56 }}
            onChange={(e) => setPrefWeight(Number(e.target.value))}
          />
          <button
            disabled={!prefGuest || !headTable}
            onClick={() =>
              addPreference({
                guestId: prefGuest,
                targetTableId: headTable!.id,
                weight: prefWeight,
                note: '',
              })
            }
          >
            添加
          </button>
        </div>
      </section>

      <section style={{ marginTop: 12 }}>
        <h4>自动排座 / 撤桌重排（GLPK / Web Worker）</h4>
        <div style={{ fontSize: 12, color: '#777', marginBottom: 4 }}>
          字典序目标：先最少换桌，再最小化偏好代价；锁定宾客绝不被挪动
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={runSolver} disabled={solving}>
            {solving ? '求解中…' : '运行重排'}
          </button>
          <button onClick={undo} disabled={!canUndo}>
            撤销手工操作
          </button>
        </div>
        {lastSolve && (
          <div
            style={{
              marginTop: 8,
              padding: 8,
              borderRadius: 6,
              background:
                lastSolve.status === 'infeasible'
                  ? '#fdecea'
                  : lastSolve.status === 'error' || lastSolve.status === 'stale'
                    ? '#fff3cd'
                    : '#e8f5e9',
              fontSize: 13,
            }}
          >
            <div>
              <strong>{lastSolve.message}</strong>
            </div>
            {lastSolve.conflicts?.map((c, i) => (
              <div key={i} style={{ color: '#a00', marginTop: 4 }}>
                • {c}
              </div>
            ))}
            {lastSolve.capacity && (
              <div style={{ marginTop: 4 }}>
                容量核算：剩余 {lastSolve.capacity.seats} 席 · 实际需求 {lastSolve.capacity.required}
                人（含临时到场 {lastSolve.capacity.walkins}）· 候选（未回复）
                {lastSolve.capacity.pendingCandidates} 人 ·{' '}
                {lastSolve.capacity.pendingFit ? '✅ 候选全部到场也坐得下' : '⚠️ 候选全部到场将超员'}
              </div>
            )}
            {lastSolve.assignments && (
              <>
                <div style={{ marginTop: 4 }}>
                  换桌人数：<strong>{lastSolve.moves ?? 0}</strong>（最少换桌目标） · 偏好总代价：
                  <strong>{(lastSolve.totalPenalty ?? 0).toFixed(2)}</strong>
                </div>
                {(lastSolve.perGuestCost ?? []).filter((c) => c.cost > 0.01).length > 0 && (
                  <details>
                    <summary>逐宾客代价明细</summary>
                    {(lastSolve.perGuestCost ?? [])
                      .filter((c) => c.cost > 0.01)
                      .sort((a, b) => b.cost - a.cost)
                      .map((c) => (
                        <div key={c.guestId}>
                          {name(c.guestId)}：{c.cost.toFixed(2)}
                        </div>
                      ))}
                  </details>
                )}
                <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                  <button onClick={applySolution}>应用该方案（可撤销）</button>
                  <button onClick={dismissResult}>忽略</button>
                </div>
              </>
            )}
            {lastSolve.status === 'stale' && (
              <div style={{ marginTop: 4 }}>该结果未写入任何状态，不会进入打印。</div>
            )}
          </div>
        )}
      </section>

      <section style={{ marginTop: 12 }}>
        <h4>手工 vs 自动对比</h4>
        <div style={{ fontSize: 13 }}>
          <div>当前已排：{assignedCount} 人 · 当前偏好代价：{currentPenalty.toFixed(2)}</div>
          {autoSnapshot ? (
            <>
              <div>
                自动方案（{new Date(autoSnapshot.at).toLocaleTimeString()}，{autoSnapshot.status}，基于布局 v
                {autoSnapshot.layoutVersion}）：{autoSnapshot.assignments.length} 人 · 换桌 {autoSnapshot.moves} · 代价{' '}
                {autoSnapshot.totalPenalty.toFixed(2)}
              </div>
              <div>
                与当前方案差异：<strong>{diff}</strong> 个席位不同 · 代价差{' '}
                {(currentPenalty - autoSnapshot.totalPenalty).toFixed(2)}
              </div>
              <button onClick={clearAutoSnapshot}>清除对比基准</button>
            </>
          ) : (
            <div style={{ color: '#888' }}>运行一次自动排座后，此处与手工调整对比。</div>
          )}
        </div>
      </section>

      <SwapChainPanel />
      <CateringPanel />
    </div>
  );
}
