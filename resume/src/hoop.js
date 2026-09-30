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

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {CANNON.World} o.world
 * @param {number} o.wallZ        z of the back wall
 * @param {number} o.y            rim height (world y)
 * @param {number} o.ballRadius   physics radius of a crumpled sheet
 * @param {CANNON.Material} o.paperMaterial
 * @param {{board:string, ink:string, accent:string, rim:string}} o.colors
 * @returns {{ group, rimRadius, center:{x,y,z}, place(x:number):void, arm(on:boolean):void }}
 */
export function createHoop({ scene, world, wallZ, y, ballRadius, paperMaterial, colors }) {
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

  // Frame and target square as thin boxes (line primitives are always 1px, boxes scale with distance)
  const frameMat = new THREE.MeshStandardMaterial({ color: colors.ink, roughness: 0.7 });
  const targetMat = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.5 });
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
  const sw = R * 1.5;
  const sh = R * 1.0;
  const sy = sh / 2; // target square sits on the rim line
  bar(sw, t, 0, sy + sh / 2 - t / 2, targetMat);
  bar(sw, t, 0, sy - sh / 2 + t / 2, targetMat);
  bar(t, sh, -sw / 2 + t / 2, sy, targetMat);
  bar(t, sh, sw / 2 - t / 2, sy, targetMat);

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
    new THREE.MeshBasicMaterial({ color: colors.board, wireframe: true, transparent: true, opacity: 0.55 }),
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
    const yy = on ? y : -100;
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
  place(0);
  arm(false);

  return { group, rimRadius: R, center, place, arm };
}
