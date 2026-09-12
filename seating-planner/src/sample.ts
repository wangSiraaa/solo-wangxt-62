import { Project, Guest, BanquetTable } from './types';

let seq = 0;
function gid(): string {
  seq += 1;
  return `G-${String(seq).padStart(4, '0')}`;
}

function g(
  displayName: string,
  opts: Partial<Pick<Guest, 'rsvp' | 'isChild' | 'familyId' | 'note'>> & { nameIndex?: number } = {},
  namesSeen?: Map<string, number>,
): Guest {
  const nameIndex = opts.nameIndex ?? 1;
  return {
    id: gid(),
    displayName,
    nameIndex,
    rsvp: opts.rsvp ?? 'confirmed',
    isChild: opts.isChild ?? false,
    familyId: opts.familyId ?? null,
    note: opts.note ?? '',
  };
}

/**
 * 样例工程，覆盖需求中的验证点：
 *  - 无解冲突：王强与李梅同属家庭「F-王家」（同行硬约束），又存在明确避让 → 直接求解必无解
 *  - 儿童椅占位：两名儿童，仅部分桌允许儿童
 *  - 未回复宾客：3 人 pending，不参与自动排座（计入候选容量）
 *  - 同名宾客：两个「王芳」，以稳定编号 G-0007 / G-0008 区分
 *  - 锁定席位：孙奶奶、张伟已入席且确认不动
 *  - 撤桌重排：约一半宾客已入席（T1/T2/T3/T4），演示撤掉 T3/T4 后最少换桌重排
 *  - 菜品：T3 的佛跳墙已出菜（撤桌后事实保留），其余未出菜
 */
export function createSampleProject(): Project {
  seq = 0;
  const guests: Guest[] = [
    g('王强', { familyId: 'F-王家', note: '新郎兄长' }),
    g('李梅', { familyId: 'F-王家', note: '王强之妻' }),
    g('王小宝', { familyId: 'F-王家', isChild: true, note: '6 岁，需儿童椅' }),
    g('张伟', { familyId: 'F-张家' }),
    g('张婷', { familyId: 'F-张家' }),
    g('张乐乐', { familyId: 'F-张家', isChild: true, note: '4 岁' }),
    g('王芳', { note: '新娘同事' }),
    g('王芳', { note: '新郎同学（同名）' }, ),
    g('陈静', { rsvp: 'pending' }),
    g('刘洋', { rsvp: 'pending' }),
    g('赵敏', { rsvp: 'pending' }),
    g('孙奶奶', { note: '行动不便，锁定主桌' }),
    g('周杰', {}),
    g('吴倩', {}),
    g('郑浩', { rsvp: 'declined', note: '已婉拒' }),
  ];
  // 同名编号
  const seen = new Map<string, number>();
  for (const guest of guests) {
    const n = (seen.get(guest.displayName) ?? 0) + 1;
    seen.set(guest.displayName, n);
    guest.nameIndex = n;
  }
  const G = (i: number) => guests[i - 1].id; // G-000i

  const tables: BanquetTable[] = [
    { id: 'T-HEAD', label: '主桌', shape: { kind: 'rect', width: 240, height: 90 }, center: { x: 600, y: 110 }, rotationDeg: 0, capacity: 6, isHead: true, allowsChildren: false },
    { id: 'T-1', label: 'T1', shape: { kind: 'round', radius: 80 }, center: { x: 250, y: 420 }, rotationDeg: 0, capacity: 8, isHead: false, allowsChildren: true },
    { id: 'T-2', label: 'T2', shape: { kind: 'round', radius: 80 }, center: { x: 950, y: 420 }, rotationDeg: 0, capacity: 8, isHead: false, allowsChildren: true },
    { id: 'T-3', label: 'T3', shape: { kind: 'round', radius: 80 }, center: { x: 250, y: 660 }, rotationDeg: 0, capacity: 8, isHead: false, allowsChildren: false },
    { id: 'T-4', label: 'T4', shape: { kind: 'round', radius: 80 }, center: { x: 950, y: 660 }, rotationDeg: 0, capacity: 8, isHead: false, allowsChildren: false },
  ];

  return {
    id: `P-${Date.now().toString(36)}`,
    name: '样例：王李联姻 2026-10-03',
    updatedAt: Date.now(),
    guests,
    dietary: {
      [G(3)]: { guestId: G(3), tags: ['儿童餐'], detail: '不要辣' },
      [G(7)]: { guestId: G(7), tags: ['素食'], detail: '蛋奶素' },
      [G(12)]: { guestId: G(12), tags: ['低盐'], detail: '' },
    },
    floor: {
      width: 1200,
      height: 800,
      tables,
      zones: [
        {
          id: 'Z-AISLE',
          label: '主通道',
          kind: 'aisle',
          polygon: [
            { x: 540, y: 220 },
            { x: 660, y: 220 },
            { x: 660, y: 800 },
            { x: 540, y: 800 },
          ],
        },
        {
          id: 'Z-EXIT',
          label: '消防出口',
          kind: 'fire-exit',
          polygon: [
            { x: 0, y: 700 },
            { x: 120, y: 700 },
            { x: 120, y: 800 },
            { x: 0, y: 800 },
          ],
        },
      ],
    },
    // 约一半宾客已入席；孙奶奶、张伟确认不动（锁定）
    assignments: [
      { guestId: G(12), seat: { tableId: 'T-HEAD', seatIndex: 0 }, locked: true, isChildSeat: false },
      { guestId: G(1), seat: { tableId: 'T-1', seatIndex: 0 }, locked: false, isChildSeat: false },
      { guestId: G(2), seat: { tableId: 'T-1', seatIndex: 1 }, locked: false, isChildSeat: false },
      { guestId: G(3), seat: { tableId: 'T-1', seatIndex: 2 }, locked: false, isChildSeat: true },
      { guestId: G(4), seat: { tableId: 'T-2', seatIndex: 0 }, locked: true, isChildSeat: false },
      { guestId: G(5), seat: { tableId: 'T-2', seatIndex: 1 }, locked: false, isChildSeat: false },
      { guestId: G(6), seat: { tableId: 'T-2', seatIndex: 2 }, locked: false, isChildSeat: true },
      { guestId: G(7), seat: { tableId: 'T-3', seatIndex: 0 }, locked: false, isChildSeat: false },
      { guestId: G(13), seat: { tableId: 'T-3', seatIndex: 1 }, locked: false, isChildSeat: false },
      { guestId: G(8), seat: { tableId: 'T-4', seatIndex: 0 }, locked: false, isChildSeat: false },
      { guestId: G(14), seat: { tableId: 'T-4', seatIndex: 1 }, locked: false, isChildSeat: false },
    ],
    avoidPairs: [
      // 演示无解：两人同属一个家庭（必须同桌），又互相避让（不得同桌）
      { id: 'AP-1', a: G(1), b: G(2), reason: '演示用冲突：删除此条即可求解' },
    ],
    preferences: [
      { id: 'PR-1', guestId: G(4), targetTableId: 'T-HEAD', weight: 2, note: '张伟希望靠近主桌' },
      { id: 'PR-2', guestId: G(7), targetTableId: 'T-HEAD', weight: 1, note: '王芳(同事)希望靠近主桌' },
    ],
    catering: [
      { id: 'D-1', tableId: 'T-HEAD', name: '冷盘拼盘', servings: 6, servedAt: 1727910000000 },
      { id: 'D-2', tableId: 'T-1', name: '龙虾两吃', servings: 8, servedAt: null },
      { id: 'D-3', tableId: 'T-2', name: '烤乳猪', servings: 8, servedAt: null },
      { id: 'D-4', tableId: 'T-3', name: '佛跳墙', servings: 8, servedAt: 1727910300000 }, // 已出菜：不可回滚
      { id: 'D-5', tableId: 'T-3', name: '清蒸石斑', servings: 8, servedAt: null },
      { id: 'D-6', tableId: 'T-4', name: '时令时蔬', servings: 8, servedAt: null },
    ],
    layoutVersion: 1,
    nextGuestSeq: seq + 1,
  };
}

export function emptyProject(): Project {
  return {
    id: `P-${Date.now().toString(36)}`,
    name: '新婚礼项目',
    updatedAt: Date.now(),
    guests: [],
    dietary: {},
    floor: { width: 1200, height: 800, tables: [], zones: [] },
    assignments: [],
    avoidPairs: [],
    preferences: [],
    catering: [],
    layoutVersion: 1,
    nextGuestSeq: 1,
  };
}
