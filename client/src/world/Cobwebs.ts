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
  opacity: 0.62,
});
const cobwebGeometry = new THREE.PlaneGeometry(1.05, 1.05);

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
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Transparent backdrop.
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const cx = size * 0.38;
  const cy = size * 0.36;
  const radials = 18;
  const endpoints: Array<[number, number, number]> = [];

  // Faint lacy mass toward the upper corner so distant planes read as a
  // denser silhouette instead of a perfect decal stamp.
  const haze = ctx.createRadialGradient(
    cx * 0.45,
    cy * 0.35,
    0,
    cx,
    cy,
    size * 0.75
  );
  haze.addColorStop(0, "rgba(210,215,220,0.13)");
  haze.addColorStop(0.38, "rgba(210,215,220,0.045)");
  haze.addColorStop(1, "rgba(210,215,220,0)");
  ctx.fillStyle = haze;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size * 0.92, 0);
  ctx.lineTo(0, size * 0.82);
  ctx.closePath();
  ctx.fill();

  // Radial threads from an off-center hub. Each is a shallow curve rather
  // than a straight spoke, giving the web a sagged, hand-spun look.
  for (let i = 0; i < radials; i++) {
    const a = (i / radials) * Math.PI * 2 + Math.sin(i * 4.17) * 0.035;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const d =
      edgeDistance(cx, cy, dx, dy, size) * (0.9 + ((i * 37) % 11) * 0.006);
    const ex = cx + dx * d;
    const ey = cy + dy * d;
    const sag = (0.018 + (i % 4) * 0.006) * size;
    const px = -dy;
    const py = dx;
    endpoints.push([ex, ey, a]);
    ctx.lineWidth = i % 5 === 0 ? 0.95 : 0.55;
    ctx.strokeStyle =
      i % 3 === 0 ? "rgba(235,238,238,0.68)" : "rgba(205,210,210,0.48)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(
      cx + dx * d * 0.55 + px * sag,
      cy + dy * d * 0.55 + py * sag,
      ex,
      ey
    );
    ctx.stroke();
  }

  // Layered capture spirals. Drawing segment-by-segment with a slight
  // downward control point creates drooping arcs between the radials.
  for (let r = 13; r < size * 0.49; r += 11) {
    const wobble = r % 22 === 0 ? 0.035 : -0.025;
    ctx.lineWidth = r % 33 === 0 ? 0.72 : 0.48;
    ctx.strokeStyle =
      r % 33 === 0 ? "rgba(230,233,233,0.62)" : "rgba(205,210,210,0.42)";
    for (let i = 0; i < radials; i++) {
      if ((i + Math.floor(r)) % 13 === 0) continue; // a few broken strands
      const a0 = (i / radials) * Math.PI * 2 + wobble;
      const a1 = ((i + 1) / radials) * Math.PI * 2 + wobble;
      const p0 = pointOnWeb(cx, cy, a0, r);
      const p1 = pointOnWeb(cx, cy, a1, r * (0.985 + (i % 3) * 0.012));
      const mid = pointOnWeb(cx, cy, (a0 + a1) * 0.5, r * 1.04);
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.quadraticCurveTo(mid[0], mid[1] + 2 + r * 0.035, p1[0], p1[1]);
      ctx.stroke();
    }
  }

  // Tiny anchor and stray threads strengthen the "corner" read at close range.
  ctx.lineWidth = 0.42;
  ctx.strokeStyle = "rgba(225,228,228,0.38)";
  drawAnchor(ctx, 0, 0, cx - 5, cy - 6, 18);
  drawAnchor(ctx, size * 0.96, 0, endpoints[2][0], endpoints[2][1], -13);
  drawAnchor(ctx, 0, size * 0.78, endpoints[12][0], endpoints[12][1], 10);
  for (let i = 0; i < endpoints.length; i += 3) {
    const [ex, ey, a] = endpoints[i];
    const tx = THREE.MathUtils.clamp(
      ex + Math.cos(a + 0.8) * (10 + (i % 4) * 4),
      0,
      size
    );
    const ty = THREE.MathUtils.clamp(
      ey + Math.sin(a + 0.8) * (10 + (i % 5) * 3),
      0,
      size
    );
    drawAnchor(ctx, ex, ey, tx, ty, i % 2 === 0 ? 7 : -7);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function edgeDistance(
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  size: number
): number {
  const tx =
    dx > 0 ? (size - cx) / dx : dx < 0 ? -cx / dx : Number.POSITIVE_INFINITY;
  const ty =
    dy > 0 ? (size - cy) / dy : dy < 0 ? -cy / dy : Number.POSITIVE_INFINITY;
  return Math.min(tx, ty);
}

function pointOnWeb(
  cx: number,
  cy: number,
  angle: number,
  radius: number
): [number, number] {
  const squash = 0.86 + Math.sin(angle * 2.5) * 0.035;
  return [
    cx + Math.cos(angle) * radius,
    cy + Math.sin(angle) * radius * squash,
  ];
}

function drawAnchor(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  sag: number
): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) * 0.5, (y0 + y1) * 0.5 + sag, x1, y1);
  ctx.stroke();
}
