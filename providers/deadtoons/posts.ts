import { Post, ProviderContext } from "../types";

// DeadToons (deadtoons.sbs) and its sister site AniDisk (anidisk.org) are
// Next.js frontends over a shared JSON API - the same one their own code
// calls: https://api.deadbase.host/api/v1/public
//   GET /posts?<filters>&page=N   -> { data: [...], page, limit, count }
//   GET /posts/search?q=<query>   -> [ ... ] (small unpaginated list)
// A "post" is one release: a single season of a show, or a movie. The
// post slug is the id every later step (meta/episodes) consumes.
const API_BASE = "https://api.deadbase.host/api/v1/public";
const SITE_ORIGIN = "https://deadtoons.sbs";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function siteHeaders(providerContext: ProviderContext) {
  return {
    "User-Agent": UA,
    Referer: `${SITE_ORIGIN}/`,
    ...(providerContext.commonHeaders || {}),
  };
}

async function apiGet(
  providerContext: ProviderContext,
  path: string,
  signal?: AbortSignal
): Promise<any> {
  const res = await providerContext.axios.get(`${API_BASE}${path}`, {
    headers: siteHeaders(providerContext),
    signal,
    timeout: 15000,
  });
  return res.data;
}

function mapPost(item: any): Post | null {
  if (!item?.slug || !item?.title) return null;
  const image =
    item.backdrop_img?.mid || item.backdrop_img?.low || item.poster?.mid || "";
  let tag: string | undefined;
  if (item.type === "movie") tag = "Movie";
  else if (item.season_number) tag = `Season ${item.season_number}`;
  return {
    title: item.title,
    link: JSON.stringify({ postSlug: item.slug }),
    image,
    tag,
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
    const cleanFilter = String(filter || "").replace(/^[?&]+/, "");
    const query = cleanFilter
      ? `${cleanFilter}&page=${page || 1}`
      : `page=${page || 1}`;
    const data = await apiGet(providerContext, `/posts?${query}`, signal);
    const items = Array.isArray(data?.data) ? data.data : [];
    return items
      .map(mapPost)
      .filter((post: Post | null): post is Post => post !== null);
  } catch (err) {
    console.error("DeadToons getPosts error:", err);
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
    // The site's search endpoint returns one small list and ignores
    // pagination - returning it again on page 2+ would duplicate posts.
    if (page && page > 1) return [];
    const data = await apiGet(
      providerContext,
      `/posts/search?q=${encodeURIComponent(searchQuery)}`,
      signal
    );
    const items = Array.isArray(data) ? data : data?.data || [];
    return items
      .map(mapPost)
      .filter((post: Post | null): post is Post => post !== null);
  } catch (err) {
    console.error("DeadToons getSearchPosts error:", err);
    return [];
  }
};
