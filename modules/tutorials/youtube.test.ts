import { describe, expect, it } from "vitest";
import { parseYoutubeUrl, youtubeEmbedUrl, youtubeThumbnailUrl, YOUTUBE_URL_ERROR } from "./youtube";

describe("parseYoutubeUrl", () => {
  it("accepts standard watch, short, embed, shorts, and live URLs", () => {
    const id = "dQw4w9WgXcQ";
    const urls = [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=12`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
      `http://youtu.be/${id}`,
    ];
    for (const url of urls) {
      const parsed = parseYoutubeUrl(url);
      expect(parsed?.videoId, url).toBe(id);
      expect(parsed?.thumbnailUrl).toBe(youtubeThumbnailUrl(id));
      expect(parsed?.embedUrl).toBe(youtubeEmbedUrl(id));
    }
  });

  it("rejects invalid URLs", () => {
    expect(parseYoutubeUrl("")).toBeNull();
    expect(parseYoutubeUrl("not a url")).toBeNull();
    expect(parseYoutubeUrl("https://vimeo.com/123")).toBeNull();
    expect(parseYoutubeUrl("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseYoutubeUrl("https://www.youtube.com/feed/subscriptions")).toBeNull();
  });
});

describe("youtube media URLs", () => {
  it("derives hqdefault thumbnails and nocookie embeds", () => {
    expect(youtubeThumbnailUrl("ABC-123_xyz")).toBe("https://img.youtube.com/vi/ABC-123_xyz/hqdefault.jpg");
    expect(youtubeEmbedUrl("ABC-123_xyz")).toBe("https://www.youtube-nocookie.com/embed/ABC-123_xyz");
    expect(YOUTUBE_URL_ERROR).toBe("Please enter a valid YouTube video URL.");
  });
});
