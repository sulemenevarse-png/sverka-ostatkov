/** Сведение загруженных таблиц в одну: общий ключ позиции = артикул + размер. */
import { DEFAULT_LOW_THRESHOLD } from './config.ts';
import { cellText } from './tabular.ts';
import type { Cell, ColumnMap, Sheet } from './tabular.ts';
import { SOURCE_KEYS } from './types.ts';
import type { AnalysisContext, SourceKey, StockRow } from './types.ts';

/** Таблица одного источника с выбранными пользователем колонками. */
export interface MappedSource {
  rows: Sheet;
  /** Индекс строки заголовков; данные начинаются со следующей. */
  headerRow: number;
  map: ColumnMap;
}

export interface MergeStats {
  sourceCount: number;
  /** Позиции, найденные во всех загруженных файлах. */
  inAll: number;
  /** Позиции, найденные только в одном файле. */
  onlyIn: Record<SourceKey, number>;
}

export interface MergeResult {
  rows: StockRow[];
  ctx: AnalysisContext;
  stats: MergeStats;
}

const CYRILLIC_SIZE_LETTERS: Record<string, string> = { Х: 'X', М: 'M', Л: 'L', С: 'S' };
const SEPARATOR = /[-_/\s.,]/;
/** Если размер стоит в конце артикула у такой доли строк, считаем, что артикулы файла уже содержат размер. */
const SIZE_IN_ARTICLE_SHARE = 0.8;

/**
 * Буквенные размеры, набранные кириллицей («ХЛ», «М»), приводим к латинице —
 * на глаз они неотличимы, а при сравнении не совпадают. Остальное («Без размера», «44-46») не трогаем.
 */
export function normalizeSize(value: Cell): string {
  const size = cellText(value).toUpperCase();
  if (size === '0' || size === '-') return '';
  return /^[XSMLХСМЛ\d]{1,5}$/.test(size) ? size.replace(/[ХМЛС]/g, (letter) => CYRILLIC_SIZE_LETTERS[letter]) : size;
}

/** Артикул без регистра и разделителей: «hd-blk» и «HD_BLK» — одно и то же. */
export function normalizeArticle(value: string): string {
  return value.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** «HD-BLK-M» заканчивается размером «M», стоящим после разделителя. */
export function endsWithSize(text: string, size: string): boolean {
  if (!size || text.length <= size.length) return false;
  const tail = text.slice(-size.length).toUpperCase();
  return tail === size.toUpperCase() && SEPARATOR.test(text.charAt(text.length - size.length - 1));
}

export function isSourceReady(source: MappedSource | null | undefined): source is MappedSource {
  return Boolean(source && source.map.art >= 0 && source.map.qty >= 0 && source.map.art !== source.map.qty);
}

/** «1 234,5» → 1234.5; нечисловое значение → 0. */
export function parseQuantity(value: Cell): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(cellText(value).replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

interface SourceItem {
  art: string;
  size: string;
  name: string;
  qty: number;
}

function readItems(source: MappedSource): SourceItem[] {
  const { map } = source;
  const items: SourceItem[] = [];
  for (const row of source.rows.slice(source.headerRow + 1)) {
    const art = cellText(row?.[map.art]);
    if (!art || /^(итог|всего|total)/i.test(art)) continue;
    items.push({
      art,
      size: map.size >= 0 ? normalizeSize(row[map.size]) : '',
      name: map.name >= 0 ? cellText(row[map.name]) : '',
      // Отрицательные остатки (пересорт, брак) продавать нельзя — считаем нулём
      qty: Math.max(0, Math.round(parseQuantity(row[map.qty]))),
    });
  }
  return items;
}

export function mergeSources(sources: Partial<Record<SourceKey, MappedSource | null>>): MergeResult {
  const byKey = new Map<string, StockRow>();
  const has: Record<SourceKey, boolean> = { wb: false, oz: false, wh: false };

  for (const sourceKey of SOURCE_KEYS) {
    const source = sources[sourceKey];
    if (!isSourceReady(source)) continue;
    has[sourceKey] = true;

    const items = readItems(source);
    // Решаем один раз на файл, а не по строкам: иначе артикул «TS-42» с размером 42
    // ошибочно сочтём «уже содержащим размер» и он не совпадёт с другими файлами.
    const sized = items.filter((item) => item.size);
    const articleHasSize = sized.length > 0 && sized.filter((item) => endsWithSize(item.art, item.size)).length >= sized.length * SIZE_IN_ARTICLE_SHARE;

    for (const item of items) {
      const key = item.size && !articleHasSize ? normalizeArticle(item.art) + normalizeArticle(item.size) : normalizeArticle(item.art);
      let row = byKey.get(key);
      if (!row) {
        row = { key, label: '', sku: item.art, size: item.size, wb: null, oz: null, wh: null, order: byKey.size, issues: [], severity: 3 };
        byKey.set(key, row);
      }
      if (!row.size) row.size = item.size;
      if (!row.label) row.label = item.name;
      // Одна позиция может идти несколькими строками (например, по разным складам WB) — складываем
      row[sourceKey] = (row[sourceKey] ?? 0) + item.qty;
    }
  }

  const sourceCount = SOURCE_KEYS.filter((key) => has[key]).length;
  const stats: MergeStats = { sourceCount, inAll: 0, onlyIn: { wb: 0, oz: 0, wh: 0 } };
  const rows = [...byKey.values()];

  for (const row of rows) {
    if (!row.label) {
      row.label = row.sku;
      row.sku = '';
    }
    if (endsWithSize(row.label, row.size)) row.size = ''; // размер уже виден в названии — не дублируем
    const present = SOURCE_KEYS.filter((key) => has[key] && row[key] != null);
    if (present.length === sourceCount) stats.inAll++;
    else if (present.length === 1) stats.onlyIn[present[0]]++;
  }

  return { rows, ctx: { has, missingIsZero: true, lowThreshold: DEFAULT_LOW_THRESHOLD }, stats };
}
