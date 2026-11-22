// ThugTV (thugtv.online / thugtv.st) catalog.
// Filters are the site's own API collection paths (see posts.ts); only
// collections that exist on the site's API are listed here.
export const catalog = [
  { title: "Trending", filter: "tmdb/trending" },
  { title: "Trending Series", filter: "tmdb/trending-tv" },
  { title: "Popular Movies", filter: "tmdb/popular" },
  { title: "Popular Series", filter: "tmdb/popular-tv" },
  { title: "Top Rated Movies", filter: "tmdb/top-rated" },
  { title: "Anime", filter: "tmdb/anime" },
  { title: "K-Drama", filter: "tmdb/kdrama" },
];

export const genres = [
  { title: "Action", filter: "tmdb/action" },
  { title: "Horror", filter: "tmdb/horror" },
  { title: "Sci-Fi", filter: "tmdb/scifi" },
  { title: "Romance", filter: "tmdb/romance" },
  { title: "Crime", filter: "tmdb/crime" },
  { title: "Superhero", filter: "tmdb/superhero" },
];
