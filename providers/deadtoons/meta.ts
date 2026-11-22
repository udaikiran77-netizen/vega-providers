import { Info, Link, ProviderContext } from "../types";

// Detail data comes from the site's own API:
//   GET /posts/<postSlug>   -> post detail; series posts embed a `season`
//                              object, movie posts embed the `anime` object
//   GET /anime/<animeSlug>  -> show/movie detail (overview, poster,
//                              rating, and watch_servers for movies)
// A series post covers ONE season; the post's other seasons are separate
// posts, listed in `other_seasons`, and are exposed as dynamic episode
// lists (episodes.ts) keyed by their own post slug.
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
  path: string
): Promise<any> {
  const res = await providerContext.axios.get(`${API_BASE}${path}`, {
    headers: siteHeaders(providerContext),
    timeout: 15000,
  });
  return res.data;
}

function parsePostSlug(link: string): string {
  try {
    const payload = JSON.parse(link);
    if (payload.postSlug) return String(payload.postSlug);
    if (payload.slug) return String(payload.slug);
  } catch {}
  const match = link.match(/\/posts\/([^/?#]+)/);
  if (match) return decodeURIComponent(match[1]);
  return link.trim();
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
  const postSlug = parsePostSlug(link);
  const post = await apiGet(
    providerContext,
    `/posts/${encodeURIComponent(postSlug)}`
  );
  const animeSlug = String(post?.anime_slug || "");
  const animeName = post?.anime_name || post?.title || "";

  // The embedded anime object is present on movie posts; series posts
  // need one extra call for overview/poster/rating.
  let anime = post?.anime || null;
  if (!anime && animeSlug) {
    try {
      anime = await apiGet(
        providerContext,
        `/anime/${encodeURIComponent(animeSlug)}`
      );
    } catch {}
  }

  const tags: string[] = (post?.genres || anime?.genres || [])
    .map((genre: any) => (typeof genre === "string" ? genre : genre?.name))
    .filter(Boolean);
  const rating = cleanRating(anime?.rating);
  const image =
    anime?.backdrop?.high ||
    post?.backdrop_img?.high ||
    anime?.backdrop?.mid ||
    post?.backdrop_img?.mid ||
    "";
  const poster =
    post?.season?.poster?.mid || anime?.poster?.mid || post?.backdrop_img?.mid || "";

  const linkList: Link[] = [];

  if (post?.season) {
    // Series: this post's season first, then the other seasons' posts.
    const seasonNumber = post.season.season_number;
    linkList.push({
      title: `Season ${seasonNumber}`,
      episodesLink: JSON.stringify({ postSlug }),
    });
    const others = (post.other_seasons || [])
      .filter((s: any) => s?.slug && s.slug !== postSlug)
      .sort((a: any, b: any) => (a.season_number || 0) - (b.season_number || 0));
    for (const other of others) {
      linkList.push({
        title: `Season ${other.season_number}`,
        episodesLink: JSON.stringify({ postSlug: other.slug }),
      });
    }
    return {
      title: animeName,
      synopsis: post.season.overview || anime?.overview || "",
      image,
      poster,
      imdbId: "",
      type: "series",
      tags,
      rating,
      linkList,
    };
  }

  // Movie post: a single direct link that stream.ts resolves through the
  // anime's watch_servers.
  linkList.push({
    title: "Movie",
    directLinks: [
      {
        title: animeName || post?.title || "Movie",
        link: JSON.stringify({ animeSlug, type: "movie" }),
        type: "movie",
      },
    ],
  });
  return {
    title: animeName || post?.title || "",
    synopsis: anime?.overview || "",
    image,
    poster: anime?.poster?.mid || poster,
    imdbId: "",
    type: "movie",
    tags,
    rating,
    linkList,
  };
};
