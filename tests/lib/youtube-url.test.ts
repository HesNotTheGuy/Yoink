import { describe, expect, it } from "vitest";
import { parseInputUrl } from "@/lib/youtube-url";

const ID = "AAAAAAAAAAA";

describe("parseInputUrl", () => {
  it("returns null for empty or non-http text", () => {
    expect(parseInputUrl("")).toBeNull();
    expect(parseInputUrl("   ")).toBeNull();
    expect(parseInputUrl("not a url")).toBeNull();
    expect(parseInputUrl("youtube.com/shorts/" + ID)).toBeNull();
  });

  it("detects common Shorts URL shapes", () => {
    const shapes = [
      `https://www.youtube.com/shorts/${ID}`,
      `https://youtube.com/shorts/${ID}`,
      `https://m.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/shorts/${ID}/`,
      `https://www.youtube.com/shorts/${ID}?feature=share`,
      `https://www.youtube.com/shorts/${ID}?si=abc`,
      `http://www.youtube.com/shorts/${ID}`,
      `  https://www.youtube.com/shorts/${ID}  `,
    ];
    for (const href of shapes) {
      expect(parseInputUrl(href)).toEqual({
        kind: "youtube-short",
        videoId: ID,
        href: href.trim(),
      });
    }
  });

  it("does not treat a channel Shorts tab as a single Short", () => {
    expect(parseInputUrl("https://www.youtube.com/@YouTube/shorts")).toEqual({
      kind: "other",
      href: "https://www.youtube.com/@YouTube/shorts",
    });
  });

  it("leaves watch, share, and malformed shorts paths as other", () => {
    expect(parseInputUrl(`https://www.youtube.com/watch?v=${ID}`)).toEqual({
      kind: "other",
      href: `https://www.youtube.com/watch?v=${ID}`,
    });
    expect(parseInputUrl(`https://youtu.be/${ID}`)).toEqual({
      kind: "other",
      href: `https://youtu.be/${ID}`,
    });
    expect(parseInputUrl("https://www.youtube.com/shorts/short")).toEqual({
      kind: "other",
      href: "https://www.youtube.com/shorts/short",
    });
    expect(parseInputUrl(`https://www.youtube.com/shorts/${ID}Z`)).toEqual({
      kind: "other",
      href: `https://www.youtube.com/shorts/${ID}Z`,
    });
    expect(parseInputUrl(`https://www.youtube.com/shorts/${ID}/extra`)).toEqual({
      kind: "other",
      href: `https://www.youtube.com/shorts/${ID}/extra`,
    });
  });
});
