import { API_BASE_URL } from 'src/conf';
import { getSentry } from 'src/sentry';
import { delay } from 'src/util2';

export const getArtistDataByInternalIDs = (internalIDs: number[]): Promise<(string | null)[]> =>
  fetch(`${API_BASE_URL}/map_artist_data_by_internal_ids`, {
    method: 'POST',
    body: JSON.stringify(internalIDs),
  }).then(async (res) => {
    if (!res.ok) {
      throw await res.text();
    }

    return res.json();
  });

export const getArtistRelationshipsByInternalIDs = (internalIDs: number[]): Promise<ArrayBuffer> =>
  fetch(`${API_BASE_URL}/map_artist_relationships_by_internal_ids`, {
    method: 'POST',
    body: JSON.stringify(internalIDs),
  }).then(async (res) => {
    if (!res.ok) {
      throw await res.text();
    }

    return res.arrayBuffer();
  });

export const getArtistRelationshipsChunk = async (
  chunkIx: number,
  chunkSize: number
): Promise<ArrayBuffer> => {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(
        `${API_BASE_URL.replace(
          'spotifytrack.net',
          'spotifytrack.b-cdn.net'
        )}/map_artist_relationships_chunk?chunk_ix=${chunkIx}&chunk_size=${chunkSize}`
      ).then(async (res) => {
        if (!res.ok) {
          throw await res.text();
        }

        return res.arrayBuffer();
      });
      return res;
    } catch (err) {
      getSentry()?.captureException(err);
      console.error(`Failed to fetch artist relationships chunk ix=${i}`);
      await delay(1000);
    }
  }
  throw new Error('Failed to fetch artist relationships after many attempts');
};

export const fetchPackedArtistPositions = (): Promise<ArrayBuffer> =>
  fetch(
    `${API_BASE_URL.replace('spotifytrack.net', 'spotifytrack.b-cdn.net')}/packed_3d_artist_coords`
  ).then(async (res) => {
    if (!res.ok) {
      throw await res.text();
    }

    return res.arrayBuffer();
  });

export const getPreviewURLsByInternalID = (internalID: number): Promise<string[] | null> =>
  fetch(`${API_BASE_URL}/get_preview_urls_by_internal_id/${internalID}`).then(async (res) => {
    if (!res.ok) {
      throw await res.text();
    }

    return res.json();
  });

export const getAllTopArtistInternalIDsForUser = (userID: string): Promise<number[]> =>
  fetch(`${API_BASE_URL}/top_artists_internal_ids_for_user/${userID}`).then(async (res) => {
    if (!res.ok) {
      throw await res.text();
    }

    return res.json();
  });
