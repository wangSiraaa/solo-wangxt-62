import initGlpk from 'glpk.js';
import { buildModel, BuiltModel } from './model';
import {
  Assignment,
  AvoidPair,
  BanquetTable,
  CapacityReport,
  Guest,
  ProximityPreference,
  SeatCost,
  SolveResult,
} from '../types';

// glpk.js 浏览器版内部即将求解放入 Web Worker（自包含 wasm），UI 不会被阻塞
const glpkPromise = initGlpk();

/** 演示用最小延迟：让“求解中新增到场 → 过期拦截”的窗口真实可见 */
const MIN_LATENCY_MS = 600;

type Glpk = Awaited<typeof glpkPromise>;

export interface LexicoResult {
  status: 'optimal' | 'feasible' | 'infeasible';
  assignments?: Assignment[];
  moves: number;
  totalPenalty?: number;
  perGuestCost?: SeatCost[];
}

/**
 * 字典序两阶段求解：
 *  阶段一：最小化换桌人数（锁定项已固定，绝不为布局好看而挪动）
 *  阶段二：固定换桌人数上界，最小化软约束偏好代价
 */
export async function lexicographicSolve(
  glpk: Glpk,
  built: BuiltModel,
  guests: Guest[],
): Promise<LexicoResult> {
  const opt = { msglev: 0, tmlim: 30, presol: true } as never;

  // 阶段一：最少换桌（同桌换位只计 epsilon，不改变主目标取整）
  const phase1 = {
    ...built.model,
    objective: {
      direction: 1,
      name: 'moves',
      vars: [...built.moveVars, ...built.seatKeepVars],
    },
  };
  const r1 = await glpk.solve(phase1 as never, opt);
  if (r1.result.status !== 5 && r1.result.status !== 2) {
    return { status: 'infeasible', moves: 0 };
  }
  const moves = Math.floor(r1.result.z + 1e-6);

  // 阶段二：换桌人数不增，偏好代价最小（叠加 epsilon 原位保持项）
  const model2 = {
    ...built.model,
    objective: {
      direction: 1,
      name: 'penalty',
      vars: [...built.model.objective.vars, ...built.seatKeepVars],
    },
    subjectTo: [
      ...built.model.subjectTo,
      {
        name: 'moves_cap',
        vars: built.moveVars,
        bnds: { type: 3, ub: moves, lb: 0 }, // GLP_UP
      },
    ],
  };
  const r2 = await glpk.solve(model2 as never, opt);
  if (r2.result.status !== 5 && r2.result.status !== 2) {
    return { status: 'infeasible', moves: 0 };
  }

  const vars = r2.result.vars as Record<string, number>;
  const objCoef = new Map(built.model.objective.vars.map((v) => [v.name, v.coef]));
  const guestById = new Map(guests.map((g) => [g.id, g]));
  const auto: Assignment[] = [];
  const perGuestCost: SeatCost[] = [];
  for (const [name, meta] of Object.entries(built.varMeta)) {
    if ((vars[name] ?? 0) > 0.5) {
      auto.push({
        guestId: meta.guestId,
        seat: meta.seat,
        locked: false,
        isChildSeat: guestById.get(meta.guestId)?.isChild ?? false,
      });
      perGuestCost.push({ guestId: meta.guestId, seat: meta.seat, cost: objCoef.get(name) ?? 0 });
    }
  }
  return {
    status: r2.result.status === 5 ? 'optimal' : 'feasible',
    assignments: [...built.lockedAssignments, ...auto],
    moves,
    // 报告的偏好代价不含 epsilon 原位保持项
    totalPenalty: perGuestCost.reduce((s, c) => s + c.cost, 0),
    perGuestCost,
  };
}

export function capacityReport(stats: BuiltModel['stats']): CapacityReport {
  return {
    seats: stats.seats,
    required: stats.required,
    walkins: stats.walkins,
    pendingCandidates: stats.pending,
    pendingFit: stats.seats - stats.required >= stats.pending,
  };
}

export async function solveSeating(
  guests: Guest[],
  tables: BanquetTable[],
  assignments: Assignment[],
  avoidPairs: AvoidPair[],
  preferences: ProximityPreference[],
  baseVersion: number,
): Promise<SolveResult> {
  const started = Date.now();
  try {
    const built = buildModel(guests, tables, assignments, avoidPairs, preferences);
    const capacity = capacityReport(built.stats);
    if (built.conflicts.length > 0) {
      return {
        type: 'result',
        status: 'infeasible',
        message: '存在硬约束冲突，问题无解',
        conflicts: built.conflicts,
        capacity,
        baseVersion,
      };
    }
    const glpk = await glpkPromise;
    const res = await lexicographicSolve(glpk, built, guests);
    // 补齐演示延迟
    const elapsed = Date.now() - started;
    if (elapsed < MIN_LATENCY_MS) {
      await new Promise((r) => setTimeout(r, MIN_LATENCY_MS - elapsed));
    }
    if (res.status === 'infeasible') {
      return {
        type: 'result',
        status: 'infeasible',
        message:
          '求解器判定不可行。常见原因：剩余桌容量不足、家庭同行与避让冲突、锁定矛盾、儿童无合规桌。',
        conflicts: [],
        capacity,
        baseVersion,
      };
    }
    return {
      type: 'result',
      status: res.status,
      message: res.status === 'optimal' ? '已求得最优解' : '已求得可行解（未证明最优）',
      assignments: res.assignments,
      totalPenalty: res.totalPenalty,
      moves: res.moves,
      capacity,
      baseVersion,
      perGuestCost: res.perGuestCost,
    };
  } catch (e) {
    return {
      type: 'result',
      status: 'error',
      message: `求解器错误：${e instanceof Error ? e.message : String(e)}`,
      baseVersion,
    };
  }
}
