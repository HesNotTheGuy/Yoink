/**
 * Download a yt-dlp release asset and refuse to install it unless its
 * SHA-256 matches the SHA2-256SUMS file published with that same release.
 *
 * The release tag comes from the first redirect of the "latest" download
 * URL. The checksum file and the binary are then both fetched from that
 * tag, so a release published between the two requests cannot mix them.
 * A missing checksum file, an unreadable line, or a hash mismatch deletes
 * the temp download and leaves any previously installed binary in place.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const YTDLP_RELEASES = "https://github.com/yt-dlp/yt-dlp/releases";
const SUMS_NAME = "SHA2-256SUMS";
const TAG_PATTERN = /^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/;

/**
 * @param {NodeJS.Platform} [platform]
 * @returns {"yt-dlp.exe" | "yt-dlp"}
 */
export function assetNameForPlatform(platform = process.platform) {
  return platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
}

/**
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseSha256Sums(text) {
  /** @type {Map<string, string>} */
  const hashes = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([a-fA-F0-9]{64})\s+\*?(\S+)$/.exec(trimmed);
    if (!match) {
      throw new Error(
        "SHA2-256SUMS has an unreadable line. Refusing to install an unverified binary."
      );
    }
    const hash = match[1].toLowerCase();
    const name = match[2];
    const prior = hashes.get(name);
    if (prior && prior !== hash) {
      throw new Error(
        `SHA2-256SUMS lists conflicting hashes for ${name}. Refusing to install an unverified binary.`
      );
    }
    hashes.set(name, hash);
  }
  return hashes;
}

/**
 * @param {string} sumsText
 * @param {string} assetName
 * @returns {string}
 */
export function hashForAsset(sumsText, assetName) {
  const hash = parseSha256Sums(sumsText).get(assetName);
  if (!hash) {
    throw new Error(
      `SHA2-256SUMS has no entry for ${assetName}. Refusing to install an unverified binary.`
    );
  }
  return hash;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
export function sha256FileHex(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/**
 * @param {string} actualHex
 * @param {string} expectedHex
 * @param {string} assetName
 */
export function assertChecksum(actualHex, expectedHex, assetName) {
  const actual = String(actualHex).toLowerCase();
  const expected = String(expectedHex).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(
      `Checksum for ${assetName} was not a SHA-256 digest. Refusing to install an unverified binary.`
    );
  }
  const actualBuf = Buffer.from(actual, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) {
    throw new Error(
      `Checksum mismatch for ${assetName}. Refusing to install an unverified binary.`
    );
  }
}

/**
 * @param {string} assetName
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ tag: string, assetName: string, assetUrl: string, sumsUrl: string }>}
 */
export async function resolveLatestReleaseAsset(assetName, fetchImpl = fetch) {
  const latestUrl = `${YTDLP_RELEASES}/latest/download/${assetName}`;
  let res;
  try {
    res = await fetchImpl(latestUrl, { redirect: "manual" });
  } catch (err) {
    throw new Error(
      `Could not resolve the yt-dlp release for ${assetName} (${errorText(err)}). Refusing to install an unverified binary.`
    );
  }
  try {
    await res.arrayBuffer();
  } catch {
    /* The redirect body is unused. A failed drain must not hide the status. */
  }
  if (res.status < 300 || res.status >= 400) {
    throw new Error(
      `Could not resolve the yt-dlp release for ${assetName} (HTTP ${res.status}). Refusing to install an unverified binary.`
    );
  }
  const location = res.headers.get("location");
  if (!location) {
    throw new Error(
      `yt-dlp release redirect for ${assetName} had no Location header. Refusing to install an unverified binary.`
    );
  }
  let redirected;
  try {
    redirected = new URL(location, latestUrl);
  } catch {
    throw new Error(
      `yt-dlp release redirect for ${assetName} was not a URL. Refusing to install an unverified binary.`
    );
  }
  const match = redirected.pathname.match(
    /\/yt-dlp\/yt-dlp\/releases\/download\/([^/]+)\/([^/]+)$/
  );
  if (!match) {
    throw new Error(
      `Could not read a yt-dlp release tag for ${assetName}. Refusing to install an unverified binary.`
    );
  }
  const tag = decodeURIComponent(match[1]);
  const file = decodeURIComponent(match[2]);
  if (!TAG_PATTERN.test(tag) || tag.includes("..")) {
    throw new Error(
      `Refusing yt-dlp release tag ${JSON.stringify(tag)}. Refusing to install an unverified binary.`
    );
  }
  if (file !== assetName) {
    throw new Error(
      `yt-dlp redirect pointed at ${file}, not ${assetName}. Refusing to install an unverified binary.`
    );
  }
  const encodedTag = encodeURIComponent(tag);
  const encodedAsset = encodeURIComponent(assetName);
  return {
    tag,
    assetName,
    assetUrl: `${YTDLP_RELEASES}/download/${encodedTag}/${encodedAsset}`,
    sumsUrl: `${YTDLP_RELEASES}/download/${encodedTag}/${SUMS_NAME}`,
  };
}

/**
 * Download `assetName` from the current yt-dlp release into `dest`.
 * Throws before replacing `dest` when the checksum cannot be checked.
 *
 * @param {{
 *   dest: string,
 *   assetName: string,
 *   fetchImpl?: typeof fetch,
 *   onStatus?: (message: string) => void,
 *   onProgress?: (received: number, total: number) => void,
 * }} opts
 * @returns {Promise<{ tag: string, assetName: string, assetUrl: string, sumsUrl: string }>}
 */
export async function downloadVerifiedYtdlp(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const status = opts.onStatus ?? (() => {});
  status(`Resolving the latest yt-dlp release for ${opts.assetName}...`);
  const release = await resolveLatestReleaseAsset(opts.assetName, fetchImpl);

  status(`Fetching SHA2-256SUMS for yt-dlp ${release.tag}...`);
  let sumsText;
  try {
    const sumsRes = await fetchImpl(release.sumsUrl, { redirect: "follow" });
    if (!sumsRes.ok) {
      throw new Error(`HTTP ${sumsRes.status} ${sumsRes.statusText}`);
    }
    sumsText = await sumsRes.text();
  } catch (err) {
    throw new Error(
      `Could not fetch SHA2-256SUMS for yt-dlp ${release.tag} (${errorText(err)}). Refusing to install an unverified binary.`
    );
  }
  if (!sumsText.trim()) {
    throw new Error(
      `SHA2-256SUMS for yt-dlp ${release.tag} was empty. Refusing to install an unverified binary.`
    );
  }
  const expected = hashForAsset(sumsText, opts.assetName);

  await fs.promises.mkdir(path.dirname(opts.dest), { recursive: true });
  const tempPath = `${opts.dest}.download`;
  try {
    status(`Downloading yt-dlp ${release.tag} (${opts.assetName})...`);
    await downloadToFile(release.assetUrl, tempPath, fetchImpl, opts.onProgress);
    status(`Checking ${opts.assetName} against SHA2-256SUMS...`);
    assertChecksum(sha256FileHex(tempPath), expected, opts.assetName);
    if (process.platform !== "win32") {
      await fs.promises.chmod(tempPath, 0o755);
    }
    replaceFileSync(tempPath, opts.dest);
  } catch (err) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    throw err;
  }
  return release;
}

/**
 * Move `tempPath` onto `destPath`. A failed replace puts the previous
 * destination back when it was moved aside.
 *
 * @param {string} tempPath
 * @param {string} destPath
 */
export function replaceFileSync(tempPath, destPath) {
  const backup = `${destPath}.bak`;
  if (fs.existsSync(backup)) retryFs(() => fs.unlinkSync(backup));
  const hadDest = fs.existsSync(destPath);
  if (hadDest) retryFs(() => fs.renameSync(destPath, backup));
  try {
    retryFs(() => fs.renameSync(tempPath, destPath));
  } catch (err) {
    if (hadDest && fs.existsSync(backup) && !fs.existsSync(destPath)) {
      try {
        fs.renameSync(backup, destPath);
      } catch {
        /* The previous binary remains at the .bak path. */
      }
    }
    throw err;
  }
  if (fs.existsSync(backup)) {
    try {
      fs.unlinkSync(backup);
    } catch {
      /* The new binary is already in place. */
    }
  }
}

/**
 * @param {string} url
 * @param {string} dest
 * @param {typeof fetch} fetchImpl
 * @param {(received: number, total: number) => void} [onProgress]
 */
async function downloadToFile(url, dest, fetchImpl, onProgress) {
  const res = await fetchImpl(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `Download failed: HTTP ${res.status} ${res.statusText}. Refusing to install an unverified binary.`
    );
  }
  if (!res.body) {
    throw new Error("Download failed: no response body. Refusing to install an unverified binary.");
  }
  const contentLength = Number(res.headers.get("content-length") ?? 0);
  let received = 0;
  const progress = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (onProgress) onProgress(received, Number.isFinite(contentLength) ? contentLength : 0);
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), progress, fs.createWriteStream(dest));
  if (contentLength > 0 && received !== contentLength) {
    throw new Error(
      `Incomplete download (${received} of ${contentLength} bytes). Refusing to install an unverified binary.`
    );
  }
}

/**
 * @param {() => void} fn
 */
function retryFs(fn) {
  const attempts = 5;
  const delayMs = 150;
  for (let i = 0; ; i++) {
    try {
      fn();
      return;
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code;
      const transient = code === "EBUSY" || code === "EPERM" || code === "EACCES";
      if (!transient || i >= attempts - 1) throw err;
      const until = Date.now() + delayMs;
      while (Date.now() < until) {
        /* Windows can briefly lock a freshly written executable. */
      }
    }
  }
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorText(err) {
  return err instanceof Error ? err.message : String(err);
}
