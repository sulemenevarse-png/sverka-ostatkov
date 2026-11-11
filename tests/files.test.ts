import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleFiles, summaryCsv, toCsv } from '../src/lib/csv.ts';
import { mergeSources, normalizeSize, parseQuantity } from '../src/lib/merge.ts';
import type { MappedSource } from '../src/lib/merge.ts';
import { columnLetter, decodeText, detectHeaderRow, guessColumns, parseCsv } from '../src/lib/tabular.ts';
import type { Sheet } from '../src/lib/tabular.ts';

/** Таблица с автоматически найденными заголовками и колонками — как после загрузки файла. */
function mapped(rows: Sheet): MappedSource {
  const headerRow = detectHeaderRow(rows);
  return { rows, headerRow, map: guessColumns(rows[headerRow]) };
}

test('CSV: кавычки, переносы строк и разделитель внутри ячейки', () => {
  const rows = parseCsv('Артикул;Название;Остаток\r\nA-1;"Худи; ""база""";5\r\n\r\nA-2;"две\nстроки";7');
  assert.deepEqual(rows, [['Артикул', 'Название', 'Остаток'], ['A-1', 'Худи; "база"', '5'], ['A-2', 'две\nстроки', '7']]);
});

test('CSV: запятые в названиях не сбивают определение разделителя', () => {
  const rows = parseCsv('Артикул;Название;Остаток\nA-1;Худи, чёрное, оверсайз, плотное;5\nA-2;Свитшот, серый, базовый, тёплый;7');
  assert.equal(rows[1].length, 3);
});

test('кодировка Windows-1251 распознаётся', () => {
  const win1251 = new Uint8Array([0xc0, 0xf0, 0xf2, 0xe8, 0xea, 0xf3, 0xeb]); // «Артикул»
  assert.equal(decodeText(win1251.buffer), 'Артикул');
  assert.equal(decodeText(new TextEncoder().encode('﻿Артикул').buffer as ArrayBuffer), 'Артикул');
});

test('строка заголовков находится под шапкой отчёта', () => {
  const rows: Sheet = [['Отчёт по остаткам'], ['Сформирован 12.11.2026'], ['Артикул', 'Название товара', 'Доступно к продаже'], ['A-1', 'Худи', 5]];
  assert.equal(detectHeaderRow(rows), 2);
});

test('колонки-ловушки: «Артикул WB» и «Штрихкод» не выбираются', () => {
  const map = guessColumns(['Артикул WB', 'Штрихкод', 'Артикул продавца', 'Размер', 'Количество в пути', 'Остаток']);
  assert.deepEqual(map, { art: 2, size: 3, qty: 5, name: -1 });
  assert.equal(guessColumns(['Код товара', 'Товар', 'Кол-во, шт']).name, 1);
});

test('размеры: кириллица приводится к латинице, остальное не искажается', () => {
  assert.equal(normalizeSize('хл'), 'XL');
  assert.equal(normalizeSize(' М '), 'M');
  assert.equal(normalizeSize('Без размера'), 'БЕЗ РАЗМЕРА');
  assert.equal(normalizeSize(46), '46');
});

test('количество: пробелы, запятая, мусор', () => {
  assert.equal(parseQuantity('1 234,5'), 1234.5);
  assert.equal(parseQuantity('нет'), 0);
  assert.equal(parseQuantity(7), 7);
});

test('файлы-примеры в трёх разных форматах сводятся полностью', () => {
  const files = sampleFiles();
  const result = mergeSources({
    wb: mapped(parseCsv(files['primer_wb.csv'].slice(1))),
    oz: mapped(parseCsv(files['primer_ozon.csv'].slice(1))),
    wh: mapped(parseCsv(files['primer_sklad.csv'].slice(1))),
  });
  assert.equal(result.rows.length, 90);
  assert.equal(result.stats.inAll, 90);
  const hoodie = result.rows.find((row) => row.label === 'Худи чёрное, р. M');
  assert.deepEqual([hoodie?.wb, hoodie?.oz, hoodie?.wh], [0, 18, 6]);
});

test('артикул, оканчивающийся числом, не путается с размером', () => {
  const wb = mapped([['Артикул продавца', 'Размер', 'Остаток'], ['TS-42', '42', 1], ['TS-42', '44', 2], ['TS-42', '46', 3]]);
  const oz = mapped([['Артикул', 'Доступно'], ['TS-42-42', 4], ['TS-42-44', 5], ['TS-42-46', 6]]);
  const result = mergeSources({ wb, oz });
  assert.equal(result.rows.length, 3);
  assert.equal(result.stats.inAll, 3);
});

test('повторы складываются, отрицательные остатки и строка «Итого» отбрасываются', () => {
  const wb = mapped([['Артикул', 'Склад WB', 'Остаток'], ['A-1', 'Коледино', 3], ['A-1', 'Казань', 4], ['A-2', 'Коледино', -2], ['Итого', '', 5]]);
  const wh = mapped([['Артикул', 'Кол-во'], ['a 1', 10], ['A-2', 1]]);
  const result = mergeSources({ wb, wh });
  assert.deepEqual(result.rows.map((row) => [row.label, row.wb, row.wh]), [['A-1', 7, 10], ['A-2', 0, 1]]);
});

test('выгрузка CSV: формулы из чужих данных обезвреживаются', () => {
  assert.equal(toCsv([['=HYPERLINK("http://x")', 5, 'a;b']]), '﻿"\'=HYPERLINK(""http://x"")";5;"a;b"');
  const { rows, ctx } = mergeSources({ wb: mapped([['Артикул', 'Остаток'], ['A-1', 0]]), wh: mapped([['Артикул', 'Кол-во'], ['A-1', 4]]) });
  assert.match(summaryCsv(rows, ctx), /A-1;;;0;4;В норме;/);
});

test('буквы колонок как в Excel', () => {
  assert.deepEqual([0, 25, 26, 27].map(columnLetter), ['A', 'Z', 'AA', 'AB']);
});
