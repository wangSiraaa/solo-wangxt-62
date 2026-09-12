import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import {
  Assignment,
  BanquetTable,
  DietaryProfile,
  Guest,
  Project,
  ProximityPreference,
  SeatRef,
  SolveResult,
  seatKey,
} from './types';
import { saveProject } from './db';
import { seatPosition } from './geometry';
import { solveSeating } from './solver/solve';
import { diffCatering } from './catering';
import { SwapLeg, validateSwapChain } from './swapchain';
import { bumpLayout, isStaleResult, removeTablesFromProject } from './projectOps';

export interface AutoSnapshot {
  at: number;
  assignments: Assignment[];
  totalPenalty: number;
  moves: number;
  status: string;
  layoutVersion: number;
}

interface State {
  project: Project;
  past: Project[]; // 撤销栈（手工操作）
  /** 数据版本：任何项目变更 +1，用于过期结果拦截 */
  version: number;
  autoSnapshot: AutoSnapshot | null;
  lastSolve: SolveResult | null;
  /** 最新有效结果是否已被消费（应用或忽略）。打印桌卡前必须消费 */
  resultConsumed: boolean;
  solving: boolean;
  selectedGuestId: string | null;
  swapError: string | null;
  lastDiff: string[];
}

type Action =
  | { type: 'load'; project: Project }
  | { type: 'mutate'; fn: (p: Project) => Project; undoable?: boolean }
  | { type: 'undo' }
  | { type: 'setAutoSnapshot'; snap: AutoSnapshot | null }
  | { type: 'setSolve'; result: SolveResult | null; consumed?: boolean }
  | { type: 'setSolving'; v: boolean }
  | { type: 'selectGuest'; id: string | null }
  | { type: 'setSwapError'; msg: string | null }
  | { type: 'setDiff'; lines: string[] };

const UNDO_LIMIT = 50;

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'load':
      return {
        ...s,
        project: a.project,
        past: [],
        version: s.version + 1,
        autoSnapshot: null,
        lastSolve: null,
        resultConsumed: true,
        lastDiff: [],
      };
    case 'mutate': {
      const undoable = a.undoable !== false;
      const next = a.fn(s.project);
      return {
        ...s,
        project: next,
        version: s.version + 1,
        past: undoable ? [...s.past.slice(-UNDO_LIMIT + 1), s.project] : s.past,
      };
    }
    case 'undo': {
      if (s.past.length === 0) return s;
      return {
        ...s,
        project: s.past[s.past.length - 1],
        past: s.past.slice(0, -1),
        version: s.version + 1,
      };
    }
    case 'setAutoSnapshot':
      return { ...s, autoSnapshot: a.snap };
    case 'setSolve':
      return { ...s, lastSolve: a.result, resultConsumed: a.consumed ?? s.resultConsumed };
    case 'setSolving':
      return { ...s, solving: a.v };
    case 'selectGuest':
      return { ...s, selectedGuestId: a.id };
    case 'setSwapError':
      return { ...s, swapError: a.msg };
    case 'setDiff':
      return { ...s, lastDiff: a.lines };
  }
}

interface Store {
  state: State;
  mutate: (fn: (p: Project) => Project, undoable?: boolean) => void;
  undo: () => void;
  canUndo: boolean;
  selectGuest: (id: string | null) => void;
  // 宾客
  addGuest: (name: string, opts?: Partial<Guest>) => void;
  addWalkIn: (name: string) => void;
  updateGuest: (id: string, patch: Partial<Guest>) => void;
  removeGuest: (id: string) => void;
  setDietary: (profile: DietaryProfile) => void;
  // 席位
  assignSeat: (guestId: string, seat: SeatRef | null) => void;
  toggleLock: (guestId: string) => void;
  /** 锁定所有“已入席且确认不动”的宾客 */
  lockAllSeated: () => void;
  // 桌
  moveTable: (tableId: string, x: number, y: number) => void;
  addTable: (t: BanquetTable) => void;
  removeTables: (tableIds: string[]) => void;
  // 约束
  addAvoid: (a: string, b: string, reason: string) => void;
  removeAvoid: (id: string) => void;
  addPreference: (p: Omit<ProximityPreference, 'id'>) => void;
  removePreference: (id: string) => void;
  // 出菜（单向，不可回滚）
  serveDish: (dishId: string) => void;
  // 交换链（原子）
  applySwapChain: (legs: SwapLeg[]) => boolean;
  // 求解与对比
  runSolver: () => void;
  applySolution: () => void;
  dismissResult: () => void;
  clearAutoSnapshot: () => void;
}

const StoreCtx = createContext<Store | null>(null);

export function StoreProvider({
  initial,
  children,
}: {
  initial: Project;
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, {
    project: initial,
    past: [],
    version: 0,
    autoSnapshot: null,
    lastSolve: null,
    resultConsumed: true,
    solving: false,
    selectedGuestId: null,
    swapError: null,
    lastDiff: [],
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  // 持久化（防抖）
  useEffect(() => {
    const t = setTimeout(() => {
      saveProject(state.project).catch((e) => console.error('保存失败', e));
    }, 400);
    return () => clearTimeout(t);
  }, [state.project]);

  const mutate = useCallback((fn: (p: Project) => Project, undoable = true) => {
    dispatch({ type: 'mutate', fn, undoable });
  }, []);

  const store: Store = useMemo(() => {
    return {
      state,
      mutate,
      undo: () => dispatch({ type: 'undo' }),
      canUndo: state.past.length > 0,
      selectGuest: (id) => dispatch({ type: 'selectGuest', id }),

      addGuest: (name, opts = {}) => {
        mutate((proj) => {
          const sameName = proj.guests.filter((g) => g.displayName === name).length;
          const guest: Guest = {
            id: `G-${String(proj.nextGuestSeq).padStart(4, '0')}`,
            displayName: name,
            nameIndex: sameName + 1,
            rsvp: opts.rsvp ?? 'confirmed',
            isChild: opts.isChild ?? false,
            familyId: opts.familyId ?? null,
            note: opts.note ?? '',
          };
          return { ...proj, guests: [...proj.guests, guest], nextGuestSeq: proj.nextGuestSeq + 1 };
        });
      },
      addWalkIn: (name) => {
        // 临时到场：计入实际需求；沿用稳定编号序列
        mutate((proj) => {
          const guest: Guest = {
            id: `G-${String(proj.nextGuestSeq).padStart(4, '0')}`,
            displayName: name,
            nameIndex: 1,
            rsvp: 'walkin',
            isChild: false,
            familyId: null,
            note: '临时到场',
          };
          return { ...proj, guests: [...proj.guests, guest], nextGuestSeq: proj.nextGuestSeq + 1 };
        });
      },
      updateGuest: (id, patch) =>
        mutate((proj) => ({
          ...proj,
          guests: proj.guests.map((g) => (g.id === id ? { ...g, ...patch } : g)),
        })),
      removeGuest: (id) =>
        mutate((proj) => {
          const dietary = { ...proj.dietary };
          delete dietary[id];
          return {
            ...proj,
            guests: proj.guests.filter((g) => g.id !== id),
            dietary,
            assignments: proj.assignments.filter((a) => a.guestId !== id),
            avoidPairs: proj.avoidPairs.filter((ap) => ap.a !== id && ap.b !== id),
            preferences: proj.preferences.filter((pr) => pr.guestId !== id),
          };
        }),
      setDietary: (profile) =>
        mutate((proj) => ({
          ...proj,
          dietary: { ...proj.dietary, [profile.guestId]: profile },
        })),

      assignSeat: (guestId, seat) =>
        mutate((proj) => {
          const guest = proj.guests.find((g) => g.id === guestId);
          if (!guest) return proj;
          let assignments = proj.assignments.filter(
            (a) => a.guestId !== guestId && (!seat || seatKey(a.seat) !== seatKey(seat)),
          );
          if (seat) {
            const prev = proj.assignments.find((a) => a.guestId === guestId);
            assignments = [
              ...assignments,
              { guestId, seat, locked: prev?.locked ?? false, isChildSeat: guest.isChild },
            ];
          }
          return bumpLayout(proj, assignments);
        }),
      toggleLock: (guestId) =>
        mutate((proj) => ({
          ...proj,
          assignments: proj.assignments.map((a) =>
            a.guestId === guestId ? { ...a, locked: !a.locked } : a,
          ),
        })),
      lockAllSeated: () =>
        mutate((proj) => ({
          ...proj,
          assignments: proj.assignments.map((a) => ({ ...a, locked: true })),
        })),

      moveTable: (tableId, x, y) =>
        mutate((proj) => ({
          ...proj,
          floor: {
            ...proj.floor,
            tables: proj.floor.tables.map((t) =>
              t.id === tableId ? { ...t, center: { x, y } } : t,
            ),
          },
        })),
      addTable: (t) =>
        mutate((proj) => ({
          ...proj,
          floor: { ...proj.floor, tables: [...proj.floor.tables, t] },
        })),
      removeTables: (tableIds) => {
        const before = stateRef.current.project;
        const after = removeTablesFromProject(before, tableIds);
        dispatch({ type: 'setDiff', lines: diffCatering(before, after) });
        mutate(() => after);
      },

      addAvoid: (a, b, reason) =>
        mutate((proj) => ({
          ...proj,
          avoidPairs: [...proj.avoidPairs, { id: `AP-${Date.now().toString(36)}`, a, b, reason }],
        })),
      removeAvoid: (id) =>
        mutate((proj) => ({
          ...proj,
          avoidPairs: proj.avoidPairs.filter((ap) => ap.id !== id),
        })),
      addPreference: (pref) =>
        mutate((proj) => ({
          ...proj,
          preferences: [...proj.preferences, { ...pref, id: `PR-${Date.now().toString(36)}` }],
        })),
      removePreference: (id) =>
        mutate((proj) => ({
          ...proj,
          preferences: proj.preferences.filter((pr) => pr.id !== id),
        })),

      serveDish: (dishId) =>
        mutate(
          (proj) => ({
            ...proj,
            catering: proj.catering.map((d) =>
              // 单向：已出菜不可回滚为未出菜
              d.id === dishId && d.servedAt === null ? { ...d, servedAt: Date.now() } : d,
            ),
          }),
          false, // 出菜是事实，不进撤销栈
        ),

      applySwapChain: (legs) => {
        const proj = stateRef.current.project;
        const v = validateSwapChain(proj, legs);
        if (!v.ok) {
          // 任何一步无合法落点：整条链不落地
          dispatch({ type: 'setSwapError', msg: v.error ?? '链验证失败' });
          return false;
        }
        dispatch({ type: 'setSwapError', msg: null });
        mutate((p) => bumpLayout(p, v.resulting!));
        return true;
      },

      runSolver: () => {
        const v0 = stateRef.current.version;
        const proj = stateRef.current.project;
        dispatch({ type: 'setSolving', v: true });
        solveSeating(
          proj.guests,
          proj.floor.tables,
          proj.assignments,
          proj.avoidPairs,
          proj.preferences,
          v0,
        ).then((result) => {
          dispatch({ type: 'setSolving', v: false });
          // 过期拦截：求解期间数据版本变化（如新增到场记录）→ 结果作废
          if (isStaleResult(v0, stateRef.current.version)) {
            dispatch({
              type: 'setSolve',
              result: {
                type: 'result',
                status: 'stale',
                message: `结果已过期并被拦截：求解期间数据已变更（v${v0} → v${stateRef.current.version}），请重新求解`,
                baseVersion: v0,
              },
              consumed: true,
            });
            return;
          }
          dispatch({ type: 'setSolve', result, consumed: false });
          if (
            (result.status === 'optimal' || result.status === 'feasible') &&
            result.assignments
          ) {
            dispatch({
              type: 'setAutoSnapshot',
              snap: {
                at: Date.now(),
                assignments: result.assignments,
                totalPenalty: result.totalPenalty ?? 0,
                moves: result.moves ?? 0,
                status: result.status,
                layoutVersion: stateRef.current.project.layoutVersion,
              },
            });
          }
        });
      },

      applySolution: () => {
        const r = state.lastSolve;
        if (!r?.assignments || (r.status !== 'optimal' && r.status !== 'feasible')) return;
        const before = stateRef.current.project;
        const after = bumpLayout(before, r.assignments);
        dispatch({ type: 'setDiff', lines: diffCatering(before, after) });
        mutate(() => after);
        dispatch({ type: 'setSolve', result: r, consumed: true });
      },

      dismissResult: () => {
        dispatch({ type: 'setSolve', result: state.lastSolve, consumed: true });
      },

      clearAutoSnapshot: () => dispatch({ type: 'setAutoSnapshot', snap: null }),
    };
  }, [state, mutate]);

  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

/** 客户端估算当前方案的偏好代价（与求解器同一公式），用于手工 vs 自动对比 */
export function estimatePenalty(project: Project): number {
  const tableById = new Map(project.floor.tables.map((t) => [t.id, t]));
  let total = 0;
  for (const pref of project.preferences) {
    const target = tableById.get(pref.targetTableId);
    const a = project.assignments.find((x) => x.guestId === pref.guestId);
    if (!target || !a) continue;
    const t = tableById.get(a.seat.tableId);
    if (!t) continue;
    const pos = seatPosition(t, a.seat.seatIndex);
    total += (Math.hypot(pos.x - target.center.x, pos.y - target.center.y) / 100) * pref.weight;
  }
  return total;
}
