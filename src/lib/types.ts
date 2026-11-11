/** Источник остатков: две площадки и собственный склад. */
export type SourceKey = 'wb' | 'oz' | 'wh';
/** Площадка, на которой товар продаётся. */
export type Channel = 'wb' | 'oz';

export const SOURCE_KEYS: SourceKey[] = ['wb', 'oz', 'wh'];
export const CHANNELS: Channel[] = ['wb', 'oz'];
export const SOURCE_LABEL: Record<SourceKey, string> = { wb: 'WB', oz: 'Ozon', wh: 'Склад' };

export type IssueLevel = 'red' | 'amber' | 'out';
/**
 * move  — на площадке 0, на складе есть: довезти;
 * idle  — на обеих площадках 0, товар лежит на складе;
 * empty — на площадке 0 и склад пуст;
 * low   — на площадке заканчивается;
 * out   — нет нигде.
 */
export type IssueType = 'move' | 'idle' | 'empty' | 'low' | 'out';

export interface Issue {
  /** Стабильный идентификатор «позиция + тип + площадка» — по нему отличаем новые предупреждения от уже показанных. */
  id: string;
  level: IssueLevel;
  type: IssueType;
  channel?: Channel;
  /** Сколько штук можно довезти со склада (0 — нечего везти). */
  qty: number;
  /** true — qty рассчитано по скорости продаж; false — это просто весь остаток склада. */
  planned: boolean;
  /** Остаток на площадке (для type = low). */
  left?: number;
  /** На сколько дней хватит остатка; null, если скорость продаж неизвестна. */
  days?: number | null;
  otherChannel?: Channel;
  otherQty?: number;
}

/** Строка сводной таблицы: одна позиция (модель + цвет + размер). */
export interface StockRow {
  key: string;
  /** Название для показа: «Худи чёрное» или артикул, если названия нет. */
  label: string;
  /** Артикул для второй строки; пусто, если он уже показан как название. */
  sku: string;
  size: string;
  /** null — позиции нет в файле этого источника. */
  wb: number | null;
  oz: number | null;
  wh: number | null;
  /** Средние продажи в день; есть только в демо-данных. */
  velocity?: Record<Channel, number>;
  price?: number;
  /** Порядок появления в исходных данных — вторичная сортировка таблицы. */
  order: number;
  issues: Issue[];
  /** 0 — критично, 1 — заканчивается, 2 — нет нигде, 3 — в норме. */
  severity: number;
}

export interface DemoRow extends StockRow {
  wb: number;
  oz: number;
  wh: number;
  velocity: Record<Channel, number>;
  price: number;
  /** Артикул модели и цвета без размера, как в выгрузке WB. */
  art: string;
  style: string;
  color: string;
  barcode: string;
  /** Накопленные дробные продажи: при 1,5 шт./день продаём 1, затем 2, затем 1… */
  carry: Record<Channel, number>;
}

export interface AnalysisContext {
  /** Какие источники вообще загружены. */
  has: Record<SourceKey, boolean>;
  /** Считать позицию, которой нет в файле, нулевым остатком (площадки часто не выгружают нули). */
  missingIsZero: boolean;
  /** Порог «заканчивается» в штуках — когда скорость продаж неизвестна. */
  lowThreshold: number;
}

export interface Recommendation {
  row: StockRow;
  issue: Issue;
}
