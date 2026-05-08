// client/src/world/WallFixtures.ts
//
// Sparse wall-mounted fixtures at low density along wall-adjacent floor
// edges. Cheap instanced primitives, big perceived detail.

import * as THREE from "three";
import type { ParsedMap } from "@shared/maps";

const FIXTURE_DENSITY = 0.1;
const MAX_FIXTURE_SITES = 140;

// Mirrors WallBuilder.WALL_THICKNESS — duplicated to avoid a cross-module
// import cycle. If you change one, change both.
const WALL_THICKNESS = 0.18;

type FixtureKind =
  | "outlet"
  | "switch"
  | "frame_small"
  | "frame_med"
  | "pipe_run"
  | "cable_sag"
  | "vent"
  | "electrical_box";

type FixturePartKind =
  | "outlet_plate"
  | "outlet_slot"
  | "switch_plate"
  | "switch_toggle"
  | "frame_small"
  | "frame_med"
  | "frame_insert_small"
  | "frame_insert_med"
  | "stain_smear"
  | "stain_drip"
  | "pipe_horizontal"
  | "pipe_vertical"
  | "pipe_clamp"
  | "cable_segment"
  | "cable_anchor"
  | "vent_cover"
  | "vent_slat"
  | "electrical_box"
  | "electrical_latch"
  | "conduit_vertical"
  | "warning_label";

type FixtureMaterialKind =
  | "porcelain"
  | "darkInset"
  | "oldWood"
  | "agedPaper"
  | "stain"
  | "rustedMetal"
  | "dullMetal"
  | "blackRubber"
  | "warningLabel";

const NEIGHBORS: { dx: number; dz: number; rot: number }[] = [
  { dx: 0, dz: -1, rot: 0 },
  { dx: 1, dz: 0, rot: -Math.PI / 2 },
  { dx: 0, dz: 1, rot: Math.PI },
  { dx: -1, dz: 0, rot: Math.PI / 2 },
];

// Module-scoped caches: one geometry per readable sub-part and one material per
// material family. WallFixtures turns every sub-part family into an
// InstancedMesh, so adding detail keeps draw calls bounded.
const _geoCache = new Map<FixturePartKind, THREE.BufferGeometry>();
const _matCache = new Map<FixtureMaterialKind, THREE.MeshStandardMaterial>();

function makeFixtureGeometry(kind: FixturePartKind): THREE.BufferGeometry {
  const cached = _geoCache.get(kind);
  if (cached) return cached;
  let geo: THREE.BufferGeometry;
  switch (kind) {
    case "outlet_plate":
      geo = new THREE.BoxGeometry(0.09, 0.13, 0.014);
      break;
    case "outlet_slot":
      geo = new THREE.BoxGeometry(0.012, 0.036, 0.007);
      break;
    case "switch_plate":
      geo = new THREE.BoxGeometry(0.085, 0.14, 0.014);
      break;
    case "switch_toggle":
      geo = new THREE.BoxGeometry(0.018, 0.056, 0.012);
      break;
    case "frame_small":
      geo = new THREE.BoxGeometry(0.36, 0.48, 0.026);
      break;
    case "frame_med":
      geo = new THREE.BoxGeometry(0.62, 0.78, 0.032);
      break;
    case "frame_insert_small":
      geo = new THREE.BoxGeometry(0.25, 0.34, 0.012);
      break;
    case "frame_insert_med":
      geo = new THREE.BoxGeometry(0.45, 0.58, 0.012);
      break;
    case "stain_smear":
      geo = new THREE.BoxGeometry(0.22, 0.18, 0.008);
      break;
    case "stain_drip":
      geo = new THREE.BoxGeometry(0.045, 0.22, 0.007);
      break;
    case "pipe_horizontal":
      geo = new THREE.BoxGeometry(0.86, 0.07, 0.075);
      break;
    case "pipe_vertical":
      geo = new THREE.BoxGeometry(0.07, 0.88, 0.075);
      break;
    case "pipe_clamp":
      geo = new THREE.BoxGeometry(0.13, 0.11, 0.026);
      break;
    case "cable_segment":
      geo = new THREE.BoxGeometry(0.42, 0.024, 0.024);
      break;
    case "cable_anchor":
      geo = new THREE.BoxGeometry(0.075, 0.075, 0.024);
      break;
    case "vent_cover":
      geo = new THREE.BoxGeometry(0.56, 0.34, 0.025);
      break;
    case "vent_slat":
      geo = new THREE.BoxGeometry(0.45, 0.032, 0.018);
      break;
    case "electrical_box":
      geo = new THREE.BoxGeometry(0.36, 0.46, 0.052);
      break;
    case "electrical_latch":
      geo = new THREE.BoxGeometry(0.052, 0.085, 0.025);
      break;
    case "conduit_vertical":
      geo = new THREE.BoxGeometry(0.064, 0.58, 0.064);
      break;
    case "warning_label":
      geo = new THREE.BoxGeometry(0.16, 0.08, 0.009);
      break;
  }
  _geoCache.set(kind, geo);
  return geo;
}

function makeFixtureMaterial(
  kind: FixtureMaterialKind
): THREE.MeshStandardMaterial {
  const cached = _matCache.get(kind);
  if (cached) return cached;
  let mat: THREE.MeshStandardMaterial;
  switch (kind) {
    case "porcelain":
      mat = new THREE.MeshStandardMaterial({
        color: 0xe8e4dc,
        roughness: 0.45,
        metalness: 0,
      });
      break;
    case "darkInset":
      mat = new THREE.MeshStandardMaterial({
        color: 0x090807,
        roughness: 0.75,
        metalness: 0,
      });
      break;
    case "oldWood":
      mat = new THREE.MeshStandardMaterial({
        color: 0x2a1810,
        roughness: 0.72,
        metalness: 0,
      });
      break;
    case "agedPaper":
      mat = new THREE.MeshStandardMaterial({
        color: 0x8b7a5e,
        roughness: 0.9,
        metalness: 0,
      });
      break;
    case "stain":
      mat = new THREE.MeshStandardMaterial({
        color: 0x3d261d,
        roughness: 0.96,
        metalness: 0,
      });
      break;
    case "rustedMetal":
      mat = new THREE.MeshStandardMaterial({
        color: 0x51433b,
        roughness: 0.86,
        metalness: 0.35,
      });
      break;
    case "dullMetal":
      mat = new THREE.MeshStandardMaterial({
        color: 0x6f6a61,
        roughness: 0.78,
        metalness: 0.42,
      });
      break;
    case "blackRubber":
      mat = new THREE.MeshStandardMaterial({
        color: 0x070707,
        roughness: 0.68,
        metalness: 0,
      });
      break;
    case "warningLabel":
      mat = new THREE.MeshStandardMaterial({
        color: 0xb38b25,
        roughness: 0.68,
        metalness: 0,
      });
      break;
  }
  _matCache.set(kind, mat);
  return mat;
}

function materialForPart(kind: FixturePartKind): FixtureMaterialKind {
  switch (kind) {
    case "outlet_plate":
    case "switch_plate":
      return "porcelain";
    case "outlet_slot":
    case "switch_toggle":
    case "electrical_latch":
      return "darkInset";
    case "frame_small":
    case "frame_med":
      return "oldWood";
    case "frame_insert_small":
    case "frame_insert_med":
      return "agedPaper";
    case "stain_smear":
    case "stain_drip":
      return "stain";
    case "pipe_horizontal":
    case "pipe_vertical":
    case "pipe_clamp":
    case "conduit_vertical":
      return "rustedMetal";
    case "vent_cover":
    case "vent_slat":
    case "electrical_box":
      return "dullMetal";
    case "cable_segment":
    case "cable_anchor":
      return "blackRubber";
    case "warning_label":
      return "warningLabel";
  }
}

export function disposeFixtureCache(): void {
  for (const g of _geoCache.values()) g.dispose();
  for (const m of _matCache.values()) m.dispose();
  _geoCache.clear();
  _matCache.clear();
}

function fixtureHeight(kind: FixtureKind, rng: () => number): number {
  switch (kind) {
    case "outlet":
      return 0.32;
    case "switch":
      return 1.25;
    case "frame_small":
    case "frame_med":
      return 1.4 + rng() * 0.3;
    case "pipe_run":
      return rng() < 0.5 ? 0.68 + rng() * 0.35 : 1.85 + rng() * 0.45;
    case "cable_sag":
      return 2.2 + rng() * 0.35;
    case "vent":
      return 1.75 + rng() * 0.3;
    case "electrical_box":
      return 1.0 + rng() * 0.35;
  }
}

function chooseFixtureKind(r: number): FixtureKind {
  if (r < 0.2) return "outlet";
  if (r < 0.36) return "switch";
  if (r < 0.54) return "frame_small";
  if (r < 0.68) return "frame_med";
  if (r < 0.8) return "pipe_run";
  if (r < 0.9) return "cable_sag";
  if (r < 0.97) return "vent";
  return "electrical_box";
}

export class WallFixtures {
  readonly object: THREE.Group;
  // Geometries/materials are owned by the module-scoped caches above and
  // shared across every WallFixtures instance — disposeFixtureCache()
  // releases them once the engine tears down, not on per-instance dispose().

  constructor(parsed: ParsedMap, tileSize: number, rng: () => number) {
    const group = new THREE.Group();
    group.name = "wall_fixtures";
    this.object = group;
    const instanceMatrices = new Map<FixturePartKind, THREE.Matrix4[]>();
    const dummy = new THREE.Object3D();
    const localOffset = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);

    // Distance from a floor tile center to the wall surface facing it.
    // WallBuilder centers a thin wall on the wall TILE center, so the wall
    // surface sits at `tileSize - WALL_THICKNESS / 2` from the floor center.
    // The 0.002 inset keeps the fixture mounted just inside the surface
    // without breaking depth ordering against the wall mesh.
    const surfaceDist = tileSize - WALL_THICKNESS / 2 - 0.002;
    let fixtureSites = 0;

    const pushPart = (
      kind: FixturePartKind,
      baseX: number,
      baseZ: number,
      rotY: number,
      localX: number,
      localY: number,
      localZ = 0,
      rotZ = 0
    ) => {
      localOffset.set(localX, 0, localZ).applyAxisAngle(yAxis, rotY);
      dummy.position.set(baseX + localOffset.x, localY, baseZ + localOffset.z);
      dummy.rotation.set(0, rotY, rotZ);
      dummy.updateMatrix();
      const matrices = instanceMatrices.get(kind);
      if (matrices) matrices.push(dummy.matrix.clone());
      else instanceMatrices.set(kind, [dummy.matrix.clone()]);
    };

    const addOutlet = (
      baseX: number,
      baseZ: number,
      rotY: number,
      height: number
    ) => {
      pushPart("outlet_plate", baseX, baseZ, rotY, 0, height, 0);
      pushPart(
        "outlet_slot",
        baseX,
        baseZ,
        rotY,
        -0.018,
        height + 0.012,
        0.013
      );
      pushPart("outlet_slot", baseX, baseZ, rotY, 0.018, height + 0.012, 0.013);
      pushPart(
        "outlet_slot",
        baseX,
        baseZ,
        rotY,
        -0.018,
        height - 0.032,
        0.013
      );
      pushPart("outlet_slot", baseX, baseZ, rotY, 0.018, height - 0.032, 0.013);
    };

    const addSwitch = (
      baseX: number,
      baseZ: number,
      rotY: number,
      height: number,
      tilt: number
    ) => {
      pushPart("switch_plate", baseX, baseZ, rotY, 0, height, 0);
      pushPart("switch_toggle", baseX, baseZ, rotY, 0, height, 0.014, tilt);
    };

    const addFrame = (
      kind: "frame_small" | "frame_med",
      baseX: number,
      baseZ: number,
      rotY: number,
      height: number,
      tilt: number,
      stainOffset: number
    ) => {
      const insertKind =
        kind === "frame_small" ? "frame_insert_small" : "frame_insert_med";
      const lowerDrip = kind === "frame_small" ? -0.2 : -0.34;
      pushPart(kind, baseX, baseZ, rotY, 0, height, 0, tilt);
      pushPart(insertKind, baseX, baseZ, rotY, 0, height, 0.024, tilt);
      pushPart(
        "stain_smear",
        baseX,
        baseZ,
        rotY,
        stainOffset,
        height + 0.04,
        0.035,
        tilt * 0.5
      );
      pushPart(
        "stain_drip",
        baseX,
        baseZ,
        rotY,
        stainOffset + 0.06,
        height + lowerDrip,
        0.037,
        tilt * 0.3
      );
    };

    const addPipeRun = (
      baseX: number,
      baseZ: number,
      rotY: number,
      height: number,
      vertical: boolean,
      crooked: number
    ) => {
      if (vertical) {
        pushPart(
          "pipe_vertical",
          baseX,
          baseZ,
          rotY,
          0,
          height,
          0.016,
          crooked
        );
        pushPart("pipe_clamp", baseX, baseZ, rotY, 0, height - 0.32, 0.054);
        pushPart("pipe_clamp", baseX, baseZ, rotY, 0, height + 0.32, 0.054);
      } else {
        pushPart(
          "pipe_horizontal",
          baseX,
          baseZ,
          rotY,
          0,
          height,
          0.016,
          crooked
        );
        pushPart("pipe_clamp", baseX, baseZ, rotY, -0.34, height, 0.054);
        pushPart("pipe_clamp", baseX, baseZ, rotY, 0.34, height, 0.054);
      }
    };

    const addCableSag = (
      baseX: number,
      baseZ: number,
      rotY: number,
      height: number,
      droop: number
    ) => {
      pushPart("cable_anchor", baseX, baseZ, rotY, -0.5, height + 0.03, 0.02);
      pushPart("cable_anchor", baseX, baseZ, rotY, 0.5, height + 0.03, 0.02);
      pushPart(
        "cable_segment",
        baseX,
        baseZ,
        rotY,
        -0.28,
        height - droop * 0.45,
        0.025,
        -0.18
      );
      pushPart(
        "cable_segment",
        baseX,
        baseZ,
        rotY,
        0,
        height - droop,
        0.025,
        0
      );
      pushPart(
        "cable_segment",
        baseX,
        baseZ,
        rotY,
        0.28,
        height - droop * 0.45,
        0.025,
        0.18
      );
    };

    const addVent = (
      baseX: number,
      baseZ: number,
      rotY: number,
      height: number,
      tilt: number
    ) => {
      pushPart("vent_cover", baseX, baseZ, rotY, 0, height, 0, tilt);
      for (let i = 0; i < 4; i++) {
        pushPart(
          "vent_slat",
          baseX,
          baseZ,
          rotY,
          0,
          height + 0.105 - i * 0.07,
          0.025,
          tilt
        );
      }
    };

    const addElectricalBox = (
      baseX: number,
      baseZ: number,
      rotY: number,
      height: number
    ) => {
      pushPart("conduit_vertical", baseX, baseZ, rotY, 0, height + 0.52, 0.012);
      pushPart("electrical_box", baseX, baseZ, rotY, 0, height, 0);
      pushPart("electrical_latch", baseX, baseZ, rotY, 0.13, height, 0.038);
      pushPart("warning_label", baseX, baseZ, rotY, -0.045, height + 0.1, 0.04);
      pushPart("pipe_clamp", baseX, baseZ, rotY, 0, height + 0.76, 0.048);
    };

    for (let z = 0; z < parsed.height; z++) {
      for (let x = 0; x < parsed.width; x++) {
        if (parsed.tiles[z][x] !== ".") continue;
        for (const n of NEIGHBORS) {
          if (fixtureSites >= MAX_FIXTURE_SITES) break;
          const nx = x + n.dx;
          const nz = z + n.dz;
          if (nz < 0 || nz >= parsed.height || nx < 0 || nx >= parsed.width)
            continue;
          if (parsed.tiles[nz][nx] !== "W") continue;
          if (rng() > FIXTURE_DENSITY) continue;

          fixtureSites++;
          const kind = chooseFixtureKind(rng());
          const tileCx = (x + 0.5) * tileSize;
          const tileCz = (z + 0.5) * tileSize;
          const lateralJitter = (rng() - 0.5) * tileSize * 0.28;
          localOffset.set(lateralJitter, 0, 0).applyAxisAngle(yAxis, n.rot);
          const baseX = tileCx + n.dx * surfaceDist + localOffset.x;
          const baseZ = tileCz + n.dz * surfaceDist + localOffset.z;
          const height = fixtureHeight(kind, rng);

          switch (kind) {
            case "outlet":
              addOutlet(baseX, baseZ, n.rot, height);
              break;
            case "switch":
              addSwitch(baseX, baseZ, n.rot, height, (rng() - 0.5) * 0.08);
              break;
            case "frame_small":
            case "frame_med":
              addFrame(
                kind,
                baseX,
                baseZ,
                n.rot,
                height,
                (rng() - 0.5) * 0.06,
                (rng() - 0.5) * 0.08
              );
              break;
            case "pipe_run":
              addPipeRun(
                baseX,
                baseZ,
                n.rot,
                height,
                rng() < 0.45,
                (rng() - 0.5) * 0.05
              );
              break;
            case "cable_sag":
              addCableSag(baseX, baseZ, n.rot, height, 0.08 + rng() * 0.08);
              break;
            case "vent":
              addVent(baseX, baseZ, n.rot, height, (rng() - 0.5) * 0.035);
              break;
            case "electrical_box":
              addElectricalBox(baseX, baseZ, n.rot, height);
              break;
          }
        }
      }
    }

    for (const [kind, matrices] of instanceMatrices) {
      const mesh = new THREE.InstancedMesh(
        makeFixtureGeometry(kind),
        makeFixtureMaterial(materialForPart(kind)),
        matrices.length
      );
      mesh.name = `wall_fixture_${kind}`;
      for (let i = 0; i < matrices.length; i++)
        mesh.setMatrixAt(i, matrices[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow =
        kind === "frame_small" ||
        kind === "frame_med" ||
        kind === "pipe_horizontal" ||
        kind === "pipe_vertical" ||
        kind === "electrical_box";
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  dispose(): void {
    // Geometries/materials are pooled at module scope; releasing them per
    // instance would invalidate other live instances. Just clear the group.
    while (this.object.children.length)
      this.object.remove(this.object.children[0]);
  }
}
