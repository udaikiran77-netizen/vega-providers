import { ProviderContext, Stream, TextTracks } from "../types";

// DeadToons stream flow (reverse-engineered from the sites' own code and
// verified against the live API):
//   Series episode: GET /anime/<slug>/season/<s>/episode/<e>
//   Movie:          GET /anime/<slug>
//   -> { watch_servers: [{ name, link_server_id }] }
//   GET /watch/<link_server_id>/resolve -> { embed_url }
// The watch servers are third-party embed hosts. Embeds from the
// VidHide/EarnVids family serve a Dean Edwards-packed player setup that
// contains direct HLS links (links.hls2/hls3/hls4) - those are unpacked
// here (pure string work, no eval) and returned as real m3u8 streams.
// StreamHG (hgcloud) and Hydrax/Abyss embeds keep their sources inside
// obfuscated/encrypted player bundles and cannot be resolved statically,
// so they are skipped. The API's download links (HubCloud, Pixeldrain,
// ...) have no API resolve endpoint - they resolve only through the
// Cloudflare-gated archive.deadtoons.sbs pages - so they are not used.
const API_BASE = "https://api.deadbase.host/api/v1/public";
const SITE_ORIGIN = "https://deadtoons.sbs";
const WATCH_ORIGIN = "https://anidisk.org";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function apiHeaders(providerContext: ProviderContext) {
  return {
    "User-Agent": UA,
    Referer: `${SITE_ORIGIN}/`,
    ...(providerContext.commonHeaders || {}),
  };
}

async function apiGet(
  providerContext: ProviderContext,
  path: string,
  signal?: AbortSignal,
  timeout = 15000
): Promise<any> {
  const res = await providerContext.axios.get(`${API_BASE}${path}`, {
    headers: apiHeaders(providerContext),
    signal,
    timeout,
  });
  return res.data;
}

function absolutize(url: string, baseUrl: string): string {
  if (!url) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) {
    try {
      return `${new URL(baseUrl).origin}${url}`;
    } catch {
      return url;
    }
  }
  return url;
}

// Dean Edwards packer unpack - the same algorithm the packed script
// itself runs, reimplemented with plain string operations (no eval).
function unpackPacker(source: string): string | null {
  const re =
    /\}\('((?:[^'\\]|\\.)*)',(\d+),(\d+),'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    try {
      const payload = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      const radix = parseInt(match[2], 10);
      const count = parseInt(match[3], 10);
      const words = match[4].replace(/\\'/g, "'").split("|");
      if (!radix || !count || words.length < count) continue;
      const encode = (c: number): string =>
        (c < radix ? "" : encode(Math.floor(c / radix))) +
        (c % radix > 35
          ? String.fromCharCode((c % radix) + 29)
          : (c % radix).toString(36));
      const dict: Record<string, string> = {};
      for (let i = 0; i < count; i++) dict[encode(i)] = words[i] || encode(i);
      const unpacked = payload.replace(
        /\b\w+\b/g,
        (word) => dict[word] ?? word
      );
      if (unpacked.includes("hls") || unpacked.includes("links")) {
        return unpacked;
      }
    } catch {}
  }
  return null;
}

interface VidhideData {
  links: Record<string, string>;
  quality?: string;
  subtitles: TextTracks;
}

function extractVidhide(text: string, embedUrl: string): VidhideData {
  const links: Record<string, string> = {};
  const linkMatch = text.match(/links\s*=\s*(\{[^}]*\})/);
  if (linkMatch) {
    const re = /"(hls\d)":"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(linkMatch[1])) !== null) {
      links[m[1]] = absolutize(m[2], embedUrl);
    }
  }
  if (!Object.keys(links).length) {
    // Fallback: any absolute m3u8/master.txt URL in the setup.
    const re = /https?:\/\/[^"'\s]+\.(?:m3u8|txt)(?:\?[^"'\s]*)?/g;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(text)) !== null && i < 3) {
      links[`hls${i}`] = m[0];
      i++;
    }
  }

  let quality: string | undefined;
  const qualityMatch = text.match(
    /qualityLabels['"]?\s*:\s*\{[^}]*?"(\d+)p"/
  );
  if (qualityMatch) quality = qualityMatch[1];

  const subtitles: TextTracks = [];
  const tracksMatch = text.match(/tracks:\[([\s\S]*?)\]/);
  if (tracksMatch) {
    const re = /\{file:"([^"]+)",label:"([^"]*)",kind:"captions"\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tracksMatch[1])) !== null) {
      subtitles.push({
        title: m[2] || "Subtitle",
        language: (m[2] || "en").slice(0, 2).toLowerCase(),
        type: "text/vtt",
        uri: absolutize(m[1], embedUrl),
      });
    }
  }
  return { links, quality, subtitles };
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
      payload = {};
    }
    const animeSlug = String(payload.animeSlug || payload.slug || "");
    if (!animeSlug) return [];
    const isSeries =
      payload.type === "series" || payload.type === "tv" || type === "series";

    let watchServers: any[] = [];
    if (isSeries) {
      const season = payload.season ?? 1;
      const episode = payload.episode ?? 1;
      const data = await apiGet(
        providerContext,
        `/anime/${encodeURIComponent(animeSlug)}/season/${season}/episode/${episode}`,
        signal
      );
      watchServers = data?.watch_servers || [];
    } else {
      const data = await apiGet(
        providerContext,
        `/anime/${encodeURIComponent(animeSlug)}`,
        signal
      );
      watchServers = data?.watch_servers || [];
    }
    if (!watchServers.length) return [];

    const streams: Stream[] = [];
    const seenLinks = new Set<string>();

    for (const server of watchServers) {
      const serverId = server?.link_server_id;
      if (!serverId) continue;
      const serverName = `DeadToons - ${server.name || "Server"}`;
      try {
        const resolved = await apiGet(
          providerContext,
          `/watch/${serverId}/resolve`,
          signal
        );
        const embedUrl: string = resolved?.embed_url || "";
        if (!embedUrl) continue;

        const embedRes = await providerContext.axios.get(embedUrl, {
          headers: {
            "User-Agent": UA,
            Referer: `${WATCH_ORIGIN}/`,
            ...(providerContext.commonHeaders || {}),
          },
          signal,
          timeout: 20000,
        });
        const html =
          typeof embedRes.data === "string"
            ? embedRes.data
            : JSON.stringify(embedRes.data);
        const unpacked = unpackPacker(html);
        if (!unpacked) continue; // not a statically resolvable embed
        const { links, quality, subtitles } = extractVidhide(
          unpacked,
          embedUrl
        );

        // hls3 is the site's most reliable CDN variant; hls2 tokens are
        // ASN-bound and hls4 is a relative playlist on the embed origin.
        for (const key of ["hls3", "hls2", "hls4"]) {
          const url = links[key];
          if (!url || seenLinks.has(url)) continue;
          seenLinks.add(url);
          streams.push({
            server: serverName,
            link: url,
            type: "m3u8",
            quality,
            subtitles: subtitles.length ? subtitles : undefined,
            headers: { Referer: embedUrl, "User-Agent": UA },
          });
        }
      } catch {}
    }

    // Soft playlist verification, mirroring the other providers: drop a
    // stream only when its playlist definitively is not an m3u8 (a CDN
    // error page served with HTTP 200); keep it when the check itself
    // fails (403/timeout - some CDNs are IP/ASN-sensitive).
    const verified: Stream[] = [];
    await Promise.all(
      streams.map(async (stream) => {
        try {
          const res = await providerContext.axios.get(stream.link, {
            headers: stream.headers,
            timeout: 8000,
            signal,
          });
          const text =
            typeof res.data === "string" ? res.data : JSON.stringify(res.data);
          if (text.trimStart().startsWith("#EXTM3U")) {
            verified.push(stream);
          }
        } catch {
          verified.push(stream);
        }
      })
    );
    const order = new Map(streams.map((s, i) => [s.link, i]));
    verified.sort(
      (a, b) => (order.get(a.link) ?? 0) - (order.get(b.link) ?? 0)
    );

    if (isDownload) {
      return verified.filter((stream) => !stream.drm);
    }
    return verified;
  } catch (err) {
    console.error("DeadToons getStream error:", err);
    return [];
  }
};
