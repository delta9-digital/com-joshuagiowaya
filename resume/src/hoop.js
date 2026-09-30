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
  const rimZ = boardFaceZ + 0.03 + R + RIM_TUBE; // rim stands off the board on a short bracket
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
      const lh = R * 0.95;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(lh * logo.aspect, lh),
        new THREE.MeshBasicMaterial({ map: logo.texture, transparent: true, depthWrite: false }),
      );
      mesh.position.set(0, boardY + R * 0.08, boardFaceZ + 0.008);
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

  // Net: an open, tapered wireframe cylinder reads as cord at this size
  const net = new THREE.Mesh(
    new THREE.CylinderGeometry(R + RIM_TUBE * 0.5, R * 0.55, R * 1.5, 12, 5, true),
    new THREE.MeshBasicMaterial({ color: colors.net, wireframe: true, transparent: true, opacity: 0.55 }),
  );
  net.position.set(0, -R * 0.75, rimZ);
  group.add(net);

  scene.add(group);

  // ---------- physics ----------
  const hoopMat = new CANNON.Material("hoop");
  world.addContactMaterial(new CANNON.ContactMaterial(paperMaterial, hoopMat, { friction: 0.4, restitution: 0.45 }));

  const boardBody = new CANNON.Body({
    mass: 0,
    material: hoopMat,
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
  return { group, rimRadius: R, center, topOffset: boardY + bh / 2, faceZ: boardFaceZ, place, setY, arm };
}
