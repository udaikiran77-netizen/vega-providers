import { EpisodeLink, ProviderContext } from "../types";

const TMDB_API = "https://db.wecollege.net/3";
const TMDB_IMAGE_W500 = "https://image.tmdb.org/t/p/w500";
const CINEJOY_ORIGIN = "https://cinejoy.pk";

export const getEpisodes = async function ({
  url,
  providerContext,
}: {
  url: string;
  providerContext: ProviderContext;
}): Promise<EpisodeLink[]> {
  try {
    const payload = JSON.parse(url);
    const tmdbId = String(payload.tmdbId ?? "");
    const season = Number(payload.season || 1);
    if (!tmdbId) return [];

    const res = await providerContext.axios.get(
      `${TMDB_API}/tv/${tmdbId}/season/${season}`,
      {
        headers: {
          "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Referer: `${CINEJOY_ORIGIN}/`,
          Origin: CINEJOY_ORIGIN,
          ...(providerContext.commonHeaders || {}),
        },
        timeout: 10000,
      }
    );
    const episodes = res.data?.episodes || [];
    return episodes.map((episode: any) => ({
      title: `Episode ${episode.episode_number}${episode.name ? `: ${episode.name}` : ""}`,
      link: JSON.stringify({
        tmdbId,
        imdbId: payload.imdbId || "",
        title: payload.title || "",
        year: payload.year || "",
        type: "series",
        season,
        episode: episode.episode_number,
      }),
      description: episode.overview || undefined,
      image: episode.still_path
        ? `${TMDB_IMAGE_W500}${episode.still_path}`
        : undefined,
    }));
  } catch (err) {
    console.error("Cinejoy getEpisodes error:", err);
    return [];
  }
};
