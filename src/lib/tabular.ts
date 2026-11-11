/** Разбор загруженных таблиц: кодировка, CSV, поиск строки заголовков и угадывание колонок. */

export type Cell = string | number | boolean | null | undefined;
export type Sheet = Cell[][];

/** В какой колонке что лежит; -1 — колонка не выбрана. */
export interface ColumnMap {
  art: number;
  size: number;
  qty: number;
  name: number;
}
export type ColumnField = keyof ColumnMap;

/**
 * Шаблоны заголовков по убыванию приоритета: сначала точные («Артикул продавца»),
 * потом общие («Артикул»). Так «Артикул WB» не выигрывает у артикула продавца,
 * а «Штрихкод» не принимается за количество из-за букв «шт».
 */
const HEADER_PATTERNS: Record<ColumnField, RegExp[]> = {
  art: [/артикул\s*(продавца|поставщика)|offer.?id|vendor.?code/i, /артикул|sku|offer|vendor|код товара|^код$|^арт/i],
  size: [/размер|size/i],
  qty: [/доступн|остат|свободн/i, /кол-?во|количество|налич|stock|qty|quantity|(^|[^а-яё])шт\.?($|[^а-яё])/i],
  name: [/наимен|назван|номенклат|name|title/i, /товар|предмет/i],
};
const FIELDS: ColumnField[] = ['art', 'size', 'qty', 'name'];
/** Заголовки ищем только в начале файла: дальше идут данные. */
const HEADER_SEARCH_ROWS = 25;

export function cellText(cell: Cell): string {
  return cell == null ? '' : String(cell).trim();
}

function looksLike(field: ColumnField, header: string): boolean {
  return HEADER_PATTERNS[field].some((pattern) => pattern.test(header));
}

/** Выгрузки из русского Excel часто в Windows-1251: пробуем UTF-8 и откатываемся, если байты невалидны. */
export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1251').decode(bytes);
  }
  return text.replace(/^﻿/, '');
}

/**
 * Разделитель — тот, что стабильно встречается в каждой из первых строк.
 * Просто «самый частый символ» ошибается, когда в названиях товаров есть запятые.
 */
function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 10);
  let best = ';';
  let bestScore = 0;
  for (const delimiter of [';', ',', '\t', '|']) {
    const counts = lines.map((line) => line.replace(/"[^"]*"/g, '').split(delimiter).length - 1);
    if (!counts.length) continue;
    const score = Math.min(...counts) * 1000 + counts.reduce((sum, n) => sum + n, 0);
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

/** CSV с кавычками и переносами строк внутри ячеек. Пустые строки отбрасываются. */
export function parseCsv(text: string): Sheet {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

function isNumeric(cell: Cell): boolean {
  return typeof cell === 'number' || /^-?[\d\s.,]+$/.test(cellText(cell));
}

/**
 * Над заголовками в выгрузках бывают строки с названием отчёта и датой.
 * Заголовком считаем строку, где больше всего текстовых ячеек и знакомых слов.
 */
export function detectHeaderRow(rows: Sheet): number {
  let best = 0;
  let bestScore = -1;
  rows.slice(0, HEADER_SEARCH_ROWS).forEach((row, index) => {
    let score = 0;
    for (const cell of row ?? []) {
      const text = cellText(cell);
      if (!text || isNumeric(cell)) continue;
      score += FIELDS.some((field) => looksLike(field, text)) ? 4 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

/** Предлагает колонки по заголовкам. Пользователь может поправить выбор вручную. */
export function guessColumns(header: Cell[]): ColumnMap {
  const map: ColumnMap = { art: -1, size: -1, qty: -1, name: -1 };
  const taken = new Set<number>();
  for (const field of FIELDS) {
    for (const pattern of HEADER_PATTERNS[field]) {
      const index = header.findIndex((cell, i) => {
        const text = cellText(cell);
        if (!text || taken.has(i) || !pattern.test(text)) return false;
        // «Код товара» — это артикул, а не название, хотя слово «товар» в нём есть
        return !(field === 'name' && looksLike('art', text));
      });
      if (index >= 0) {
        map[field] = index;
        taken.add(index);
        break;
      }
    }
  }
  return map;
}

/** Буква колонки как в Excel: 0 → A, 26 → AA. */
export function columnLetter(index: number): string {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}
