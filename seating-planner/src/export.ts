import { Project, guestLabel } from './types';

export interface PrintGuard {
  solving: boolean;
  hasUnconsumedResult: boolean;
}

/** 打印前置检查：只能来自最新确认布局 */
export function canPrint(guard: PrintGuard): string | null {
  if (guard.solving) return '求解进行中，布局未确认，不能打印';
  if (guard.hasUnconsumedResult) return '存在未处理的最新求解结果：请先「应用」或「忽略」，再打印';
  return null;
}

/**
 * 导出桌卡：只读取当前已确认布局（project.assignments + layoutVersion）。
 * 忌口从独立存储读取（keyed by guestId），与席位无关，换座不丢失。
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
.header{width:100%;color:#666;font-size:12px;border-bottom:1px solid #ccc;padding-bottom:8px}
@media print{.card{border:1px dashed #999}}
</style></head><body>
<div class="header">${escapeHtml(project.name)} · 布局版本 v${project.layoutVersion} · 打印于 ${new Date().toLocaleString()} · 共 ${project.assignments.length} 席</div>
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
