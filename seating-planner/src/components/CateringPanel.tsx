import React from 'react';
import { useStore } from '../store';

/** 菜品与忌口清单：出菜单向不可逆；撤桌/重排后展示差异 */
export function CateringPanel() {
  const { state, serveDish } = useStore();
  const { project, lastDiff } = state;
  const tableById = new Map(project.floor.tables.map((t) => [t.id, t]));

  const active = project.catering.filter((d) => tableById.has(d.tableId));
  const orphaned = project.catering.filter((d) => !tableById.has(d.tableId));

  return (
    <section style={{ marginTop: 12 }}>
      <h4>菜品与忌口</h4>
      <div style={{ fontSize: 13 }}>
        {project.floor.tables.map((t) => {
          const dishes = active.filter((d) => d.tableId === t.id);
          if (dishes.length === 0) return null;
          return (
            <div key={t.id} style={{ marginBottom: 4 }}>
              <strong>{t.label}</strong>
              {dishes.map((d) => (
                <div key={d.id} style={{ paddingLeft: 8 }}>
                  {d.name} ×{d.servings}{' '}
                  {d.servedAt !== null ? (
                    <span style={{ color: '#2a7d2a' }}>✓ 已出菜（不可回滚）</span>
                  ) : (
                    <button onClick={() => serveDish(d.id)}>标记出菜</button>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        {orphaned.length > 0 && (
          <div style={{ marginTop: 4, color: '#a76' }}>
            已撤桌的出菜事实（保留）：
            {orphaned.map((d) => (
              <div key={d.id} style={{ paddingLeft: 8 }}>
                {d.name}（原 {d.tableId}）✓ 已出菜
              </div>
            ))}
          </div>
        )}
      </div>
      {lastDiff.length > 0 && (
        <div style={{ marginTop: 8, padding: 6, background: '#fff8e1', borderRadius: 4, fontSize: 13 }}>
          <strong>菜品/忌口差异：</strong>
          {lastDiff.map((l, i) => (
            <div key={i}>• {l}</div>
          ))}
        </div>
      )}
    </section>
  );
}
