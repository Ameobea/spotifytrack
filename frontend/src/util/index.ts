export const getProxiedImageURL = (size: number, url: string) =>
  `https://spotifytrack.b-cdn.net/spotify_images/insecure/fill/${size}/${size}/sm/0/${btoa(
    url
  )}.jpg`;
