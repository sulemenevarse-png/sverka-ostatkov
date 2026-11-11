import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';

// Адрес сайта и подпапка задаются в .env (см. .env.example), а не в коде
const env = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');

export default defineConfig({
  output: 'static',
  site: env.SITE_URL || undefined,
  base: env.BASE_PATH || '/',
  // Markdown на сайте не используется; подсветка кода (Shiki) несовместима с CSP
  markdown: { syntaxHighlight: false },
  security: {
    // Astro добавит в страницу <meta> с Content-Security-Policy и хэшами своих скриптов и стилей.
    // Политика запрещает всё, что демо не нужно. Главное — connect-src 'none': страница
    // технически не может отправить данные из загруженных файлов куда-либо.
    // Те же правила дублируются заголовками сервера в deploy/nginx.conf.example
    // (frame-ancestors работает только из заголовка, не из <meta>).
    csp: {
      directives: [
        "default-src 'none'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
      ],
    },
  },
});
