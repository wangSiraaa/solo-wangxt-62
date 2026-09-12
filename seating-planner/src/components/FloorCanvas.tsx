import React, { useMemo } from 'react';
import { Stage, Layer, Rect, Circle, Line, Text, Group, Label, Tag } from 'react-konva';
import { useStore } from '../store';
import { checkFloorViolations, seatPosition, CHAIR_RADIUS } from '../geometry';
import { BanquetTable, guestLabel, seatKey } from '../types';

const ZONE_FILL: Record<string, string> = {
  aisle: 'rgba(255,165,0,0.25)',
  'fire-exit': 'rgba(255,0,0,0.30)',
  other: 'rgba(128,128,128,0.25)',
};

export function FloorCanvas() {
  const { state, assignSeat, moveTable, selectGuest } = useStore();
  const { project, selectedGuestId } = state;
  const { floor } = project;

  const violations = useMemo(
    () => checkFloorViolations(floor.tables, floor.zones),
    [floor.tables, floor.zones],
  );
  const violatedTables = useMemo(() => {
    const set = new Set<string>();
    for (const v of violations) {
      const m = v.target.match(/^桌 (\S+)/);
      if (m) {
        const t = floor.tables.find((t) => t.label === m[1]);
        if (t) set.add(t.id);
      }
    }
    return set;
  }, [violations, floor.tables]);

  const assignmentBySeat = useMemo(() => {
    const m = new Map<string, (typeof project.assignments)[number]>();
    for (const a of project.assignments) m.set(seatKey(a.seat), a);
    return m;
  }, [project.assignments]);

  const guestById = useMemo(
    () => new Map(project.guests.map((g) => [g.id, g])),
    [project.guests],
  );

  const selectedGuest = selectedGuestId ? guestById.get(selectedGuestId) : null;

  const onSeatClick = (table: BanquetTable, seatIndex: number) => {
    const existing = assignmentBySeat.get(`${table.id}#${seatIndex}`);
    if (existing) {
      selectGuest(existing.guestId);
      return;
    }
    if (selectedGuest) {
      if (selectedGuest.rsvp !== 'confirmed' && selectedGuest.rsvp !== 'walkin') return; // 未回复/婉拒不参与排座
      if (selectedGuest.isChild && !table.allowsChildren) return;
      assignSeat(selectedGuest.id, { tableId: table.id, seatIndex });
    }
  };

  return (
    <div>
      <Stage width={floor.width} height={floor.height} style={{ background: '#faf8f4', border: '1px solid #ccc' }}>
        <Layer>
          {/* 禁止占用多边形（仅几何检查，不代表安全认证） */}
          {floor.zones.map((z) => (
            <React.Fragment key={z.id}>
              <Line
                points={z.polygon.flatMap((p) => [p.x, p.y])}
                closed
                fill={ZONE_FILL[z.kind]}
                stroke={z.kind === 'fire-exit' ? '#c00' : '#c80'}
                dash={[6, 4]}
                strokeWidth={1.5}
              />
              <Text
                x={Math.min(...z.polygon.map((p) => p.x)) + 4}
                y={Math.min(...z.polygon.map((p) => p.y)) + 4}
                text={`${z.label}（禁占）`}
                fontSize={13}
                fill={z.kind === 'fire-exit' ? '#a00' : '#960'}
              />
            </React.Fragment>
          ))}

          {floor.tables.map((t) => {
            const bad = violatedTables.has(t.id);
            return (
              <Group
                key={t.id}
                x={t.center.x}
                y={t.center.y}
                rotation={t.rotationDeg}
                draggable
                onDragEnd={(e) => moveTable(t.id, e.target.x(), e.target.y())}
              >
                {t.shape.kind === 'round' ? (
                  <Circle
                    radius={t.shape.radius}
                    fill={t.isHead ? '#ffe9b0' : '#fff'}
                    stroke={bad ? '#d00' : '#8a6d3b'}
                    strokeWidth={bad ? 3 : 1.5}
                  />
                ) : (
                  <Rect
                    x={-t.shape.width / 2}
                    y={-t.shape.height / 2}
                    width={t.shape.width}
                    height={t.shape.height}
                    fill={t.isHead ? '#ffe9b0' : '#fff'}
                    stroke={bad ? '#d00' : '#8a6d3b'}
                    strokeWidth={bad ? 3 : 1.5}
                  />
                )}
                <Text
                  x={-60}
                  y={-8}
                  width={120}
                  align="center"
                  text={`${t.label} (${t.capacity})${t.allowsChildren ? ' 👶' : ''}`}
                  fontSize={14}
                  fontStyle={t.isHead ? 'bold' : 'normal'}
                />
              </Group>
            );
          })}

          {/* 席位椅子 */}
          {floor.tables.flatMap((t) =>
            Array.from({ length: t.capacity }, (_, i) => {
              const pos = seatPosition(t, i);
              const a = assignmentBySeat.get(`${t.id}#${i}`);
              const guest = a ? guestById.get(a.guestId) : null;
              const fill = a
                ? a.locked
                  ? '#7b68ee'
                  : a.isChildSeat
                    ? '#7fc97f'
                    : '#4a90d9'
                : selectedGuest &&
                    (selectedGuest.rsvp === 'confirmed' || selectedGuest.rsvp === 'walkin') &&
                    (!selectedGuest.isChild || t.allowsChildren)
                  ? '#cfe6ff'
                  : '#eee';
              return (
                <Group key={`${t.id}-${i}`} onClick={() => onSeatClick(t, i)} onTap={() => onSeatClick(t, i)}>
                  <Circle
                    x={pos.x}
                    y={pos.y}
                    radius={CHAIR_RADIUS}
                    fill={fill}
                    stroke={a?.locked ? '#4b2fa0' : '#999'}
                    strokeWidth={a?.locked ? 2.5 : 1}
                  />
                  {guest && (
                    <Text
                      x={pos.x - 40}
                      y={pos.y - 6}
                      width={80}
                      align="center"
                      text={`${guestLabel(guest).slice(0, 5)}${a?.locked ? '🔒' : ''}`}
                      fontSize={11}
                      listening={false}
                    />
                  )}
                </Group>
              );
            }),
          )}
        </Layer>
      </Stage>
      {violations.length > 0 && (
        <div style={{ color: '#b00', marginTop: 8, maxWidth: floor.width }}>
          ⚠️ 几何检查：{violations.length} 处与禁占区重叠（仅几何提示，不构成消防/安全认证）：
          <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
            {violations.slice(0, 8).map((v, i) => (
              <li key={i}>
                {v.target} 压到「{v.zoneLabel}」
              </li>
            ))}
            {violations.length > 8 && <li>…其余 {violations.length - 8} 处</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
