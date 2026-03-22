import type { AstroIntegration } from 'astro';

export default function chessDevToolbar(): AstroIntegration {
  return {
    name: 'chess-dev-toolbar',
    hooks: {
      'astro:config:setup': ({ addDevToolbarApp }) => {
        addDevToolbarApp({
          id: 'chess-full-fetch',
          name: 'Chess Full Fetch',
          icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c-.55 0-1 .45-1 1v1H9.5c-.28 0-.5.22-.5.5s.22.5.5.5H11v2.05A6.002 6.002 0 0 0 6 13v1h12v-1a6.002 6.002 0 0 0-5-5.95V5h1.5c.28 0 .5-.22.5-.5s-.22-.5-.5-.5H13V3c0-.55-.45-1-1-1zM5 16v1h14v-1H5zm-1 3v2h16v-2H4z"/></svg>`,
          entrypoint: new URL('./app.ts', import.meta.url),
        });
      },
    },
  };
}
