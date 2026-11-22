import { Info, Link, ProviderContext } from "../types";

// Detail data comes from the site's own API:
//   GET /api/tmdb/movie/<tmdbId>
//   GET /api/tmdb/tv/<tmdbId>     (includes seasons, cast, external_ids)
const API_BASES = ["https://api.thugtv.online/api", "https://thugtv.st/api"];
const TMDB_IMAGE_W500 = "https://image.tmdb.org/t/p/w500";
const TMDB_IMAGE_ORIGINAL = "https://image.tmdb.org/t/p/original";
const SITE_ORIGIN = "https://thugtv.st";

function thugHeaders(providerContext: ProviderContext) {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Referer: `${SITE_ORIGIN}/`,
    Origin: SITE_ORIGIN,
    ...(providerContext.commonHeaders || {}),
  };
}

async function apiGet(
  providerContext: ProviderContext,
  path: string
): Promise<any> {
  let lastErr: any = null;
  for (const base of API_BASES) {
    try {
      const res = await providerContext.axios.get(`${base}/${path}`, {
        headers: thugHeaders(providerContext),
        timeout: 12000,
      });
      return res.data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("ThugTV API unreachable");
}

function parseLink(link: string): { tmdbId: string; type: string } {
  try {
    const payload = JSON.parse(link);
    return {
      tmdbId: String(payload.tmdbId ?? payload.id ?? ""),
      type:
        payload.type === "series" || payload.type === "tv"
          ? "series"
          : "movie",
    };
  } catch {
    const idMatch = link.match(/(\d{2,})/);
    return {
      tmdbId: idMatch ? idMatch[1] : "",
      type:
        link.includes("/tv") || link.includes("/series") ? "series" : "movie",
    };
  }
}

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const { tmdbId, type } = parseLink(link);
  const tmdbType = type === "series" ? "tv" : "movie";
  const data = (await apiGet(providerContext, `tmdb/${tmdbType}/${tmdbId}`)) || {};

  const title = data.title || data.name || "";
  const year = (data.release_date || data.first_air_date || "").slice(0, 4);
  const imdbId = data.imdb_id || data.external_ids?.imdb_id || "";
  const castSource = Array.isArray(data.cast)
    ? data.cast
    : data.credits?.cast || [];
  const cast: string[] = castSource
    .slice(0, 10)
    .map((person: any) => person?.name)
    .filter(Boolean);
  const tags: string[] = (data.genres || [])
    .map((genre: any) => genre?.name)
    .filter(Boolean);
  const rating = data.vote_average
    ? Number(data.vote_average).toFixed(1)
    : undefined;

  const basePayload = {
    tmdbId: String(tmdbId),
    imdbId,
    title,
    year,
  };

  const linkList: Link[] = [];
  if (type === "series") {
    const seasons = (data.seasons || [])
      .filter((season: any) => season?.season_number > 0)
      .sort((a: any, b: any) => a.season_number - b.season_number);
    for (const season of seasons) {
      linkList.push({
        title: `Season ${season.season_number}`,
        episodesLink: JSON.stringify({
          ...basePayload,
          type: "series",
          season: season.season_number,
        }),
      });
    }
  } else {
    linkList.push({
      title: "Movie",
      directLinks: [
        {
          title: title || "Movie",
          link: JSON.stringify({ ...basePayload, type: "movie" }),
          type: "movie",
        },
      ],
    });
  }

  return {
    title,
    synopsis: data.overview || "",
    image: data.backdrop_path
      ? `${TMDB_IMAGE_ORIGINAL}${data.backdrop_path}`
      : data.poster_path
        ? `${TMDB_IMAGE_W500}${data.poster_path}`
        : "",
    poster: data.poster_path ? `${TMDB_IMAGE_W500}${data.poster_path}` : "",
    imdbId,
    tmdbId: String(tmdbId),
    type,
    tags,
    cast,
    rating,
    linkList,
  };
};
