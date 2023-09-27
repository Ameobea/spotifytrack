# Spotifytrack

**Spotifytrack** is a web application a record of your listening habits on Spotify, allowing you to see how your preferences change over time and remember when you discovered your favorite tracks and artists.

It also includes some other Spotify-related tools like the [Artist Averager]([https://TODO_ADD_LINK_HERE](https://spotifytrack.net/artist-averager.html)).

Try it yourself: <https://spotifytrack.net>

![A screenshot of Spotifytrack showing the homepage for a user with a timeline showing recently discovered tracks and artists](https://i.ameo.link/98s.png)

## Directories

 * `frontend` contains the entire web UI for Spotifytrack.  It is built with TypeScript + React.
 * `backend` contains the backend API server that furnishes all of the data for the web frontend, handles OAuth, deals with caching, etc.
 * `research` contains Python notebooks used to generate, process, and analyze artist relationship data in order to generate artist embeddings for the artist averager.

## Building + Developing

Almost all tasks involved with building or running the code can be found in `Justfile`s throughout the project.  They can be run using the [just command runner](https://github.com/casey/just).

![A screenshot of Spotifytrack showing the artist relationship graph, an interactive visualization of the relationship between a user's top artists](https://ameo.link/u/98t.png)
