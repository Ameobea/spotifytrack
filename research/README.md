# Research Notebooks

These notebooks are used to generate, process, and analyze artist relationship data in order to generate artist embeddings for the artist averager.

## Source Data

The Spotify API provides, for every artist, the set of up to ~10 other artists that are most related to that artist.  That functionality is documented in the official Spotify API docs: <https://developer.spotify.com/console/get-artist-related-artists/>

As part of the main Spotifytrack web application backend, I [implemented functionality](https://github.com/Ameobea/spotifytrack/blob/38a65c4e88dd83ccf6426dc7faa61d747401ab14/backend/src/routes/mod.rs#L1073) to crawl the related artists graph and collect the related artists for as many artists as possible.

## Artist Embedding Generation

The notebook [`spotify_related_artists_embedding`](./spotify_related_artists_embedding.ipynb) implements the main flow of ingesting raw artist relationship data dumped from the Spotifytrack Redis cache + MySQL databases along with mappings between internal Spotifytrack IDs and Spotify IDs and converting it into an [embedding](https://developers.google.com/machine-learning/crash-course/embeddings/video-lecture).

After pre-processing the raw data into Pandas dataframes and generating mappings back and forth between Spotifytrack and Spotify IDs, it creates a NetworkX network representing all artist relationships in the first 100k artists scraped (this turns out to cover the vast majority of artists on Spotify.  Although over a million were scraped in total, most of the remaining 900k+ tend to have extremely low or no playcounts).

Once the graph is generated, [`node2vec`](https://github.com/eliorc/node2vec), which uses [`word2vec`](https://www.tensorflow.org/tutorials/text/word2vec) internally, is used to generate an arbitrary-dimensional embedding for all of the artists.  This generates a vector, which can be thought of as a coordinate in n-dimensional space, for each artist with the goal of minimizing the space between related artists and maximizing the distance between unrelated ones.

The generated embeddings can then be dumped in word2vec format which is just the artist ID followed by its position vector.  This is then loaded by the Spotifytrack web application backend to serve the artist averager.

## Analysis

The [`standalone 8 dims loading + testing`](standalone%208%20dims%20loading%20+%20testing.ipynb) notebook contains code for loading one of the embeddings generated using the previous notebook and doing some experiments and analysis with it.

It also has some code for performing principal component analysis on the embedding, transforming it from n dimensions down to 3 dimensions to that it can be plotted on a 3D scatterplot.
