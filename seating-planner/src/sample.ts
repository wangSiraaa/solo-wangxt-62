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
 *  - 未回复宾客：3 人 pending，不参与自动排座
 *  - 同名宾客：两个「王芳」，以稳定编号 G-0007 / G-0008 区分
 *  - 锁定席位：奶奶锁定在主桌 1 号位
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
      [guests[2].id]: { guestId: guests[2].id, tags: ['儿童餐'], detail: '不要辣' },
      [guests[6].id]: { guestId: guests[6].id, tags: ['素食'], detail: '蛋奶素' },
      [guests[11].id]: { guestId: guests[11].id, tags: ['低盐'], detail: '' },
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
    assignments: [{ guestId: guests[11].id, seat: { tableId: 'T-HEAD', seatIndex: 0 }, locked: true, isChildSeat: false }],
    avoidPairs: [
      // 演示无解：两人同属一个家庭（必须同桌），又互相避让（不得同桌）
      { id: 'AP-1', a: guests[0].id, b: guests[1].id, reason: '演示用冲突：删除此条即可求解' },
    ],
    preferences: [
      { id: 'PR-1', guestId: guests[3].id, targetTableId: 'T-HEAD', weight: 2, note: '张伟希望靠近主桌' },
      { id: 'PR-2', guestId: guests[6].id, targetTableId: 'T-HEAD', weight: 1, note: '王芳(同事)希望靠近主桌' },
    ],
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
    nextGuestSeq: 1,
  };
}
