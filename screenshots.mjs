import puppeteer from 'puppeteer';
import { mkdir } from 'fs/promises';

const BASE = 'http://localhost:3001';
const OUT  = './docs/screenshots';
await mkdir(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Mirror THEME_CSS for direct injection (bypasses React/localStorage timing)
const THEME_CSS = {
  slate: `
    :root {
      --accent: #818cf8;
      --color-zinc-950: #070b14;
      --color-zinc-900: #0d1424;
      --color-zinc-800: #141e35;
      --color-zinc-700: #1e2d4a;
      --color-zinc-600: #2d4166;
      --color-zinc-500: #4a6180;
      --color-zinc-400: #7a9ab8;
      --color-zinc-300: #a8c0d8;
      --color-blue-700: #3730a3;
      --color-blue-600: #4f46e5;
      --color-blue-500: #6366f1;
      --color-blue-400: #818cf8;
    }
  `,
  terminal: `
    :root {
      --accent: #22c55e;
      --color-zinc-950: #010c01;
      --color-zinc-900: #021502;
      --color-zinc-800: #042004;
      --color-zinc-700: #063006;
      --color-zinc-600: #0a420a;
      --color-zinc-500: #166016;
      --color-zinc-400: #4ade80;
      --color-zinc-300: #86efac;
      --color-blue-700: #15803d;
      --color-blue-600: #16a34a;
      --color-blue-500: #22c55e;
      --color-blue-400: #4ade80;
    }
    *, *::before, *::after { font-family: 'Courier New', monospace !important; }
    body::after {
      content: '';
      position: fixed; inset: 0;
      background: repeating-linear-gradient(
        0deg, transparent, transparent 2px,
        rgba(0,255,65,0.015) 2px, rgba(0,255,65,0.015) 4px
      );
      pointer-events: none; z-index: 9998;
    }
    .bg-blue-600, .bg-blue-500 { box-shadow: 0 0 14px rgba(34,197,94,0.45) !important; }
  `,
  glass: `
    :root {
      --accent: #a78bfa;
      --color-zinc-950: #04020f;
      --color-zinc-900: #080518;
      --color-zinc-800: #100c28;
      --color-zinc-700: #1c1640;
      --color-zinc-600: #2e2560;
      --color-zinc-500: #5048a0;
      --color-zinc-400: #7c6fc8;
      --color-zinc-300: #b0a8e8;
      --color-blue-700: #4c1d95;
      --color-blue-600: #6d28d9;
      --color-blue-500: #7c3aed;
      --color-blue-400: #a78bfa;
    }
    body { background: radial-gradient(ellipse at 30% 20%, #1a0533 0%, #04020f 50%, #020818 100%) fixed !important; }
    .rounded-xl, .rounded-lg {
      backdrop-filter: blur(18px) saturate(160%) !important;
      -webkit-backdrop-filter: blur(18px) saturate(160%) !important;
      background-color: rgb(12 8 30 / 0.45) !important;
      border-color: rgb(255 255 255 / 0.07) !important;
    }
    .bg-blue-600, .bg-blue-500 { box-shadow: 0 0 20px rgba(124,58,237,0.5), 0 0 60px rgba(124,58,237,0.15) !important; }
  `,
  neon: `
    :root {
      --accent: #f472b6;
      --color-zinc-950: #05010d;
      --color-zinc-900: #0a0118;
      --color-zinc-800: #130225;
      --color-zinc-700: #1e0336;
      --color-zinc-600: #2e054f;
      --color-zinc-500: #6b1d8a;
      --color-zinc-400: #c026d3;
      --color-zinc-300: #e879f9;
      --color-blue-700: #9d174d;
      --color-blue-600: #be185d;
      --color-blue-500: #ec4899;
      --color-blue-400: #f472b6;
    }
    body { background: radial-gradient(ellipse at 70% 80%, #1a0028 0%, #05010d 60%) fixed !important; }
    .bg-blue-600, .bg-blue-500 { box-shadow: 0 0 18px rgba(236,72,153,0.55), 0 0 50px rgba(236,72,153,0.2) !important; }
    .border-zinc-800, .border-zinc-700 { border-color: rgb(236 72 153 / 0.2) !important; }
    h1 { color: #f0abfc !important; }
  `,
};

async function injectTheme(page, theme) {
  await page.evaluate((css) => {
    let el = document.getElementById('theme-override');
    if (!el) { el = document.createElement('style'); el.id = 'theme-override'; document.head.appendChild(el); }
    el.textContent = css;
  }, THEME_CSS[theme]);
  await sleep(500);
}

const browser = await puppeteer.launch({ headless: true });
const page    = await browser.newPage();
await page.setViewport({ width: 960, height: 720, deviceScaleFactor: 2 });

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`  ${name}.png`);
}

async function resetSettings() {
  await fetch(`${BASE}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      outputDir: 'C:\\Downloads',
      defaultMode: 'video',
      defaultQuality: 'best',
      embedMetadata: true,
      embedThumbnail: true,
      cookiesFile: '',
      speedLimit: '',
    }),
  });
}

await resetSettings();

// ── 1. Main UI (Slate) ─────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle0' });
await sleep(400);
await injectTheme(page, 'slate');
await shot('01-main');

// ── 2. Active download ─────────────────────────────────────────────────────
await page.reload({ waitUntil: 'networkidle0' });
await sleep(400);
await injectTheme(page, 'slate');
await page.evaluate(() => {
  const fakeCard = document.createElement('div');
  fakeCard.style.cssText = `
    margin: 0 auto; max-width: 42rem;
    background: #141e35; border: 1px solid #1e2d4a;
    border-radius: 12px; padding: 16px;
    display: flex; flex-direction: column; gap: 12px;
  `;
  fakeCard.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <img src="https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg"
           style="width:72px;height:48px;object-fit:cover;border-radius:6px;flex-shrink:0;"
           onerror="this.style.display='none'" />
      <div style="flex:1;min-width:0;">
        <div style="font-size:14px;font-weight:500;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          Never Gonna Give You Up
        </div>
        <div style="font-size:12px;color:#7a9ab8;margin-top:2px;">youtube.com · Video · Best</div>
      </div>
      <span style="font-size:12px;color:#818cf8;font-weight:500;flex-shrink:0;">Downloading</span>
    </div>
    <div style="height:5px;background:#1e2d4a;border-radius:9999px;overflow:hidden;">
      <div style="width:63%;height:100%;background:#6366f1;border-radius:9999px;"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:#7a9ab8;">
      <span>63%</span><span>4.2 MiB/s</span><span>ETA 12s</span>
    </div>
  `;
  const main = document.querySelector('main') || document.body;
  const cards = main.querySelectorAll('.rounded-xl, .rounded-lg');
  if (cards[0]?.parentNode) cards[0].parentNode.insertBefore(fakeCard, cards[0].nextSibling);
});
await sleep(400);
await shot('02-downloading');

// ── 3. History ─────────────────────────────────────────────────────────────
await fetch(`${BASE}/api/history`, { method: 'DELETE' });
for (const entry of [
  { id: 'a3', url: 'https://youtube.com/watch?v=3', title: 'Blinding Lights',         thumbnail: 'https://i.ytimg.com/vi/4NRXx6U8ABQ/mqdefault.jpg', mode: 'video', outputDir: 'C:\\Downloads', status: 'done', completedAt: Date.now() - 300000 },
  { id: 'a2', url: 'https://youtube.com/watch?v=2', title: 'Bohemian Rhapsody',       thumbnail: 'https://i.ytimg.com/vi/fJ9rUzIMcZQ/mqdefault.jpg',  mode: 'audio', outputDir: 'C:\\Downloads', status: 'done', completedAt: Date.now() - 120000 },
  { id: 'a1', url: 'https://youtube.com/watch?v=1', title: 'Never Gonna Give You Up', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg', mode: 'video', outputDir: 'C:\\Downloads', status: 'done', completedAt: Date.now() -  60000 },
]) {
  await fetch(`${BASE}/api/history`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
}
await page.goto(BASE, { waitUntil: 'networkidle0' });
await sleep(400);
await injectTheme(page, 'slate');
await page.click('button::-p-text(History)');
await sleep(500);
await shot('03-history');

// ── 4. Settings (shows 6-theme picker) ────────────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle0' });
await sleep(400);
await injectTheme(page, 'slate');
await page.click('button::-p-text(Settings)');
await sleep(500);
await shot('04-settings');

// ── 5. Terminal theme ──────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle0' });
await sleep(400);
await injectTheme(page, 'terminal');
await shot('05-terminal-theme');

// ── 6. Glass theme ─────────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle0' });
await sleep(400);
await injectTheme(page, 'glass');
await shot('06-glass-theme');

// ── 7. Neon Noir theme ─────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle0' });
await sleep(400);
await injectTheme(page, 'neon');
await shot('07-neon-theme');

// ── Cleanup ────────────────────────────────────────────────────────────────
await resetSettings();
await fetch(`${BASE}/api/history`, { method: 'DELETE' }).catch(() => {});

await browser.close();
console.log('Done.');
