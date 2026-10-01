// ==================================================
// Basketball hoop on the back wall: backboard, rim and net built from primitives, plus the
// static colliders (backboard box, a ring of small spheres for the rim). Baskets are detected
// geometrically in stage.js from `center` and `rimRadius`. Sized from the ball radius so the rim
// opening is always about 1.9 balls wide.
// ==================================================
import * as THREE from "three";
import * as CANNON from "cannon-es";

const RIM_SEGMENTS = 16;
const RIM_TUBE = 0.018;
const COLLIDER_R = 0.022;
const BOARD_T = 0.04;
// Gap between backboard and rim. Like a real hoop, a hard shot that hits the board can drop
// behind the rim instead of always rattling in.
const RIM_GAP = 0.2;

// Rasterises an SVG into a texture. SVGs without width/height get them from the viewBox so the
// browser gives the image a real size.
async function loadSvgTexture(url, size = 512) {
  try {
    let svg = await (await fetch(url)).text();
    const vb = svg.match(/viewBox=["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    if (vb && !/<svg[^>]*\swidth=/.test(svg)) {
      svg = svg.replace(/<svg/, `<svg width="${vb[1]}" height="${vb[2]}"`);
    }
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = blobUrl;
    });
    URL.revokeObjectURL(blobUrl);
    const w = img.naturalWidth || 256;
    const h = img.naturalHeight || 256;
    const s = size / Math.max(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return { texture, aspect: canvas.width / canvas.height };
  } catch (err) {
    console.warn("[hoop] logo not loaded:", err);
    return null;
  }
}

// ---------- net ----------
const NET_RINGS = 7; // knot rings from the rim (ring 0, fixed) down to the bottom
const NET_COLS = 16; // knots per ring
const NET_SPRING = 70; // pull of each knot back to its rest position
const NET_DAMP = 7;
const NET_COUPLE = 45; // pull toward neighbouring knots, so a push ripples through the net
const NET_PUSH_MARGIN = 1.04; // knots are pushed out to this × the ball radius
const NET_DRAG = 2.2; // how strongly the net slows a ball passing through (per second)

// A tapered net of knots joined in a diamond pattern (each knot ties to the two knots below it, odd
// rings offset half a step), drawn as opaque line segments so depth testing puts the strands in
// front of the ball over it and the ones behind it under it. Each knot is a damped spring: a ball
// inside the net pushes knots out to its surface, and neighbour coupling spreads the ripple.
function createNet(R, rimZ, color) {
  const height = R * 1.5;
  const bottomR = R * 0.5; // a touch narrower than the ball, so a make visibly stretches the bottom
  const n = NET_RINGS * NET_COLS;
  const rest = new Float32Array(n * 3);
  const off = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const idx = (i, j) => i * NET_COLS + ((j % NET_COLS) + NET_COLS) % NET_COLS;
  for (let i = 0; i < NET_RINGS; i++) {
    const f = i / (NET_RINGS - 1);
    const r = R + (bottomR - R) * f * (2 - f) * 0.9 + (bottomR - R) * f * 0.1; // slight belly
    const y = -height * f;
    for (let j = 0; j < NET_COLS; j++) {
      const a = ((j + (i % 2) * 0.5) / NET_COLS) * Math.PI * 2;
      const k = idx(i, j) * 3;
      rest[k] = Math.cos(a) * r;
      rest[k + 1] = y;
      rest[k + 2] = rimZ + Math.sin(a) * r;
    }
  }
  // Segments: each knot to the two knots below it (diamond mesh)
  const pairs = [];
  for (let i = 0; i < NET_RINGS - 1; i++) {
    for (let j = 0; j < NET_COLS; j++) {
      const down = i % 2 === 0 ? [idx(i + 1, j - 1), idx(i + 1, j)] : [idx(i + 1, j), idx(i + 1, j + 1)];
      for (const d of down) pairs.push(idx(i, j), d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  pos.set(rest);
  const posAttr = new THREE.BufferAttribute(pos, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", posAttr);
  geometry.setIndex(pairs);
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
  lines.frustumCulled = false; // the net deforms beyond its rest bounds

  // Neighbours for coupling: left/right on the ring, and the knots above and below
  const nbr = [];
  for (let i = 0; i < NET_RINGS; i++) {
    for (let j = 0; j < NET_COLS; j++) {
      const list = [idx(i, j - 1), idx(i, j + 1)];
      if (i > 0) list.push(...(i % 2 === 1 ? [idx(i - 1, j), idx(i - 1, j + 1)] : [idx(i - 1, j - 1), idx(i - 1, j)]));
      if (i < NET_RINGS - 1) list.push(...(i % 2 === 0 ? [idx(i + 1, j - 1), idx(i + 1, j)] : [idx(i + 1, j), idx(i + 1, j + 1)]));
      nbr.push(list);
    }
  }

  let settled = true;
  function update(dt, bodies, ballRadius, origin) {
    dt = Math.min(dt, 1 / 30);
    // Balls inside or touching the net, in the hoop group's local space
    const inside = [];
    for (const b of bodies) {
      const lx = b.position.x - origin.x;
      const ly = b.position.y - origin.y;
      const lz = b.position.z - origin.z;
      if (ly > ballRadius * 1.2 || ly < -height - ballRadius) continue;
      if (Math.hypot(lx, lz - rimZ) > R + ballRadius) continue;
      inside.push({ b, x: lx, y: ly, z: lz });
    }
    if (!inside.length && settled) return;

    const reach = ballRadius * NET_PUSH_MARGIN;
    let energy = 0;
    for (let k = NET_COLS; k < n; k++) {
      // ring 0 hangs from the rim and stays put
      const p = k * 3;
      for (let c = 0; c < 3; c++) {
        let avg = 0;
        for (const q of nbr[k]) avg += off[q * 3 + c];
        avg /= nbr[k].length;
        const acc = -NET_SPRING * off[p + c] - NET_DAMP * vel[p + c] + NET_COUPLE * (avg - off[p + c]);
        vel[p + c] += acc * dt;
      }
      for (let c = 0; c < 3; c++) off[p + c] += vel[p + c] * dt;

      // Keep the knot outside every ball in the net: push it to the surface and give it the
      // ball's motion, so the strands stretch around the ball and swing as it drops
      for (const s of inside) {
        const x = rest[p] + off[p] - s.x;
        const y = rest[p + 1] + off[p + 1] - s.y;
        const z = rest[p + 2] + off[p + 2] - s.z;
        const d = Math.hypot(x, y, z);
        if (d >= reach || d < 1e-5) continue;
        const push = (reach - d) / d;
        off[p] += x * push;
        off[p + 1] += y * push;
        off[p + 2] += z * push;
        const v = s.b.velocity;
        vel[p] = vel[p] * 0.5 + v.x * 0.5;
        vel[p + 1] = vel[p + 1] * 0.5 + v.y * 0.5;
        vel[p + 2] = vel[p + 2] * 0.5 + v.z * 0.5;
      }
      energy += Math.abs(off[p]) + Math.abs(off[p + 1]) + Math.abs(off[p + 2]);
      pos[p] = rest[p] + off[p];
      pos[p + 1] = rest[p + 1] + off[p + 1];
      pos[p + 2] = rest[p + 2] + off[p + 2];
    }
    // The net slows a ball dropping through it
    for (const s of inside) {
      if (s.y > 0) continue;
      const k = Math.exp(-NET_DRAG * dt);
      s.b.velocity.x *= k;
      s.b.velocity.z *= k;
      if (s.b.velocity.y < 0) s.b.velocity.y *= Math.exp(-NET_DRAG * 0.6 * dt);
    }
    posAttr.needsUpdate = true;
    settled = !inside.length && energy < 1e-3 * n;
    if (settled) {
      off.fill(0);
      vel.fill(0);
      pos.set(rest);
    }
  }

  return { lines, update };
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {CANNON.World} o.world
 * @param {number} o.wallZ        z of the back wall
 * @param {number} o.y            rim height (world y)
 * @param {number} o.ballRadius   physics radius of a crumpled sheet
 * @param {CANNON.Material} o.paperMaterial
 * @param {{board:string, frame:string, rim:string, net:string}} o.colors
 * @param {string} [o.logoUrl]   SVG drawn onto the backboard above the rim
 * @returns {{ group, rimRadius, center:{x,y,z}, topOffset:number, faceZ:number,
 *             place(x:number):void, setY(y:number):void, arm(on:boolean):void }}
 */
export function createHoop({ scene, world, wallZ, y, ballRadius, paperMaterial, colors, logoUrl }) {
  const R = ballRadius * 1.9; // rim inner radius
  const boardZ = wallZ + BOARD_T / 2 + 0.005;
  const boardFaceZ = boardZ + BOARD_T / 2;
  const rimZ = boardFaceZ + RIM_GAP + R + RIM_TUBE; // rim stands off the board on a bracket
  const bw = R * 2.8;
  const bh = R * 1.8;
  const boardY = R * 0.75; // board center, relative to rim height

  // ---------- visuals (group origin = rim center height, x set by place()) ----------
  const group = new THREE.Group();
  group.position.set(0, y, 0);

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(bw, bh, BOARD_T),
    new THREE.MeshStandardMaterial({ color: colors.board, roughness: 0.6 }),
  );
  board.position.set(0, boardY, boardZ);
  board.castShadow = true;
  board.receiveShadow = true;
  group.add(board);

  // Frame as thin boxes (line primitives are always 1px, boxes scale with distance)
  const frameMat = new THREE.MeshStandardMaterial({ color: colors.frame, roughness: 0.7 });
  const t = 0.02;
  const bar = (w, h, x, yy, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), mat);
    m.position.set(x, yy, boardFaceZ + 0.006);
    group.add(m);
  };
  bar(bw, t, 0, boardY + bh / 2 - t / 2, frameMat);
  bar(bw, t, 0, boardY - bh / 2 + t / 2, frameMat);
  bar(t, bh, -bw / 2 + t / 2, boardY, frameMat);
  bar(t, bh, bw / 2 - t / 2, boardY, frameMat);
  // Logo centred on the board above the rim (loaded asynchronously; the board is fine without it)
  if (logoUrl) {
    loadSvgTexture(logoUrl).then((logo) => {
      if (!logo) return;
      const lh = R * 1.45;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(lh * logo.aspect, lh),
        new THREE.MeshBasicMaterial({ map: logo.texture, transparent: true, depthWrite: false }),
      );
      mesh.position.set(0, boardY + R * 0.04, boardFaceZ + 0.008);
      group.add(mesh);
    });
  }

  const rimMat = new THREE.MeshStandardMaterial({ color: colors.rim, roughness: 0.45, metalness: 0.3 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R + RIM_TUBE, RIM_TUBE, 10, 40), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 0, rimZ);
  rim.castShadow = true;
  group.add(rim);

  const bracketLen = rimZ - R - RIM_TUBE - boardFaceZ;
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(R * 0.5, 0.03, bracketLen), rimMat);
  bracket.position.set(0, 0, boardFaceZ + bracketLen / 2);
  group.add(bracket);

  // Net: a diamond-knotted cord net that the ball pushes through (see createNet)
  const net = createNet(R, rimZ, colors.net);
  group.add(net.lines);

  scene.add(group);

  // ---------- physics ----------
  const hoopMat = new CANNON.Material("hoop");
  world.addContactMaterial(new CANNON.ContactMaterial(paperMaterial, hoopMat, { friction: 0.2, restitution: 0.75 }));
  // The backboard is springier than paper would really be, so an overpowered shot kicks back out
  // instead of dying against the board and dropping straight through the rim.
  const boardMat = new CANNON.Material("backboard");
  world.addContactMaterial(new CANNON.ContactMaterial(paperMaterial, boardMat, { friction: 0.05, restitution: 0.9 }));

  const boardBody = new CANNON.Body({
    mass: 0,
    material: boardMat,
    shape: new CANNON.Box(new CANNON.Vec3(bw / 2, bh / 2, BOARD_T / 2)),
  });
  world.addBody(boardBody);

  const rimBodies = [];
  for (let i = 0; i < RIM_SEGMENTS; i++) {
    const b = new CANNON.Body({ mass: 0, material: hoopMat, shape: new CANNON.Sphere(COLLIDER_R) });
    b.rimAngle = (i / RIM_SEGMENTS) * Math.PI * 2;
    world.addBody(b);
    rimBodies.push(b);
  }

  const center = { x: 0, y, z: rimZ };
  let armed = false;

  // Colliders sit at the hoop while armed, and far below the floor while the hoop is away.
  function arm(on) {
    armed = on;
    const x = center.x;
    const yy = on ? center.y : -100;
    boardBody.position.set(x, yy + boardY, boardZ);
    for (const b of rimBodies) {
      b.position.set(x + (R + COLLIDER_R) * Math.cos(b.rimAngle), yy, rimZ + (R + COLLIDER_R) * Math.sin(b.rimAngle));
    }
  }

  function place(x) {
    center.x = x;
    group.position.x = x;
    arm(armed);
  }
  // Rim height; the group's y is animated by the caller, so only the colliders follow here.
  function setY(newY) {
    center.y = newY;
    arm(armed);
  }

  place(0);
  arm(false);

  // topOffset: backboard top edge above the rim; faceZ: z of the backboard's front face
  // Per frame: deform the net around any balls inside it (and slow them a little as they pass)
  function updateNet(dt, bodies, ballRadius) {
    net.update(dt, bodies, ballRadius, group.position);
  }

  return { group, rimRadius: R, center, topOffset: boardY + bh / 2, faceZ: boardFaceZ, rimBodies, place, setY, arm, updateNet };
}
