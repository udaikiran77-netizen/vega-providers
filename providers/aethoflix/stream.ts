import { ProviderContext, Stream } from "../types";

// AethoFlix stream flow (from the site's own code):
// The main site iframes its own player host, embed.aethoflix.live
// ("Server 1 - Aetho Embed": /embed/movie/<tmdbId>,
// /embed/tv/<tmdbId>/<season>/<episode>). That player's documented
// mesh API resolves a title to its playable sources in one call:
//   GET https://embed.aethoflix.live/api/v2/aetho-mesh/resolve
//     ?apiId=aetho-prime-hi-master-1&server=aetho-prime&tier=hindi-master
//     &tmdbId=<id>&type=movie|tv[&season=<s>&episode=<e>]
//   -> { ok, sources: [{ type, url, resolution, label, language,
//        audioLanguages, originServer }], dubs: [...] }
// (server/tier select the mesh lane; the returned source set is the
// title's full aggregated set either way - verified against the live API.)
//
// Source URLs are the player's own proxy wrappers:
//   /api/proxy-m3u8?url=<direct m3u8>&ref=<referer>&lang=...
//   /api/proxy-mkv?url=<direct file>
//   /api/torrent-stream/<hash>?...   (served by the embed host itself)
// For HLS the wrapper is unwrapped here: the direct CDN playlists serve
// fine with the bundled `ref` as Referer (verified live, playlist +
// segment chain), which is also what a player needs - the site's proxy
// itself 404s/times out on some upstreams. File sources keep the proxy
// URL: the player plays them exactly like that (the proxy serves them
// as playable MP4), while the raw files are often MKV containers.
const EMBED_ORIGIN = "https://embed.aethoflix.live";
const SITE_ORIGIN = "https://aethoflix.live";
const RESOLVE_URL = `${EMBED_ORIGIN}/api/v2/aetho-mesh/resolve`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function embedHeaders(providerContext: ProviderContext) {
  // commonHeaders go FIRST: the app-supplied defaults must never override
  // the User-Agent/Referer these hosts expect.
  return {
    ...(providerContext.commonHeaders || {}),
    "User-Agent": UA,
    Referer: `${SITE_ORIGIN}/`,
  };
}

function parsePayload(link: string): {
  tmdbId: number;
  type: "movie" | "series";
  season?: number;
  episode?: number;
} | null {
  try {
    const payload = JSON.parse(link);
    const tmdbId = Number(payload.tmdbId || payload.id);
    if (!tmdbId) return null;
    return {
      tmdbId,
      type:
        payload.type === "series" || payload.type === "tv"
          ? "series"
          : "movie",
      season: payload.season != null ? Number(payload.season) : undefined,
      episode: payload.episode != null ? Number(payload.episode) : undefined,
    };
  } catch {}
  const match = link.match(/\/(?:watch\/|embed\/)?(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/);
  if (match) {
    return {
      tmdbId: Number(match[2]),
      type: match[1] === "tv" ? "series" : "movie",
      season: match[3] ? Number(match[3]) : undefined,
      episode: match[4] ? Number(match[4]) : undefined,
    };
  }
  return null;
}

function queryParam(url: string, name: string): string {
  const qIndex = url.indexOf("?");
  if (qIndex < 0) return "";
  try {
    return new URLSearchParams(url.slice(qIndex + 1)).get(name) || "";
  } catch {
    return "";
  }
}

function absolutize(url: string): string {
  if (!url) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${EMBED_ORIGIN}${url}`;
  return url;
}

// "1080p • Hindi (VidZee Hindi)" -> "Hindi (VidZee Hindi)"
function cleanLabel(source: any): string {
  const label = String(source?.label || "").trim();
  const stripped = label.replace(/^\d{3,4}p\s*•\s*/, "").trim();
  if (stripped) return stripped;
  if (source?.originServer) return String(source.originServer);
  if (source?.language) return String(source.language);
  return "Server";
}

interface MappedSource {
  stream: Stream;
  kind: "hls" | "file" | "torrent";
}

function mapSource(source: any): MappedSource | null {
  const rawUrl = String(source?.url || "");
  if (!rawUrl) return null;
  const quality = source?.resolution ? String(source.resolution) : undefined;
  const server = `AethoFlix - ${cleanLabel(source)}`;
  const tag = source?.language ? String(source.language) : undefined;

  if (rawUrl.includes("/api/proxy-m3u8")) {
    const direct = queryParam(rawUrl, "url");
    if (!direct) return null;
    const ref = queryParam(rawUrl, "ref");
    return {
      kind: "hls",
      stream: {
        server,
        link: direct,
        type: "m3u8",
        quality,
        tag,
        headers: {
          Referer: ref || `${EMBED_ORIGIN}/`,
          "User-Agent": UA,
        },
      },
    };
  }

  if (rawUrl.includes("/api/proxy-mkv")) {
    // Played through the site's own file proxy, like its player does.
    return {
      kind: "file",
      stream: {
        server,
        link: absolutize(rawUrl),
        type: "mp4",
        quality,
        tag,
        headers: { Referer: `${EMBED_ORIGIN}/`, "User-Agent": UA },
      },
    };
  }

  if (rawUrl.includes("/api/torrent-stream/")) {
    return {
      kind: "torrent",
      stream: {
        server,
        link: absolutize(rawUrl),
        type: "mp4",
        quality,
        tag,
        headers: { Referer: `${EMBED_ORIGIN}/`, "User-Agent": UA },
      },
    };
  }

  // Any other absolute URL the API returns: pass through as-is.
  if (/^https?:\/\//i.test(rawUrl)) {
    const isHls = source?.type === "hls" || /\.m3u8($|\?)/i.test(rawUrl);
    return {
      kind: isHls ? "hls" : "file",
      stream: {
        server,
        link: rawUrl,
        type: isHls ? "m3u8" : "mp4",
        quality,
        tag,
        headers: { Referer: `${EMBED_ORIGIN}/`, "User-Agent": UA },
      },
    };
  }
  return null;
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
    const payload = parsePayload(link);
    if (!payload) return [];
    const isSeries =
      payload.type === "series" || type === "series" || type === "tv";

    const params = new URLSearchParams({
      apiId: "aetho-prime-hi-master-1",
      server: "aetho-prime",
      tier: "hindi-master",
      tmdbId: String(payload.tmdbId),
      type: isSeries ? "tv" : "movie",
    });
    if (isSeries) {
      params.set("season", String(payload.season ?? 1));
      params.set("episode", String(payload.episode ?? 1));
    }

    const res = await providerContext.axios.get(
      `${RESOLVE_URL}?${params.toString()}`,
      { headers: embedHeaders(providerContext), signal, timeout: 30000 }
    );
    const sources = Array.isArray(res.data?.sources) ? res.data.sources : [];
    if (!sources.length) return [];

    const mapped: MappedSource[] = [];
    const seenLinks = new Set<string>();
    for (const source of sources) {
      const item = mapSource(source);
      if (!item || seenLinks.has(item.stream.link)) continue;
      seenLinks.add(item.stream.link);
      mapped.push(item);
    }

    // Number duplicate server names so entries stay distinguishable in
    // the app's server list.
    const nameCounts = new Map<string, number>();
    for (const item of mapped) {
      nameCounts.set(item.stream.server, (nameCounts.get(item.stream.server) || 0) + 1);
    }
    const nameSeen = new Map<string, number>();
    for (const item of mapped) {
      if ((nameCounts.get(item.stream.server) || 0) > 1) {
        const n = (nameSeen.get(item.stream.server) || 0) + 1;
        nameSeen.set(item.stream.server, n);
        item.stream.server = `${item.stream.server} ${n}`;
      }
    }

    // Playlist check for HLS only, NON-destructive (same lesson as the
    // DeadToons fix): these rotating CDNs can answer a bare check with
    // an interstitial or a transient failure while the same link plays
    // fine, so a stream is dropped ONLY on a definitive 404/410. File
    // and torrent streams are not checked - their servers expect range
    // requests, not full GETs.
    const hlsItems = mapped.filter((item) => item.kind === "hls");
    const deadLinks = new Set<string>();
    await Promise.all(
      hlsItems.map(async (item) => {
        try {
          await providerContext.axios.get(item.stream.link, {
            headers: item.stream.headers,
            timeout: 8000,
            signal,
          });
        } catch (err: any) {
          const status = err?.response?.status;
          if (status === 404 || status === 410) {
            deadLinks.add(item.stream.link);
          }
        }
      })
    );
    const alive = mapped.filter((item) => !deadLinks.has(item.stream.link));

    const rank = (item: MappedSource): number => {
      if (isDownload) {
        return item.kind === "file" ? 0 : item.kind === "torrent" ? 1 : 2;
      }
      return item.kind === "hls" ? 0 : item.kind === "file" ? 1 : 2;
    };
    alive.sort((a, b) => rank(a) - rank(b));
    return alive.map((item) => item.stream);
  } catch (err) {
    console.error("AethoFlix getStream error:", err);
    return [];
  }
};
