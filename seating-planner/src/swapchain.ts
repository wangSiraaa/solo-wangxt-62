import { Assignment, Project, SeatRef, guestLabel, seatKey } from './types';

export interface SwapLeg {
  guestId: string;
  to: SeatRef;
}

export interface ChainValidation {
  ok: boolean;
  error?: string;
  /** 验证通过时的完整新席位表（原子应用，不存在部分落地） */
  resulting?: Assignment[];
  steps: string[];
}

/**
 * 验证局部交换链：
 *  - 链内宾客先全部“离席”，再按顺序落座；任何一步无合法落点 → 整条链不落地
 *  - 支持两人/多人循环换座（A→B 位、B→A 位）
 *  - 锁定席位与锁定宾客不可参与；儿童只能落儿童桌；避让/家庭同桌在终态复核
 */
export function validateSwapChain(project: Project, legs: SwapLeg[]): ChainValidation {
  const steps: string[] = [];
  if (legs.length === 0) return { ok: false, error: '空链', steps };
  const guestById = new Map(project.guests.map((g) => [g.id, g]));
  const tableById = new Map(project.floor.tables.map((t) => [t.id, t]));
  const name = (id: string) => {
    const g = guestById.get(id);
    return g ? guestLabel(g) : id;
  };

  const ids = legs.map((l) => l.guestId);
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: '链中宾客重复', steps };
  }
  for (const l of legs) {
    const g = guestById.get(l.guestId);
    if (!g) return { ok: false, error: `宾客 ${l.guestId} 不存在`, steps };
    const cur = project.assignments.find((a) => a.guestId === l.guestId);
    if (cur?.locked) {
      return { ok: false, error: `${name(l.guestId)} 已锁定，不能参与换座链`, steps };
    }
  }

  // 链外占位（锁定与普通席位）
  const lifted = new Set(ids);
  const occupied = new Map<string, Assignment>();
  for (const a of project.assignments) {
    if (!lifted.has(a.guestId)) occupied.set(seatKey(a.seat), a);
  }

  // 按序落座
  const placed = new Map<string, SeatRef>();
  for (const [i, leg] of legs.entries()) {
    const g = guestById.get(leg.guestId)!;
    const t = tableById.get(leg.to.tableId);
    if (!t) return { ok: false, error: `第 ${i + 1} 步：桌 ${leg.to.tableId} 不存在`, steps };
    if (leg.to.seatIndex < 0 || leg.to.seatIndex >= t.capacity) {
      return { ok: false, error: `第 ${i + 1} 步：${t.label} 没有 ${leg.to.seatIndex + 1} 号位`, steps };
    }
    const key = seatKey(leg.to);
    const occ = occupied.get(key);
    if (occ) {
      return {
        ok: false,
        error: `第 ${i + 1} 步：${t.label} ${leg.to.seatIndex + 1} 号位被 ${name(occ.guestId)}${occ.locked ? '（锁定）' : ''} 占用，无合法落点`,
        steps,
      };
    }
    if (g.isChild && !t.allowsChildren) {
      return { ok: false, error: `第 ${i + 1} 步：${name(g.id)} 是儿童，${t.label} 不允许儿童`, steps };
    }
    occupied.set(key, {
      guestId: leg.guestId,
      seat: leg.to,
      locked: false,
      isChildSeat: g.isChild,
    });
    placed.set(leg.guestId, leg.to);
    steps.push(`第 ${i + 1} 步：${name(leg.guestId)} → ${t.label} ${leg.to.seatIndex + 1} 号位 ✓`);
  }

  // 终态：未参与链的宾客保持原席位
  const resulting: Assignment[] = [
    ...project.assignments.filter((a) => !lifted.has(a.guestId)),
    ...legs.map((l) => ({
      guestId: l.guestId,
      seat: l.to,
      locked: false,
      isChildSeat: guestById.get(l.guestId)!.isChild,
    })),
  ];

  // 终态复核：避让
  const tableOf = new Map(resulting.map((a) => [a.guestId, a.seat.tableId]));
  for (const ap of project.avoidPairs) {
    const ta = tableOf.get(ap.a);
    const tb = tableOf.get(ap.b);
    if (ta && tb && ta === tb) {
      return {
        ok: false,
        error: `终态冲突：${name(ap.a)} 与 ${name(ap.b)} 避让失败（同坐 ${tableById.get(ta)?.label}）`,
        steps,
      };
    }
  }
  // 终态复核：家庭同桌（已入席成员）
  const families = new Map<string, string[]>();
  for (const g of project.guests) {
    if (g.familyId && tableOf.has(g.id)) {
      if (!families.has(g.familyId)) families.set(g.familyId, []);
      families.get(g.familyId)!.push(g.id);
    }
  }
  for (const [fid, members] of families) {
    const tables = new Set(members.map((id) => tableOf.get(id)));
    if (tables.size > 1) {
      return { ok: false, error: `终态冲突：家庭「${fid}」成员被拆到不同桌`, steps };
    }
  }
  return { ok: true, resulting, steps };
}
