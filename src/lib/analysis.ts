import { LOW_STOCK_DAYS, TARGET_STOCK_DAYS } from './config.ts';
import { CHANNELS } from './types.ts';
import type { AnalysisContext, Channel, Issue, IssueLevel, Recommendation, SourceKey, StockRow } from './types.ts';

const SEVERITY: Record<IssueLevel, number> = { red: 0, amber: 1, out: 2 };
const SEVERITY_OK = 3;

/**
 * Остаток с учётом настроек: null, если источник не загружен
 * или позиции нет в файле и её нельзя считать нулём.
 */
export function effectiveStock(row: StockRow, key: SourceKey, ctx: AnalysisContext): number | null {
  if (!ctx.has[key]) return null;
  const value = row[key];
  if (value == null) return ctx.missingIsZero ? 0 : null;
  return value;
}

/** Находит проблемы одной позиции. Самые серьёзные — в начале списка. */
export function computeIssues(row: StockRow, ctx: AnalysisContext): Issue[] {
  const stock = { wb: effectiveStock(row, 'wb', ctx), oz: effectiveStock(row, 'oz', ctx) };
  const warehouse = effectiveStock(row, 'wh', ctx) ?? 0;
  const channels = CHANNELS.filter((ch) => stock[ch] != null);
  if (!channels.length) return [];

  const make = (issue: Omit<Issue, 'id'>): Issue => ({ ...issue, id: `${row.key}|${issue.type}|${issue.channel ?? ''}` });
  const onChannels = channels.reduce((sum, ch) => sum + (stock[ch] ?? 0), 0);

  if (onChannels + warehouse === 0) return [make({ level: 'out', type: 'out', qty: 0, planned: false })];
  // Обе площадки пустые, а товар лежит на складе — одна общая проблема вместо двух одинаковых
  if (channels.length === 2 && onChannels === 0) return [make({ level: 'red', type: 'idle', qty: warehouse, planned: false })];

  const issues: Issue[] = [];
  for (const channel of channels) {
    const left = stock[channel] ?? 0;
    const velocity = row.velocity?.[channel];
    const targetStock = velocity ? Math.ceil(velocity * TARGET_STOCK_DAYS) : 0;

    if (left === 0) {
      if (warehouse > 0) {
        const qty = velocity ? Math.min(warehouse, Math.max(4, targetStock)) : warehouse;
        issues.push(make({ level: 'red', type: 'move', channel, qty, planned: Boolean(velocity) }));
      } else {
        const otherChannel = channels.find((ch) => ch !== channel);
        issues.push(make({ level: 'red', type: 'empty', channel, qty: 0, planned: false, otherChannel, otherQty: otherChannel ? stock[otherChannel] ?? 0 : 0 }));
      }
      continue;
    }

    const days = velocity ? Math.floor(left / velocity) : null;
    const isLow = days != null ? days <= LOW_STOCK_DAYS : left <= ctx.lowThreshold;
    if (isLow) {
      const qty = warehouse > 0 ? (velocity ? Math.min(warehouse, Math.max(0, targetStock - left)) : warehouse) : 0;
      issues.push(make({ level: 'amber', type: 'low', channel, left, days, qty, planned: Boolean(velocity) }));
    }
  }
  return issues.sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level]);
}

/**
 * Пересчитывает проблемы всех позиций (записывает их в row.issues и row.severity)
 * и возвращает плоский список рекомендаций, отсортированный по важности.
 */
export function analyze(rows: StockRow[], ctx: AnalysisContext): Recommendation[] {
  const recommendations: Recommendation[] = [];
  for (const row of rows) {
    row.issues = computeIssues(row, ctx);
    row.severity = row.issues.length ? SEVERITY[row.issues[0].level] : SEVERITY_OK;
    for (const issue of row.issues) recommendations.push({ row, issue });
  }
  return recommendations.sort(
    (a, b) => SEVERITY[a.issue.level] - SEVERITY[b.issue.level] || b.issue.qty - a.issue.qty || a.row.label.localeCompare(b.row.label, 'ru'),
  );
}

export function countProblems(rows: StockRow[]): number {
  return rows.filter((row) => row.issues.length > 0).length;
}

/** Строки для таблицы: сначала проблемные, внутри — в исходном порядке. */
export function sortBySeverity<T extends StockRow>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => a.severity - b.severity || a.order - b.order);
}

/** Площадка, ячейку которой нужно подсветить из-за этой проблемы. */
export function issueTouches(issue: Issue, key: SourceKey): boolean {
  if (issue.type === 'idle') return key !== 'wh';
  return (issue.channel as Channel | undefined) === key;
}
