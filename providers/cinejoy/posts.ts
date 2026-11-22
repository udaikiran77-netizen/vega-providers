import { Post, ProviderContext } from "../types";

const TMDB_API = "https://db.wecollege.net/3";
const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
const CINEJOY_ORIGIN = "https://cinejoy.pk";

function cinejoyHeaders(providerContext: ProviderContext) {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Referer: `${CINEJOY_ORIGIN}/`,
    Origin: CINEJOY_ORIGIN,
    ...(providerContext.commonHeaders || {}),
  };
}

function buildListUrl(filter: string, page: number): string {
  if (filter.startsWith("trending/")) {
    return `${TMDB_API}/${filter}/week?page=${page}`;
  }
  const joiner = filter.includes("?") ? "&" : "?";
  const sort = filter.startsWith("discover/") ? "&sort_by=popularity.desc" : "";
  return `${TMDB_API}/${filter}${joiner}page=${page}${sort}`;
}

function mapResults(results: any[], forcedType?: string): Post[] {
  const posts: Post[] = [];
  for (const item of results || []) {
    const mediaType = forcedType || item?.media_type;
    const type =
      mediaType === "tv" || mediaType === "series" ? "series" : "movie";
    if (mediaType && mediaType !== "movie" && mediaType !== "tv") continue;
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
    const url = buildListUrl(filter, page || 1);
    const res = await providerContext.axios.get(url, {
      headers: cinejoyHeaders(providerContext),
      signal,
      timeout: 10000,
    });
    const forcedType = filter.includes("/tv") || filter.includes("tv/")
      ? "tv"
      : filter.includes("/movie") || filter.includes("movie/")
        ? "movie"
        : undefined;
    return mapResults(res.data?.results || [], forcedType);
  } catch (err) {
    console.error("Cinejoy getPosts error:", err);
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
    const url = `${TMDB_API}/search/multi?query=${encodeURIComponent(
      searchQuery
    )}&page=${page || 1}&include_adult=false`;
    const res = await providerContext.axios.get(url, {
      headers: cinejoyHeaders(providerContext),
      signal,
      timeout: 10000,
    });
    return mapResults(res.data?.results || []);
  } catch (err) {
    console.error("Cinejoy getSearchPosts error:", err);
    return [];
  }
};
