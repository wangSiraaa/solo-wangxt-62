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
  AvoidPair,
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

export interface AutoSnapshot {
  at: number;
  assignments: Assignment[];
  totalPenalty: number;
  status: string;
}

interface State {
  project: Project;
  past: Project[]; // 撤销栈（手工操作）
  autoSnapshot: AutoSnapshot | null;
  lastSolve: SolveResult | null;
  solving: boolean;
  selectedGuestId: string | null;
}

type Action =
  | { type: 'load'; project: Project }
  | { type: 'mutate'; fn: (p: Project) => Project; undoable?: boolean }
  | { type: 'undo' }
  | { type: 'setAutoSnapshot'; snap: AutoSnapshot | null }
  | { type: 'setSolve'; result: SolveResult | null }
  | { type: 'setSolving'; v: boolean }
  | { type: 'selectGuest'; id: string | null };

const UNDO_LIMIT = 50;

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'load':
      return { ...s, project: a.project, past: [], autoSnapshot: null, lastSolve: null };
    case 'mutate': {
      const undoable = a.undoable !== false;
      const next = a.fn(s.project);
      return {
        ...s,
        project: next,
        past: undoable ? [...s.past.slice(-UNDO_LIMIT + 1), s.project] : s.past,
      };
    }
    case 'undo': {
      if (s.past.length === 0) return s;
      return { ...s, project: s.past[s.past.length - 1], past: s.past.slice(0, -1) };
    }
    case 'setAutoSnapshot':
      return { ...s, autoSnapshot: a.snap };
    case 'setSolve':
      return { ...s, lastSolve: a.result };
    case 'setSolving':
      return { ...s, solving: a.v };
    case 'selectGuest':
      return { ...s, selectedGuestId: a.id };
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
  updateGuest: (id: string, patch: Partial<Guest>) => void;
  removeGuest: (id: string) => void;
  setDietary: (profile: DietaryProfile) => void;
  // 席位
  assignSeat: (guestId: string, seat: SeatRef | null) => void;
  toggleLock: (guestId: string) => void;
  // 桌
  moveTable: (tableId: string, x: number, y: number) => void;
  addTable: (t: BanquetTable) => void;
  removeTable: (tableId: string) => void;
  // 约束
  addAvoid: (a: string, b: string, reason: string) => void;
  removeAvoid: (id: string) => void;
  addPreference: (p: Omit<ProximityPreference, 'id'>) => void;
  removePreference: (id: string) => void;
  // 求解与对比
  runSolver: () => void;
  applySolution: () => void;
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
    autoSnapshot: null,
    lastSolve: null,
    solving: false,
    selectedGuestId: null,
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
    const p = state.project;
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
          return {
            ...proj,
            guests: [...proj.guests, guest],
            nextGuestSeq: proj.nextGuestSeq + 1,
          };
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
            (a) =>
              a.guestId !== guestId && (!seat || seatKey(a.seat) !== seatKey(seat)),
          );
          if (seat) {
            const prev = proj.assignments.find((a) => a.guestId === guestId);
            assignments = [
              ...assignments,
              {
                guestId,
                seat,
                locked: prev?.locked ?? false,
                isChildSeat: guest.isChild,
              },
            ];
          }
          return { ...proj, assignments };
        }),
      toggleLock: (guestId) =>
        mutate((proj) => ({
          ...proj,
          assignments: proj.assignments.map((a) =>
            a.guestId === guestId ? { ...a, locked: !a.locked } : a,
          ),
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
      removeTable: (tableId) =>
        mutate((proj) => ({
          ...proj,
          floor: {
            ...proj.floor,
            tables: proj.floor.tables.filter((t) => t.id !== tableId),
          },
          assignments: proj.assignments.filter((a) => a.seat.tableId !== tableId),
        })),

      addAvoid: (a, b, reason) =>
        mutate((proj) => ({
          ...proj,
          avoidPairs: [
            ...proj.avoidPairs,
            { id: `AP-${Date.now().toString(36)}`, a, b, reason },
          ],
        })),
      removeAvoid: (id) =>
        mutate((proj) => ({
          ...proj,
          avoidPairs: proj.avoidPairs.filter((ap) => ap.id !== id),
        })),
      addPreference: (pref) =>
        mutate((proj) => ({
          ...proj,
          preferences: [
            ...proj.preferences,
            { ...pref, id: `PR-${Date.now().toString(36)}` },
          ],
        })),
      removePreference: (id) =>
        mutate((proj) => ({
          ...proj,
          preferences: proj.preferences.filter((pr) => pr.id !== id),
        })),

      runSolver: () => {
        dispatch({ type: 'setSolving', v: true });
        const proj = stateRef.current.project;
        solveSeating(
          proj.guests,
          proj.floor.tables,
          proj.assignments,
          proj.avoidPairs,
          proj.preferences,
        ).then((result) => {
          dispatch({ type: 'setSolving', v: false });
          dispatch({ type: 'setSolve', result });
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
                status: result.status,
              },
            });
          }
        });
      },

      applySolution: () => {
        const r = state.lastSolve;
        if (!r?.assignments) return;
        mutate((proj) => ({ ...proj, assignments: r.assignments! }));
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
