import initGlpk from 'glpk.js';
import { buildModel } from './model';
import {
  Assignment,
  AvoidPair,
  BanquetTable,
  Guest,
  ProximityPreference,
  SeatCost,
  SolveResult,
} from '../types';

// glpk.js 浏览器版内部即将求解放入 Web Worker（自包含 wasm），UI 不会被阻塞
const glpkPromise = initGlpk();

export async function solveSeating(
  guests: Guest[],
  tables: BanquetTable[],
  assignments: Assignment[],
  avoidPairs: AvoidPair[],
  preferences: ProximityPreference[],
): Promise<SolveResult> {
  try {
    const built = buildModel(guests, tables, assignments, avoidPairs, preferences);
    if (built.conflicts.length > 0) {
      return {
        type: 'result',
        status: 'infeasible',
        message: '存在硬约束冲突，问题无解',
        conflicts: built.conflicts,
      };
    }
    const glpk = await glpkPromise;
    const res = await glpk.solve(built.model, {
      msglev: glpk.GLP_MSG_OFF,
      tmlim: 30, // 秒
      presol: true,
    });
    const status = res.result.status;
    if (status !== glpk.GLP_OPT && status !== glpk.GLP_FEAS) {
      return {
        type: 'result',
        status: 'infeasible',
        message: `求解器判定不可行（GLPK 状态 ${status}）。常见原因：容量不足、家庭同行与避让冲突、锁定矛盾。`,
        conflicts: [],
      };
    }
    const vars = res.result.vars;
    const autoAssignments: Assignment[] = [];
    const perGuestCost: SeatCost[] = [];
    const objCoef = new Map(built.model.objective.vars.map((v) => [v.name, v.coef]));
    const guestById = new Map(guests.map((g) => [g.id, g]));
    for (const [name, meta] of Object.entries(built.varMeta)) {
      if ((vars[name] ?? 0) > 0.5) {
        autoAssignments.push({
          guestId: meta.guestId,
          seat: meta.seat,
          locked: false,
          isChildSeat: guestById.get(meta.guestId)?.isChild ?? false,
        });
        perGuestCost.push({
          guestId: meta.guestId,
          seat: meta.seat,
          cost: objCoef.get(name) ?? 0,
        });
      }
    }
    return {
      type: 'result',
      status: status === glpk.GLP_OPT ? 'optimal' : 'feasible',
      message: status === glpk.GLP_OPT ? '已求得最优解' : '已求得可行解（未证明最优）',
      assignments: [...built.lockedAssignments, ...autoAssignments],
      totalPenalty: res.result.z,
      perGuestCost,
    };
  } catch (e) {
    return {
      type: 'result',
      status: 'error',
      message: `求解器错误：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
