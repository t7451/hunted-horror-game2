#!/usr/bin/env node
// Fetch PBR texture sets from Poly Haven and encode to KTX2 for the game's
// MaterialFactory. Run from repo root: `node scripts/fetch-textures.mjs`.
//
// Requires: Node 20+ (built-in fetch), `basisu` on PATH.
//   brew: brew install basis_universal
//   src:  build from https://github.com/BinomialLLC/basis_universal
//         (no Debian/Ubuntu package — `apt install basisu` will 404).
//         See client/public/assets/textures/README.md for the no-sudo recipe.
//
// Poly Haven assets are CC0. The slugs below were chosen to match the
// MaterialFactory slot names; swap any of them by editing ASSETS and
// re-running. The script is idempotent — already-encoded .ktx2 files are
// skipped unless --force is passed.

import { spawnSync } from "node:child_process";
import { mkdir, writeFile, stat, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Vite root is `client/`, so the served publicDir is `client/public/`.
const OUT_ROOT = join(REPO_ROOT, "client/public/assets/textures");
const RES = "2k";
const FORCE = process.argv.includes("--force");

// Slug → output. Each slug maps to a Poly Haven asset id; output path is
// the prefix the MaterialFactory expects (it appends `_albedo.ktx2`,
// `_normal.ktx2`, `_orm.ktx2`).
//
// If a slug doesn't exist or doesn't ship an `arm` packed map, the script
// errors loudly with a hint. Browse https://polyhaven.com/textures to pick
// a replacement slug.
const ASSETS = [
  {
    slug: "decrepit_wallpaper",
    out: "walls/wallpaper_dirty_01_2k",
    label: "wallpaper",
  },
  {
    slug: "wood_floor_worn",
    out: "floors/wood_floor_worn_01_2k",
    label: "wood floor",
  },
  {
    slug: "painted_plaster_wall",
    out: "walls/plaster_cracked_01_2k",
    label: "plaster wall",
  },
  {
    slug: "rough_plaster_broken",
    out: "ceilings/ceiling_plaster_01_2k",
    label: "ceiling plaster",
  },
  {
    slug: "wood_planks_dirt",
    out: "doors/door_wood_01_2k",
    label: "door wood",
  },
  {
    slug: "painted_concrete",
    out: "trim/baseboard_painted_01_2k",
    label: "painted baseboard",
  },
];

// ── helpers ────────────────────────────────────────────────────────────────

function checkBasisu() {
  const r = spawnSync("basisu", ["-version"], { stdio: "pipe" });
  if (r.error || r.status !== 0) {
    console.error(
      "ERROR: `basisu` not found on PATH. Install it before running:\n" +
        "  macOS:       brew install basis_universal\n" +
        "  Linux:       build from source — basisu isn't in apt/dnf/etc.\n" +
        "               https://github.com/BinomialLLC/basis_universal\n" +
        "               (see client/public/assets/textures/README.md for a no-sudo recipe)"
    );
    process.exit(1);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

async function downloadTo(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
}

// Pick a JPG download URL out of Poly Haven's nested files response.
// Structure example:
//   { Diffuse: { "2k": { jpg: { url, size, md5 } } }, ... }
function pickJpg(node, mapKey) {
  const map = node[mapKey];
  if (!map) return null;
  const res = map[RES];
  if (!res) return null;
  return res.jpg?.url || null;
}

// basisu defaults: use UASTC for high-frequency data (normal, ARM) and
// ETC1S for albedo (smaller, fine for diffuse). `--mipmap` precomputes
// mip levels at encode time so the runtime loader doesn't allocate them.
function encodeKtx2(srcJpg, dstKtx2, mode) {
  const args = [
    "-ktx2",
    "-mipmap",
    mode === "uastc" ? "-uastc" : "-comp_level",
    mode === "uastc" ? "" : "2",
    "-output_file",
    dstKtx2,
    srcJpg,
  ].filter(Boolean);
  const r = spawnSync("basisu", args, { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`basisu failed for ${srcJpg} → ${dstKtx2}`);
  }
}

// ── main ───────────────────────────────────────────────────────────────────

async function processAsset({ slug, out, label }) {
  const outPrefix = join(OUT_ROOT, out);
  const targets = {
    albedo: `${outPrefix}_albedo.ktx2`,
    normal: `${outPrefix}_normal.ktx2`,
    orm: `${outPrefix}_orm.ktx2`,
  };

  if (
    !FORCE &&
    (await exists(targets.albedo)) &&
    (await exists(targets.normal)) &&
    (await exists(targets.orm))
  ) {
    console.log(`✓ ${label} (${slug}) — already encoded, skipping`);
    return;
  }

  console.log(`▶ ${label} (${slug})`);
  const files = await fetchJson(`https://api.polyhaven.com/files/${slug}`);

  const diffuseUrl = pickJpg(files, "Diffuse");
  const normalUrl = pickJpg(files, "nor_gl");
  const armUrl = pickJpg(files, "arm");

  const missing = [
    ["Diffuse", diffuseUrl],
    ["nor_gl", normalUrl],
    ["arm", armUrl],
  ]
    .filter(([, u]) => !u)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `${slug} is missing required map(s) at ${RES}: ${missing.join(", ")}. ` +
        `Pick a different slug or use a different resolution. ` +
        `See https://polyhaven.com/a/${slug}`
    );
  }

  const tmp = join(tmpdir(), `polyhaven-${slug}`);
  await mkdir(tmp, { recursive: true });
  const tmpDiffuse = join(tmp, "diffuse.jpg");
  const tmpNormal = join(tmp, "normal.jpg");
  const tmpArm = join(tmp, "arm.jpg");

  console.log(`  ↓ diffuse / normal / arm @ ${RES}`);
  await Promise.all([
    downloadTo(diffuseUrl, tmpDiffuse),
    downloadTo(normalUrl, tmpNormal),
    downloadTo(armUrl, tmpArm),
  ]);

  await mkdir(dirname(targets.albedo), { recursive: true });

  console.log(`  ⚙ encoding KTX2`);
  // Albedo: ETC1S (sRGB-aware via colorspace; basisu defaults sRGB for jpg).
  encodeKtx2(tmpDiffuse, targets.albedo, "etc1s");
  // Normal: UASTC (preserves high-frequency detail without color shift).
  encodeKtx2(tmpNormal, targets.normal, "uastc");
  // ARM (AO/Rough/Metal packed): UASTC — channel-precise data.
  encodeKtx2(tmpArm, targets.orm, "uastc");

  await rm(tmp, { recursive: true, force: true });
  console.log(`  ✓ ${out}_*.ktx2`);
}

async function main() {
  checkBasisu();
  await mkdir(OUT_ROOT, { recursive: true });
  for (const a of ASSETS) {
    try {
      await processAsset(a);
    } catch (e) {
      console.error(`✗ ${a.label} (${a.slug}): ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log("\nDone. Drop into git lfs if these get pushed; KTX2 files are binary.");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
