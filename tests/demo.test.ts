import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countProblems } from '../src/lib/analysis.ts';
import { createDemoState, hoursSaved, savedTotal, simulateDay } from '../src/lib/demo-state.ts';

test('демо-каталог: 90 позиций и 7 расхождений на старте', () => {
  const state = createDemoState();
  assert.equal(state.rows.length, 90);
  assert.equal(new Set(state.rows.map((row) => row.key)).size, 90, 'артикулы не повторяются');
  assert.equal(countProblems(state.rows), 7);
  assert.equal(hoursSaved(state), 3.5);
  assert.ok(savedTotal(state) > 0);
});

test('демо детерминировано: два запуска дают одинаковые данные', () => {
  const stock = () => createDemoState().rows.map((row) => [row.key, row.wb, row.oz, row.wh]);
  assert.deepEqual(stock(), stock());
});

test('первые три дня симуляции каждый раз дают новое предупреждение', () => {
  const state = createDemoState();
  for (let day = 2; day <= 4; day++) {
    const feedBefore = state.feed.length;
    const result = simulateDay(state);
    assert.ok(result.sold > 0);
    assert.ok(result.fresh.length > 0, `день ${day}: должно появиться новое предупреждение`);
    assert.ok(state.feed.length > feedBefore, 'бот написал о новом предупреждении');
  }
});

test('симуляция: остатки не уходят в минус, о проблеме сообщаем один раз, счётчик не убывает', () => {
  const state = createDemoState();
  const announced = new Set<string>();
  let saved = savedTotal(state);
  for (let day = 0; day < 40; day++) {
    for (const rec of simulateDay(state).fresh) {
      assert.ok(!announced.has(rec.issue.id), `повторное предупреждение ${rec.issue.id}`);
      announced.add(rec.issue.id);
    }
    assert.ok(state.rows.every((row) => row.wb >= 0 && row.oz >= 0));
    assert.ok(savedTotal(state) >= saved);
    saved = savedTotal(state);
  }
});
