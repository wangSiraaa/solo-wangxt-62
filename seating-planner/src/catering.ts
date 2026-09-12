import { Project } from './types';

/**
 * 菜品与忌口清单差异。
 * 原则：已出菜（servedAt 非空）是不可回滚的事实，撤桌/重排只影响未出菜的订单；
 * 忌口按宾客归属统计，随席位变化生成每桌增减。
 */
export function diffCatering(before: Project, after: Project): string[] {
  const lines: string[] = [];
  const tableLabel = (p: Project, id: string) =>
    p.floor.tables.find((t) => t.id === id)?.label ?? `${id}（已撤）`;

  // ---- 菜品 ----
  const afterDishIds = new Set(after.catering.map((d) => d.id));
  for (const d of before.catering) {
    const label = tableLabel(before, d.tableId);
    if (!afterDishIds.has(d.id)) {
      if (d.servedAt !== null) {
        // 防御：已出菜记录不应被删除
        lines.push(`⚠️ 「${d.name}」(${label}) 已出菜却被移除 —— 已阻止回滚`);
      } else {
        lines.push(`「${d.name}」(${label}) 未出菜 · 已撤单`);
      }
    } else {
      const stillThere = after.floor.tables.some((t) => t.id === d.tableId);
      if (!stillThere && d.servedAt !== null) {
        lines.push(`「${d.name}」(${label}) 已出菜 · 桌已撤，出菜事实保留（不可回滚）`);
      }
    }
  }

  // ---- 忌口（按桌统计增减）----
  const countByTable = (p: Project) => {
    const m = new Map<string, Map<string, number>>();
    for (const a of p.assignments) {
      const diet = p.dietary[a.guestId];
      if (!diet) continue;
      const label = tableLabel(p, a.seat.tableId);
      if (!m.has(label)) m.set(label, new Map());
      const tags = m.get(label)!;
      for (const tag of diet.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
    return m;
  };
  const b = countByTable(before);
  const a = countByTable(after);
  const tables = new Set([...b.keys(), ...a.keys()]);
  for (const t of tables) {
    const tags = new Set([...(b.get(t)?.keys() ?? []), ...(a.get(t)?.keys() ?? [])]);
    for (const tag of tags) {
      const delta = (a.get(t)?.get(tag) ?? 0) - (b.get(t)?.get(tag) ?? 0);
      if (delta !== 0) {
        lines.push(`忌口 ${t}：${tag} ${delta > 0 ? '+' : ''}${delta}`);
      }
    }
  }
  return lines;
}
