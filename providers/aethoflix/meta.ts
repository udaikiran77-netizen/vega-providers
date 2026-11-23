import { Info, Link, ProviderContext } from "../types";

// Detail data comes from the same TMDB API the site itself uses:
//   GET /movie/<tmdbId>  -> movie detail (includes imdb_id)
//   GET /tv/<tmdbId>     -> series detail with the season list; episodes
//                           are dynamic, one extra call per season
//                           (episodes.ts), exactly like the site's watch
//                           page flow.
const TMDB_BASES = ["https://api.themoviedb.org/3", "https://api.tmdb.org/3"];
const TMDB_KEY = "fca1c3fa675f74cf4aa8d24b72dd4807";
const IMG = "https://image.tmdb.org/t/p";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function siteHeaders(providerContext: ProviderContext) {
  return {
    ...(providerContext.commonHeaders || {}),
    "User-Agent": UA,
  };
}

async function tmdbGet(
  providerContext: ProviderContext,
  path: string,
  params: Record<string, string | number> = {}
): Promise<any> {
  const query = new URLSearchParams({
    api_key: TMDB_KEY,
    language: "en-US",
  });
  for (const [key, value] of Object.entries(params)) {
    query.set(key, String(value));
  }
  const glue = path.includes("?") ? "&" : "?";
  let lastError: any = null;
  for (const base of TMDB_BASES) {
    try {
      const res = await providerContext.axios.get(
        `${base}${path}${glue}${query.toString()}`,
        { headers: siteHeaders(providerContext), timeout: 15000 }
      );
      return res.data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

interface LinkPayload {
  tmdbId: number;
  type: "movie" | "series";
}

function parseLink(link: string): LinkPayload | null {
  try {
    const payload = JSON.parse(link);
    const tmdbId = Number(payload.tmdbId || payload.id);
    if (!tmdbId) return null;
    return {
      tmdbId,
      type: payload.type === "series" || payload.type === "tv" ? "series" : "movie",
    };
  } catch {}
  // Tolerate the site's own watch URLs: /watch/movie/<id>, /watch/tv/<id>
  const match = link.match(/\/(?:watch\/)?(movie|tv)\/(\d+)/);
  if (match) {
    return {
      tmdbId: Number(match[2]),
      type: match[1] === "tv" ? "series" : "movie",
    };
  }
  return null;
}

function cleanRating(raw: any): string | undefined {
  const value = parseFloat(String(raw ?? ""));
  return Number.isFinite(value) && value > 0 ? value.toFixed(1) : undefined;
}

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const payload = parseLink(link);
  if (!payload) {
    throw new Error("AethoFlix getMeta: unrecognized link");
  }
  const { tmdbId, type } = payload;

  if (type === "movie") {
    const data = await tmdbGet(providerContext, `/movie/${tmdbId}`);
    const title = data?.title || data?.name || "";
    const linkList: Link[] = [
      {
        title: "Movie",
        directLinks: [
          {
            title,
            link: JSON.stringify({ tmdbId, type: "movie" }),
            type: "movie",
          },
        ],
      },
    ];
    return {
      title,
      synopsis: data?.overview || "",
      image: data?.backdrop_path ? `${IMG}/w1280${data.backdrop_path}` : "",
      poster: data?.poster_path ? `${IMG}/w500${data.poster_path}` : "",
      imdbId: data?.imdb_id || "",
      tmdbId: String(tmdbId),
      type: "movie",
      tags: (data?.genres || []).map((g: any) => g?.name).filter(Boolean),
      rating: cleanRating(data?.vote_average),
      linkList,
    };
  }

  const data = await tmdbGet(providerContext, `/tv/${tmdbId}`, {
    append_to_response: "external_ids",
  });
  const title = data?.name || data?.title || "";
  const seasons = (data?.seasons || [])
    .filter((s: any) => s?.season_number != null && s.season_number >= 1)
    .sort((a: any, b: any) => a.season_number - b.season_number);
  const linkList: Link[] = seasons.map((season: any) => ({
    title: `Season ${season.season_number}`,
    episodesLink: JSON.stringify({ tmdbId, season: season.season_number }),
  }));
  return {
    title,
    synopsis: data?.overview || "",
    image: data?.backdrop_path ? `${IMG}/w1280${data.backdrop_path}` : "",
    poster: data?.poster_path ? `${IMG}/w500${data.poster_path}` : "",
    imdbId: data?.external_ids?.imdb_id || "",
    tmdbId: String(tmdbId),
    type: "series",
    tags: (data?.genres || []).map((g: any) => g?.name).filter(Boolean),
    rating: cleanRating(data?.vote_average),
    linkList,
  };
};
