#!/usr/bin/env node
// scripts/download-audio.js
// Downloads 15 CC0 audio assets from freesound.org previews (public, no auth needed).
// Previews are 128kbps MP3 — sufficient quality for a browser horror game.
// Run: node scripts/download-audio.js

import { createWriteStream, mkdirSync, existsSync } from "fs";
import { Readable } from "stream";
import { finished } from "stream/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "public", "audio");

// Freesound HQ preview URL: https://cdn.freesound.org/previews/{floor(id/1000)}/{id}_hq.mp3
function previewUrl(id) {
  const prefix = Math.floor(id / 1000);
  return `https://cdn.freesound.org/previews/${prefix}/${id}_hq.mp3`;
}

// All CC0 verified. IDs sourced May 2026.
const SOUNDS = [
  { file: "ambient_loop.mp3",       id: 567220, desc: "Drone Loop (Fixed) — dark horror drone" },
  { file: "breath_panic.mp3",       id: 554307, desc: "Scared Male Heavy Breathing" },
  { file: "heartbeat_loop.mp3",     id: 332810, desc: "heartbeat-150bpm (MATLAB synth)" },
  { file: "footstep_wood_1.mp3",    id: 502507, desc: "Creaking Wood 4 Steps" },
  { file: "footstep_wood_2.mp3",    id: 506660, desc: "Wood Creak Single V5" },
  { file: "footstep_wood_3.mp3",    id: 421150, desc: "Footstep_Wood_Heel_1" },
  { file: "footstep_wood_4.mp3",    id:  51149, desc: "Footsteps Wooden Stairs Squeaking" },
  { file: "key_pickup.mp3",         id: 248037, desc: "Pick Up Keys 1" },
  { file: "door_creak.mp3",         id: 393800, desc: "Creaky door open/close — horror tags" },
  { file: "observer_moan_1.mp3",    id: 473525, desc: "groan — haunting phantom moan" },
  { file: "observer_moan_2.mp3",    id: 401976, desc: "monster active 5 — creature growl" },
  { file: "observer_breathing.mp3", id: 457046, desc: "Horror Pulsating Drone Loop" },
  { file: "observer_stalk.mp3",     id: 223447, desc: "mysterious synth drone loop" },
  { file: "jump_scare_sting.mp3",   id: 408973, desc: "Jump scare sounds — Psycho stab (5.8K DL)" },
  { file: "static_burst.mp3",       id: 165058, desc: "White noise — for static burst" },
];

async function download(url, destPath, desc) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "hunted-horror-game/1.0 (audio asset download)",
      "Accept": "audio/mpeg,audio/*,*/*",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const stream = createWriteStream(destPath);
  await finished(Readable.fromWeb(res.body).pipe(stream));
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log("HUNTED audio downloader — freesound CC0 previews");
  console.log("=".repeat(52));
  console.log(`Output: ${OUT_DIR}\n`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const sound of SOUNDS) {
    const dest = path.join(OUT_DIR, sound.file);

    if (existsSync(dest)) {
      console.log(`  [SKIP] ${sound.file} (exists)`);
      skipped++;
      continue;
    }

    const url = previewUrl(sound.id);
    process.stdout.write(`  Downloading ${sound.file} (ID ${sound.id})... `);

    try {
      await download(url, dest, sound.desc);
      console.log("OK");
      ok++;
    } catch (err) {
      console.log(`FAIL — ${err.message}`);
      // Try alternate URL format for older IDs (some use /data/previews/ instead of CDN)
      const altUrl = `https://freesound.org/data/previews/${Math.floor(sound.id / 1000)}/${sound.id}_hq.mp3`;
      process.stdout.write(`    Retrying alt URL... `);
      try {
        await download(altUrl, dest, sound.desc);
        console.log("OK");
        ok++;
      } catch (err2) {
        console.log(`FAIL — ${err2.message}`);
        console.log(`    Manual: https://freesound.org/s/${sound.id}/ → "${sound.desc}"`);
        failed++;
      }
    }
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`Done: ${ok} downloaded, ${skipped} skipped, ${failed} failed`);
  if (failed > 0) {
    console.log(`\nFor failed files: log in at freesound.org and download manually.`);
    console.log(`Place in public/audio/ with the filename shown above.`);
    console.log(`The game plays without missing files (falls back to synthesis).`);
  }
  console.log(`\nAudioWorld will pick up all .mp3 files automatically on next pnpm dev.`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
