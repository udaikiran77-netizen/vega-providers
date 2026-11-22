import { EpisodeLink, ProviderContext } from "../types";

// Episode lists come from the site's own API:
//   GET /api/tmdb/tv/<tmdbId>/season/<seasonNumber>
const API_BASES = ["https://api.thugtv.online/api", "https://thugtv.st/api"];
const TMDB_IMAGE_W500 = "https://image.tmdb.org/t/p/w500";
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

    let data: any = null;
    let lastErr: any = null;
    for (const base of API_BASES) {
      try {
        const res = await providerContext.axios.get(
          `${base}/tmdb/tv/${tmdbId}/season/${season}`,
          { headers: thugHeaders(providerContext), timeout: 12000 }
        );
        data = res.data;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!data) throw lastErr || new Error("ThugTV API unreachable");

    const episodes = data?.episodes || [];
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
    console.error("ThugTV getEpisodes error:", err);
    return [];
  }
};
