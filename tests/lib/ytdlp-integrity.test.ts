import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertChecksum,
  downloadVerifiedYtdlp,
  hashForAsset,
  parseSha256Sums,
  resolveLatestReleaseAsset,
} from "@/lib/ytdlp-integrity.mjs";

const TAG = "2026.10.26";
const ASSET = "yt-dlp";
const LATEST = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET}`;
const SUMS_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${TAG}/SHA2-256SUMS`;
const ASSET_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${TAG}/${ASSET}`;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yoink-sums-"));
  tempDirs.push(dir);
  return dir;
}

function sha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function response(body: BodyInit | null, status: number, headers?: Record<string, string>): Response {
  return new Response(body, { status, headers });
}

describe("parseSha256Sums", () => {
  it("reads a two-space hash line and ignores comments", () => {
    const hashes = parseSha256Sums(
      "# comment\n" +
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  yt-dlp\n" +
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb *yt-dlp.exe\n"
    );
    expect(hashes.get("yt-dlp")).toBe("a".repeat(64));
    expect(hashes.get("yt-dlp.exe")).toBe("b".repeat(64));
  });

  it("does not treat yt-dlp.exe as the yt-dlp asset", () => {
    const text = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  yt-dlp.exe\n";
    expect(() => hashForAsset(text, "yt-dlp")).toThrow(/no entry for yt-dlp/);
  });

  it("rejects an unreadable line and conflicting hashes", () => {
    expect(() => parseSha256Sums("not-a-hash  yt-dlp\n")).toThrow(/unreadable line/);
    const conflict =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  yt-dlp\n" +
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  yt-dlp\n";
    expect(() => parseSha256Sums(conflict)).toThrow(/conflicting hashes/);
  });
});

describe("assertChecksum", () => {
  it("accepts a matching digest and rejects a mismatch", () => {
    const digest = "ab".repeat(32);
    expect(() => assertChecksum(digest, digest.toUpperCase(), "yt-dlp")).not.toThrow();
    expect(() => assertChecksum("cd".repeat(32), digest, "yt-dlp")).toThrow(/Checksum mismatch/);
  });
});

describe("resolveLatestReleaseAsset", () => {
  it("pins the tag from the first GitHub redirect", async () => {
    const release = await resolveLatestReleaseAsset(ASSET, async () =>
      response(null, 302, {
        location: `https://github.com/yt-dlp/yt-dlp/releases/download/${TAG}/${ASSET}`,
      })
    );
    expect(release.tag).toBe(TAG);
    expect(release.assetUrl).toBe(ASSET_URL);
    expect(release.sumsUrl).toBe(SUMS_URL);
  });

  it("fails closed when the redirect is not a release tag", async () => {
    await expect(
      resolveLatestReleaseAsset(ASSET, async () =>
        response(null, 302, {
          location: "https://release-assets.githubusercontent.com/github-production-release-asset/yt-dlp",
        })
      )
    ).rejects.toThrow(/Refusing to install an unverified binary/);
  });
});

describe("downloadVerifiedYtdlp", () => {
  it("installs the file only after the published checksum matches", async () => {
    const bytes = new TextEncoder().encode("yoink-binary");
    const digest = sha256(bytes);
    const sums = `${digest}  ${ASSET}\n${"d".repeat(64)}  yt-dlp.exe\n`;
    const dir = tempDir();
    const dest = path.join(dir, ASSET);
    const seen: string[] = [];

    const release = await downloadVerifiedYtdlp({
      dest,
      assetName: ASSET,
      onStatus: (message) => seen.push(message),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url === LATEST) {
          expect(init?.redirect).toBe("manual");
          return response(null, 302, {
            location: `https://github.com/yt-dlp/yt-dlp/releases/download/${TAG}/${ASSET}`,
          });
        }
        if (url === SUMS_URL) return response(sums, 200);
        if (url === ASSET_URL) return response(bytes, 200);
        throw new Error(`unexpected ${url}`);
      },
    });

    expect(release.tag).toBe(TAG);
    expect(fs.readFileSync(dest, "utf8")).toBe("yoink-binary");
    expect(seen.some((line) => line.includes("SHA2-256SUMS"))).toBe(true);
    expect(fs.existsSync(`${dest}.download`)).toBe(false);
  });

  it("does not install when the checksum file cannot be fetched", async () => {
    const dir = tempDir();
    const dest = path.join(dir, ASSET);
    fs.writeFileSync(dest, "previous");

    await expect(
      downloadVerifiedYtdlp({
        dest,
        assetName: ASSET,
        fetchImpl: async (input) => {
          const url = String(input);
          if (url === LATEST) {
            return response(null, 302, {
              location: `https://github.com/yt-dlp/yt-dlp/releases/download/${TAG}/${ASSET}`,
            });
          }
          if (url === SUMS_URL) return response("nope", 404);
          throw new Error(`binary should not be fetched, got ${url}`);
        },
      })
    ).rejects.toThrow(/Could not fetch SHA2-256SUMS/);

    expect(fs.readFileSync(dest, "utf8")).toBe("previous");
    expect(fs.existsSync(`${dest}.download`)).toBe(false);
  });

  it("deletes a download whose hash does not match and keeps the previous binary", async () => {
    const bytes = new TextEncoder().encode("tampered");
    const sums = `${"ab".repeat(32)}  ${ASSET}\n`;
    const dir = tempDir();
    const dest = path.join(dir, ASSET);
    fs.writeFileSync(dest, "previous");

    await expect(
      downloadVerifiedYtdlp({
        dest,
        assetName: ASSET,
        fetchImpl: async (input) => {
          const url = String(input);
          if (url === LATEST) {
            return response(null, 302, {
              location: `https://github.com/yt-dlp/yt-dlp/releases/download/${TAG}/${ASSET}`,
            });
          }
          if (url === SUMS_URL) return response(sums, 200);
          if (url === ASSET_URL) return response(bytes, 200);
          throw new Error(`unexpected ${url}`);
        },
      })
    ).rejects.toThrow(/Checksum mismatch/);

    expect(fs.readFileSync(dest, "utf8")).toBe("previous");
    expect(fs.existsSync(`${dest}.download`)).toBe(false);
  });
});
