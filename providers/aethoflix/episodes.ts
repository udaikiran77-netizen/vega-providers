import { EpisodeLink, ProviderContext } from "../types";

// Episode lists come from the same TMDB API the site itself uses:
//   GET /tv/<tmdbId>/season/<n> -> { episodes: [{ episode_number,
//                                    name, still_path, overview }] }
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
  path: string
): Promise<any> {
  const query = `api_key=${TMDB_KEY}&language=en-US`;
  const glue = path.includes("?") ? "&" : "?";
  let lastError: any = null;
  for (const base of TMDB_BASES) {
    try {
      const res = await providerContext.axios.get(`${base}${path}${glue}${query}`, {
        headers: siteHeaders(providerContext),
        timeout: 15000,
      });
      return res.data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
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
      payload = {};
    }
    const tmdbId = Number(payload.tmdbId || payload.id);
    const season = Number(payload.season ?? 1);
    if (!tmdbId) return [];

    const data = await tmdbGet(
      providerContext,
      `/tv/${tmdbId}/season/${season}`
    );
    const episodes = Array.isArray(data?.episodes) ? data.episodes : [];
    return episodes
      .filter((episode: any) => episode?.episode_number != null)
      .sort(
        (a: any, b: any) => (a.episode_number || 0) - (b.episode_number || 0)
      )
      .map((episode: any) => ({
        title: `Episode ${episode.episode_number}${episode.name ? `: ${episode.name}` : ""}`,
        link: JSON.stringify({
          tmdbId,
          type: "series",
          season,
          episode: episode.episode_number,
        }),
        image: episode.still_path
          ? `${IMG}/w500${episode.still_path}`
          : undefined,
      }));
  } catch (err) {
    console.error("AethoFlix getEpisodes error:", err);
    return [];
  }
};
