// 端到端验证：样例工程的硬冲突无解 → 删除冲突后可解 → 校验全部约束
import initGlpk from 'glpk.js/node';
import { createSampleProject } from '../src/sample';
import { buildModel } from '../src/solver/model';

const glpk = await initGlpk();
const p = createSampleProject();
let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures++;
};

// 1. 样例自带 家庭同行 vs 明确避让 冲突 → 建模阶段应报告无解
const m1 = buildModel(p.guests, p.floor.tables, p.assignments, p.avoidPairs, p.preferences);
check('冲突样例：建模阶段检出硬冲突', m1.conflicts.length > 0);
console.log('   冲突内容:', m1.conflicts.join(' | '));

// 2. 移除演示冲突后应可解
const m2 = buildModel(p.guests, p.floor.tables, p.assignments, [], p.preferences);
check('移除冲突后：无建模冲突', m2.conflicts.length === 0);
const res = await glpk.solve(m2.model, { msglev: 0, tmlim: 30, presol: true });
check('求解状态为最优', res.result.status === glpk.GLP_OPT);

const seated = {};
for (const [name, meta] of Object.entries(m2.varMeta)) {
  if (res.result.vars[name] > 0.5) seated[meta.guestId] = meta.seat;
}
// 锁定席位保留
for (const a of m2.lockedAssignments) seated[a.guestId] = a.seat;

const confirmed = p.guests.filter((g) => g.rsvp === 'confirmed');
const pending = p.guests.filter((g) => g.rsvp !== 'confirmed');
check('全部已确认宾客都有席位', confirmed.every((g) => seated[g.id]));
check('未回复/婉拒宾客未被排座', pending.every((g) => !seated[g.id]));

const seatUse = Object.values(seated).map((s) => `${s.tableId}#${s.seatIndex}`);
check('无席位重复占用', new Set(seatUse).size === seatUse.length);

const granny = p.guests.find((g) => g.displayName === '孙奶奶');
check(
  '锁定席位未被移动（孙奶奶在主桌1号位）',
  seated[granny.id].tableId === 'T-HEAD' && seated[granny.id].seatIndex === 0,
);

const tableOf = (name) => seated[p.guests.find((g) => g.displayName === name).id].tableId;
check('家庭同行：王家三人同桌', tableOf('王强') === tableOf('李梅') && tableOf('李梅') === tableOf('王小宝'));
check('家庭同行：张家三人同桌', tableOf('张伟') === tableOf('张婷') && tableOf('张婷') === tableOf('张乐乐'));

const childTables = new Set(p.floor.tables.filter((t) => t.allowsChildren).map((t) => t.id));
const kids = p.guests.filter((g) => g.isChild && g.rsvp === 'confirmed');
check('儿童椅占位：儿童均坐在允许儿童的桌', kids.every((k) => childTables.has(seated[k.id].tableId)));

// 容量
const cap = {};
for (const t of p.floor.tables) cap[t.id] = t.capacity;
for (const s of Object.values(seated)) cap[s.tableId]--;
check('各桌容量未超限', Object.values(cap).every((c) => c >= 0));

console.log(`   偏好总代价 z = ${res.result.z.toFixed(2)}`);
check('软约束代价已计算且 >= 0', res.result.z >= 0);

// 3. 容量不足场景：把总容量压到确认人数以下 → 应报冲突
const tinyTables = p.floor.tables.map((t) => ({ ...t, capacity: 1 }));
const m3 = buildModel(p.guests, tinyTables, [], [], []);
check('容量不足场景被检出', m3.conflicts.some((c) => c.includes('容量不足')));

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
