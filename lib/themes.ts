/**
 * Theme definitions for Yoink.
 *
 * The Theme strings are also the keys used in localStorage and the values
 * passed to the runtime CSS injector. The CSS strings here are intentionally
 * raw — they get injected via `<style id="theme-override">` so they can
 * override Tailwind v4 custom properties without touching the build.
 *
 * This is the single source of truth. Both the main app (`app/page.tsx`)
 * and the screenshot scripts (`scripts/*-screenshots.mjs`) import from here.
 */

export type Theme = "slate" | "terminal" | "glass" | "minimal" | "neon" | "brutalist";

export const THEMES: { value: Theme; label: string; accent: string }[] = [
  { value: "slate",    label: "Slate",     accent: "#818cf8" },
  { value: "terminal", label: "Terminal",  accent: "#22c55e" },
  { value: "glass",    label: "Glass",     accent: "#a78bfa" },
  { value: "minimal",  label: "Minimal",   accent: "#e5e5e5" },
  { value: "neon",     label: "Neon Noir", accent: "#f472b6" },
  { value: "brutalist",label: "Brutalist", accent: "#ffffff" },
];

export const THEME_CSS: Record<Theme, string> = {
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
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');
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
    *, *::before, *::after {
      font-family: 'JetBrains Mono', 'Courier New', monospace !important;
    }
    body::after {
      content: '';
      position: fixed; inset: 0;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0, 255, 65, 0.015) 2px,
        rgba(0, 255, 65, 0.015) 4px
      );
      pointer-events: none;
      z-index: 9998;
    }
    .bg-blue-600, .bg-blue-500 {
      box-shadow: 0 0 14px rgba(34,197,94,0.45) !important;
    }
    input:focus, select:focus, textarea:focus {
      box-shadow: 0 0 0 1px #22c55e, 0 0 8px rgba(34,197,94,0.3) !important;
    }
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
    body {
      background: radial-gradient(ellipse at 30% 20%, #1a0533 0%, #04020f 50%, #020818 100%) fixed !important;
    }
    .rounded-xl, .rounded-lg {
      backdrop-filter: blur(18px) saturate(160%) !important;
      -webkit-backdrop-filter: blur(18px) saturate(160%) !important;
      background-color: rgb(12 8 30 / 0.45) !important;
      border-color: rgb(255 255 255 / 0.07) !important;
    }
    .bg-blue-600, .bg-blue-500 {
      box-shadow: 0 0 20px rgba(124,58,237,0.5), 0 0 60px rgba(124,58,237,0.15) !important;
    }
    input:focus, select:focus {
      border-color: #7c3aed !important;
      box-shadow: 0 0 0 1px #7c3aed, 0 0 12px rgba(124,58,237,0.25) !important;
    }
  `,
  minimal: `
    :root {
      --accent: #e5e5e5;
      --color-zinc-950: #080808;
      --color-zinc-900: #101010;
      --color-zinc-800: #1a1a1a;
      --color-zinc-700: #242424;
      --color-zinc-600: #3a3a3a;
      --color-zinc-500: #666666;
      --color-zinc-400: #999999;
      --color-zinc-300: #cccccc;
      --color-blue-700: #333333;
      --color-blue-600: #555555;
      --color-blue-500: #e5e5e5;
      --color-blue-400: #f5f5f5;
    }
    .rounded-xl, .rounded-lg { border-radius: 4px !important; }
    .rounded-md, .rounded-lg { border-radius: 3px !important; }
    .text-2xl { font-size: 1.1rem !important; font-weight: 300 !important; letter-spacing: 0.2em !important; text-transform: uppercase !important; }
    h1 { letter-spacing: 0.15em !important; font-weight: 300 !important; }
    label, .uppercase { letter-spacing: 0.18em !important; }
    .bg-blue-600, .bg-blue-500 {
      background-color: #e5e5e5 !important;
      color: #080808 !important;
    }
    .text-white { color: #e8e8e8 !important; }
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
    body {
      background: radial-gradient(ellipse at 70% 80%, #1a0028 0%, #05010d 60%) fixed !important;
    }
    .bg-blue-600, .bg-blue-500 {
      box-shadow: 0 0 18px rgba(236,72,153,0.55), 0 0 50px rgba(236,72,153,0.2) !important;
    }
    input:focus, select:focus {
      border-color: #ec4899 !important;
      box-shadow: 0 0 0 1px #ec4899, 0 0 14px rgba(236,72,153,0.3) !important;
    }
    .border-zinc-800, .border-zinc-700 {
      border-color: rgb(236 72 153 / 0.2) !important;
    }
    h1 { color: #f0abfc !important; }
  `,
  brutalist: `
    :root {
      --accent: #ffffff;
      --color-zinc-950: #000000;
      --color-zinc-900: #0d0d0d;
      --color-zinc-800: #1a1a1a;
      --color-zinc-700: #2e2e2e;
      --color-zinc-600: #555555;
      --color-zinc-500: #888888;
      --color-zinc-400: #bbbbbb;
      --color-zinc-300: #dddddd;
      --color-blue-700: #1a1a1a;
      --color-blue-600: #ffffff;
      --color-blue-500: #ffffff;
      --color-blue-400: #ffffff;
    }
    *, *::before, *::after { border-radius: 0 !important; }
    .rounded-xl, .rounded-lg, .rounded-md, .rounded-full { border-radius: 0 !important; }
    .border, .border-zinc-800, .border-zinc-700 {
      border-width: 2px !important;
      border-color: #ffffff !important;
    }
    .bg-blue-600, .bg-blue-500 {
      background-color: #ffffff !important;
      color: #000000 !important;
      font-weight: 700 !important;
    }
    .text-2xl { font-weight: 900 !important; letter-spacing: -0.02em !important; font-size: 1.6rem !important; }
    button:not(.bg-blue-600):not(.bg-blue-500) {
      border: 2px solid #555555 !important;
    }
    button:hover:not(.bg-blue-600):not(.bg-blue-500) {
      border-color: #ffffff !important;
    }
  `,
};

export const THEME_KEYS: Theme[] = THEMES.map((t) => t.value);
