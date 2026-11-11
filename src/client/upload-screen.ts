/**
 * Экран «Свои файлы»: загрузка выгрузок, сопоставление колонок, запуск сверки.
 * Файлы читаются только в браузере; сетевых запросов с их содержимым нет
 * (и политика безопасности страницы их запрещает — см. astro.config.mjs).
 */
import { sampleFiles } from '../lib/csv.ts';
import { isSourceReady, mergeSources } from '../lib/merge.ts';
import type { MappedSource } from '../lib/merge.ts';
import { plural, withCount } from '../lib/messages.ts';
import { cellText, columnLetter, decodeText, detectHeaderRow, guessColumns, parseCsv } from '../lib/tabular.ts';
import type { ColumnField, Sheet } from '../lib/tabular.ts';
import { SOURCE_KEYS } from '../lib/types.ts';
import type { SourceKey } from '../lib/types.ts';
import { $, downloadText, esc, fmt, toast } from './dom.ts';
import { showUserData } from './service-screen.ts';
import { goTo } from './tabs.ts';

const TEXT_EXTENSIONS = ['csv', 'txt', 'tsv'];
const EXCEL_EXTENSIONS = ['xlsx', 'xls'];
/** Файл больше этого размера может подвесить вкладку: выгрузки остатков обычно в сотни раз меньше. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PREVIEW_ROWS = 3;
const PREVIEW_COLUMNS = 12;
const PREVIEW_CELL_CHARS = 28;

/** Ошибка с текстом, который можно показать пользователю как есть. */
class UserError extends Error {}

interface LoadedFile extends MappedSource {
  name: string;
  sheets: Record<string, Sheet>;
  sheet: string;
}
interface Slot {
  file: LoadedFile | null;
  error: string | null;
  /** Номер последней загрузки: если пользователь быстро выбрал другой файл, результат первой отбрасываем. */
  loadId: number;
}

const slots: Record<SourceKey, Slot> = {
  wb: { file: null, error: null, loadId: 0 },
  oz: { file: null, error: null, loadId: 0 },
  wh: { file: null, error: null, loadId: 0 },
};

/* ---------- Чтение файлов ---------- */

interface XlsxApi {
  read(data: ArrayBuffer, options: { type: 'array' }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json(sheet: unknown, options: { header: 1; raw: boolean; defval: string }): Sheet };
}
let xlsxLoading: Promise<XlsxApi> | null = null;

/** Библиотека чтения Excel весит около мегабайта, поэтому грузим её только когда выбран Excel-файл. */
function loadXlsx(): Promise<XlsxApi> {
  xlsxLoading ??= new Promise<XlsxApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = document.body.dataset.xlsxSrc ?? '';
    script.onload = () => resolve((window as unknown as { XLSX: XlsxApi }).XLSX);
    script.onerror = () => {
      xlsxLoading = null;
      reject(new UserError('Модуль чтения Excel не загрузился. Проверьте интернет или сохраните файл как CSV.'));
    };
    document.head.appendChild(script);
  });
  return xlsxLoading;
}

async function readSheets(file: File): Promise<Record<string, Sheet>> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (![...TEXT_EXTENSIONS, ...EXCEL_EXTENSIONS].includes(extension)) throw new UserError('Подойдут файлы .xlsx, .xls и .csv.');
  if (file.size > MAX_FILE_BYTES) throw new UserError('Файл больше 20 МБ. Оставьте в нём только лист с остатками.');

  const buffer = await file.arrayBuffer();
  const sheets: Record<string, Sheet> = {};
  if (TEXT_EXTENSIONS.includes(extension)) {
    sheets[file.name] = parseCsv(decodeText(buffer));
  } else {
    const xlsx = await loadXlsx();
    const workbook = xlsx.read(buffer, { type: 'array' });
    for (const name of workbook.SheetNames) {
      sheets[name] = xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '' });
    }
  }
  for (const name of Object.keys(sheets)) if (!sheets[name].length) delete sheets[name];
  if (!Object.keys(sheets).length) throw new UserError('В файле не нашлось строк с данными.');
  return sheets;
}

function selectSheet(file: LoadedFile, name: string): void {
  file.sheet = name;
  file.rows = file.sheets[name];
  setHeaderRow(file, detectHeaderRow(file.rows));
}

function setHeaderRow(file: LoadedFile, index: number): void {
  file.headerRow = Math.min(file.rows.length - 1, Math.max(0, index));
  file.map = guessColumns(file.rows[file.headerRow] ?? []);
}

async function loadFile(key: SourceKey, file: File): Promise<void> {
  const slot = slots[key];
  const loadId = ++slot.loadId;
  let loaded: LoadedFile | null = null;
  let error: string | null = null;
  try {
    const sheets = await readSheets(file);
    loaded = { name: file.name, sheets, sheet: '', rows: [], headerRow: 0, map: { art: -1, size: -1, qty: -1, name: -1 } };
    // По умолчанию открываем самый длинный лист: остатки почти всегда на нём
    const largest = Object.keys(sheets).sort((a, b) => sheets[b].length - sheets[a].length)[0];
    selectSheet(loaded, largest);
  } catch (cause) {
    // Технические подробности пользователю не показываем — только понятное сообщение
    error = cause instanceof UserError ? cause.message : 'Не получилось прочитать файл. Подойдут .xlsx, .xls и .csv.';
  }
  if (loadId !== slot.loadId) return;
  slot.file = loaded;
  slot.error = error;
  renderSlot(key);
  renderSummary();
}

/* ---------- Отрисовка карточки источника ---------- */

function headerLabel(file: LoadedFile, column: number): string {
  return cellText(file.rows[file.headerRow]?.[column]);
}

function columnCount(file: LoadedFile): number {
  return file.rows.slice(file.headerRow, file.headerRow + 30).reduce((max, row) => Math.max(max, row.length), 0);
}

function columnOptions(file: LoadedFile, selected: number, emptyLabel: string): string {
  let options = `<option value="-1">${esc(emptyLabel)}</option>`;
  for (let column = 0; column < columnCount(file); column++) {
    const label = `${columnLetter(column)}: ${headerLabel(file, column) || '(без названия)'}`;
    options += `<option value="${column}"${column === selected ? ' selected' : ''}>${esc(label)}</option>`;
  }
  return options;
}

function selectField(file: LoadedFile, field: ColumnField, label: string, emptyLabel: string, required = false): string {
  return `<label><span${required ? ' class="req"' : ''}>${esc(label)}</span><select data-field="${field}">${columnOptions(file, file.map[field], emptyLabel)}</select></label>`;
}

/** Первые строки файла с подписями выбранных колонок — чтобы сразу видеть, верно ли сопоставление. */
function previewHtml(file: LoadedFile): string {
  const tags = new Map<number, string>();
  if (file.map.name >= 0) tags.set(file.map.name, 'название');
  if (file.map.size >= 0) tags.set(file.map.size, 'размер');
  if (file.map.qty >= 0) tags.set(file.map.qty, 'количество');
  if (file.map.art >= 0) tags.set(file.map.art, 'артикул');

  const columns = Array.from({ length: Math.min(columnCount(file), PREVIEW_COLUMNS) }, (_, i) => i);
  const mark = (column: number) => (tags.has(column) ? ' class="m"' : '');
  const clip = (text: string) => esc(text.slice(0, PREVIEW_CELL_CHARS));

  const head = columns
    .map((column) => `<th${mark(column)}>${tags.has(column) ? `<em>${esc(tags.get(column))}</em>` : ''}${clip(headerLabel(file, column) || columnLetter(column))}</th>`)
    .join('');
  const body = file.rows
    .slice(file.headerRow + 1, file.headerRow + 1 + PREVIEW_ROWS)
    .map((row) => `<tr>${columns.map((column) => `<td${mark(column)}>${clip(cellText(row[column]))}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="prev"><table class="xls"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function mappingHtml(file: LoadedFile): string {
  const sheetNames = Object.keys(file.sheets);
  const dataRows = Math.max(0, file.rows.length - file.headerRow - 1);
  const sheetField =
    sheetNames.length > 1
      ? `<label><span>Лист</span><select data-field="sheet">${sheetNames.map((name) => `<option${name === file.sheet ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`
      : '';
  const sameColumn = file.map.art >= 0 && file.map.art === file.map.qty;

  return `<div class="fname">
      <span title="${esc(file.name)}">${esc(file.name)}</span>
      <span class="fname-n">· ${fmt(dataRows)} ${plural(dataRows, 'строка', 'строки', 'строк')}</span>
      <button class="link" type="button" data-action="clear">Заменить</button>
    </div>
    <div class="fields">
      ${sheetField}
      <label><span>Строка с заголовками</span><input type="number" data-field="header" min="1" max="${file.rows.length}" value="${file.headerRow + 1}"></label>
      ${selectField(file, 'art', 'Артикул', '— выберите —', true)}
      ${selectField(file, 'qty', 'Количество', '— выберите —', true)}
      ${selectField(file, 'size', 'Размер', 'нет / уже в артикуле')}
      ${selectField(file, 'name', 'Название товара', 'нет')}
    </div>
    ${sameColumn ? '<div class="err">Артикул и количество не могут быть в одной колонке.</div>' : ''}
    ${previewHtml(file)}`;
}

function renderSlot(key: SourceKey): void {
  const slot = slots[key];
  const card = $(`#src-${key}`);
  const chip = $('.chip', card);
  const ready = isSourceReady(slot.file);
  chip.textContent = ready ? 'готово' : slot.file ? 'укажите колонки' : 'не загружен';
  chip.classList.toggle('ok', ready);

  $('.drop', card).hidden = Boolean(slot.file);
  const error = $('.src-error', card);
  error.hidden = !slot.error;
  error.textContent = slot.error ?? '';
  $('.src-mapping', card).innerHTML = slot.file ? mappingHtml(slot.file) : '';
}

function renderSummary(): void {
  const ready = SOURCE_KEYS.filter((key) => isSourceReady(slots[key].file)).length;
  $<HTMLButtonElement>('#btnMerge').disabled = ready < 2;
  $('#goReady').hidden = ready < 2;
  $('#goWaiting').hidden = ready >= 2;
  $('#goReadyCount').textContent = `Готово к сверке: ${withCount(ready, 'файл', 'файла', 'файлов')}.`;
}

/* ---------- События ---------- */

function onFieldChange(key: SourceKey, target: HTMLInputElement | HTMLSelectElement): void {
  if (target instanceof HTMLInputElement && target.type === 'file') {
    const file = target.files?.[0];
    target.value = ''; // чтобы повторный выбор того же файла снова вызвал событие
    if (file) void loadFile(key, file);
    return;
  }
  const file = slots[key].file;
  const field = target.dataset.field;
  if (!file || !field) return;

  if (field === 'sheet') selectSheet(file, target.value);
  else if (field === 'header') setHeaderRow(file, (Number.parseInt(target.value, 10) || 1) - 1);
  else file.map[field as ColumnField] = Number.parseInt(target.value, 10);
  renderSlot(key);
  renderSummary();
}

function initSlot(key: SourceKey): void {
  const card = $(`#src-${key}`);
  card.addEventListener('change', (event) => onFieldChange(key, event.target as HTMLInputElement | HTMLSelectElement));
  card.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).dataset.action !== 'clear') return;
    slots[key].loadId++;
    slots[key].file = null;
    slots[key].error = null;
    renderSlot(key);
    renderSummary();
  });
  card.addEventListener('dragover', (event) => {
    event.preventDefault();
    card.classList.add('drag');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drag'));
  card.addEventListener('drop', (event) => {
    event.preventDefault();
    card.classList.remove('drag');
    const file = event.dataTransfer?.files[0];
    if (file) void loadFile(key, file);
  });
  renderSlot(key);
}

function runMerge(): void {
  const result = mergeSources({ wb: slots.wb.file, oz: slots.oz.file, wh: slots.wh.file });
  if (!result.rows.length) {
    toast('В выбранных колонках не нашлось артикулов — проверьте сопоставление');
    return;
  }
  showUserData(result);
  goTo('svc');
  toast(`Сведено ${withCount(result.rows.length, 'позиция', 'позиции', 'позиций')}`);
}

function downloadSamples(): void {
  // Небольшая пауза между файлами: браузеры блокируют несколько загрузок, начатых одновременно
  Object.entries(sampleFiles()).forEach(([name, content], index) => window.setTimeout(() => downloadText(name, content), index * 350));
  toast('Скачиваются 3 файла-примера — загрузите их в карточки выше');
}

export function initUploadScreen(): void {
  SOURCE_KEYS.forEach(initSlot);
  $('#btnMerge').addEventListener('click', runMerge);
  $('#btnSamples').addEventListener('click', downloadSamples);
  renderSummary();
}
