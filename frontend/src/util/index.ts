export const getProxiedImageURL = (size: number, url: string) =>
  `https://spotifytrack-image-resizer-mi7imxlw6a-uw.a.run.app/insecure/fill/${size}/${size}/sm/0/${btoa(
    url
  )}.jpg`;
