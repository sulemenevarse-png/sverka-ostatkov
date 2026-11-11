/** Мелкие помощники для работы со страницей. */

/** Находит элемент, который обязан быть в разметке; иначе это ошибка вёрстки, а не данных. */
export function $<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Элемент не найден: ${selector}`);
  return element;
}

export function $$<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Экранирование для вставки в HTML. Всё, что пришло из данных (в том числе из файлов
 * пользователя), проходит через эту функцию перед попаданием в innerHTML.
 */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Число с русскими разделителями разрядов: 134670 → «134 670». */
export function fmt(value: number): string {
  return Math.round(value).toLocaleString('ru-RU');
}

let toastTimer: number | undefined;

export function toast(message: string): void {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove('on'), 3200);
}

/** Отдаёт пользователю файл, собранный в браузере. */
export function downloadText(filename: string, text: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 500);
}
