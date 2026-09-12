// ---------- 领域类型 ----------
// 坐标单位：厘米（场地平面）

export interface Vec {
  x: number;
  y: number;
}

/** 宾客。同名宾客靠稳定 id 区分，displayName 仅用于展示。 */
export interface Guest {
  id: string; // 稳定编号，如 G-0001，永不复用
  displayName: string;
  /** 同名区分序号（同一 displayName 内递增，仅展示用） */
  nameIndex: number;
  rsvp: 'confirmed' | 'pending' | 'declined';
  isChild: boolean;
  /** 家庭/同行组 id，同组必须同桌（硬约束） */
  familyId: string | null;
  note: string;
}

/** 忌口与席位独立存储：keyed by guestId，换座不丢失 */
export interface DietaryProfile {
  guestId: string;
  tags: string[]; // 如 素食 / 无麸质 / 坚果过敏
  detail: string;
}

export type TableShape =
  | { kind: 'round'; radius: number }
  | { kind: 'rect'; width: number; height: number };

export interface BanquetTable {
  id: string;
  label: string; // 如 “主桌” “T3”
  shape: TableShape;
  center: Vec;
  rotationDeg: number;
  capacity: number; // 座位数（椅子绕桌均布）
  isHead: boolean; // 是否主桌
  allowsChildren: boolean;
}

/** 席位 = 某桌的第 i 把椅子。儿童椅占位：child 宾客占一个普通席位并标记。 */
export interface SeatRef {
  tableId: string;
  seatIndex: number; // 0..capacity-1
}

export interface Assignment {
  guestId: string;
  seat: SeatRef;
  locked: boolean; // 锁定席位：自动排座不得移动
  isChildSeat: boolean; // 该席位按儿童椅使用（占位）
}

/** 明确避让（硬约束）：两人不得同桌 */
export interface AvoidPair {
  id: string;
  a: string; // guestId
  b: string;
  reason: string;
}

/** 软约束：偏好靠近主桌 / 靠近某桌，可放宽，求解后显示代价 */
export interface ProximityPreference {
  id: string;
  guestId: string;
  targetTableId: string; // 通常是主桌
  weight: number; // 每米偏离的代价权重
  note: string;
}

/** 禁止占用多边形（过道 / 消防出口）。仅做几何检查，不构成安全认证。 */
export interface ForbiddenZone {
  id: string;
  label: string;
  kind: 'aisle' | 'fire-exit' | 'other';
  polygon: Vec[];
}

export interface FloorPlan {
  width: number;
  height: number;
  tables: BanquetTable[];
  zones: ForbiddenZone[];
}

export interface Project {
  id: string;
  name: string;
  updatedAt: number;
  guests: Guest[];
  dietary: Record<string, DietaryProfile>; // guestId -> profile
  floor: FloorPlan;
  assignments: Assignment[];
  avoidPairs: AvoidPair[];
  preferences: ProximityPreference[];
  nextGuestSeq: number; // 稳定编号计数器
}

// ---------- 求解器协议 ----------

export interface SolveRequest {
  type: 'solve';
  guests: Guest[];
  tables: BanquetTable[];
  assignments: Assignment[]; // 用于锁定
  avoidPairs: AvoidPair[];
  preferences: ProximityPreference[];
}

export interface SeatCost {
  guestId: string;
  seat: SeatRef;
  cost: number; // 该宾客的偏好代价
}

export interface SolveResult {
  type: 'result';
  status: 'optimal' | 'feasible' | 'infeasible' | 'error';
  message: string;
  assignments?: Assignment[]; // 未锁定部分的新方案（锁定项原样保留）
  totalPenalty?: number;
  perGuestCost?: SeatCost[];
  /** 无解时给出参与冲突的约束描述，便于定位 */
  conflicts?: string[];
}

export function seatKey(s: SeatRef): string {
  return `${s.tableId}#${s.seatIndex}`;
}

export function guestLabel(g: Guest): string {
  return g.nameIndex > 1 ? `${g.displayName} (#${g.nameIndex})` : g.displayName;
}
