import { parseYoutubeUrl } from "@/modules/tutorials/youtube";

export const TUTORIAL_VIDEO_URL_ERROR =
  "Please enter a valid YouTube, Vimeo, Facebook, or Instagram video URL.";

export type TutorialVideoProvider = "youtube" | "vimeo" | "facebook" | "instagram";

export type ParsedTutorialVideo = {
  provider: TutorialVideoProvider;
  thumbnailUrl: string;
  embedUrl: string;
};

const VIMEO_ID = /^\d+$/;
const VIMEO_HASH = /^[A-Za-z0-9]+$/;
const INSTAGRAM_CODE = /^[A-Za-z0-9_-]+$/;
const FACEBOOK_VIDEO_ID = /^\d+$/;
const FB_WATCH_CODE = /^[A-Za-z0-9_-]+$/;

function hostWithoutWww(hostname: string) {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

function pathParts(pathname: string) {
  return pathname.split("/").filter(Boolean);
}

function parseHttpUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

function vimeoEmbed(videoId: string, hash?: string) {
  const embed = new URL(`https://player.vimeo.com/video/${videoId}`);
  if (hash) embed.searchParams.set("h", hash);
  return embed.toString();
}

function parseVimeoUrl(url: URL): ParsedTutorialVideo | null {
  const host = hostWithoutWww(url.hostname);
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;

  const parts = pathParts(url.pathname);
  let videoId = "";
  let hash = url.searchParams.get("h")?.trim() || "";

  if (host === "player.vimeo.com") {
    if (parts[0] !== "video" || !VIMEO_ID.test(parts[1] ?? "")) return null;
    videoId = parts[1];
  } else if (VIMEO_ID.test(parts[0] ?? "")) {
    videoId = parts[0];
    if (!hash && parts[1] && VIMEO_HASH.test(parts[1])) hash = parts[1];
  } else if (parts[0] === "channels" && VIMEO_ID.test(parts[2] ?? "")) {
    videoId = parts[2];
  } else if (parts[0] === "groups" && parts[2] === "videos" && VIMEO_ID.test(parts[3] ?? "")) {
    videoId = parts[3];
  } else if (
    (parts[0] === "showcase" || parts[0] === "album") &&
    parts[2] === "video" &&
    VIMEO_ID.test(parts[3] ?? "")
  ) {
    videoId = parts[3];
  } else {
    return null;
  }

  if (!VIMEO_ID.test(videoId)) return null;
  if (hash && !VIMEO_HASH.test(hash)) hash = "";

  return {
    provider: "vimeo",
    thumbnailUrl: "",
    embedUrl: vimeoEmbed(videoId, hash || undefined),
  };
}

function facebookCanonicalHref(url: URL) {
  const canonical = new URL(url.toString());
  canonical.hash = "";
  return canonical.toString();
}

function parseFacebookUrl(url: URL): ParsedTutorialVideo | null {
  const host = hostWithoutWww(url.hostname);
  const facebookHosts = new Set(["facebook.com", "m.facebook.com", "web.facebook.com", "fb.com"]);
  const isWatchHost = host === "fb.watch";
  if (!facebookHosts.has(host) && !isWatchHost) return null;

  const parts = pathParts(url.pathname);
  const watchId = url.searchParams.get("v")?.trim() ?? "";

  let isVideo = false;
  if (isWatchHost) {
    isVideo = FB_WATCH_CODE.test(parts[0] ?? "");
  } else if (parts[0] === "watch" && FACEBOOK_VIDEO_ID.test(watchId)) {
    isVideo = true;
  } else if (parts[0] === "video.php" && FACEBOOK_VIDEO_ID.test(watchId)) {
    isVideo = true;
  } else if (parts[0] === "reel" && FACEBOOK_VIDEO_ID.test(parts[1] ?? "")) {
    isVideo = true;
  } else if (parts[0] === "reels" && FACEBOOK_VIDEO_ID.test(parts[1] ?? "")) {
    isVideo = true;
  } else if (parts.includes("videos")) {
    const index = parts.lastIndexOf("videos");
    isVideo = FACEBOOK_VIDEO_ID.test(parts[index + 1] ?? "");
  }

  if (!isVideo) return null;

  const href = encodeURIComponent(facebookCanonicalHref(url));
  return {
    provider: "facebook",
    thumbnailUrl: "",
    embedUrl: `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false`,
  };
}

function parseInstagramUrl(url: URL): ParsedTutorialVideo | null {
  const host = hostWithoutWww(url.hostname);
  if (host !== "instagram.com" && host !== "instagr.am") return null;

  const parts = pathParts(url.pathname);
  const kind = (parts[0] ?? "").toLowerCase();
  const code = parts[1] ?? "";
  if (!INSTAGRAM_CODE.test(code)) return null;

  let embedKind = "";
  if (kind === "p") embedKind = "p";
  else if (kind === "reel" || kind === "reels") embedKind = "reel";
  else if (kind === "tv") embedKind = "tv";
  else return null;

  return {
    provider: "instagram",
    thumbnailUrl: "",
    embedUrl: `https://www.instagram.com/${embedKind}/${code}/embed`,
  };
}

export function parseTutorialVideo(raw: string): ParsedTutorialVideo | null {
  const youtube = parseYoutubeUrl(raw);
  if (youtube) {
    return {
      provider: "youtube",
      thumbnailUrl: youtube.thumbnailUrl,
      embedUrl: youtube.embedUrl,
    };
  }

  const url = parseHttpUrl(raw);
  if (!url) return null;

  return parseVimeoUrl(url) ?? parseFacebookUrl(url) ?? parseInstagramUrl(url);
}
