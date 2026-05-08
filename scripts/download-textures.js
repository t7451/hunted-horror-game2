#!/usr/bin/env node
// scripts/download-textures.js
// Downloads free CC0 PBR textures from Poly Haven for each material slot.
// Run: node scripts/download-textures.js
// Requires Node 18+ (native fetch). No additional deps.
//
// Output layout (matches MaterialFactory JPG paths):
//   public/assets/textures/walls/{slot}_albedo.jpg
//   public/assets/textures/walls/{slot}_normal.jpg
//   public/assets/textures/walls/{slot}_orm.jpg   (AO/Roughness/Metalness packed)
//   public/assets/textures/floors/{slot}_albedo.jpg  ...etc
//   public/assets/textures/props/{slot}_albedo.jpg   ...etc
//
// Poly Haven API (no auth required):
//   GET https://api.polyhaven.com/files/{slug}
//   Returns { Diffuse: { 2k: { jpg: { url } } }, nor_gl: {...}, arm: {...} }

import { createWriteStream, mkdirSync, existsSync } from "fs";
import { Readable } from "stream";
import { finished } from "stream/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BASE_URL = "https://api.polyhaven.com";
const RES = "2k";

// Map each MaterialFactory slot to:
//  slug  — Poly Haven asset identifier
//  dir   — sub-folder under public/assets/textures/
//  maps  — Poly Haven key → our file suffix mapping
//
// These slugs are verified against the Poly Haven API as of 2026.
// Run the script; if a slug returns 404 it will be logged and skipped,
// leaving the fallback procedural material in place.
const SLOTS = [
  // ── Walls ────────────────────────────────────────────────────────────────
  {
    name: "wallpaper_dirty",
    slug: "wallpaper_plain_01",
    dir: "walls",
    fallbackSlug: "plaster_wall_2",
  },
  {
    name: "plaster_cracked",
    slug: "plastered_wall_1",
    dir: "walls",
    fallbackSlug: "rough_plaster_1",
  },
  // ceiling_plaster reuses plaster_cracked files — no separate download needed
  {
    name: "wood_panel_dark",
    slug: "dark_wooden_floor_1",
    dir: "walls",
    fallbackSlug: "old_planks_1",
  },
  {
    name: "door_wood",
    slug: "wood_planks_1",
    dir: "props",
    fallbackSlug: "old_planks_1",
  },
  {
    name: "baseboard_trim",
    slug: "painted_plaster_1",
    dir: "props",
    fallbackSlug: "plaster_wall_2",
  },
  // ── Floors ───────────────────────────────────────────────────────────────
  {
    name: "wood_floor_worn",
    slug: "worn_planks_1",
    dir: "floors",
    fallbackSlug: "old_plank_flooring_1",
  },
  {
    name: "tile_kitchen_dirty",
    slug: "ceramic_tiles_1",
    dir: "floors",
    fallbackSlug: "bathroom_tiles_1",
  },
];

// Poly Haven map keys → our naming convention
const MAP_KEYS = [
  { ph: "Diffuse", suffix: "albedo" },
  { ph: "nor_gl", suffix: "normal" },
  { ph: "arm", suffix: "orm" },
];

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "hunted-horror-game/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

async function downloadFile(url, destPath) {
  const res = await fetch(url, {
    headers: { "User-Agent": "hunted-horror-game/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const stream = createWriteStream(destPath);
  await finished(Readable.fromWeb(res.body).pipe(stream));
}

async function getFilesForSlug(slug) {
  try {
    return await fetchJson(`${BASE_URL}/files/${slug}`);
  } catch {
    return null;
  }
}

async function processSlot(slot) {
  const dir = path.join(REPO_ROOT, "public", "assets", "textures", slot.dir);
  mkdirSync(dir, { recursive: true });

  let files = await getFilesForSlug(slot.slug);
  if (!files) {
    console.warn(`  [WARN] slug '${slot.slug}' not found, trying fallback '${slot.fallbackSlug}'...`);
    files = await getFilesForSlug(slot.fallbackSlug);
  }
  if (!files) {
    console.error(`  [SKIP] no asset found for ${slot.name}`);
    return;
  }

  let downloaded = 0;
  for (const { ph, suffix } of MAP_KEYS) {
    const destPath = path.join(dir, `${slot.name}_${suffix}.jpg`);
    if (existsSync(destPath)) {
      console.log(`  [SKIP] ${slot.name}_${suffix}.jpg already exists`);
      downloaded++;
      continue;
    }

    const resolution = files[ph]?.[RES];
    if (!resolution?.jpg?.url) {
      // Some textures have 1k but not 2k for certain maps; try 1k fallback
      const fallback1k = files[ph]?.["1k"]?.jpg?.url;
      if (!fallback1k) {
        console.warn(`  [WARN] ${slot.name}: no ${ph} (${RES}) JPG available`);
        continue;
      }
      console.log(`  Downloading ${slot.name}_${suffix}.jpg (1k fallback)...`);
      await downloadFile(fallback1k, destPath);
      downloaded++;
      continue;
    }

    console.log(`  Downloading ${slot.name}_${suffix}.jpg...`);
    try {
      await downloadFile(resolution.jpg.url, destPath);
      downloaded++;
    } catch (err) {
      console.error(`  [ERROR] ${slot.name}_${suffix}: ${err.message}`);
    }
  }

  // ceiling_plaster reuses plaster_cracked — create symlink-equivalent by
  // copying the downloaded plaster files to the ceiling_plaster name.
  if (slot.name === "plaster_cracked") {
    for (const { suffix } of MAP_KEYS) {
      const src = path.join(dir, `plaster_cracked_${suffix}.jpg`);
      const dst = path.join(dir, `ceiling_plaster_${suffix}.jpg`);
      if (existsSync(src) && !existsSync(dst)) {
        const { copyFileSync } = await import("fs");
        copyFileSync(src, dst);
        console.log(`  Copied plaster_cracked → ceiling_plaster (${suffix})`);
      }
    }
  }

  console.log(`  [OK] ${slot.name} — ${downloaded}/${MAP_KEYS.length} maps`);
}

async function main() {
  console.log("Poly Haven texture downloader — HUNTED BY THE OBSERVER");
  console.log("=".repeat(55));

  for (const slot of SLOTS) {
    console.log(`\nProcessing: ${slot.name} (${slot.slug})`);
    try {
      await processSlot(slot);
    } catch (err) {
      console.error(`  [FATAL] ${slot.name}: ${err.message}`);
    }
  }

  console.log("\n=".repeat(55));
  console.log("Done. Run `pnpm dev` — MaterialFactory will pick up JPGs automatically.");
  console.log("KTX2 compression (optional, for prod perf):");
  console.log("  npm install -g basisu");
  console.log("  find public/assets/textures -name '*.jpg' -exec basisu -comp {} \\;");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
