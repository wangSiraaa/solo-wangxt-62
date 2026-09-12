import {
  Assignment,
  BanquetTable,
  Guest,
  ProximityPreference,
  AvoidPair,
  SeatRef,
  guestLabel,
} from '../types';
import { seatPosition } from '../geometry';

/** glpk.js 的对象模型格式 */
export interface GLPKModel {
  name: string;
  objective: {
    direction: number; // 1 = min, 2 = max
    name: string;
    vars: { name: string; coef: number }[];
  };
  subjectTo: {
    name: string;
    vars: { name: string; coef: number }[];
    bnds: { type: number; ub: number; lb: number };
  }[];
  binaries?: string[];
}

export interface BuiltModel {
  model: GLPKModel;
  varMeta: Record<string, { guestId: string; seat: SeatRef }>;
  lockedAssignments: Assignment[];
  conflicts: string[]; // 建模阶段即可发现的硬冲突
}

const GLP_LO = 1;
const GLP_UP = 3;
const GLP_FX = 5;

function varName(g: string, s: SeatRef): string {
  return `x_${g}_${s.tableId}_${s.seatIndex}`;
}

/**
 * 建模：
 *  - 仅 confirmed 宾客参与自动排座；pending/declined 不进模型
 *  - 锁定席位：对应 x 固定为 1，该席位不再生成其他变量
 *  - 家庭同行：z[f,t] 选择唯一桌，成员席位变量受 z 约束
 *  - 明确避让：同桌两人之和 <= 1
 *  - 儿童只能坐 allowsChildren 的桌；儿童椅占一个普通席位
 *  - 软约束：靠近目标桌的偏好转化为目标函数距离代价
 */
export function buildModel(
  guests: Guest[],
  tables: BanquetTable[],
  assignments: Assignment[],
  avoidPairs: AvoidPair[],
  preferences: ProximityPreference[],
): BuiltModel {
  const conflicts: string[] = [];
  const byId = new Map(guests.map((g) => [g.id, g]));
  const locked = assignments.filter((a) => a.locked && byId.get(a.guestId)?.rsvp === 'confirmed');
  const lockedSeatKeys = new Set(locked.map((a) => `${a.seat.tableId}#${a.seat.seatIndex}`));
  const lockedByGuest = new Map(locked.map((a) => [a.guestId, a]));

  // 锁定冲突检测
  const seenSeat = new Map<string, string>();
  for (const a of locked) {
    const k = `${a.seat.tableId}#${a.seat.seatIndex}`;
    const prev = seenSeat.get(k);
    if (prev) {
      conflicts.push(
        `锁定冲突：${guestLabel(byId.get(prev)!)} 与 ${guestLabel(byId.get(a.guestId)!)} 锁定在同一席位 ${k}`,
      );
    }
    seenSeat.set(k, a.guestId);
  }

  const seatable = guests.filter((g) => g.rsvp === 'confirmed');
  const toAutoSeat = seatable.filter((g) => !lockedByGuest.has(g.id));

  // 容量粗检
  const totalSeats = tables.reduce((s, t) => s + t.capacity, 0);
  if (seatable.length > totalSeats) {
    conflicts.push(`容量不足：已确认 ${seatable.length} 人，总席位 ${totalSeats}`);
  }
  const childSeats = tables.filter((t) => t.allowsChildren).reduce((s, t) => s + t.capacity, 0);
  const childCount = seatable.filter((g) => g.isChild).length;
  if (childCount > childSeats) {
    conflicts.push(`儿童席位不足：儿童 ${childCount} 人，可坐儿童的席位 ${childSeats}`);
  }

  // 家庭组
  const families = new Map<string, Guest[]>();
  for (const g of seatable) {
    if (g.familyId) {
      if (!families.has(g.familyId)) families.set(g.familyId, []);
      families.get(g.familyId)!.push(g);
    }
  }
  // 家庭 vs 避让 硬冲突
  for (const [fid, members] of families) {
    for (const ap of avoidPairs) {
      const inA = members.some((m) => m.id === ap.a);
      const inB = members.some((m) => m.id === ap.b);
      if (inA && inB) {
        const ga = byId.get(ap.a);
        const gb = byId.get(ap.b);
        conflicts.push(
          `硬冲突：家庭「${fid}」要求同行，但 ${ga ? guestLabel(ga) : ap.a} 与 ${gb ? guestLabel(gb) : ap.b} 存在明确避让（${ap.reason}）`,
        );
      }
    }
    // 锁定在不同桌的家庭成员
    const lockedTables = new Set(
      members.map((m) => lockedByGuest.get(m.id)?.seat.tableId).filter(Boolean) as string[],
    );
    if (lockedTables.size > 1) {
      conflicts.push(`锁定冲突：家庭「${fid}」成员被锁定在不同桌，违反同行硬约束`);
    }
  }
  // 避让双方都被锁在同一桌
  for (const ap of avoidPairs) {
    const la = lockedByGuest.get(ap.a);
    const lb = lockedByGuest.get(ap.b);
    if (la && lb && la.seat.tableId === lb.seat.tableId) {
      conflicts.push(`锁定冲突：避让双方均被锁定在桌 ${la.seat.tableId}`);
    }
  }

  // ---- 变量 ----
  const binaries: string[] = [];
  const varMeta: BuiltModel['varMeta'] = {};
  const objVars: { name: string; coef: number }[] = [];
  const subjectTo: GLPKModel['subjectTo'] = [];

  const tableById = new Map(tables.map((t) => [t.id, t]));
  const prefByGuest = new Map<string, ProximityPreference[]>();
  for (const p of preferences) {
    if (!prefByGuest.has(p.guestId)) prefByGuest.set(p.guestId, []);
    prefByGuest.get(p.guestId)!.push(p);
  }

  // 每家庭可选桌（锁定成员限定桌）
  const familyAllowedTables = new Map<string, Set<string>>();
  for (const [fid, members] of families) {
    const lockedTables = [
      ...new Set(members.map((m) => lockedByGuest.get(m.id)?.seat.tableId).filter(Boolean) as string[]),
    ];
    familyAllowedTables.set(
      fid,
      new Set(lockedTables.length > 0 ? lockedTables : tables.map((t) => t.id)),
    );
  }

  const guestVars = new Map<string, string[]>(); // guestId -> varNames
  const seatVars = new Map<string, string[]>(); // seatKey -> varNames
  const guestTableVars = new Map<string, Map<string, string[]>>(); // guest -> table -> vars

  for (const g of toAutoSeat) {
    const allowedTables = g.familyId
      ? familyAllowedTables.get(g.familyId)!
      : new Set(tables.map((t) => t.id));
    for (const t of tables) {
      if (!allowedTables.has(t.id)) continue;
      if (g.isChild && !t.allowsChildren) continue;
      // 避让：若对方被锁在此桌，则本宾客不能来
      const blockedHere = avoidPairs.some((ap) => {
        const other = ap.a === g.id ? ap.b : ap.b === g.id ? ap.a : null;
        if (!other) return false;
        return lockedByGuest.get(other)?.seat.tableId === t.id;
      });
      if (blockedHere) continue;
      for (let i = 0; i < t.capacity; i++) {
        const key = `${t.id}#${i}`;
        if (lockedSeatKeys.has(key)) continue;
        const name = varName(g.id, { tableId: t.id, seatIndex: i });
        binaries.push(name);
        varMeta[name] = { guestId: g.id, seat: { tableId: t.id, seatIndex: i } };
        if (!guestVars.has(g.id)) guestVars.set(g.id, []);
        guestVars.get(g.id)!.push(name);
        if (!seatVars.has(key)) seatVars.set(key, []);
        seatVars.get(key)!.push(name);
        if (!guestTableVars.has(g.id)) guestTableVars.set(g.id, new Map());
        const m = guestTableVars.get(g.id)!;
        if (!m.has(t.id)) m.set(t.id, []);
        m.get(t.id)!.push(name);

        // 软约束代价：到偏好目标桌中心的距离（米）× 权重
        let coef = 0;
        for (const p of prefByGuest.get(g.id) ?? []) {
          const target = tableById.get(p.targetTableId);
          if (!target) continue;
          const d = Math.hypot(
            seatPosition(t, i).x - target.center.x,
            seatPosition(t, i).y - target.center.y,
          );
          coef += (d / 100) * p.weight;
        }
        objVars.push({ name, coef });
      }
    }
    const vars = guestVars.get(g.id) ?? [];
    if (vars.length === 0) {
      conflicts.push(`无可用席位：${guestLabel(g)} 在当前硬约束下没有任何可坐的位置`);
    } else {
      subjectTo.push({
        name: `seat_${g.id}`,
        vars: vars.map((v) => ({ name: v, coef: 1 })),
        bnds: { type: GLP_FX, ub: 1, lb: 1 },
      });
    }
  }

  // 席位唯一
  for (const [key, vars] of seatVars) {
    if (vars.length > 1) {
      subjectTo.push({
        name: `cap_${key}`,
        vars: vars.map((v) => ({ name: v, coef: 1 })),
        bnds: { type: GLP_UP, ub: 1, lb: 0 },
      });
    }
  }

  // 家庭同桌：z[f,t]
  for (const [fid, members] of families) {
    const auto = members.filter((m) => !lockedByGuest.has(m.id));
    if (auto.length === 0) continue;
    const allowed = familyAllowedTables.get(fid)!;
    const zNames: string[] = [];
    for (const tid of allowed) {
      const t = tableById.get(tid)!;
      // 家庭所需席位数（含锁定成员）不能超过桌容量
      const lockedHere = members.filter(
        (m) => lockedByGuest.get(m.id)?.seat.tableId === tid,
      ).length;
      const freeSeats = t.capacity - lockedHere;
      if (auto.length > freeSeats) continue; // 该桌放不下整个家庭
      const z = `z_${fid}_${tid}`;
      binaries.push(z);
      zNames.push(z);
      for (const m of auto) {
        for (const v of guestTableVars.get(m.id)?.get(tid) ?? []) {
          subjectTo.push({
            name: `fam_${fid}_${m.id}_${v}`,
            vars: [
              { name: v, coef: 1 },
              { name: z, coef: -1 },
            ],
            bnds: { type: GLP_UP, ub: 0, lb: 0 },
          });
        }
      }
    }
    if (zNames.length === 0) {
      conflicts.push(`家庭「${fid}」（${members.length} 人）没有任何容量足够的桌可同行`);
    } else {
      subjectTo.push({
        name: `famone_${fid}`,
        vars: zNames.map((z) => ({ name: z, coef: 1 })),
        bnds: { type: GLP_FX, ub: 1, lb: 1 },
      });
    }
  }

  // 明确避让：双方均自动排座时，同桌之和 <= 1
  for (const ap of avoidPairs) {
    const aAuto = !lockedByGuest.has(ap.a) && byId.get(ap.a)?.rsvp === 'confirmed';
    const bAuto = !lockedByGuest.has(ap.b) && byId.get(ap.b)?.rsvp === 'confirmed';
    if (!aAuto && !bAuto) continue;
    for (const t of tables) {
      const vars = [
        ...(guestTableVars.get(ap.a)?.get(t.id) ?? []),
        ...(guestTableVars.get(ap.b)?.get(t.id) ?? []),
      ];
      if (vars.length > 1) {
        subjectTo.push({
          name: `avoid_${ap.id}_${t.id}`,
          vars: vars.map((v) => ({ name: v, coef: 1 })),
          bnds: { type: GLP_UP, ub: 1, lb: 0 },
        });
      }
    }
  }

  return {
    model: {
      name: 'seating',
      objective: { direction: 1, name: 'penalty', vars: objVars },
      subjectTo,
      binaries,
    },
    varMeta,
    lockedAssignments: locked,
    conflicts,
  };
}
