export const YOUTUBE_URL_ERROR = "Please enter a valid YouTube video URL.";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

export type ParsedYoutube = {
  videoId: string;
  thumbnailUrl: string;
  embedUrl: string;
};

export function youtubeThumbnailUrl(videoId: string) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

export function youtubeEmbedUrl(videoId: string) {
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

function hostWithoutWww(hostname: string) {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

function firstPathSegment(pathname: string, index = 0) {
  return pathname.split("/").filter(Boolean)[index] ?? "";
}

export function parseYoutubeUrl(raw: string): ParsedYoutube | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = hostWithoutWww(url.hostname);
  if (!YOUTUBE_HOSTS.has(host)) return null;

  let videoId = "";

  if (host === "youtu.be") {
    videoId = firstPathSegment(url.pathname);
  } else {
    const fromQuery = url.searchParams.get("v");
    if (fromQuery) {
      videoId = fromQuery;
    } else {
      const head = firstPathSegment(url.pathname).toLowerCase();
      if (head === "embed" || head === "shorts" || head === "live" || head === "v" || head === "watch") {
        videoId = firstPathSegment(url.pathname, 1);
      }
    }
  }

  videoId = videoId.replace(/[^A-Za-z0-9_-].*$/, "");
  if (!VIDEO_ID.test(videoId)) return null;

  return {
    videoId,
    thumbnailUrl: youtubeThumbnailUrl(videoId),
    embedUrl: youtubeEmbedUrl(videoId),
  };
}
