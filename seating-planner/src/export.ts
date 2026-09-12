import { Project, guestLabel } from './types';

/**
 * 导出桌卡：忌口从独立存储读取（keyed by guestId），与席位无关，
 * 因此换座不会丢失忌口信息。
 */
export function exportPlaceCards(project: Project) {
  const tableById = new Map(project.floor.tables.map((t) => [t.id, t]));
  const guestById = new Map(project.guests.map((g) => [g.id, g]));

  const cards = project.assignments
    .slice()
    .sort((a, b) => {
      const ta = tableById.get(a.seat.tableId)?.label ?? '';
      const tb = tableById.get(b.seat.tableId)?.label ?? '';
      return ta.localeCompare(tb) || a.seat.seatIndex - b.seat.seatIndex;
    })
    .map((a) => {
      const g = guestById.get(a.guestId);
      if (!g) return '';
      const diet = project.dietary[a.guestId]; // 独立存储，随宾客而非席位
      const t = tableById.get(a.seat.tableId);
      return `<div class="card">
  <div class="name">${escapeHtml(guestLabel(g))}</div>
  <div class="seat">${escapeHtml(t?.label ?? '')} · ${a.seat.seatIndex + 1} 号位${a.isChildSeat ? ' · 儿童椅' : ''}</div>
  ${diet && diet.tags.length ? `<div class="diet">忌口：${escapeHtml(diet.tags.join(' / '))}${diet.detail ? `（${escapeHtml(diet.detail)}）` : ''}</div>` : ''}
</div>`;
    })
    .join('\n');

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>桌卡 - ${escapeHtml(project.name)}</title>
<style>
body{font-family:system-ui,sans-serif;display:flex;flex-wrap:wrap;gap:12px;padding:16px}
.card{border:1px solid #999;border-radius:8px;width:220px;padding:16px;text-align:center;page-break-inside:avoid}
.name{font-size:20px;font-weight:600;margin-bottom:8px}
.seat{color:#555;margin-bottom:6px}
.diet{color:#a33;font-size:13px}
@media print{.card{border:1px dashed #999}}
</style></head><body>
${cards}
</body></html>`;

  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
  } else {
    // 弹窗被拦截时下载文件
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'place-cards.html';
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
