/** Демо-каталог вымышленного бренда: 6 фасонов × 3 цвета × 5 размеров = 90 позиций. */
import type { DemoRow } from './types.ts';

export const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
/** Доля спроса по размерам: M и L продаются лучше краёв размерной сетки. */
const SIZE_DEMAND: Record<string, number> = { XS: 0.45, S: 0.9, M: 1.3, L: 1.1, XL: 0.6 };

type Gender = 'n' | 'f' | 'm' | 'p';
/** Прилагательное цвета согласуется с родом названия: худи чёрное, футболка чёрная, штаны чёрные. */
const COLORS: Record<string, Record<Gender, string> & { title: string }> = {
  BLK: { n: 'чёрное', f: 'чёрная', m: 'чёрный', p: 'чёрные', title: 'Чёрный' },
  WHT: { n: 'белое', f: 'белая', m: 'белый', p: 'белые', title: 'Белый' },
  GRY: { n: 'серое', f: 'серая', m: 'серый', p: 'серые', title: 'Серый' },
  BEG: { n: 'бежевое', f: 'бежевая', m: 'бежевый', p: 'бежевые', title: 'Бежевый' },
};

const STYLES: { code: string; name: string; gender: Gender; price: number; demand: number; colors: string[] }[] = [
  { code: 'HD', name: 'Худи', gender: 'n', price: 4990, demand: 1.2, colors: ['BLK', 'GRY', 'BEG'] },
  { code: 'ZH', name: 'Зип-худи', gender: 'n', price: 5490, demand: 0.8, colors: ['BLK', 'GRY', 'WHT'] },
  { code: 'TS', name: 'Футболка', gender: 'f', price: 1990, demand: 1.3, colors: ['BLK', 'WHT', 'BEG'] },
  { code: 'TO', name: 'Футболка оверсайз', gender: 'f', price: 2490, demand: 1.0, colors: ['BLK', 'WHT', 'GRY'] },
  { code: 'SW', name: 'Свитшот', gender: 'm', price: 3990, demand: 0.8, colors: ['BLK', 'GRY', 'BEG'] },
  { code: 'PN', name: 'Штаны', gender: 'p', price: 3490, demand: 0.9, colors: ['BLK', 'GRY', 'BEG'] },
];

interface Scenario {
  wb: number;
  oz: number;
  wh: number;
  /** Продажи в день на WB и на Ozon. */
  sales: [number, number];
}

/**
 * Позиции, заданные вручную, — сценарий демонстрации.
 * Первые семь — расхождения, видимые сразу. Последние три подобраны так,
 * чтобы новые предупреждения появлялись на 1-м, 2-м и 3-м нажатии «Симулировать продажи».
 */
const SCENARIO: Record<string, Scenario> = {
  'HD-BLK-M': { wb: 0, oz: 18, wh: 6, sales: [2.2, 1.2] },
  'TS-WHT-S': { wb: 5, oz: 14, wh: 20, sales: [1.6, 0.9] },
  'SW-GRY-L': { wb: 11, oz: 0, wh: 9, sales: [0.8, 1.0] },
  'PN-BLK-S': { wb: 0, oz: 7, wh: 0, sales: [1.1, 0.5] },
  'TO-BLK-XL': { wb: 12, oz: 2, wh: 12, sales: [0.9, 0.8] },
  'ZH-GRY-M': { wb: 0, oz: 0, wh: 15, sales: [0.9, 0.5] },
  'HD-BEG-XS': { wb: 3, oz: 9, wh: 0, sales: [0.9, 0.4] },
  'TS-BLK-M': { wb: 9, oz: 16, wh: 24, sales: [1.5, 0.9] },
  'HD-GRY-L': { wb: 14, oz: 15, wh: 10, sales: [2.0, 1.0] },
  'SW-BLK-M': { wb: 19, oz: 8, wh: 14, sales: [1.2, 1.0] },
};

/** Генератор псевдослучайных чисел с фиксированным зерном (mulberry32): демо у всех выглядит одинаково. */
export function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function buildDemoRows(): DemoRow[] {
  const random = seededRandom(20261112);
  const rows: DemoRow[] = [];

  for (const style of STYLES) {
    for (const colorCode of style.colors) {
      for (const size of SIZES) {
        const art = `${style.code}-${colorCode}`;
        const sku = `${art}-${size}`;
        const index = rows.length + 1;
        // Обычные позиции получают запас минимум на ~12 дней, чтобы не шуметь в первые дни симуляции
        const salesWb = Math.max(0.2, round1(style.demand * SIZE_DEMAND[size] * (0.5 + 0.5 * random())));
        const salesOz = Math.max(0.1, round1(salesWb * (0.45 + 0.3 * random())));
        const generated: Scenario = {
          sales: [salesWb, salesOz],
          wb: Math.max(4, Math.round(salesWb * (12 + 18 * random()))),
          oz: Math.max(3, Math.round(salesOz * (12 + 18 * random()))),
          wh: Math.round((salesWb + salesOz) * (4 + 14 * random())),
        };
        const stock = SCENARIO[sku] ?? generated;

        rows.push({
          key: sku,
          sku,
          art,
          label: `${style.name} ${COLORS[colorCode][style.gender]}`,
          size,
          style: style.name,
          color: COLORS[colorCode].title,
          barcode: `20000${41700 + index * 7}`,
          price: style.price,
          wb: stock.wb,
          oz: stock.oz,
          wh: stock.wh,
          velocity: { wb: stock.sales[0], oz: stock.sales[1] },
          carry: { wb: 0, oz: 0 },
          order: index,
          issues: [],
          severity: 3,
        });
      }
    }
  }
  return rows;
}
