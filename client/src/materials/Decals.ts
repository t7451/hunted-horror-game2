import * as THREE from "three";

// Lightweight decal splatting on walls/floors. Spec calls for
// three-stdlib's DecalGeometry, but DecalGeometry needs a target mesh
// with non-instanced geometry to project against — our walls are an
// InstancedMesh which DecalGeometry can't handle. So Phase 4 ships a
// flat-quad fallback: small additive-blended quads placed flush with
// the wall/floor surface. Visually equivalent at flashlight distance,
// and trivially compatible with InstancedMesh worlds.

export type DecalKind = "blood" | "water" | "grime" | "scratch";

const COLOR: Record<DecalKind, number> = {
  blood: 0x3a0608,
  water: 0x202830,
  grime: 0x1c1610,
  scratch: 0x8b7868,
};

const decalGeo = new THREE.PlaneGeometry(1, 1);

function makeMaterial(kind: DecalKind): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: COLOR[kind],
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide,
  });
}

export type DecalSpec = {
  kind: DecalKind;
  position: THREE.Vector3;
  /** Surface normal — decal's +Z is rotated to face this direction. */
  normal: THREE.Vector3;
  size?: number;
};

export class DecalSpawner {
  private readonly group = new THREE.Group();
  private readonly materials = new Map<DecalKind, THREE.MeshBasicMaterial>();

  constructor(scene: THREE.Scene) {
    this.group.name = "decals";
    scene.add(this.group);
  }

  spawn(spec: DecalSpec): void {
    let mat = this.materials.get(spec.kind);
    if (!mat) {
      mat = makeMaterial(spec.kind);
      this.materials.set(spec.kind, mat);
    }
    const mesh = new THREE.Mesh(decalGeo, mat);
    const size = spec.size ?? 0.6 + Math.random() * 0.5;
    mesh.scale.set(size, size, 1);
    mesh.position.copy(spec.position);
    // Orient the +Z face of the plane to the surface normal.
    const up = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(
      up,
      spec.normal.clone().normalize()
    );
    mesh.quaternion.copy(q);
    // Slight random roll keeps the decal from looking grid-aligned.
    mesh.rotateZ(Math.random() * Math.PI * 2);
    this.group.add(mesh);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.materials.forEach(m => m.dispose());
    decalGeo.dispose();
  }
}
