/** Точка входа клиентского кода: связывает три экрана и вкладки. */
import { initNowScreen, renderNowScreen } from './now-screen.ts';
import { getDemoRows, initServiceScreen } from './service-screen.ts';
import { initTabs, onTabShown } from './tabs.ts';
import { initUploadScreen } from './upload-screen.ts';

initServiceScreen();
initNowScreen();
initUploadScreen();

// Экран «Как сейчас» показывает те же остатки, что и сервис, — после симуляции их нужно перерисовать
const showNow = () => renderNowScreen(getDemoRows());
onTabShown('now', showNow);
showNow();

initTabs();
