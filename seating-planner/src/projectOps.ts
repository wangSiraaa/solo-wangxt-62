import { Assignment, Project } from './types';

/** 席位变更时递增布局版本 */
export function bumpLayout(p: Project, assignments: Assignment[]): Project {
  return { ...p, assignments, layoutVersion: p.layoutVersion + 1 };
}

/**
 * 撤桌（纯函数）：
 *  - 桌上席位释放，宾客变为待排
 *  - 未出菜订单随桌撤单；已出菜记录保留（不可回滚的事实）
 *  - 指向被撤桌的偏好一并移除
 */
export function removeTablesFromProject(proj: Project, tableIds: string[]): Project {
  const removed = new Set(tableIds);
  return bumpLayout(
    {
      ...proj,
      floor: {
        ...proj.floor,
        tables: proj.floor.tables.filter((t) => !removed.has(t.id)),
      },
      catering: proj.catering.filter((d) => !removed.has(d.tableId) || d.servedAt !== null),
      preferences: proj.preferences.filter((p) => !removed.has(p.targetTableId)),
    },
    proj.assignments.filter((a) => !removed.has(a.seat.tableId)),
  );
}

/** 过期结果拦截：求解发起时的数据版本与当前版本不一致 → 作废 */
export function isStaleResult(baseVersion: number, currentVersion: number): boolean {
  return baseVersion !== currentVersion;
}
