// DeadToons (deadtoons.sbs) catalog.
// Filters are query-string fragments for the site's own API
// (GET https://api.deadbase.host/api/v1/public/posts?<filter>&page=N),
// see posts.ts. Only filters verified against the live API are listed.
export const catalog = [
  { title: "Latest Posts", filter: "" },
  { title: "Popular", filter: "sort=popular" },
  { title: "Movies", filter: "type=movie" },
  { title: "Hindi Dubbed", filter: "language=hindi" },
  { title: "Completed", filter: "status=completed" },
  { title: "Eng Subbed", filter: "tag=eng-subbed" },
];

export const genres = [
  { title: "Action", filter: "genre=action" },
  { title: "Adventure", filter: "genre=adventure" },
  { title: "Animation", filter: "genre=animation" },
  { title: "Comedy", filter: "genre=comedy" },
  { title: "Drama", filter: "genre=drama" },
  { title: "Fantasy", filter: "genre=fantasy" },
  { title: "Horror", filter: "genre=horror" },
  { title: "Mystery", filter: "genre=mystery" },
  { title: "Romance", filter: "genre=romance" },
  { title: "Sci-Fi", filter: "genre=sci-fi" },
  { title: "Slice of Life", filter: "genre=slice-of-life" },
  { title: "Supernatural", filter: "genre=supernatural" },
];
