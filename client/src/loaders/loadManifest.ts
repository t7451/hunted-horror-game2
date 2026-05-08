import { AUDIO_MANIFEST, type SoundId } from "../audio/audio-manifest";

export type AssetEntry = {
  id: string;
  type: "audio" | "texture";
  url: string;
  weight: number;
};

const TEXTURE_SLUGS = [
  "wallpaper_dirty",
  "wood_floor_worn",
  "ceiling_plaster",
  "door_wood",
  "baseboard_trim",
];

export function buildLoadManifest(): AssetEntry[] {
  const entries: AssetEntry[] = [];

  for (const id of Object.keys(AUDIO_MANIFEST) as SoundId[]) {
    for (const url of AUDIO_MANIFEST[id].src) {
      entries.push({ id: `audio:${id}`, type: "audio", url, weight: 2 });
    }
  }

  for (const slug of TEXTURE_SLUGS) {
    entries.push({
      id: `texture:${slug}`,
      type: "texture",
      url: `/assets/textures/${slug}/${slug}.ktx2`,
      weight: 5,
    });
  }

  return entries;
}
