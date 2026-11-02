import { describe, expect, it } from "vitest";
import { parseTutorialVideo, TUTORIAL_VIDEO_URL_ERROR } from "./video";
import { youtubeEmbedUrl, youtubeThumbnailUrl } from "./youtube";

describe("parseTutorialVideo", () => {
  it("keeps YouTube watch URLs", () => {
    const id = "dQw4w9WgXcQ";
    const parsed = parseTutorialVideo(`https://www.youtube.com/watch?v=${id}`);
    expect(parsed).toEqual({
      provider: "youtube",
      thumbnailUrl: youtubeThumbnailUrl(id),
      embedUrl: youtubeEmbedUrl(id),
    });
  });

  it("accepts Vimeo numeric, unlisted hash, player, and collection URLs", () => {
    expect(parseTutorialVideo("https://vimeo.com/123456789")).toEqual({
      provider: "vimeo",
      thumbnailUrl: "",
      embedUrl: "https://player.vimeo.com/video/123456789",
    });
    expect(parseTutorialVideo("https://vimeo.com/123456789/abc12def")).toEqual({
      provider: "vimeo",
      thumbnailUrl: "",
      embedUrl: "https://player.vimeo.com/video/123456789?h=abc12def",
    });
    expect(parseTutorialVideo("https://player.vimeo.com/video/123456789?h=privhash")).toEqual({
      provider: "vimeo",
      thumbnailUrl: "",
      embedUrl: "https://player.vimeo.com/video/123456789?h=privhash",
    });
    expect(parseTutorialVideo("https://vimeo.com/channels/staffpicks/123456789")?.embedUrl).toBe(
      "https://player.vimeo.com/video/123456789"
    );
    expect(parseTutorialVideo("https://vimeo.com/groups/name/videos/123456789")?.embedUrl).toBe(
      "https://player.vimeo.com/video/123456789"
    );
    expect(parseTutorialVideo("https://vimeo.com/showcase/55/video/123456789")?.embedUrl).toBe(
      "https://player.vimeo.com/video/123456789"
    );
  });

  it("accepts Facebook watch, videos, reel, and fb.watch URLs", () => {
    const watch = parseTutorialVideo("https://www.facebook.com/watch/?v=111222333");
    expect(watch?.provider).toBe("facebook");
    expect(watch?.embedUrl).toContain("https://www.facebook.com/plugins/video.php?href=");
    expect(watch?.embedUrl).toContain(encodeURIComponent("https://www.facebook.com/watch/?v=111222333"));

    const pageVideo = parseTutorialVideo("https://www.facebook.com/SomePage/videos/444555666");
    expect(pageVideo?.provider).toBe("facebook");
    expect(pageVideo?.embedUrl).toContain(encodeURIComponent("https://www.facebook.com/SomePage/videos/444555666"));

    const reel = parseTutorialVideo("https://www.facebook.com/reel/777888999");
    expect(reel?.provider).toBe("facebook");

    const short = parseTutorialVideo("https://fb.watch/AbC123_-x");
    expect(short?.provider).toBe("facebook");
    expect(short?.embedUrl).toContain(encodeURIComponent("https://fb.watch/AbC123_-x"));

    const php = parseTutorialVideo("https://www.facebook.com/video.php?v=123456");
    expect(php?.provider).toBe("facebook");
  });

  it("accepts Instagram post, reel, reels, and tv URLs", () => {
    expect(parseTutorialVideo("https://www.instagram.com/p/AbC123xyz/")?.embedUrl).toBe(
      "https://www.instagram.com/p/AbC123xyz/embed"
    );
    expect(parseTutorialVideo("https://www.instagram.com/reel/ReElCode/")?.embedUrl).toBe(
      "https://www.instagram.com/reel/ReElCode/embed"
    );
    expect(parseTutorialVideo("https://www.instagram.com/reels/ReElCode/")?.embedUrl).toBe(
      "https://www.instagram.com/reel/ReElCode/embed"
    );
    expect(parseTutorialVideo("https://www.instagram.com/tv/TvCode99/")?.embedUrl).toBe(
      "https://www.instagram.com/tv/TvCode99/embed"
    );
  });

  it("rejects profiles and unrelated sites", () => {
    expect(parseTutorialVideo("")).toBeNull();
    expect(parseTutorialVideo("not a url")).toBeNull();
    expect(parseTutorialVideo("https://vimeo.com/staff")).toBeNull();
    expect(parseTutorialVideo("https://www.facebook.com/SomePage")).toBeNull();
    expect(parseTutorialVideo("https://www.instagram.com/postbus/")).toBeNull();
    expect(parseTutorialVideo("https://example.com/watch?v=abc")).toBeNull();
    expect(TUTORIAL_VIDEO_URL_ERROR).toBe(
      "Please enter a valid YouTube, Vimeo, Facebook, or Instagram video URL."
    );
  });
});
