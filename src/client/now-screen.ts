/** Экран «Как сейчас»: три таблицы в трёх разных форматах, как их видит селлер в Excel. */
import { countProblems } from '../lib/analysis.ts';
import { SIZES, seededRandom } from '../lib/demo-data.ts';
import { withCount } from '../lib/messages.ts';
import type { DemoRow } from '../lib/types.ts';
import { $, esc } from './dom.ts';

interface SheetView {
  dot: string;
  title: string;
  file: string;
  head: string[];
  rows: DemoRow[];
  /** Ячейки строки; последняя — количество. */
  cells: (row: DemoRow) => (string | number)[];
}

function sheetHtml(view: SheetView): string {
  const body = view.rows
    .map((row) => {
      const level = row.issues[0]?.level;
      const rowClass = level ? ` class="d-${level === 'red' ? 'red' : 'amber'}"` : '';
      const cells = view.cells(row);
      return `<tr${rowClass}>${cells.map((cell, i) => `<td${i === cells.length - 1 ? ' class="q"' : ''}>${esc(cell)}</td>`).join('')}</tr>`;
    })
    .join('');
  return `<div class="card sheet">
    <div class="sheet-h"><span class="dot ${view.dot}"></span>${esc(view.title)}<small>${esc(view.file)}</small></div>
    <div class="sheet-b"><table class="xls"><thead><tr>${view.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>
  </div>`;
}

export function renderNowScreen(rows: DemoRow[]): void {
  // У каждого файла свой порядок строк — как в жизни, поэтому глазами их не сопоставить
  const random = seededRandom(7);
  const byBarcode = rows.slice().sort((a, b) => a.barcode.localeCompare(b.barcode));
  const shuffled = rows.map((row) => ({ row, sort: random() })).sort((a, b) => a.sort - b.sort).map((item) => item.row);
  const byColor = rows
    .slice()
    .sort((a, b) => a.color.localeCompare(b.color, 'ru') || a.style.localeCompare(b.style, 'ru') || SIZES.indexOf(a.size) - SIZES.indexOf(b.size));

  const sheets: SheetView[] = [
    { dot: 'wb', title: 'Wildberries', file: 'wb_ostatki.xlsx', head: ['Артикул продавца', 'Баркод', 'Размер', 'Остаток'], rows: byBarcode, cells: (r) => [r.art, r.barcode, r.size, r.wb] },
    { dot: 'oz', title: 'Ozon', file: 'ozon_stocks.xlsx', head: ['Артикул', 'Название товара', 'Доступно к продаже'], rows: shuffled, cells: (r) => [r.sku, `${r.label}, р. ${r.size}`, r.oz] },
    { dot: 'wh', title: 'Свой склад', file: 'sklad.xlsx', head: ['Код', 'Наименование', 'Цвет', 'Размер', 'Кол-во'], rows: byColor, cells: (r) => [r.art.toLowerCase(), r.style, r.color, r.size, r.wh] },
  ];
  $('#sheets').innerHTML = sheets.map(sheetHtml).join('');

  const problems = countProblems(rows);
  $('#nowSummary').textContent = `В этих трёх таблицах ${withCount(rows.length, 'позиция', 'позиции', 'позиций')} и ${withCount(problems, 'расхождение', 'расхождения', 'расхождений')}.`;
}

export function initNowScreen(): void {
  const button = $('#btnDiff');
  button.addEventListener('click', () => {
    const shown = $('#sheets').classList.toggle('show-diff');
    button.textContent = shown ? 'Скрыть подсветку' : 'Подсветить расхождения';
  });
}
