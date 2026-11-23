import { EpisodeLink, ProviderContext } from "../types";

// Episode lists come from the site's own API: a series post embeds its
// full season (including the released episodes) in the post detail:
//   GET /posts/<postSlug> -> { anime_slug, season: { season_number,
//                              episodes: [{ episode_number, ... }] } }
// Fallback for a bare anime/season reference:
//   GET /anime/<animeSlug>/season/<n> -> { episodes: [...] }
const API_BASE = "https://api.deadbase.host/api/v1/public";
const SITE_ORIGIN = "https://deadtoons.sbs";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function siteHeaders(providerContext: ProviderContext) {
  return {
    ...(providerContext.commonHeaders || {}),
    "User-Agent": UA,
    Referer: `${SITE_ORIGIN}/`,
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

export const getEpisodes = async function ({
  url,
  providerContext,
}: {
  url: string;
  providerContext: ProviderContext;
}): Promise<EpisodeLink[]> {
  try {
    let payload: any = {};
    try {
      payload = JSON.parse(url);
    } catch {
      payload = { postSlug: url };
    }

    let animeSlug = String(payload.animeSlug || "");
    let seasonNumber = Number(payload.season || 0);
    let episodes: any[] = [];

    if (payload.postSlug) {
      const post = await apiGet(
        providerContext,
        `/posts/${encodeURIComponent(String(payload.postSlug))}`
      );
      animeSlug = animeSlug || String(post?.anime_slug || "");
      seasonNumber = seasonNumber || Number(post?.season?.season_number || 1);
      episodes = post?.season?.episodes || [];
    }
    if (!episodes.length && animeSlug && seasonNumber) {
      const season = await apiGet(
        providerContext,
        `/anime/${encodeURIComponent(animeSlug)}/season/${seasonNumber}`
      );
      episodes = season?.episodes || [];
    }
    if (!animeSlug) return [];

    return episodes
      .filter((episode: any) => episode?.episode_number != null)
      .sort(
        (a: any, b: any) => (a.episode_number || 0) - (b.episode_number || 0)
      )
      .map((episode: any) => ({
        title: `Episode ${episode.episode_number}${episode.episode_name ? `: ${episode.episode_name}` : ""}`,
        link: JSON.stringify({
          animeSlug,
          type: "series",
          season: seasonNumber,
          episode: episode.episode_number,
        }),
        image: episode.img?.mid || episode.img?.low || undefined,
      }));
  } catch (err) {
    console.error("DeadToons getEpisodes error:", err);
    return [];
  }
};
