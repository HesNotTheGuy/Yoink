/**
 * Node-free URL parse so the renderer can import it.
 * `lib/ytdlp.ts` loads `fs` and cannot ship in the client bundle.
 */

export type ParsedInputUrl =
  | { kind: "youtube-short"; videoId: string; href: string }
  | { kind: "other"; href: string };

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function hostnameWithoutWww(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

export function parseInputUrl(raw: string): ParsedInputUrl | null {
  const href = raw.trim();
  if (!href) return null;
  if (!/^https?:\/\//i.test(href)) return null;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const host = hostnameWithoutWww(url.hostname);
  if (YOUTUBE_HOSTS.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 2 && parts[0].toLowerCase() === "shorts" && VIDEO_ID.test(parts[1])) {
      return { kind: "youtube-short", videoId: parts[1], href };
    }
  }

  return { kind: "other", href };
}
