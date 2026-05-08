// client/src/world/CeilingFixtures.ts
//
// Hanging pendant lamp fixtures suspended from the ceiling above open floor
// tiles. Each fixture is a ceiling plate → drop cord → metal shade (cone) →
// emissive bulb with a warm PointLight beneath it.
//
// 65 % of fixtures are live (lit); 35 % of those flicker. The remaining
// 35 % are broken/dead — geometry only, no light — which creates the classic
// horror-house contrast of lit pools and dark corners.
//
// Max active PointLights is quality-gated; the LightCuller in engine.ts
// handles runtime distance-based dimming so the GPU never sees all lights
// simultaneously.

import * as THREE from "three";
import { WALL_HEIGHT, type ParsedMap } from "@shared/maps.ts";

// ── Layout constants ─────────────────────────────────────────────────────────

const FIXTURE_SPACING = 3; // place at every 3rd tile (12 m)

// Fixture geometry dimensions
const CORD_LEN = 0.52;
const SHADE_TOP_R = 0.08;
const SHADE_BOT_R = 0.24;
const SHADE_HEIGHT = 0.30;
const BULB_R = 0.065;
const PLATE_W = 0.14;
const PLATE_H = 0.04;

// Fraction of placed fixtures that receive a live PointLight
const LIVE_FRACTION = 0.65;
// Fraction of live fixtures that flicker
const FLICKER_FRACTION = 0.35;

const LIGHT_COLOR = 0xffb055; // warm tungsten
const LIGHT_INTENSITY = 1.15;
const LIGHT_DISTANCE = 9.0;
const LIGHT_DECAY = 2;

// ── Types ────────────────────────────────────────────────────────────────────

export type CeilingFixtureResult = {
  group: THREE.Group;
  /** All live PointLights — register with LightCuller. */
  lights: THREE.PointLight[];
  /** Subset of lights that should flicker — add LightFlicker to FlickerGroup. */
  flickerLights: THREE.PointLight[];
  dispose: () => void;
};

// ── Public function ───────────────────────────────────────────────────────────

export function buildCeilingFixtures(
  parsed: ParsedMap,
  tileSize: number,
  quality: "low" | "mid" | "high",
  rng: () => number
): CeilingFixtureResult {
  const group = new THREE.Group();
  group.name = "ceiling_fixtures";
  const lights: THREE.PointLight[] = [];
  const flickerLights: THREE.PointLight[] = [];
  const geoList: THREE.BufferGeometry[] = [];
  const matList: THREE.Material[] = [];

  if (quality === "low") {
    return { group, lights, flickerLights, dispose: () => {} };
  }

  const maxLights = quality === "high" ? 24 : 14;
  const radialSegs = quality === "high" ? 10 : 7;

  // ── Shared geometries ──────────────────────────────────────────────────────
  const plateGeo = new THREE.BoxGeometry(PLATE_W, PLATE_H, PLATE_W);
  const cordGeo = new THREE.BoxGeometry(0.012, CORD_LEN, 0.012);
  // Open-ended cone: wide at bottom so the light spills downward
  const shadeGeo = new THREE.CylinderGeometry(
    SHADE_TOP_R,
    SHADE_BOT_R,
    SHADE_HEIGHT,
    radialSegs,
    1,
    true
  );
  // Solid top cap to close the shade at the cord attachment
  const capGeo = new THREE.CircleGeometry(SHADE_TOP_R, radialSegs);
  const bulbGeo = new THREE.SphereGeometry(BULB_R, 8, 6);
  // Emissive disk that fills the open bottom of the shade — the main glow cue
  const glowDiskGeo = new THREE.CircleGeometry(SHADE_BOT_R * 0.85, radialSegs);
  geoList.push(plateGeo, cordGeo, shadeGeo, capGeo, bulbGeo, glowDiskGeo);

  // ── Shared materials ───────────────────────────────────────────────────────
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x2e2820,
    roughness: 0.55,
    metalness: 0.55,
  });
  const bulbLitMat = new THREE.MeshStandardMaterial({
    color: 0xfff4d4,
    emissive: 0xffaa44,
    emissiveIntensity: 2.8,
    roughness: 0.3,
    metalness: 0.0,
  });
  const bulbDeadMat = new THREE.MeshStandardMaterial({
    color: 0x1a1814,
    roughness: 0.8,
    metalness: 0.1,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xfff0c0,
    emissive: 0xffaa44,
    emissiveIntensity: 1.6,
    roughness: 0.5,
    metalness: 0.0,
    side: THREE.FrontSide,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  matList.push(metalMat, bulbLitMat, bulbDeadMat, glowMat);

  // ── Placement ──────────────────────────────────────────────────────────────
  // Clamp shade bottom below ceiling: cord bottom + shade_height
  const SHADE_BOT_Y = WALL_HEIGHT - PLATE_H - CORD_LEN - SHADE_HEIGHT;
  const SHADE_CENTER_Y = SHADE_BOT_Y + SHADE_HEIGHT * 0.5;
  const BULB_Y = SHADE_BOT_Y + BULB_R + 0.01;
  const GLOW_DISK_Y = SHADE_BOT_Y - 0.005;
  const LIGHT_Y = SHADE_BOT_Y - 0.12;

  let lightCount = 0;

  for (let tz = 1; tz < parsed.height - 1; tz++) {
    for (let tx = 1; tx < parsed.width - 1; tx++) {
      // Stagger grid: offset so (tx+tz) % spacing avoids strict alignment
      if ((tx % FIXTURE_SPACING) !== 1 || (tz % FIXTURE_SPACING) !== 1) continue;

      const tile = parsed.tiles[tz][tx];
      // Only walkable non-door tiles
      if (tile === "W" || tile === "D") continue;

      // Require ≥ 2 open cardinal neighbours so we don't dangle in a corridor
      // junction with no real room behind it.
      let openNeighbors = 0;
      const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dz] of dirs) {
        const t = parsed.tiles[tz + dz]?.[tx + dx];
        if (t && t !== "W" && t !== "D") openNeighbors++;
      }
      if (openNeighbors < 2) continue;

      const fx = (tx + 0.5) * tileSize;
      const fz = (tz + 0.5) * tileSize;

      // ── Build pendant ──────────────────────────────────────────────────────
      // Ceiling plate
      const plate = new THREE.Mesh(plateGeo, metalMat);
      plate.position.set(fx, WALL_HEIGHT - PLATE_H * 0.5, fz);
      plate.matrixAutoUpdate = false;
      plate.updateMatrix();
      group.add(plate);

      // Drop cord
      const cord = new THREE.Mesh(cordGeo, metalMat);
      cord.position.set(fx, WALL_HEIGHT - PLATE_H - CORD_LEN * 0.5, fz);
      cord.matrixAutoUpdate = false;
      cord.updateMatrix();
      group.add(cord);

      // Shade body (open cone)
      const shade = new THREE.Mesh(shadeGeo, metalMat);
      shade.position.set(fx, SHADE_CENTER_Y, fz);
      shade.matrixAutoUpdate = false;
      shade.updateMatrix();
      group.add(shade);

      // Shade top cap (closes the opening at the cord)
      const cap = new THREE.Mesh(capGeo, metalMat);
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(fx, SHADE_CENTER_Y + SHADE_HEIGHT * 0.5 - 0.001, fz);
      cap.matrixAutoUpdate = false;
      cap.updateMatrix();
      group.add(cap);

      // Decide working vs. dead
      const isLive = rng() < LIVE_FRACTION;

      // Bulb
      const bulb = new THREE.Mesh(bulbGeo, isLive ? bulbLitMat : bulbDeadMat);
      bulb.position.set(fx, BULB_Y, fz);
      bulb.matrixAutoUpdate = false;
      bulb.updateMatrix();
      group.add(bulb);

      if (isLive) {
        // Glow disk at shade opening
        const disk = new THREE.Mesh(glowDiskGeo, glowMat);
        disk.rotation.x = Math.PI / 2; // face downward
        disk.position.set(fx, GLOW_DISK_Y, fz);
        disk.matrixAutoUpdate = false;
        disk.updateMatrix();
        group.add(disk);

        if (lightCount < maxLights) {
          const intensity = LIGHT_INTENSITY + rng() * 0.25;
          const light = new THREE.PointLight(
            LIGHT_COLOR,
            intensity,
            LIGHT_DISTANCE,
            LIGHT_DECAY
          );
          light.position.set(fx, LIGHT_Y, fz);
          group.add(light);
          lights.push(light);

          if (rng() < FLICKER_FRACTION) {
            flickerLights.push(light);
          }
          lightCount++;
        }
      }
    }
  }

  return {
    group,
    lights,
    flickerLights,
    dispose: () => {
      for (const g of geoList) g.dispose();
      for (const m of matList) m.dispose();
    },
  };
}
