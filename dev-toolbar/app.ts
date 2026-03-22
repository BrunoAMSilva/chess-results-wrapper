import { defineToolbarApp } from 'astro/toolbar';

export default defineToolbarApp({
  init(canvas) {
    const win = document.createElement('astro-dev-toolbar-window');

    win.innerHTML = `
      <h2 style="margin: 0 0 12px; font-size: 14px; font-weight: 600;">
        Chess Results — Full Fetch
      </h2>
      <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 12px;">
        <input id="cr-tid" type="text" placeholder="Tournament ID"
          style="flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid #555; background: #1a1a2e; color: #fff; font-size: 13px;" />
        <button id="cr-fetch" type="button"
          style="padding: 6px 14px; border-radius: 6px; border: none; background: #6d28d9; color: #fff; font-size: 13px; cursor: pointer; white-space: nowrap;">
          Full Fetch
        </button>
      </div>
      <div id="cr-status" style="font-size: 12px; color: #aaa; min-height: 18px;"></div>
    `;

    canvas.appendChild(win);

    // Try to extract tid from the current page URL
    const tidInput = win.querySelector<HTMLInputElement>('#cr-tid')!;
    const params = new URLSearchParams(window.location.search);
    const pageTid = params.get('tid');
    if (pageTid) tidInput.value = pageTid;

    const fetchBtn = win.querySelector<HTMLButtonElement>('#cr-fetch')!;
    const status = win.querySelector<HTMLDivElement>('#cr-status')!;

    fetchBtn.addEventListener('click', async () => {
      const tid = tidInput.value.trim();
      if (!tid) {
        status.textContent = '⚠ Enter a tournament ID';
        status.style.color = '#f59e0b';
        return;
      }

      fetchBtn.disabled = true;
      fetchBtn.textContent = 'Fetching…';
      status.textContent = `Scraping tournament ${tid} (all rounds, standings, player cards)…`;
      status.style.color = '#aaa';

      try {
        const res = await fetch('/api/dev-fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tid }),
        });
        const data = await res.json();
        if (res.ok) {
          status.textContent = `✓ Tournament ${tid} fully fetched`;
          status.style.color = '#34d399';
        } else {
          status.textContent = `✗ ${data.error}`;
          status.style.color = '#f87171';
        }
      } catch (e) {
        status.textContent = `✗ Network error`;
        status.style.color = '#f87171';
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Full Fetch';
      }
    });
  },
});
