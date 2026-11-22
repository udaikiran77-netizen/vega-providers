import { ProviderContext, Stream, TextTracks } from "../types";

// ThugTV stream flow (reverse-engineered from the site's own frontend code
// and verified against its live API):
//   GET /api/stream/movie/<tmdbId>[?imdb=<imdbId>]
//   GET /api/stream/tv/<tmdbId>/<season>/<episode>[?imdb=<imdbId>]
//   -> { sources: [...], pending: boolean }
// Direct ("hls") sources carry a playable m3u8 url, qualityVariants,
// audioStreams and subtitles. Some direct sources have no url yet and must
// be resolved first via their resolvePath (or a relative "/stream/direct/..."
// url): GET <apiBase><path> returns either { status: "unavailable" } or a
// resolved source. "embed" sources are third-party iframe players and are
// skipped - Vega needs direct media links.
const API_BASES = ["https://api.thugtv.online/api", "https://thugtv.st/api"];
const API_ORIGIN = "https://api.thugtv.online";
const MOVIEBOX_PROXY = "https://thuktv-stream-proxy.rahul-work-joshi.workers.dev";
const SITE_ORIGIN = "https://thugtv.st";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function apiHeaders(providerContext: ProviderContext) {
  return {
    "User-Agent": UA,
    Referer: `${SITE_ORIGIN}/`,
    Origin: SITE_ORIGIN,
    ...(providerContext.commonHeaders || {}),
  };
}

function streamHeaders() {
  // NOTE: no Origin header here - the site's moviebox stream proxy
  // rejects any request that carries an Origin header ("Forbidden
  // origin"), while Referer + User-Agent work for every direct host.
  return {
    Referer: `${SITE_ORIGIN}/`,
    "User-Agent": UA,
  };
}

async function apiGet(
  providerContext: ProviderContext,
  path: string,
  signal?: AbortSignal,
  timeout = 20000
): Promise<any> {
  let lastErr: any = null;
  for (const base of API_BASES) {
    try {
      const res = await providerContext.axios.get(`${base}${path}`, {
        headers: apiHeaders(providerContext),
        signal,
        timeout,
      });
      return res.data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("ThugTV API unreachable");
}

// The site's player rewrites some source urls before playing them; mirror
// that here (from the site's own stream-url transform):
//  - "/api/stream/direct-playlist/..." is used as-is on the API host
//  - "/api/stream/moviebox/..." is served through the site's stream proxy
function transformUrl(raw: string): string {
  if (!raw) return raw;
  if (raw.startsWith("/api/stream/direct-playlist/")) {
    return `${API_ORIGIN}${raw}`;
  }
  if (raw.startsWith("/api/stream/moviebox/")) {
    return `${MOVIEBOX_PROXY}${raw.replace(/^\/api\/stream/, "")}`;
  }
  if (raw.startsWith("/")) {
    return `${API_ORIGIN}${raw}`;
  }
  return raw;
}

function parseQuality(label?: string): string | undefined {
  if (!label) return undefined;
  const m = String(label).match(/(\d{3,4})\s*p/i);
  if (m) return m[1];
  if (/4k|uhd/i.test(label)) return "2160";
  return undefined;
}

function mapSubtitles(list: any[]): TextTracks {
  const out: TextTracks = [];
  const seen = new Set<string>();
  for (const s of list || []) {
    const uri = s?.url || s?.file;
    if (!uri) continue;
    const abs = transformUrl(String(uri));
    if (seen.has(abs)) continue;
    seen.add(abs);
    const langRaw = s.lang || s.language || s.id || "en";
    out.push({
      title: s.label || s.display || s.lang || "Subtitle",
      language: String(langRaw).slice(0, 2).toLowerCase(),
      type:
        s.type === "vtt" || abs.split("?")[0].endsWith(".vtt")
          ? "text/vtt"
          : "application/x-subrip",
      uri: abs,
    });
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const getStream = async function ({
  link,
  type,
  signal,
  providerContext,
  isDownload,
}: {
  link: string;
  type: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  try {
    let payload: any = {};
    try {
      payload = JSON.parse(link);
    } catch {
      payload = { tmdbId: link };
    }
    const tmdbId = String(payload.tmdbId ?? payload.id ?? "");
    if (!tmdbId) return [];
    const isSeries =
      payload.type === "series" ||
      payload.type === "tv" ||
      type === "series";
    const imdbId = payload.imdbId || "";
    const season = payload.season ?? 1;
    const episode = payload.episode ?? 1;

    const streamPath = isSeries
      ? `/stream/tv/${tmdbId}/${season}/${episode}`
      : `/stream/movie/${tmdbId}`;
    const fullPath = `${streamPath}${imdbId ? `?imdb=${encodeURIComponent(imdbId)}` : ""}`;

    let data = await apiGet(providerContext, fullPath, signal, 25000);
    let sources: any[] = Array.isArray(data?.sources) ? data.sources : [];

    const hasDirect = (list: any[]) =>
      list.some(
        (s) => s && s.type !== "embed" && (s.url || s.resolvePath)
      );
    // The site polls while the backend marks the response as pending.
    if (data?.pending && !hasDirect(sources)) {
      await delay(2500);
      try {
        const retry = await apiGet(providerContext, fullPath, signal, 25000);
        if (Array.isArray(retry?.sources) && retry.sources.length) {
          data = retry;
          sources = retry.sources;
        }
      } catch {}
    }

    const streams: Stream[] = [];
    const seenLinks = new Set<string>();

    const pushStream = (
      serverName: string,
      rawUrl: string,
      quality: string | undefined,
      subtitles: TextTracks
    ) => {
      const url = transformUrl(rawUrl);
      if (!url || !/^https?:\/\//i.test(url)) return;
      if (seenLinks.has(url)) return;
      seenLinks.add(url);
      const streamType =
        url.includes(".m3u8") || /\.m3u8($|\?)/i.test(url)
          ? "m3u8"
          : url.includes(".mp4")
            ? "mp4"
            : "m3u8";
      streams.push({
        server: serverName,
        link: url,
        type: streamType,
        quality,
        subtitles: subtitles.length ? subtitles : undefined,
        headers: streamHeaders(),
      });
    };

    const processSource = async (source: any): Promise<void> => {
      if (!source || source.type === "embed") return;
      const name = source.name || source.label || "Server";
      const serverName = `ThugTV - ${name}`;
      const subtitles = mapSubtitles(source.subtitles || []);
      const quality = parseQuality(source.quality) || undefined;

      let url: string = source.url || "";

      // Sources without a ready url must be resolved through the API first
      // (resolvePath, or a relative "/stream/..." url).
      const resolvePath: string =
        source.resolvePath ||
        (url.startsWith("/stream/") ? url : "") ||
        "";
      if (resolvePath) {
        try {
          const resolved = await apiGet(
            providerContext,
            resolvePath,
            signal,
            15000
          );
          if (!resolved || resolved.status === "unavailable") return;
          if (Array.isArray(resolved.sources)) {
            for (const inner of resolved.sources) {
              if (inner && inner.type !== "embed" && inner.url) {
                pushStream(
                  `ThugTV - ${inner.name || inner.label || name}`,
                  inner.url,
                  parseQuality(inner.quality) || quality,
                  mapSubtitles(inner.subtitles || subtitles)
                );
              }
            }
            return;
          }
          if (typeof resolved.url === "string" && resolved.url) {
            url = resolved.url;
          } else if (typeof resolved.link === "string" && resolved.link) {
            url = resolved.link;
          } else {
            return;
          }
        } catch {
          return;
        }
      }

      if (!url) return;

      // One stream per quality variant when the source provides them
      // (the main url is normally one of the variants).
      const variants: any[] = Array.isArray(source.qualityVariants)
        ? source.qualityVariants
        : [];
      if (variants.length) {
        for (const variant of variants) {
          if (variant?.url) {
            pushStream(
              serverName,
              variant.url,
              parseQuality(variant.label) || quality,
              subtitles
            );
          }
        }
      }
      pushStream(serverName, url, quality, subtitles);

      // Alternate audio languages are separate playable playlists.
      const audios: any[] = Array.isArray(source.audioStreams)
        ? source.audioStreams
        : [];
      for (const audio of audios) {
        if (audio?.url && !seenLinks.has(transformUrl(audio.url))) {
          pushStream(
            `${serverName} (${audio.label || audio.lang || "Audio"})`,
            audio.url,
            quality,
            subtitles
          );
        }
      }
    };

    for (const source of sources) {
      await processSource(source);
    }

    // Soft playlist verification, mirroring the Cinejoy provider: drop a
    // stream only when its playlist definitively is not an m3u8.
    const verified: Stream[] = [];
    await Promise.all(
      streams.map(async (stream) => {
        if (stream.type !== "m3u8") {
          verified.push(stream);
          return;
        }
        try {
          const res = await providerContext.axios.get(stream.link, {
            headers: streamHeaders(),
            timeout: 8000,
            signal,
          });
          const text =
            typeof res.data === "string" ? res.data : JSON.stringify(res.data);
          if (text.trimStart().startsWith("#EXTM3U")) {
            verified.push(stream);
          }
        } catch {
          // Inconclusive check (network) - keep the stream; the site's API
          // already validated this server for the title.
          verified.push(stream);
        }
      })
    );
    // Preserve API source order (Promise.all above may reorder).
    const order = new Map(streams.map((s, i) => [s.link, i]));
    verified.sort((a, b) => (order.get(a.link) ?? 0) - (order.get(b.link) ?? 0));

    if (isDownload) {
      return verified.filter((stream) => !stream.drm);
    }
    return verified;
  } catch (err) {
    console.error("ThugTV getStream error:", err);
    return [];
  }
};
