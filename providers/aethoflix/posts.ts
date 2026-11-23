import { Post, ProviderContext } from "../types";

// AethoFlix (aethoflix.live) is a React frontend over the TMDB API - the
// same API its own bundle calls:
//   base  https://api.themoviedb.org/3  (fallback https://api.tmdb.org/3)
//   every request carries ?api_key=<the site's public frontend key>
//   &language=en-US, exactly as the site's own URL builder does.
// Catalog rows are TMDB paths ("/trending/all/week", "/movie/popular",
// "/discover/movie?with_genres=28", ...); search is "/search/multi".
// IDs are TMDB ids; the media type travels with each post link.
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

// One TMDB GET with the site's primary -> fallback host behaviour.
export async function tmdbGet(
  providerContext: ProviderContext,
  path: string,
  params: Record<string, string | number> = {},
  signal?: AbortSignal
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
        { headers: siteHeaders(providerContext), signal, timeout: 15000 }
      );
      return res.data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function inferType(filter: string, item: any): "movie" | "series" | null {
  const mediaType = item?.media_type;
  if (mediaType === "movie") return "movie";
  if (mediaType === "tv") return "series";
  if (filter.includes("/movie") || filter.includes("/discover/movie")) {
    return "movie";
  }
  if (filter.includes("/tv") || filter.includes("/discover/tv")) {
    return "series";
  }
  return null;
}

function mapPost(filter: string, item: any): Post | null {
  if (!item?.id) return null;
  const type = inferType(filter, item);
  if (!type) return null; // skips people and unknown rows in /trending/all
  const title = item.title || item.name || "";
  if (!title) return null;
  const image = item.poster_path
    ? `${IMG}/w500${item.poster_path}`
    : item.backdrop_path
      ? `${IMG}/w780${item.backdrop_path}`
      : "";
  const year = String(item.release_date || item.first_air_date || "").slice(
    0,
    4
  );
  return {
    title,
    link: JSON.stringify({ tmdbId: item.id, type }),
    image,
    tag: type === "movie" ? `Movie${year ? ` • ${year}` : ""}` : "Series",
  };
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
    const path = filter && filter.startsWith("/") ? filter : "/trending/all/week";
    // Filters may already carry a query string (discover rows); page is
    // added as a param either way.
    const data = await tmdbGet(providerContext, path, { page: page || 1 }, signal);
    const items = Array.isArray(data?.results) ? data.results : [];
    return items
      .map((item: any) => mapPost(path, item))
      .filter((post: Post | null): post is Post => post !== null);
  } catch (err) {
    console.error("AethoFlix getPosts error:", err);
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
    // The site's search page calls /search/multi with include_adult=false.
    const data = await tmdbGet(
      providerContext,
      "/search/multi",
      { query: searchQuery, include_adult: "false", page: page || 1 },
      signal
    );
    const items = Array.isArray(data?.results) ? data.results : [];
    return items
      .map((item: any) => mapPost("/search/multi", item))
      .filter((post: Post | null): post is Post => post !== null);
  } catch (err) {
    console.error("AethoFlix getSearchPosts error:", err);
    return [];
  }
};
