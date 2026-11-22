import { Post, ProviderContext } from "../types";

// ThugTV serves its catalog from its own JSON API (the same one the
// website's frontend uses): https://api.thugtv.online/api/tmdb/*
// The same backend is also reachable via the site's own origin
// (https://thugtv.st/api), which is used as a fallback.
const API_BASES = ["https://api.thugtv.online/api", "https://thugtv.st/api"];
const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
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
  path: string,
  signal?: AbortSignal
): Promise<any> {
  let lastErr: any = null;
  for (const base of API_BASES) {
    try {
      const res = await providerContext.axios.get(`${base}/${path}`, {
        headers: thugHeaders(providerContext),
        signal,
        timeout: 12000,
      });
      return res.data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("ThugTV API unreachable");
}

// Collections whose items are all of one media type on the site's API.
// Anything else (e.g. "tmdb/trending", search) carries a per-item
// media_type field instead.
const FORCED_TYPE: Record<string, string> = {
  "tmdb/trending-tv": "tv",
  "tmdb/popular": "movie",
  "tmdb/popular-tv": "tv",
  "tmdb/top-rated": "movie",
  "tmdb/anime": "tv",
  "tmdb/kdrama": "tv",
  "tmdb/action": "movie",
  "tmdb/horror": "movie",
  "tmdb/scifi": "movie",
  "tmdb/romance": "movie",
  "tmdb/crime": "movie",
  "tmdb/superhero": "movie",
};

function mapResults(results: any[], forcedType?: string): Post[] {
  const posts: Post[] = [];
  for (const item of results || []) {
    const mediaType = forcedType || item?.media_type;
    if (mediaType && mediaType !== "movie" && mediaType !== "tv") continue;
    const type = mediaType === "tv" ? "series" : "movie";
    const tmdbId = item?.id;
    const title = item?.title || item?.name;
    if (!tmdbId || !title || !item?.poster_path) continue;
    const year = (item?.release_date || item?.first_air_date || "").slice(0, 4);
    posts.push({
      title,
      link: JSON.stringify({ tmdbId: String(tmdbId), type }),
      image: `${TMDB_IMAGE}${item.poster_path}`,
      tag: year || undefined,
    });
  }
  return posts;
}

function asArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

export const getPosts = async function ({
  filter,
  page,
  signal,
  providerContext,
}: {
  filter: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  try {
    const cleanFilter = String(filter || "tmdb/trending").replace(/^\/+/, "");
    const data = await apiGet(
      providerContext,
      `${cleanFilter}?page=${page || 1}`,
      signal
    );
    return mapResults(asArray(data), FORCED_TYPE[cleanFilter]);
  } catch (err) {
    console.error("ThugTV getPosts error:", err);
    return [];
  }
};

export const getSearchPosts = async function ({
  searchQuery,
  page,
  signal,
  providerContext,
}: {
  searchQuery: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  try {
    const data = await apiGet(
      providerContext,
      `tmdb/search?q=${encodeURIComponent(searchQuery)}&page=${page || 1}`,
      signal
    );
    return mapResults(asArray(data));
  } catch (err) {
    console.error("ThugTV getSearchPosts error:", err);
    return [];
  }
};
