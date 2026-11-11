/** Состояние демо и симуляция продаж. Чистая логика без обращения к странице. */
import { analyze, countProblems } from './analysis.ts';
import { MANUAL_CHECK_CYCLE_DAYS, MANUAL_HOURS_PER_WEEK } from './config.ts';
import { buildDemoRows } from './demo-data.ts';
import { alertMessage, digestMessage, OPEN_TABLE_BUTTON, plural } from './messages.ts';
import type { ChatMessage } from './messages.ts';
import { CHANNELS } from './types.ts';
import type { AnalysisContext, DemoRow, Recommendation } from './types.ts';

export const DEMO_CONTEXT: AnalysisContext = { has: { wb: true, oz: true, wh: true }, missingIsZero: true, lowThreshold: 0 };

/** Сколько отдельных сообщений бот присылает за раз; остальное сворачивается в «и ещё N». */
const MAX_ALERTS_PER_DAY = 3;
const DIGEST_TIME = '09:00';

export type FeedItem = { kind: 'day'; label: string } | { kind: 'message'; message: ChatMessage; time: string };

export interface DemoState {
  rows: DemoRow[];
  recommendations: Recommendation[];
  day: number;
  soldTotal: number;
  /** Оценка спасённых продаж по каждой позиции и площадке, ₽. */
  saved: Map<string, number>;
  /** Предупреждения, о которых уже сообщали, — чтобы не повторяться. */
  seen: Set<string>;
  /** Предупреждения, появившиеся на последнем шаге симуляции. */
  fresh: Set<string>;
  feed: FeedItem[];
}

export function createDemoState(): DemoState {
  const rows = buildDemoRows();
  const recommendations = analyze(rows, DEMO_CONTEXT);
  const state: DemoState = {
    rows,
    recommendations,
    day: 1,
    soldTotal: 0,
    saved: new Map(),
    seen: new Set(recommendations.map((rec) => rec.issue.id)),
    fresh: new Set(),
    feed: [{ kind: 'day', label: 'День 1' }],
  };
  creditSavedSales(state);
  pushMessage(state, digestMessage(`Сверка на ${DIGEST_TIME}`, rows.length, countProblems(rows), ' из WB, Ozon и склада'));
  for (const rec of recommendations.slice(0, 2)) pushMessage(state, alertMessage(rec, DEMO_CONTEXT));
  return state;
}

function pushMessage(state: DemoState, message: ChatMessage): void {
  state.feed.push({ kind: 'message', message, time: DIGEST_TIME });
}

/**
 * «Спасено продаж»: сколько штук не продалось бы за неделю до следующей ручной сверки,
 * если бы проблему не заметили. Считаем только то, что реально можно довезти со склада.
 */
export function unitsSaved(rec: Recommendation): number {
  const { row, issue } = rec;
  const velocity = row.velocity;
  if (!velocity) return 0;
  const weeklyDemand = (channelVelocity: number) => Math.round(channelVelocity * MANUAL_CHECK_CYCLE_DAYS);

  if (issue.type === 'idle') return Math.min(issue.qty, weeklyDemand(velocity.wb + velocity.oz));
  if (!issue.channel || issue.qty <= 0) return 0;
  if (issue.type === 'move') return Math.min(issue.qty, weeklyDemand(velocity[issue.channel]));
  if (issue.type === 'low') return Math.min(issue.qty, Math.max(0, weeklyDemand(velocity[issue.channel]) - (issue.left ?? 0)));
  return 0;
}

function creditSavedSales(state: DemoState): void {
  for (const rec of state.recommendations) {
    // Ключ без типа проблемы: «заканчивается» → «закончился» — это одна и та же потеря, а не две
    const key = `${rec.row.key}|${rec.issue.channel ?? 'all'}`;
    const value = unitsSaved(rec) * (rec.row.price ?? 0);
    if (value > (state.saved.get(key) ?? 0)) state.saved.set(key, value);
  }
}

export function savedTotal(state: DemoState): number {
  let total = 0;
  for (const value of state.saved.values()) total += value;
  return total;
}

export function hoursSaved(state: DemoState): number {
  return MANUAL_HOURS_PER_WEEK * (1 + (state.day - 1) / 7);
}

export interface DayResult {
  sold: number;
  fresh: Recommendation[];
}

/** Проживает один день продаж: уменьшает остатки на площадках и находит новые проблемы. */
export function simulateDay(state: DemoState): DayResult {
  state.day += 1;
  let sold = 0;
  for (const row of state.rows) {
    for (const channel of CHANNELS) {
      row.carry[channel] += row.velocity[channel];
      // 1e-9 гасит погрешность сложения дробей: 0.1 × 10 должно дать целую продажу
      const whole = Math.floor(row.carry[channel] + 1e-9);
      row.carry[channel] -= whole;
      const units = Math.min(whole, row[channel]);
      row[channel] -= units;
      sold += units;
    }
  }
  state.soldTotal += sold;

  state.recommendations = analyze(state.rows, DEMO_CONTEXT);
  const fresh = state.recommendations.filter((rec) => !state.seen.has(rec.issue.id));
  state.fresh = new Set(fresh.map((rec) => rec.issue.id));
  for (const id of state.fresh) state.seen.add(id);
  creditSavedSales(state);

  if (fresh.length) {
    state.feed.push({ kind: 'day', label: `День ${state.day}` });
    for (const rec of fresh.slice(0, MAX_ALERTS_PER_DAY)) pushMessage(state, alertMessage(rec, DEMO_CONTEXT));
    const rest = fresh.length - MAX_ALERTS_PER_DAY;
    if (rest > 0) {
      pushMessage(state, { icon: '', title: '', lines: [`И ещё ${rest} ${plural(rest, 'позиция', 'позиции', 'позиций')} — в сводной таблице.`], button: OPEN_TABLE_BUTTON });
    }
  }
  return { sold, fresh };
}
