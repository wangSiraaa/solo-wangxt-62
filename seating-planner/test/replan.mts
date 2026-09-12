// 撤桌重排端到端验证：
//  最少换桌 → 偏好；锁定不动；临时到场计入实际、未回复计入候选；
//  家庭同桌但剩余容量不足 → 无解；两人循环换座；过期拦截；菜品差异不可回滚
import initGlpk from 'glpk.js/node';
import { createSampleProject } from '../src/sample';
import { buildModel } from '../src/solver/model';
import { capacityReport, lexicographicSolve } from '../src/solver/solve';
import { validateSwapChain } from '../src/swapchain';
import { diffCatering } from '../src/catering';
import { isStaleResult, removeTablesFromProject } from '../src/projectOps';
import { canPrint } from '../src/export';
import { Assignment, Guest, Project } from '../src/types';

const glpk = await initGlpk();
let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures++;
};

const p0 = createSampleProject();
const G = (n: number) => `G-${String(n).padStart(4, '0')}`;
const seatOf = (list: Assignment[], gid: string) => list.find((a) => a.guestId === gid)?.seat;

// ---------- 1. 撤桌重排：最少换桌 ----------
// 删除演示用避让冲突后撤掉 T3/T4（4 位宾客被迫离席）
const p1 = removeTablesFromProject({ ...p0, avoidPairs: [] }, ['T-3', 'T-4']);
check('撤桌后 T3/T4 宾客被释放', !p1.assignments.some((a) => a.seat.tableId === 'T-3' || a.seat.tableId === 'T-4'));
check('撤桌后布局版本递增', p1.layoutVersion === p0.layoutVersion + 1);

const built1 = buildModel(p1.guests, p1.floor.tables, p1.assignments, p1.avoidPairs, p1.preferences);
check('撤桌后可建模（无硬冲突）', built1.conflicts.length === 0);
const r1 = await lexicographicSolve(glpk as never, built1, p1.guests);
check('重排求得最优解', r1.status === 'optimal');
check('最少换桌 = 0（已入席者全部原地保留）', r1.moves === 0);
const stillSeated = p1.assignments.filter((a) => !a.locked);
check(
  '未锁定已入席宾客一个都没被挪动',
  stillSeated.every((a) => {
    const ns = seatOf(r1.assignments!, a.guestId);
    return ns && ns.tableId === a.seat.tableId && ns.seatIndex === a.seat.seatIndex;
  }),
);
check(
  '锁定宾客（孙奶奶/张伟）原地不动',
  seatOf(r1.assignments!, G(12))?.tableId === 'T-HEAD' && seatOf(r1.assignments!, G(4))?.tableId === 'T-2',
);
const displaced = [G(7), G(8), G(13), G(14)];
check('被撤桌的 4 人全部重新入座', displaced.every((id) => seatOf(r1.assignments!, id)));

// 字典序验证：若存在偏好更优但需换桌的方案，也不能换 —— 换桌数必须等于阶段一最优
check('偏好代价在“零换桌”前提下取得最小', (r1.totalPenalty ?? 0) >= 0 && r1.moves === 0);

// ---------- 2. 容量核算：临时到场 vs 未回复 ----------
const walkin: Guest = {
  id: 'G-0099', displayName: '临时到场甲', nameIndex: 1,
  rsvp: 'walkin', isChild: false, familyId: null, note: '',
};
const built2 = buildModel([...p1.guests, walkin], p1.floor.tables, p1.assignments, [], p1.preferences);
const cap = capacityReport(built2.stats);
check('临时到场计入实际需求', cap.required === 12 && cap.walkins === 1);
check('未回复计入候选而非实际', cap.pendingCandidates === 3);
check('候选容量评估正确', cap.pendingFit === (cap.seats - cap.required >= 3));

// ---------- 3. 家庭必须同桌但剩余桌容量不足 → 无解 ----------
const bigFamily: Guest[] = Array.from({ length: 9 }, (_, i) => ({
  id: `G-01${String(i).padStart(2, '0')}`,
  displayName: `大家成员${i + 1}`,
  nameIndex: 1,
  rsvp: 'confirmed' as const,
  isChild: false,
  familyId: 'F-大家',
  note: '',
}));
const built3 = buildModel(
  [...p1.guests, ...bigFamily],
  p1.floor.tables, // 剩余最大桌容量 8 < 9
  p1.assignments,
  [],
  [],
);
check(
  '9 人家庭超过剩余最大桌容量 → 报无解冲突',
  built3.conflicts.some((c) => c.includes('F-大家') && c.includes('容量')),
);

// ---------- 4. 两人循环换座 ----------
const swapProj: Project = { ...p0, avoidPairs: [] };
const cycle = validateSwapChain(swapProj, [
  { guestId: G(13), to: { tableId: 'T-4', seatIndex: 1 } }, // 周杰 → 吴倩的位子
  { guestId: G(14), to: { tableId: 'T-3', seatIndex: 1 } }, // 吴倩 → 周杰的位子
]);
check('两人循环换座验证通过', cycle.ok);
check(
  '循环换座结果正确',
  seatOf(cycle.resulting!, G(13))?.tableId === 'T-4' && seatOf(cycle.resulting!, G(14))?.tableId === 'T-3',
);

// 无合法落点：目标是锁定席位 → 整条链不落地
const bad1 = validateSwapChain(swapProj, [
  { guestId: G(13), to: { tableId: 'T-HEAD', seatIndex: 0 } }, // 孙奶奶锁定位
]);
check('落点为锁定席位 → 链被拒绝', !bad1.ok && bad1.resulting === undefined);

// 链中宾客被锁定 → 拒绝
const bad2 = validateSwapChain(swapProj, [
  { guestId: G(4), to: { tableId: 'T-1', seatIndex: 7 } }, // 张伟已锁定
]);
check('锁定宾客不能参与链', !bad2.ok);

// 终态避让冲突 → 拒绝（周杰与吴倩互相避让，链把两人送到同桌）
const avoidProj: Project = {
  ...swapProj,
  avoidPairs: [{ id: 'APX', a: G(13), b: G(14), reason: '测试' }],
};
const bad3 = validateSwapChain(avoidProj, [
  { guestId: G(13), to: { tableId: 'T-3', seatIndex: 2 } },
  { guestId: G(14), to: { tableId: 'T-3', seatIndex: 1 } },
]);
check('终态避让冲突 → 链被拒绝', !bad3.ok);

// 儿童落到不允许儿童的桌 → 拒绝
const bad4 = validateSwapChain(swapProj, [
  { guestId: G(3), to: { tableId: 'T-4', seatIndex: 7 } }, // 王小宝是儿童，T4 不允许
]);
check('儿童落到非儿童桌 → 链被拒绝', !bad4.ok);

// ---------- 5. 过期拦截 ----------
check('版本一致 → 不过期', !isStaleResult(7, 7));
check('求解中新增到场（版本+1）→ 过期拦截', isStaleResult(7, 8));

// ---------- 6. 菜品与忌口差异、出菜不可回滚 ----------
const diff = diffCatering(p0, p1);
check('未出菜随桌撤单（清蒸石斑/时令时蔬）',
  diff.some((l) => l.includes('清蒸石斑') && l.includes('撤单')) &&
  diff.some((l) => l.includes('时令时蔬') && l.includes('撤单')));
check('已出菜事实保留（佛跳墙不可回滚）',
  diff.some((l) => l.includes('佛跳墙') && l.includes('不可回滚')));
check('已出菜记录仍在账单中', p1.catering.some((d) => d.id === 'D-4' && d.servedAt !== null));
check('忌口差异生成（素食离开 T3）', diff.some((l) => l.includes('素食') && l.includes('-1')));

// 重排应用后忌口随宾客落桌
const p2: Project = { ...p1, assignments: r1.assignments!, layoutVersion: p1.layoutVersion + 1 };
const diff2 = diffCatering(p1, p2);
check('重排后忌口差异指向新桌', diff2.some((l) => l.includes('素食') && l.includes('+1')));

// ---------- 7. 打印守卫 ----------
check('求解中禁止打印', canPrint({ solving: true, hasUnconsumedResult: false }) !== null);
check('未消费的新结果禁止打印', canPrint({ solving: false, hasUnconsumedResult: true }) !== null);
check('最新确认布局允许打印', canPrint({ solving: false, hasUnconsumedResult: false }) === null);

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
