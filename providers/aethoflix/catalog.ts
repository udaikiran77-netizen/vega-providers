// AethoFlix (aethoflix.live) catalog.
// The site is a TMDB frontend: its home/movies/series rows are TMDB API
// paths, and posts.ts passes these filters straight to that API (see
// posts.ts). Rows mirror the site's own sections.
export const catalog = [
  { title: "Trending Now", filter: "/trending/all/week" },
  { title: "Top 10 Today", filter: "/trending/all/day" },
  { title: "Trending Movies", filter: "/trending/movie/week" },
  { title: "Now Playing", filter: "/movie/now_playing" },
  { title: "Popular Movies", filter: "/movie/popular" },
  { title: "Top Rated Movies", filter: "/movie/top_rated" },
  { title: "Upcoming Movies", filter: "/movie/upcoming" },
  { title: "Trending Series", filter: "/trending/tv/week" },
  { title: "Popular Series", filter: "/tv/popular" },
  { title: "Top Rated Series", filter: "/tv/top_rated" },
  { title: "On The Air", filter: "/tv/on_the_air" },
];

export const genres = [
  { title: "Action", filter: "/discover/movie?with_genres=28&sort_by=popularity.desc&include_adult=false" },
  { title: "Adventure", filter: "/discover/movie?with_genres=12&sort_by=popularity.desc&include_adult=false" },
  { title: "Animation", filter: "/discover/movie?with_genres=16&sort_by=popularity.desc&include_adult=false" },
  { title: "Comedy", filter: "/discover/movie?with_genres=35&sort_by=popularity.desc&include_adult=false" },
  { title: "Crime", filter: "/discover/movie?with_genres=80&sort_by=popularity.desc&include_adult=false" },
  { title: "Drama", filter: "/discover/movie?with_genres=18&sort_by=popularity.desc&include_adult=false" },
  { title: "Horror", filter: "/discover/movie?with_genres=27&sort_by=popularity.desc&include_adult=false" },
  { title: "Mystery", filter: "/discover/movie?with_genres=9648&sort_by=popularity.desc&include_adult=false" },
  { title: "Romance", filter: "/discover/movie?with_genres=10749&sort_by=popularity.desc&include_adult=false" },
  { title: "Sci-Fi", filter: "/discover/movie?with_genres=878&sort_by=popularity.desc&include_adult=false" },
  { title: "Thriller", filter: "/discover/movie?with_genres=53&sort_by=popularity.desc&include_adult=false" },
];
