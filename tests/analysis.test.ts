import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, computeIssues, countProblems } from '../src/lib/analysis.ts';
import { recommendationText, statusText } from '../src/lib/messages.ts';
import type { AnalysisContext, StockRow } from '../src/lib/types.ts';

const ALL: AnalysisContext = { has: { wb: true, oz: true, wh: true }, missingIsZero: true, lowThreshold: 3 };

function row(stock: Partial<StockRow>): StockRow {
  return { key: 'K', label: 'Худи чёрное', sku: 'HD-BLK-M', size: 'M', wb: 10, oz: 10, wh: 10, order: 0, issues: [], severity: 3, ...stock };
}

test('пример из задания: WB 0, Ozon 18, склад 6 → довезти на WB 6 шт.', () => {
  const item = row({ wb: 0, oz: 18, wh: 6, velocity: { wb: 2.2, oz: 1.2 } });
  const [issue] = computeIssues(item, ALL);
  assert.equal(issue.type, 'move');
  assert.equal(issue.channel, 'wb');
  assert.equal(issue.qty, 6, 'нельзя рекомендовать больше, чем есть на складе');
  const text = recommendationText({ row: item, issue }, ALL);
  assert.equal(`${text.title}: ${text.name}${text.detail}`, 'Довезти на WB: худи чёрное M — 6 шт. со склада');
});

test('заканчивается: остаток делим на скорость продаж', () => {
  const item = row({ label: 'Футболка белая', size: 'S', wb: 5, oz: 14, wh: 20, velocity: { wb: 1.6, oz: 0.9 } });
  const [issue] = computeIssues(item, ALL);
  assert.equal(issue.type, 'low');
  assert.equal(issue.days, 3);
  assert.match(recommendationText({ row: item, issue }, ALL).detail, /хватит на 3 дня/);
});

test('обе площадки пустые, товар на складе — одна проблема, а не две', () => {
  const issues = computeIssues(row({ wb: 0, oz: 0, wh: 15 }), ALL);
  assert.deepEqual(issues.map((issue) => issue.type), ['idle']);
});

test('нет нигде — отдельный статус, без рекомендации довезти', () => {
  const item = row({ wb: 0, oz: 0, wh: 0 });
  analyze([item], ALL);
  assert.equal(item.issues[0].type, 'out');
  assert.equal(statusText(item), 'Нет нигде');
});

test('без скорости продаж работает порог в штуках', () => {
  assert.equal(computeIssues(row({ wb: 3 }), ALL)[0].type, 'low');
  assert.equal(computeIssues(row({ wb: 4 }), ALL).length, 0);
});

test('позиции нет в файле: считаем нулём только если это включено', () => {
  const item = row({ wb: null, oz: 5, wh: 8 });
  assert.equal(computeIssues(item, ALL)[0].type, 'move');
  assert.equal(computeIssues(item, { ...ALL, missingIsZero: false, lowThreshold: 0 }).length, 0);
});

test('незагруженный источник не участвует в сверке', () => {
  const withoutOzon: AnalysisContext = { ...ALL, has: { wb: true, oz: false, wh: true } };
  const issues = computeIssues(row({ wb: 0, oz: null, wh: 7 }), withoutOzon);
  assert.deepEqual(issues.map((issue) => `${issue.type}:${issue.channel}`), ['move:wb']);
});

test('analyze сортирует: сначала критичные, и считает проблемные позиции', () => {
  const rows = [row({ key: 'ok' }), row({ key: 'low', wb: 2 }), row({ key: 'zero', wb: 0 })];
  const recs = analyze(rows, ALL);
  assert.deepEqual(recs.map((rec) => rec.row.key), ['zero', 'low']);
  assert.equal(countProblems(rows), 2);
});
