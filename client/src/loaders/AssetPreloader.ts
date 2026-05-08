import type { AssetEntry } from "./loadManifest";

export type PreloadProgress = {
  loaded: number;
  total: number;
  ratio: number;
  currentLabel: string;
};

const LABELS: Record<string, string> = {
  "audio:ambient_loop": "Listening at the door",
  "audio:heartbeat_loop": "Finding your pulse",
  "audio:observer_breathing": "He is breathing",
  "audio:observer_moan_1": "He is somewhere",
  "audio:observer_stalk": "He hears the floorboards",
  "texture:wallpaper_dirty": "Hanging wallpaper",
  "texture:wood_floor_worn": "Laying floorboards",
  "texture:ceiling_plaster": "Plastering the ceiling",
  "texture:door_wood": "Hanging doors",
  "texture:baseboard_trim": "Nailing baseboards",
};

function fallbackLabel(id: string): string {
  if (id.startsWith("audio:")) return "Tuning the silence";
  if (id.startsWith("texture:")) return "Painting the walls";
  return "Building the house";
}

const CONCURRENCY = 4;

/**
 * Fetch every entry in parallel (capped concurrency) so the HTTP cache is
 * warm by the time MaterialFactory and AudioWorld actually decode them.
 * Errors are swallowed: missing assets fall back to procedural at runtime.
 */
export async function preloadAssets(
  entries: AssetEntry[],
  onProgress: (p: PreloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  let totalWeight = 0;
  for (const e of entries) totalWeight += e.weight;
  let loadedWeight = 0;
  let cursor = 0;

  async function loadOne(entry: AssetEntry): Promise<void> {
    try {
      const r = await fetch(entry.url, { signal });
      await r.arrayBuffer();
    } catch {
      /* missing or aborted — runtime falls back to procedural */
    }
    loadedWeight += entry.weight;
    onProgress({
      loaded: loadedWeight,
      total: totalWeight,
      ratio: Math.min(1, loadedWeight / totalWeight),
      currentLabel: LABELS[entry.id] ?? fallbackLabel(entry.id),
    });
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(
      (async () => {
        while (cursor < entries.length) {
          if (signal?.aborted) return;
          const idx = cursor++;
          await loadOne(entries[idx]);
        }
      })()
    );
  }
  await Promise.all(workers);
  onProgress({
    loaded: totalWeight,
    total: totalWeight,
    ratio: 1,
    currentLabel: "Ready",
  });
}
