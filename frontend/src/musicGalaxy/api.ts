import { API_BASE_URL } from 'src/conf';

export const getArtistDataByInternalIDs = (internalIDs: number[]): Promise<(string | null)[]> =>
  fetch(`${API_BASE_URL}/map_artist_data_by_internal_ids`, {
    method: 'POST',
    body: JSON.stringify(internalIDs),
  }).then((res) => res.json());

export const getArtistRelationshipsByInternalIDs = (internalIDs: number[]): Promise<ArrayBuffer> =>
  fetch(`${API_BASE_URL}/map_artist_relationships_by_internal_ids`, {
    method: 'POST',
    body: JSON.stringify(internalIDs),
  }).then((res) => res.arrayBuffer());

export const fetchPackedArtistPositions = (): Promise<ArrayBuffer> =>
  fetch(`${API_BASE_URL}/packed_3d_artist_coords`).then((res) => res.arrayBuffer());

export const getPreviewURLsByInternalID = (internalID: number): Promise<string[] | null> =>
  fetch(`${API_BASE_URL}/get_preview_urls_by_internal_id/${internalID}`).then((res) => res.json());

export const getAllTopArtistInternalIDsForUser = (userID: string): Promise<number[]> =>
  fetch(`${API_BASE_URL}/top_artists_internal_ids_for_user/${userID}`).then((res) => res.json());
