/**
 * Тексты, которые собираются из данных: рекомендации, статусы, сообщения бота.
 * Функции возвращают обычный текст — экранирование делает слой отображения.
 */
import { effectiveStock } from './analysis.ts';
import { SOURCE_KEYS, SOURCE_LABEL } from './types.ts';
import type { AnalysisContext, Recommendation, StockRow } from './types.ts';

/** Русское склонение: plural(3, 'день', 'дня', 'дней') → 'дня'. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 > 10 && mod100 < 20) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function withCount(n: number, one: string, few: string, many: string): string {
  return `${n} ${plural(n, one, few, many)}`;
}

function daysText(days: number): string {
  return days < 1 ? 'хватит меньше чем на день' : `хватит на ${withCount(days, 'день', 'дня', 'дней')}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** «Худи чёрное M» — название вместе с размером. */
export function fullName(row: StockRow): string {
  return row.size ? `${row.label} ${row.size}` : row.label;
}

/** «WB 0 · Ozon 18 · Склад 6» — остатки по загруженным источникам. */
export function stockLine(row: StockRow, ctx: AnalysisContext, labelSeparator = ' '): string {
  return SOURCE_KEYS.filter((key) => ctx.has[key])
    .map((key) => `${SOURCE_LABEL[key]}${labelSeparator}${effectiveStock(row, key, ctx) ?? '—'}`)
    .join(' · ');
}

export interface RecommendationText {
  /** Заголовок: «Довезти на WB». */
  title: string;
  /** Название позиции с маленькой буквы — в интерфейсе выделяется жирным. */
  name: string;
  /** Продолжение фразы после названия: « — 6 шт. со склада». */
  detail: string;
}

export function recommendationText({ row, issue }: Recommendation, ctx: AnalysisContext): RecommendationText {
  const name = fullName(row).charAt(0).toLowerCase() + fullName(row).slice(1);
  const channel = issue.channel ? SOURCE_LABEL[issue.channel] : '';

  switch (issue.type) {
    case 'move':
      return {
        title: `Довезти на ${channel}`,
        name,
        detail: issue.planned ? ` — ${issue.qty} шт. со склада` : ` — на складе лежит ${issue.qty} шт.`,
      };
    case 'idle':
      return {
        title: 'Лежит на складе, не продаётся',
        name,
        detail: ` — ${issue.qty} шт. на складе, на WB и Ozon — 0. Отгрузить на обе площадки`,
      };
    case 'empty': {
      const elsewhere = issue.otherChannel && issue.otherQty ? ` — на ${SOURCE_LABEL[issue.otherChannel]} ещё ${issue.otherQty} шт.` : '';
      return {
        title: ctx.has.wh ? `Нет на ${channel}, склад пуст` : `Нет на ${channel}`,
        name,
        detail: elsewhere + (ctx.has.wh ? `${elsewhere ? '' : ' —'} Пора дозаказывать` : ''),
      };
    }
    case 'low': {
      let detail = ` — ${issue.days != null ? daysText(issue.days) : `осталось ${issue.left} шт.`}`;
      if (issue.qty > 0) detail += issue.planned ? `. Довезти ${issue.qty} шт. со склада` : `, на складе ${issue.qty} шт.`;
      else if (ctx.has.wh) detail += '. Склад пуст — дозаказать';
      return { title: `Заканчивается на ${channel}`, name, detail };
    }
    case 'out':
      return { title: 'Нет в наличии нигде', name, detail: ' — дозаказать' };
  }
}

/** Короткий статус для таблицы: «Нет на WB», «WB: на 3 дн.»; null — позиция в норме. */
export function statusText(row: StockRow): string | null {
  const issue = row.issues[0];
  if (!issue) return null;
  const channel = issue.channel ? SOURCE_LABEL[issue.channel] : '';
  let text: string;
  switch (issue.type) {
    case 'move':
    case 'empty':
      text = `Нет на ${channel}`;
      break;
    case 'idle':
      text = 'Только на складе';
      break;
    case 'low':
      text = issue.days == null ? `${channel}: ост. ${issue.left}` : issue.days < 1 ? `${channel}: меньше дня` : `${channel}: на ${issue.days} дн.`;
      break;
    case 'out':
      text = 'Нет нигде';
      break;
  }
  return row.issues.length > 1 ? `${text} +${row.issues.length - 1}` : text;
}

/** Сообщение бота: первая строка — заголовок (выделяется жирным), дальше обычные строки. */
export interface ChatMessage {
  icon: string;
  title: string;
  lines: string[];
  /** Подпись кнопки под сообщением. */
  button?: string;
}

export const OPEN_TABLE_BUTTON = 'Открыть сводную таблицу';

export function digestMessage(title: string, total: number, problems: number, sources: string): ChatMessage {
  return {
    icon: '☀️',
    title,
    lines: [`Сведено ${withCount(total, 'позиция', 'позиции', 'позиций')}${sources}.`, `Требуют внимания: ${problems}.`],
    button: OPEN_TABLE_BUTTON,
  };
}

export function alertMessage(rec: Recommendation, ctx: AnalysisContext): ChatMessage {
  const { row, issue } = rec;
  const text = recommendationText(rec, ctx);
  const channel = issue.channel ? SOURCE_LABEL[issue.channel] : '';
  const lines = [row.size ? `${row.label}, ${row.size}` : row.label, stockLine(row, ctx, ': ')];

  switch (issue.type) {
    case 'move':
      lines.push(issue.planned ? `➡️ Довезти ${issue.qty} шт. со склада` : `➡️ На складе лежит ${issue.qty} шт.`);
      break;
    case 'idle':
      lines.push('➡️ Отгрузить на WB и Ozon');
      break;
    case 'empty':
      if (ctx.has.wh) lines.push('➡️ Склад пуст — дозаказать');
      break;
    case 'low':
      lines.push(issue.days != null ? `⏳ ${capitalize(daysText(issue.days))}` : `⏳ Осталось ${issue.left} шт.`);
      if (issue.qty > 0 && issue.planned) lines.push(`➡️ Довезти ${issue.qty} шт. со склада`);
      break;
    case 'out':
      lines.push('➡️ Дозаказать');
      break;
  }

  const isSoldOut = issue.type === 'move' || issue.type === 'empty';
  return {
    icon: issue.level === 'red' ? '🔴' : issue.level === 'amber' ? '🟡' : '⚪️',
    title: isSoldOut ? `Закончился размер на ${channel}` : text.title,
    lines,
  };
}
