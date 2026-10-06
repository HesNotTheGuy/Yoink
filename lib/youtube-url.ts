/**
 * Parse a pasted download URL into a domain type.
 *
 * Lives in its own module so the renderer can import it. `lib/ytdlp.ts`
 * pulls in Node builtins and cannot be bundled into the client page.
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

/**
 * Returns null when `raw` is empty or not an http(s) URL.
 * A path of `/shorts/<11-char-id>` is a single Short.
 * A channel tab such as `/@handle/shorts` is `other`.
 */
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
    if (parts.length >= 2 && parts[0].toLowerCase() === "shorts" && VIDEO_ID.test(parts[1])) {
      return { kind: "youtube-short", videoId: parts[1], href };
    }
  }

  return { kind: "other", href };
}
