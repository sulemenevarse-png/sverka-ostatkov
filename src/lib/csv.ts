/** Выгрузка в CSV: сводная таблица и файлы-примеры для экрана загрузки. */
import { effectiveStock, sortBySeverity } from './analysis.ts';
import { buildDemoRows } from './demo-data.ts';
import { recommendationText, statusText } from './messages.ts';
import type { Cell } from './tabular.ts';
import { SOURCE_KEYS, SOURCE_LABEL } from './types.ts';
import type { AnalysisContext, StockRow } from './types.ts';

function csvCell(value: Cell): string {
  let text = value == null ? '' : String(value);
  // Текст, начинающийся с «=», «+», «-» или «@», Excel выполнит как формулу.
  // Данные приходят из чужих файлов, поэтому обезвреживаем такие ячейки апострофом.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Разделитель «;» и BOM — чтобы файл без настроек открывался в русском Excel. */
export function toCsv(rows: Cell[][]): string {
  return '﻿' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
}

/**
 * Три файла-примера в тех же трёх форматах, что на экране «Как сейчас»:
 * WB — артикул без размера, Ozon — размер внутри артикула, склад — артикул в нижнем регистре.
 */
export function sampleFiles(): Record<string, string> {
  const rows = buildDemoRows();
  return {
    'primer_wb.csv': toCsv([['Артикул продавца', 'Баркод', 'Размер', 'Остаток'], ...rows.map((row) => [row.art, row.barcode, row.size, row.wb])]),
    'primer_ozon.csv': toCsv([['Артикул', 'Название товара', 'Доступно к продаже'], ...rows.slice().reverse().map((row) => [row.sku, `${row.label}, р. ${row.size}`, row.oz])]),
    'primer_sklad.csv': toCsv([['Код', 'Наименование', 'Цвет', 'Размер', 'Кол-во'], ...rows.map((row) => [row.art.toLowerCase(), row.style, row.color, row.size, row.wh])]),
  };
}

/** Сводная таблица со статусами и рекомендациями — то, что видно на экране, в виде файла. */
export function summaryCsv(rows: StockRow[], ctx: AnalysisContext): string {
  const sources = SOURCE_KEYS.filter((key) => ctx.has[key]);
  const header = ['Товар', 'Артикул', 'Размер', ...sources.map((key) => SOURCE_LABEL[key]), 'Статус', 'Что сделать'];
  const body = sortBySeverity(rows).map((row) => [
    row.label,
    row.sku,
    row.size,
    ...sources.map((key) => effectiveStock(row, key, ctx) ?? ''),
    statusText(row) ?? 'В норме',
    row.issues
      .map((issue) => {
        const text = recommendationText({ row, issue }, ctx);
        return `${text.title}: ${text.name}${text.detail}`;
      })
      .join(' | '),
  ]);
  return toCsv([header, ...body]);
}
