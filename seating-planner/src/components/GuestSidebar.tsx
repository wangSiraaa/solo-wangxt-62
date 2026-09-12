import React, { useState } from 'react';
import { useStore } from '../store';
import { guestLabel, seatKey } from '../types';

const RSVP_LABEL = { confirmed: '已确认', pending: '未回复', declined: '已婉拒' } as const;

export function GuestSidebar() {
  const { state, addGuest, updateGuest, removeGuest, setDietary, assignSeat, toggleLock, selectGuest } =
    useStore();
  const { project, selectedGuestId } = state;
  const [newName, setNewName] = useState('');
  const [filter, setFilter] = useState('');

  const tableLabel = (tableId: string) =>
    project.floor.tables.find((t) => t.id === tableId)?.label ?? tableId;

  const guests = project.guests.filter((g) => g.displayName.includes(filter));

  return (
    <div style={{ width: 320, overflowY: 'auto', padding: 8, borderRight: '1px solid #ddd' }}>
      <h3>宾客（{project.guests.length}）</h3>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <input
          value={newName}
          placeholder="姓名（同名自动编号）"
          onChange={(e) => setNewName(e.target.value)}
          style={{ flex: 1 }}
        />
        <button
          onClick={() => {
            if (newName.trim()) {
              addGuest(newName.trim());
              setNewName('');
            }
          }}
        >
          添加
        </button>
      </div>
      <input
        value={filter}
        placeholder="搜索…"
        onChange={(e) => setFilter(e.target.value)}
        style={{ width: '100%', marginBottom: 8 }}
      />
      {guests.map((g) => {
        const a = project.assignments.find((x) => x.guestId === g.id);
        const diet = project.dietary[g.id];
        const selected = g.id === selectedGuestId;
        return (
          <div
            key={g.id}
            onClick={() => selectGuest(selected ? null : g.id)}
            style={{
              border: selected ? '2px solid #4a90d9' : '1px solid #ccc',
              borderRadius: 6,
              padding: 6,
              marginBottom: 6,
              cursor: 'pointer',
              background: g.rsvp === 'pending' ? '#fffbe6' : g.rsvp === 'declined' ? '#f5f5f5' : '#fff',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>
                {guestLabel(g)} {g.isChild && '👶'}
              </strong>
              <span style={{ fontSize: 12, color: '#666' }}>{g.id}</span>
            </div>
            <div style={{ fontSize: 12, color: '#555' }}>
              {RSVP_LABEL[g.rsvp]}
              {g.familyId && ` · 家庭:${g.familyId}`}
              {a && ` · ${tableLabel(a.seat.tableId)} ${a.seat.seatIndex + 1} 号位${a.locked ? ' 🔒' : ''}`}
            </div>
            {g.note && <div style={{ fontSize: 12, color: '#888' }}>{g.note}</div>}
            {selected && (
              <div style={{ marginTop: 6, fontSize: 13 }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  <select
                    value={g.rsvp}
                    onChange={(e) => updateGuest(g.id, { rsvp: e.target.value as never })}
                  >
                    <option value="confirmed">已确认</option>
                    <option value="pending">未回复</option>
                    <option value="declined">已婉拒</option>
                  </select>
                  <label>
                    <input
                      type="checkbox"
                      checked={g.isChild}
                      onChange={(e) => updateGuest(g.id, { isChild: e.target.checked })}
                    />
                    儿童
                  </label>
                  <input
                    placeholder="家庭组 id"
                    defaultValue={g.familyId ?? ''}
                    style={{ width: 90 }}
                    onBlur={(e) =>
                      updateGuest(g.id, { familyId: e.target.value.trim() || null })
                    }
                  />
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <input
                    placeholder="忌口标签，逗号分隔"
                    defaultValue={diet?.tags.join(',') ?? ''}
                    style={{ flex: 1 }}
                    onBlur={(e) =>
                      setDietary({
                        guestId: g.id,
                        tags: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
                        detail: diet?.detail ?? '',
                      })
                    }
                  />
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {a ? (
                    <>
                      <button onClick={() => toggleLock(g.id)}>
                        {a.locked ? '解锁席位' : '锁定席位'}
                      </button>
                      <button onClick={() => assignSeat(g.id, null)}>移出席位</button>
                    </>
                  ) : (
                    g.rsvp === 'confirmed' && <span style={{ color: '#888' }}>点击画布上的空椅子安排入座</span>
                  )}
                  <button style={{ marginLeft: 'auto', color: '#a00' }} onClick={() => removeGuest(g.id)}>
                    删除
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
