import { describe, expect, it } from "vitest";
import {
  buildDownloadArgv,
  buildFormatArgs,
  buildJsRuntimeArgs,
  buildProbeArgs,
  buildSubtitleArgs,
  buildTailArgs,
  parseProgressLine,
  parseTitleLine,
} from "@/lib/ytdlp";

describe("buildFormatArgs", () => {
  it("emits -x and audio flags for audio mode", () => {
    const args = buildFormatArgs({ mode: "audio", quality: "best" });
    expect(args).toContain("-x");
    expect(args).toContain("--audio-format");
    expect(args).toContain("mp3");
  });

  it("uses the best preset when quality=best", () => {
    const args = buildFormatArgs({ mode: "video", quality: "best" });
    const fIdx = args.indexOf("-f");
    expect(fIdx).toBeGreaterThanOrEqual(0);
    expect(args[fIdx + 1]).toMatch(/bestvideo/);
  });

  it("applies the 720p ceiling when quality=720p", () => {
    const args = buildFormatArgs({ mode: "video", quality: "720p" });
    const fIdx = args.indexOf("-f");
    expect(args[fIdx + 1]).toContain("height<=720");
  });

  it("falls back to best when quality is unknown", () => {
    const args = buildFormatArgs({ mode: "video", quality: "garbage" });
    const fIdx = args.indexOf("-f");
    expect(args[fIdx + 1]).toMatch(/bestvideo|best/);
  });

  it("uses explicit formatId when provided", () => {
    const args = buildFormatArgs({ mode: "video", quality: "best", formatId: "137+140" });
    const fIdx = args.indexOf("-f");
    expect(args[fIdx + 1]).toBe("137+140");
  });

  it("merges to mp4 for video downloads", () => {
    const args = buildFormatArgs({ mode: "video", quality: "best" });
    expect(args).toContain("--merge-output-format");
    expect(args).toContain("mp4");
  });

  it("adds embed flags when requested", () => {
    const args = buildFormatArgs({
      mode: "video",
      quality: "best",
      embedMetadata: true,
    });
    expect(args).toContain("--embed-metadata");
    expect(args).toContain("--embed-chapters");
  });
});

describe("buildSubtitleArgs", () => {
  it("returns nothing when subs are disabled or undefined", () => {
    expect(buildSubtitleArgs(undefined, "video")).toEqual([]);
    expect(buildSubtitleArgs({ enabled: false }, "video")).toEqual([]);
  });

  it("requests subs with default lang=en", () => {
    const args = buildSubtitleArgs({ enabled: true }, "video");
    expect(args).toContain("--write-subs");
    expect(args).toContain("--write-auto-subs");
    const langIdx = args.indexOf("--sub-langs");
    expect(args[langIdx + 1]).toBe("en");
  });

  it("honors a custom language", () => {
    const args = buildSubtitleArgs({ enabled: true, lang: "fr,de" }, "video");
    const langIdx = args.indexOf("--sub-langs");
    expect(args[langIdx + 1]).toBe("fr,de");
  });

  it("embeds when embed=true and mode=video", () => {
    const args = buildSubtitleArgs({ enabled: true, embed: true }, "video");
    expect(args).toContain("--embed-subs");
    expect(args).not.toContain("--convert-subs");
  });

  it("converts to srt sidecar when embed=false", () => {
    const args = buildSubtitleArgs({ enabled: true, embed: false }, "video");
    expect(args).toContain("--convert-subs");
    expect(args).toContain("srt");
    expect(args).not.toContain("--embed-subs");
  });

  it("never embeds for audio mode even if embed=true", () => {
    const args = buildSubtitleArgs({ enabled: true, embed: true }, "audio");
    expect(args).not.toContain("--embed-subs");
    expect(args).toContain("--convert-subs");
  });
});

describe("buildTailArgs", () => {
  it("always emits --newline and -o with the template", () => {
    const args = buildTailArgs({ outputTemplate: "C:\\out\\%(title)s.%(ext)s" });
    expect(args).toContain("--newline");
    const oIdx = args.indexOf("-o");
    expect(args[oIdx + 1]).toBe("C:\\out\\%(title)s.%(ext)s");
  });

  it("includes --cookies when a cookiesFile is provided", () => {
    const args = buildTailArgs({ cookiesFile: "C:\\c.txt", outputTemplate: "x" });
    const cIdx = args.indexOf("--cookies");
    expect(args[cIdx + 1]).toBe("C:\\c.txt");
  });

  it("includes --limit-rate when speedLimit is provided", () => {
    const args = buildTailArgs({ speedLimit: "1M", outputTemplate: "x" });
    const lIdx = args.indexOf("--limit-rate");
    expect(args[lIdx + 1]).toBe("1M");
  });
});

describe("parseProgressLine", () => {
  it("parses standard yt-dlp download progress", () => {
    const line = "[download]  42.7% of 12.34MiB at 1.23MiB/s ETA 00:08";
    const p = parseProgressLine(line);
    expect(p).not.toBeNull();
    expect(p!.progress).toBeCloseTo(42.7);
    expect(p!.speed).toBe("1.23MiB/s");
    expect(p!.eta).toBe("00:08");
  });

  it("returns null on non-progress lines", () => {
    expect(parseProgressLine("[download] Destination: foo.mp4")).toBeNull();
    expect(parseProgressLine("")).toBeNull();
    expect(parseProgressLine("random log line")).toBeNull();
  });
});

describe("parseTitleLine", () => {
  it("extracts the basename from a Destination line", () => {
    expect(parseTitleLine("[download] Destination: C:\\Users\\You\\Downloads\\Hello World.mp4"))
      .toBe("Hello World.mp4");
  });

  it("returns null when no destination is present", () => {
    expect(parseTitleLine("[download]  50% of 1MiB at 1MiB/s ETA 00:01")).toBeNull();
  });
});

const SHORT_URL = "https://www.youtube.com/shorts/AAAAAAAAAAA";
const WATCH_URL = "https://www.youtube.com/watch?v=AAAAAAAAAAA";

describe("buildFormatArgs for YouTube Shorts", () => {
  it("uses a width cap and /best fallback for 1080p Shorts", () => {
    const args = buildFormatArgs({
      mode: "video",
      quality: "1080p",
      urlKind: "youtube-short",
    });
    const fIdx = args.indexOf("-f");
    expect(args[fIdx + 1]).toBe(
      "bestvideo[width<=1080][height<=1920]+bestaudio/best[width<=1080][height<=1920]/best",
    );
  });

  it("does not require mp4-only video for best Shorts quality", () => {
    const args = buildFormatArgs({
      mode: "video",
      quality: "best",
      urlKind: "youtube-short",
    });
    const fIdx = args.indexOf("-f");
    expect(args[fIdx + 1]).toBe("bestvideo+bestaudio/best");
  });

  it("keeps the landscape height selector when urlKind is omitted", () => {
    const args = buildFormatArgs({ mode: "video", quality: "1080p" });
    const fIdx = args.indexOf("-f");
    expect(args[fIdx + 1]).toBe(
      "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]",
    );
  });
});

describe("buildJsRuntimeArgs", () => {
  it("emits --js-runtimes kind:path when a runtime is provided", () => {
    expect(
      buildJsRuntimeArgs({ kind: "node", executable: "/opt/node" }),
    ).toEqual(["--js-runtimes", "node:/opt/node"]);
  });

  it("emits nothing when no runtime is available", () => {
    expect(buildJsRuntimeArgs(null)).toEqual([]);
  });
});

describe("buildProbeArgs", () => {
  it("probes Shorts with --no-playlist, a JS runtime, and a -- sentinel", () => {
    expect(
      buildProbeArgs({
        url: SHORT_URL,
        jsRuntime: { kind: "deno", executable: "/opt/deno" },
      }),
    ).toEqual([
      "--dump-json",
      "--no-download",
      "--no-playlist",
      "--js-runtimes",
      "deno:/opt/deno",
      "--",
      SHORT_URL,
    ]);
  });
});

describe("buildDownloadArgv", () => {
  it("adds Shorts format, --js-runtimes, and --no-playlist for a Shorts URL", () => {
    const args = buildDownloadArgv({
      url: SHORT_URL,
      mode: "video",
      quality: "1080p",
      outputTemplate: "out/%(title)s.%(ext)s",
      jsRuntime: { kind: "node", executable: "/opt/node" },
    });
    const fIdx = args.indexOf("-f");
    expect(args[fIdx + 1]).toBe(
      "bestvideo[width<=1080][height<=1920]+bestaudio/best[width<=1080][height<=1920]/best",
    );
    expect(args).toContain("--js-runtimes");
    expect(args[args.indexOf("--js-runtimes") + 1]).toBe("node:/opt/node");
    expect(args).toContain("--no-playlist");
    expect(args.slice(-2)).toEqual(["--", SHORT_URL]);
  });

  it("does not add --no-playlist or the Shorts selector for a watch URL", () => {
    const args = buildDownloadArgv({
      url: WATCH_URL,
      mode: "video",
      quality: "1080p",
      outputTemplate: "out/%(title)s.%(ext)s",
      jsRuntime: null,
    });
    const fIdx = args.indexOf("-f");
    expect(args[fIdx + 1]).toBe(
      "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]",
    );
    expect(args).not.toContain("--no-playlist");
    expect(args).not.toContain("--js-runtimes");
    expect(args.slice(-2)).toEqual(["--", WATCH_URL]);
  });
});

