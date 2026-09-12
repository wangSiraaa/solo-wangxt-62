// 几何检查验证：禁占多边形重叠检测（仅几何，不涉及安全认证）
import { createSampleProject } from '../src/sample';
import {
  checkFloorViolations,
  pointInPolygon,
  circleIntersectsPolygon,
  seatPosition,
} from '../src/geometry';

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures++;
};

const p = createSampleProject();

// 初始布局不违规
const v0 = checkFloorViolations(p.floor.tables, p.floor.zones);
check('样例初始布局无违规', v0.length === 0);

// 把 T1 拖到主通道上 → 应报违规
const moved = p.floor.tables.map((t) =>
  t.id === 'T-1' ? { ...t, center: { x: 600, y: 400 } } : t,
);
const v1 = checkFloorViolations(moved, p.floor.zones);
check('桌子压到主通道被检出', v1.some((v) => v.zoneId === 'Z-AISLE' && v.target.includes('T1')));

// 把 T3 拖到消防出口 → 应报违规
const moved2 = p.floor.tables.map((t) =>
  t.id === 'T-3' ? { ...t, center: { x: 60, y: 750 } } : t,
);
const v2 = checkFloorViolations(moved2, p.floor.zones);
check('桌子压到消防出口被检出', v2.some((v) => v.zoneId === 'Z-EXIT'));

// 基础几何原语
const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
check('点在多边形内', pointInPolygon({ x: 5, y: 5 }, square));
check('点在多边形外', !pointInPolygon({ x: 15, y: 5 }, square));
check('圆与多边形边相交', circleIntersectsPolygon({ x: 12, y: 5 }, 3, square));
check('圆与多边形相离', !circleIntersectsPolygon({ x: 20, y: 5 }, 3, square));

// 席位坐标：圆桌 8 席应均布在桌外一圈
const t1 = p.floor.tables.find((t) => t.id === 'T-1')!;
const r = 80 + 22 + 6;
const ok = Array.from({ length: 8 }, (_, i) => {
  const pos = seatPosition(t1, i);
  return Math.abs(Math.hypot(pos.x - t1.center.x, pos.y - t1.center.y) - r) < 1e-6;
});
check('圆桌椅位均布于期望半径', ok.every(Boolean));

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
