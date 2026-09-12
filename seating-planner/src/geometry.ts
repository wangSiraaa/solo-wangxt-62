import { BanquetTable, SeatRef, Vec } from './types';

export const CHAIR_RADIUS = 22; // cm，椅子占位半径（含儿童椅）

/** 点是否在多边形内（射线法，边界上视为在内） */
export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (pointOnSegment(p, a, b)) return true;
    const hit =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (hit) inside = !inside;
  }
  return inside;
}

function pointOnSegment(p: Vec, a: Vec, b: Vec): boolean {
  const cross = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y);
  if (Math.abs(cross) > 1e-6) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  if (dot < 0) return false;
  const lenSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot <= lenSq;
}

function distPointSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** 圆与多边形是否相交（含圆心在多边形内） */
export function circleIntersectsPolygon(c: Vec, r: number, poly: Vec[]): boolean {
  if (pointInPolygon(c, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (distPointSegment(c, poly[j], poly[i]) <= r) return true;
  }
  // 多边形顶点在圆内已被边距离覆盖；多边形完全在圆内的极端情形检查顶点
  return poly.some((v) => Math.hypot(v.x - c.x, v.y - c.y) <= r);
}

/** 计算某桌每个席位（椅子中心）的世界坐标 */
export function seatPosition(table: BanquetTable, seatIndex: number): Vec {
  const n = table.capacity;
  const ang0 = (table.rotationDeg * Math.PI) / 180;
  const t = seatIndex / n;
  if (table.shape.kind === 'round') {
    const r = table.shape.radius + CHAIR_RADIUS + 6;
    const a = ang0 + t * Math.PI * 2;
    return { x: table.center.x + r * Math.cos(a), y: table.center.y + r * Math.sin(a) };
  }
  // 矩形桌：椅子沿周长均布
  const { width: w, height: h } = table.shape;
  const perim = 2 * (w + h);
  let d = t * perim;
  const off = CHAIR_RADIUS + 6;
  // 局部坐标：上边(左→右)、右边(上→下)、下边(右→左)、左边(下→上)
  let lx: number, ly: number;
  if (d < w) {
    lx = -w / 2 + d;
    ly = -h / 2 - off;
  } else if ((d -= w) < h) {
    lx = w / 2 + off;
    ly = -h / 2 + d;
  } else if ((d -= h) < w) {
    lx = w / 2 - d;
    ly = h / 2 + off;
  } else {
    d -= w;
    lx = -w / 2 - off;
    ly = h / 2 - d;
  }
  const cos = Math.cos(ang0);
  const sin = Math.sin(ang0);
  return {
    x: table.center.x + lx * cos - ly * sin,
    y: table.center.y + lx * sin + ly * cos,
  };
}

/** 桌面足迹（圆或旋转矩形的近似外接圆 + 顶点）与多边形的相交检查 */
export function tableIntersectsPolygon(table: BanquetTable, poly: Vec[]): boolean {
  if (table.shape.kind === 'round') {
    return circleIntersectsPolygon(table.center, table.shape.radius, poly);
  }
  const { width: w, height: h } = table.shape;
  const ang = (table.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const corners: Vec[] = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ].map((p) => ({
    x: table.center.x + p.x * cos - p.y * sin,
    y: table.center.y + p.x * sin + p.y * cos,
  }));
  if (corners.some((c) => pointInPolygon(c, poly))) return true;
  if (poly.some((v) => pointInRotatedRect(v, table))) return true;
  // 边相交
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    for (let j = 0; j < poly.length; j++) {
      if (segmentsIntersect(a, b, poly[j], poly[(j + 1) % poly.length])) return true;
    }
  }
  return false;
}

function pointInRotatedRect(p: Vec, table: BanquetTable): boolean {
  if (table.shape.kind !== 'rect') return false;
  const ang = (-table.rotationDeg * Math.PI) / 180;
  const dx = p.x - table.center.x;
  const dy = p.y - table.center.y;
  const lx = dx * Math.cos(ang) - dy * Math.sin(ang);
  const ly = dx * Math.sin(ang) + dy * Math.cos(ang);
  return Math.abs(lx) <= table.shape.width / 2 && Math.abs(ly) <= table.shape.height / 2;
}

function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o1 = cross(a, b, c);
  const o2 = cross(a, b, d);
  const o3 = cross(c, d, a);
  const o4 = cross(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function cross(o: Vec, a: Vec, b: Vec): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export interface ZoneViolation {
  zoneId: string;
  zoneLabel: string;
  target: string; // 描述：桌 label 或席位
}

/** 检查所有桌与椅是否压到禁占区（纯几何检查，不代表安全认证） */
export function checkFloorViolations(
  tables: BanquetTable[],
  zones: { id: string; label: string; polygon: Vec[] }[],
): ZoneViolation[] {
  const out: ZoneViolation[] = [];
  for (const z of zones) {
    for (const t of tables) {
      if (tableIntersectsPolygon(t, z.polygon)) {
        out.push({ zoneId: z.id, zoneLabel: z.label, target: `桌 ${t.label}` });
        continue;
      }
      for (let i = 0; i < t.capacity; i++) {
        const p = seatPosition(t, i);
        if (circleIntersectsPolygon(p, CHAIR_RADIUS, z.polygon)) {
          out.push({ zoneId: z.id, zoneLabel: z.label, target: `桌 ${t.label} 席位 ${i + 1}` });
        }
      }
    }
  }
  return out;
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function seatOf(table: BanquetTable, ref: SeatRef): Vec {
  return seatPosition(table, ref.seatIndex);
}
