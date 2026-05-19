/**
 * Tests for lib/ffmpeg.ts — arg builders and parsers used by the
 * editor (trim, cut, audio clipper). Same canary role as the ytdlp tests.
 */

import { describe, expect, it } from "vitest";
import {
  secondsToTimestamp,
  buildTrimArgs,
  buildAudioTrimArgs,
  buildConcatArgs,
  parseProgressBlock,
} from "@/lib/ffmpeg";

describe("secondsToTimestamp", () => {
  it("formats whole seconds", () => {
    expect(secondsToTimestamp(0)).toBe("00:00:00.000");
    expect(secondsToTimestamp(5)).toBe("00:00:05.000");
    expect(secondsToTimestamp(65)).toBe("00:01:05.000");
    expect(secondsToTimestamp(3665)).toBe("01:01:05.000");
  });

  it("preserves millisecond precision", () => {
    expect(secondsToTimestamp(1.234)).toBe("00:00:01.234");
    expect(secondsToTimestamp(90.5)).toBe("00:01:30.500");
  });

  it("clamps negatives and NaN to zero", () => {
    expect(secondsToTimestamp(-5)).toBe("00:00:00.000");
    expect(secondsToTimestamp(NaN)).toBe("00:00:00.000");
  });
});

describe("buildTrimArgs", () => {
  it("uses -ss before -i for fast seek", () => {
    const args = buildTrimArgs({ input: "in.mp4", output: "out.mp4", inSec: 10, outSec: 20 });
    const ssIdx = args.indexOf("-ss");
    const iIdx = args.indexOf("-i");
    expect(ssIdx).toBeLessThan(iIdx);
    expect(args[ssIdx + 1]).toBe("00:00:10.000");
  });

  it("computes -t as outSec - inSec", () => {
    const args = buildTrimArgs({ input: "a", output: "b", inSec: 5, outSec: 12.5 });
    const tIdx = args.indexOf("-t");
    expect(parseFloat(args[tIdx + 1])).toBeCloseTo(7.5);
  });

  it("stream-copies by default", () => {
    const args = buildTrimArgs({ input: "a", output: "b", inSec: 0, outSec: 1 });
    expect(args).toContain("-c");
    expect(args).toContain("copy");
  });

  it("omits stream-copy when copyStreams=false", () => {
    const args = buildTrimArgs({
      input: "a",
      output: "b",
      inSec: 0,
      outSec: 1,
      copyStreams: false,
    });
    // -c copy should not be present
    const cIdx = args.indexOf("-c");
    expect(cIdx === -1 || args[cIdx + 1] !== "copy").toBe(true);
  });

  it("ends with the output path", () => {
    const args = buildTrimArgs({
      input: "a",
      output: "C:\\out.mp4",
      inSec: 0,
      outSec: 1,
    });
    expect(args[args.length - 1]).toBe("C:\\out.mp4");
  });
});

describe("buildAudioTrimArgs", () => {
  it("uses libmp3lame for mp3 codec", () => {
    const args = buildAudioTrimArgs({
      input: "a",
      output: "b.mp3",
      inSec: 0,
      outSec: 5,
      codec: "mp3",
    });
    const caIdx = args.indexOf("-c:a");
    expect(args[caIdx + 1]).toBe("libmp3lame");
  });

  it("uses pcm_s16le for wav codec", () => {
    const args = buildAudioTrimArgs({
      input: "a",
      output: "b.wav",
      inSec: 0,
      outSec: 5,
      codec: "wav",
    });
    const caIdx = args.indexOf("-c:a");
    expect(args[caIdx + 1]).toBe("pcm_s16le");
  });

  it("strips video with -vn", () => {
    const args = buildAudioTrimArgs({
      input: "a",
      output: "b",
      inSec: 0,
      outSec: 5,
      codec: "flac",
    });
    expect(args).toContain("-vn");
  });
});

describe("buildConcatArgs", () => {
  it("uses the concat demuxer with safe mode disabled", () => {
    const args = buildConcatArgs("list.txt", "out.mp4");
    expect(args).toContain("-f");
    expect(args).toContain("concat");
    const safeIdx = args.indexOf("-safe");
    expect(args[safeIdx + 1]).toBe("0");
  });

  it("references the list file as -i", () => {
    const args = buildConcatArgs("C:\\list.txt", "out.mp4");
    const iIdx = args.indexOf("-i");
    expect(args[iIdx + 1]).toBe("C:\\list.txt");
  });
});

describe("parseProgressBlock", () => {
  it("returns the most recent out_time and speed", () => {
    const block = [
      "frame=42",
      "out_time_us=1234567",
      "speed=1.5x",
      "progress=continue",
    ].join("\n");
    const p = parseProgressBlock(block);
    expect(p.outTimeSec).toBeCloseTo(1.234567);
    expect(p.speed).toBe("1.5x");
    expect(p.done).toBe(false);
  });

  it("marks done=true when progress=end", () => {
    const block = "out_time_us=5000000\nspeed=2x\nprogress=end";
    const p = parseProgressBlock(block);
    expect(p.done).toBe(true);
  });

  it("returns nulls when the block has no usable keys", () => {
    const p = parseProgressBlock("garbage\nlines\n");
    expect(p.outTimeSec).toBeNull();
    expect(p.speed).toBeNull();
  });
});
