/** Переключение трёх экранов демо. Адрес вкладки хранится в #хэше, чтобы на экран можно было дать ссылку. */
import { $, $$ } from './dom.ts';

export type TabId = 'now' | 'svc' | 'up';
const TAB_IDS: TabId[] = ['now', 'svc', 'up'];

const shownHandlers: Partial<Record<TabId, () => void>> = {};

/** Подписка на показ экрана — например, чтобы перерисовать его по свежим данным. */
export function onTabShown(tab: TabId, handler: () => void): void {
  shownHandlers[tab] = handler;
}

export function goTo(tab: TabId): void {
  for (const button of $$('.tab')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  for (const screen of $$('.screen')) screen.classList.toggle('on', screen.id === `s-${tab}`);
  shownHandlers[tab]?.();

  // Если страница прокручена ниже вкладок — возвращаемся к началу нового экрана
  const tabsTop = $('.tabs').getBoundingClientRect().top + window.scrollY;
  if (window.scrollY > tabsTop) window.scrollTo(0, tabsTop);
  try {
    history.replaceState(null, '', `#${tab}`);
  } catch {
    // При открытии файла с диска в некоторых браузерах история недоступна — вкладка всё равно переключилась
  }
}

export function initTabs(): void {
  for (const button of $$('[data-tab], [data-go]')) {
    button.addEventListener('click', () => goTo((button.dataset.tab ?? button.dataset.go) as TabId));
  }
  const fromHash = location.hash.slice(1) as TabId;
  if (TAB_IDS.includes(fromHash) && fromHash !== 'now') goTo(fromHash);
}
