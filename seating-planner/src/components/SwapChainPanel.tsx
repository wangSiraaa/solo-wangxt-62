import React, { useState } from 'react';
import { useStore } from '../store';
import { SwapLeg } from '../swapchain';
import { guestLabel } from '../types';

/** 局部交换链：人工构造，逐步验证，任何一步无合法落点则整条链不落地 */
export function SwapChainPanel() {
  const { state, applySwapChain } = useStore();
  const { project, swapError } = state;
  const [legs, setLegs] = useState<SwapLeg[]>([]);
  const [guestId, setGuestId] = useState('');
  const [tableId, setTableId] = useState('');
  const [seatIndex, setSeatIndex] = useState(0);
  const [lastSteps, setLastSteps] = useState<string[]>([]);
  const [lastOk, setLastOk] = useState<boolean | null>(null);

  const seated = project.assignments.filter((a) => !a.locked);
  const guestById = new Map(project.guests.map((g) => [g.id, g]));
  const tableById = new Map(project.floor.tables.map((t) => [t.id, t]));
  const name = (id: string) => {
    const g = guestById.get(id);
    return g ? guestLabel(g) : id;
  };
  const seatName = (t: string, i: number) =>
    `${tableById.get(t)?.label ?? t} ${i + 1} 号位`;

  const run = (chain: SwapLeg[]) => {
    const ok = applySwapChain(chain);
    setLastOk(ok);
    setLastSteps(ok ? chain.map((l, i) => `第 ${i + 1} 步：${name(l.guestId)} → ${seatName(l.to.tableId, l.to.seatIndex)} ✓`) : []);
    if (ok) setLegs([]);
  };

  // 演示：两人循环换座（A→B 位，B→A 位）
  const demoCycle = () => {
    const adults = seated.filter((a) => {
      const g = guestById.get(a.guestId);
      return g && !g.isChild;
    });
    if (adults.length < 2) return;
    const [x, y] = adults;
    const chain: SwapLeg[] = [
      { guestId: x.guestId, to: y.seat },
      { guestId: y.guestId, to: x.seat },
    ];
    setLegs(chain);
  };

  return (
    <section style={{ marginTop: 12 }}>
      <h4>局部交换链（原子落地）</h4>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 13 }}>
        <select value={guestId} onChange={(e) => setGuestId(e.target.value)}>
          <option value="">已入席宾客</option>
          {seated.map((a) => (
            <option key={a.guestId} value={a.guestId}>
              {name(a.guestId)}（现 {seatName(a.seat.tableId, a.seat.seatIndex)}）
            </option>
          ))}
        </select>
        <select
          value={tableId}
          onChange={(e) => {
            setTableId(e.target.value);
            setSeatIndex(0);
          }}
        >
          <option value="">目标桌</option>
          {project.floor.tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {tableId && (
          <select value={seatIndex} onChange={(e) => setSeatIndex(Number(e.target.value))}>
            {Array.from({ length: tableById.get(tableId)!.capacity }, (_, i) => (
              <option key={i} value={i}>
                {i + 1} 号位
              </option>
            ))}
          </select>
        )}
        <button
          disabled={!guestId || !tableId}
          onClick={() => {
            setLegs([...legs, { guestId, to: { tableId, seatIndex } }]);
            setGuestId('');
          }}
        >
          + 链节
        </button>
      </div>
      {legs.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 13 }}>
          {legs.map((l, i) => (
            <div key={i}>
              {i + 1}. {name(l.guestId)} → {seatName(l.to.tableId, l.to.seatIndex)}
              <button style={{ marginLeft: 6 }} onClick={() => setLegs(legs.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
            <button onClick={() => run(legs)}>验证并执行（原子）</button>
            <button onClick={() => setLegs([])}>清空</button>
          </div>
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        <button onClick={demoCycle} disabled={seated.length < 2}>
          演示：两人循环换座
        </button>
      </div>
      {swapError && (
        <div style={{ marginTop: 6, padding: 6, background: '#fdecea', borderRadius: 4, fontSize: 13 }}>
          ❌ 链未落地：{swapError}
        </div>
      )}
      {lastOk === true && (
        <div style={{ marginTop: 6, padding: 6, background: '#e8f5e9', borderRadius: 4, fontSize: 13 }}>
          ✅ 链已整体应用（可撤销）
          {lastSteps.map((s, i) => (
            <div key={i}>{s}</div>
          ))}
        </div>
      )}
    </section>
  );
}
