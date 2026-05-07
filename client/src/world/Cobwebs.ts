import * as THREE from "three";

// Cobwebs in upper room corners. Spec asks for a CC0 cobweb alpha PNG;
// until those land we generate a small radial spider-web pattern on a
// canvas at module load, then re-use it across every cobweb plane via a
// shared transparent material. One material, N draw calls (or ideally one
// after Phase 6 culling drops far rooms).

const cobwebTexture = makeCobwebTexture();
const cobwebMaterial = new THREE.MeshBasicMaterial({
  map: cobwebTexture,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  opacity: 0.55,
});
const cobwebGeometry = new THREE.PlaneGeometry(0.9, 0.9);

export type CobwebPlacement = {
  position: THREE.Vector3;
  /** Outward direction from the corner — the cobweb plane's +Z faces this. */
  outward: THREE.Vector3;
};

export class CobwebSet {
  private readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.group.name = "cobwebs";
    scene.add(this.group);
  }

  add(p: CobwebPlacement): void {
    const mesh = new THREE.Mesh(cobwebGeometry, cobwebMaterial);
    mesh.position.copy(p.position);
    const up = new THREE.Vector3(0, 0, 1);
    mesh.quaternion.setFromUnitVectors(up, p.outward.clone().normalize());
    // Random roll so corners don't all read identical.
    mesh.rotateZ(Math.random() * Math.PI * 2);
    // Slight scale variance.
    const s = 0.7 + Math.random() * 0.6;
    mesh.scale.set(s, s, 1);
    this.group.add(mesh);
  }

  dispose(): void {
    this.group.removeFromParent();
    // Material/geometry are module-shared — don't dispose here; they'll be
    // garbage-collected on full page reload. Multiple engine mounts in the
    // same session correctly reuse them.
  }
}

function makeCobwebTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Transparent backdrop.
  ctx.clearRect(0, 0, size, size);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = "rgba(220,220,220,0.85)";

  const cx = size / 2;
  const cy = size / 2;
  const radials = 10;

  // Radial threads from center.
  for (let i = 0; i < radials; i++) {
    const a = (i / radials) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * cx, cy + Math.sin(a) * cy);
    ctx.stroke();
  }

  // Concentric polygonal arcs connecting radials.
  for (let r = 8; r < cx; r += 8) {
    ctx.beginPath();
    for (let i = 0; i <= radials; i++) {
      const a = (i / radials) * Math.PI * 2 + (r % 16 === 0 ? 0.05 : -0.05);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
