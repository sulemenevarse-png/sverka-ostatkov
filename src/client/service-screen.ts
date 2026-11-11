/**
 * Экран «С сервисом»: сводная таблица, рекомендации, счётчики и макет Telegram.
 * Показывает либо демо-данные, либо результат сверки файлов пользователя.
 */
import { analyze, countProblems, effectiveStock, issueTouches, sortBySeverity } from '../lib/analysis.ts';
import { summaryCsv } from '../lib/csv.ts';
import { createDemoState, DEMO_CONTEXT, hoursSaved, savedTotal, simulateDay } from '../lib/demo-state.ts';
import type { DemoState, FeedItem } from '../lib/demo-state.ts';
import type { MergeResult } from '../lib/merge.ts';
import { alertMessage, digestMessage, recommendationText, statusText, stockLine, withCount } from '../lib/messages.ts';
import { SOURCE_KEYS, SOURCE_LABEL } from '../lib/types.ts';
import type { AnalysisContext, DemoRow, Recommendation, SourceKey, StockRow } from '../lib/types.ts';
import { $, $$, downloadText, esc, fmt, toast } from './dom.ts';
import { goTo, onTabShown } from './tabs.ts';

/** Сколько рекомендаций видно до нажатия «Показать все». */
const RECS_COLLAPSED = 7;
const RECS_EXPANDED_LIMIT = 200;
/** Больше строк таблица не рисует — у крупного каталога просим уточнить поиском. */
const TABLE_ROW_LIMIT = 400;
const FEED_LIMIT = 14;

let demo: DemoState = createDemoState();
let user: (MergeResult & { recommendations: Recommendation[] }) | null = null;
const view = { filter: 'all' as 'all' | 'bad', query: '', showAllRecs: false };

interface Dataset {
  rows: StockRow[];
  ctx: AnalysisContext;
  recommendations: Recommendation[];
  /** Предупреждения, появившиеся на последнем шаге симуляции. */
  fresh: Set<string>;
}

function dataset(): Dataset {
  if (user) return { rows: user.rows, ctx: user.ctx, recommendations: user.recommendations, fresh: new Set() };
  return { rows: demo.rows, ctx: DEMO_CONTEXT, recommendations: demo.recommendations, fresh: demo.fresh };
}

export function getDemoRows(): DemoRow[] {
  return demo.rows;
}

/** Показывает результат сверки загруженных файлов вместо демо-данных. */
export function showUserData(result: MergeResult): void {
  user = { ...result, recommendations: analyze(result.rows, result.ctx) };
  view.filter = 'all';
  view.query = '';
  view.showAllRecs = false;
  $<HTMLInputElement>('#search').value = '';
  render();
}

/* ---------- Счётчики ---------- */

/** Плавно докручивает число до нового значения — так рост счётчика заметен. */
function animateNumber(element: HTMLElement, target: number, suffix: string): void {
  const from = Number(element.dataset.value ?? 0);
  element.dataset.value = String(target);
  if (from === target) {
    element.textContent = fmt(target) + suffix;
    return;
  }
  const duration = 600;
  let start: number | null = null;
  const step = (now: number) => {
    start ??= now;
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = fmt(from + (target - from) * eased) + suffix;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderKpis(data: Dataset): void {
  const problems = countProblems(data.rows);
  $('#kpisDemo').hidden = Boolean(user);
  $('#kpisUser').hidden = !user;

  if (!user) {
    $('#kTime').textContent = `${(Math.round(hoursSaved(demo) * 10) / 10).toLocaleString('ru-RU')} ч`;
    animateNumber($('#kMoney'), savedTotal(demo), ' ₽');
    $('#kBad').textContent = String(problems);
    $('#kBadNote').textContent = `из ${withCount(data.rows.length, 'позиции', 'позиций', 'позиций')}`;
    $('#kDay').textContent = demo.soldTotal ? `День ${demo.day} · продано ${fmt(demo.soldTotal)} шт.` : `День ${demo.day} · нажмите: +1 день продаж`;
    return;
  }

  const stuck = data.recommendations.filter((rec) => rec.issue.type === 'move' || rec.issue.type === 'idle');
  const stuckUnits = stuck.reduce((sum, rec) => sum + rec.issue.qty, 0);
  $('#kuTotal').textContent = fmt(data.rows.length);
  $('#kuTotalNote').textContent = `из ${withCount(user.stats.sourceCount, 'файла', 'файлов', 'файлов')} за секунду`;
  $('#kuBad').textContent = fmt(problems);
  $('#kuStuck').textContent = fmt(stuck.length);
  $('#kuStuckNote').textContent = `${fmt(stuckUnits)} шт. лежит без продаж`;
  $('#kuLow').textContent = fmt(data.recommendations.filter((rec) => rec.issue.type === 'low').length);
  $('#kuLowNote').textContent = `осталось ${user.ctx.lowThreshold} шт. или меньше`;
}

/* ---------- Плашка «Показаны ваши данные» ---------- */

function renderBanner(): void {
  const banner = $('#userBanner');
  banner.hidden = !user;
  $('#svcTitle').textContent = user ? 'Ваши остатки: сводная таблица' : ($('#svcTitle').dataset.demoTitle ?? '');
  if (!user) return;

  const { stats, ctx, rows } = user;
  const details: string[] = [];
  if (stats.sourceCount > 1) details.push(`найдены во всех файлах — ${fmt(stats.inAll)}`);
  for (const key of SOURCE_KEYS) {
    if (ctx.has[key] && stats.onlyIn[key]) details.push(`только в файле «${SOURCE_LABEL[key]}» — ${fmt(stats.onlyIn[key])}`);
  }
  // Ни одна позиция не совпала между файлами — почти наверняка выбрана не та колонка артикула
  const nothingMatched = stats.sourceCount > 1 && stats.inAll === 0;
  banner.classList.toggle('warn', nothingMatched);
  $('#bannerText').textContent = `Позиций: ${fmt(rows.length)}${details.length ? ` (${details.join('; ')})` : ''}.`;
  $('#bannerWarn').hidden = !nothingMatched;
  $<HTMLInputElement>('#optMissing').checked = ctx.missingIsZero;
  $<HTMLInputElement>('#optLow').value = String(ctx.lowThreshold);
}

/* ---------- Таблица ---------- */

function stockCell(row: StockRow, key: SourceKey, ctx: AnalysisContext): string {
  if (!ctx.has[key]) return '<td class="num qna">—</td>';
  const value = effectiveStock(row, key, ctx);
  if (row[key] == null || value == null) return `<td class="num qna" title="Нет в файле">${value ?? '—'}</td>`;

  const issue = row.issues.find((item) => issueTouches(item, key));
  let highlight = '';
  if (issue) highlight = issue.level === 'red' ? 'q0' : 'qlow';
  else if (value === 0 && key !== 'wh') highlight = 'q0';
  return `<td class="num ${highlight}">${fmt(value)}</td>`;
}

function statusChip(row: StockRow): string {
  const level = row.issues[0]?.level ?? 'ok';
  return `<span class="st ${level}">${esc(statusText(row) ?? 'В норме')}</span>`;
}

function rowHtml(row: StockRow, data: Dataset, highlightFresh: boolean): string {
  const level = row.issues[0]?.level ?? '';
  const isFresh = highlightFresh && row.issues.some((issue) => data.fresh.has(issue.id));
  const chip = statusChip(row);
  return `<tr class="${level}${isFresh ? ' fresh' : ''}">
    <td><span class="pname">${esc(row.label)}</span>${row.size ? `<span class="size">${esc(row.size)}</span>` : ''}
      ${row.sku ? `<div class="psku">${esc(row.sku)}</div>` : ''}${row.issues.length ? `<div class="st-m">${chip}</div>` : ''}</td>
    ${SOURCE_KEYS.map((key) => stockCell(row, key, data.ctx)).join('')}
    <td class="c-st">${chip}</td>
  </tr>`;
}

function renderTable(data: Dataset, highlightFresh = false): void {
  const query = view.query.trim().toLowerCase();
  const matching = sortBySeverity(
    data.rows.filter((row) => {
      if (view.filter === 'bad' && !row.issues.length) return false;
      return !query || `${row.label} ${row.size} ${row.sku}`.toLowerCase().includes(query);
    }),
  );
  const shown = matching.slice(0, TABLE_ROW_LIMIT);

  $('#tbody').innerHTML = shown.map((row) => rowHtml(row, data, highlightFresh)).join('') || '<tr><td colspan="5" class="empty">Ничего не найдено</td></tr>';
  $('#tcount').textContent = `Показано ${fmt(shown.length)} из ${fmt(data.rows.length)}${matching.length > TABLE_ROW_LIMIT ? ' — уточните поиском' : ''}`;
  $('#segAllCount').textContent = fmt(data.rows.length);
  $('#segBadCount').textContent = fmt(countProblems(data.rows));
  for (const button of $$('#seg button')) button.classList.toggle('on', button.dataset.filter === view.filter);
}

/* ---------- Рекомендации ---------- */

function renderRecommendations(data: Dataset): void {
  // Новые предупреждения поднимаем наверх, порядок остальных не меняем
  const ordered = data.recommendations.slice().sort((a, b) => Number(data.fresh.has(b.issue.id)) - Number(data.fresh.has(a.issue.id)));
  const shown = ordered.slice(0, view.showAllRecs ? RECS_EXPANDED_LIMIT : RECS_COLLAPSED);

  $('#recCount').textContent = fmt(ordered.length);
  $('#recs').innerHTML =
    shown
      .map((rec) => {
        const text = recommendationText(rec, data.ctx);
        const badge = data.fresh.has(rec.issue.id) ? '<span class="new">новое</span>' : '';
        return `<li class="rec ${rec.issue.level}">
          <div class="t">${esc(text.title)}${badge}</div>
          <div class="b"><b>${esc(text.name)}</b>${esc(text.detail)}</div>
          <div class="d num">${esc(stockLine(rec.row, data.ctx))}</div>
        </li>`;
      })
      .join('') || '<li class="empty">Расхождений нет — остатки в порядке.</li>';

  $('#recMore').hidden = ordered.length <= RECS_COLLAPSED;
  $('#btnMore').textContent = view.showAllRecs ? 'Свернуть' : `Показать все (${fmt(ordered.length)})`;
}

/* ---------- Макет Telegram ---------- */

function feedItems(data: Dataset): FeedItem[] {
  if (!user) return demo.feed;
  const time = '09:00';
  return [
    { kind: 'day', label: 'Сегодня' },
    { kind: 'message', time, message: digestMessage('Сверка остатков', data.rows.length, countProblems(data.rows), '') },
    ...data.recommendations.slice(0, 2).map((rec): FeedItem => ({ kind: 'message', time, message: alertMessage(rec, data.ctx) })),
  ];
}

function feedItemHtml(item: FeedItem): string {
  if (item.kind === 'day') return `<div class="tg-day">${esc(item.label)}</div>`;
  const { message } = item;
  const head = message.title ? `${esc(message.icon)} <b>${esc(message.title)}</b>\n` : '';
  const button = message.button ? `<span class="kb">${esc(message.button)}</span>` : '';
  return `<div class="msg">${head}${esc(message.lines.join('\n'))}${button}<time>${esc(item.time)}</time></div>`;
}

function scrollFeedToEnd(): void {
  const feed = $('#tg');
  feed.scrollTop = feed.scrollHeight;
}

function renderFeed(data: Dataset): void {
  $('#tg').innerHTML = feedItems(data).slice(-FEED_LIMIT).map(feedItemHtml).join('');
  scrollFeedToEnd();
}

/* ---------- Общая отрисовка и события ---------- */

function render(highlightFresh = false): void {
  if (user) user.recommendations = analyze(user.rows, user.ctx);
  const data = dataset();
  renderBanner();
  renderKpis(data);
  renderTable(data, highlightFresh);
  renderRecommendations(data);
  renderFeed(data);
}

function runSimulation(): void {
  const { sold, fresh } = simulateDay(demo);
  render(true);
  const news = fresh.length ? withCount(fresh.length, 'новое предупреждение', 'новых предупреждения', 'новых предупреждений') : 'новых предупреждений нет';
  toast(`День ${demo.day}: продано ${sold} шт. · ${news}`);
}

export function initServiceScreen(): void {
  $('#btnSim').addEventListener('click', runSimulation);
  $('#btnReset').addEventListener('click', () => {
    demo = createDemoState();
    view.showAllRecs = false;
    render();
    toast('Демо сброшено к первому дню');
  });

  $('#seg').addEventListener('click', (event) => {
    const filter = (event.target as HTMLElement).closest<HTMLElement>('button')?.dataset.filter;
    if (filter === 'all' || filter === 'bad') {
      view.filter = filter;
      renderTable(dataset());
    }
  });
  $<HTMLInputElement>('#search').addEventListener('input', (event) => {
    view.query = (event.target as HTMLInputElement).value;
    renderTable(dataset());
  });
  $('#btnMore').addEventListener('click', () => {
    view.showAllRecs = !view.showAllRecs;
    renderRecommendations(dataset());
  });
  $('#btnCsv').addEventListener('click', () => {
    const data = dataset();
    downloadText('svodnye_ostatki.csv', summaryCsv(data.rows, data.ctx));
  });

  $<HTMLInputElement>('#optMissing').addEventListener('change', (event) => {
    if (!user) return;
    user.ctx.missingIsZero = (event.target as HTMLInputElement).checked;
    render();
  });
  $<HTMLInputElement>('#optLow').addEventListener('change', (event) => {
    if (!user) return;
    user.ctx.lowThreshold = Math.max(0, Number.parseInt((event.target as HTMLInputElement).value, 10) || 0);
    render();
  });
  $('#btnBackUp').addEventListener('click', () => goTo('up'));
  $('#btnBackDemo').addEventListener('click', () => {
    user = null;
    view.showAllRecs = false;
    render();
    toast('Снова показаны демо-данные');
  });

  // Пока экран скрыт, у ленты нет высоты и прокрутить её нельзя — делаем это при показе
  onTabShown('svc', scrollFeedToEnd);
  render();
}
