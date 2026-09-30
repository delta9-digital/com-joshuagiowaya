// ==================================================
// Resume paper stage
// Two modes, chosen by data-mode on .rs-stage:
//   "pile" (default): every sheet starts as a crumpled ball on the floor. Back/Next unfolds the
//          next sheet toward the camera and tosses the current one back onto the pile.
//   "read": the floor starts empty and the first sheet is already open. Next crumples the sheet
//          you finished onto the floor and, once it lands, the next one arrives open; Back unfolds
//          the last crumpled sheet again and the unread one vanishes. Only read sheets are ever on
//          the floor. Next on the last sheet crumples it too, leaving nothing open ("finished").
// Pages turn with Back/Next, ▲/▼ buttons, arrow keys, the mouse wheel, or a swipe.
// Hovering a crumpled page highlights it and shows which page it is; on touch, the first tap
// previews and a second tap opens.
// data-sheet-headers="first" draws the dark header band only on a section's first sheet.
// data-hoop="on" adds a basketball hoop: once every page has been crumpled it drops down onto the
// middle of the back wall, flicked balls arc, and one that falls through the rim counts as a
// basket in the HUD. Reopening a page lifts the hoop away again.
// Scene, VAT playback, and physics are adapted from item-develop/paper-crumple-demo (MIT).
// ==================================================
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { readResume, paginate, drawPage, waitForFonts, PAGE_W, PAGE_H } from "./pages.js";
import { createHoop } from "./hoop.js";

const section = document.querySelector(".rs-stage");
const viewport = section.querySelector(".rs-stage__viewport");
const container = document.getElementById("stage");
const loadingEl = document.getElementById("stage-loading");
const prevBtns = section.querySelectorAll('[data-nav="prev"], [data-nav="up"]');
const nextBtns = section.querySelectorAll('[data-nav="next"], [data-nav="down"]');
const counterEls = section.querySelectorAll("[data-counter]");
const labelEls = section.querySelectorAll("[data-label]");
const tocEl = section.querySelector("[data-toc]");
const statusEl = section.querySelector("[data-status]");
const textToggle = section.querySelector("[data-text-toggle]");
const scoreEl = section.querySelector("[data-score]");
const scoreMadeEl = section.querySelector("[data-score-made]");
const scoreShotsEl = section.querySelector("[data-score-shots]");
const menuBtn = section.querySelector("[data-menu-open]");
const menuEl = section.querySelector("[data-menu]");
const resumeEl = document.getElementById("resume");

const MODE = section.dataset.mode === "read" ? "read" : "pile";
// "full": the stage fills the screen — vertical swipes turn pages instead of scrolling the site.
const FULL = section.dataset.layout === "full";
const HOOP = section.dataset.hoop === "on";
const CONTINUATION_BAND = section.dataset.sheetHeaders !== "first";
// data-sheets="print": plain printed paper, tighter type, sections flowing onto shared sheets
const SHEET_LAYOUT = section.dataset.sheets === "print" ? "print" : "notebook";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const rootStyle = getComputedStyle(document.documentElement);
const token = (name, fallback) => rootStyle.getPropertyValue(name).trim() || fallback;

// ---------- tuning ----------
const CAMERA_BASE = { y: 2.2, z: 3.6, targetY: 0.35 };
const FLOOR_VISUAL_Y = -0.1;
const WALL_Z = -1.1;
const OPEN_DISTANCE = 1.5;
const OPEN_HEIGHT_RATIO = 0.9;
const OPEN_WIDTH_RATIO = 0.94;
const CLOSED_SCALE = 0.82;
const OPEN_DURATION = 1.15;
const DISCARD_DURATION = 1.25;
const ARRIVE_DURATION = 0.7; // read mode: a fresh sheet fading into the open pose
const VANISH_DURATION = 0.45; // read mode: an unread sheet / skipped ball fading away
const ARRIVE_LIFT = 0.45; // how far above the open pose a fresh sheet starts
const LAND_TIMEOUT_MS = 2500; // read mode: arrive anyway if the tossed sheet never reports landing
const WHEEL_COOLDOWN_MS = 900; // one page per wheel gesture
const WHEEL_MIN_DELTA = 8;
const SPEED = reduceMotion ? 4 : 1.5;
const OPEN_FRAME = 1.5; // VAT frame shown when open — near 0 is flat, a little higher keeps some crinkle
const ROLL_LINEAR_RESISTANCE = 2.6;
const ROLL_ANGULAR_RESISTANCE = 4.5;
const ROLL_SETTLE_SPEED = 0.018;
const PHYSICS_STEP = 1 / 60;
const PAPER_MASS = 0.16;
const GRAB_LIFT = 0.5;
const GRAB_STIFFNESS = 14;
const GRAB_MAX_SPEED = 4.5;
const THROW_MAX_SPEED = 3.2;
// Hoop: horizontal release speed cap, the lift added per unit of horizontal speed (~40° arc),
// the flick speed below which a release is a drop rather than a shot, and how far the open sheet
// fades while a ball is in hand or in the air so the hoop stays visible on narrow screens.
const THROW_MAX_SPEED_HOOP = 3.6;
const THROW_LIFT = 1.15;
const FLICK_WINDOW_MS = 120; // pointer samples used to measure a flick
const SHOT_MIN_SPEED = 0.9;
const SHEET_DIM = 0.12;
const HOOP_Y = FLOOR_VISUAL_Y + 1.1; // fallback rim height; normally fitted under the HUD
const HOOP_Y_MIN = FLOOR_VISUAL_Y + 0.8;
const HOOP_Y_MAX = FLOOR_VISUAL_Y + 2.1; // safety cap; throw lift scales to reach it (throwLift)
const HOOP_CLEARANCE = 0.35; // how far a full-strength throw peaks above the rim
const HUD_GAP_PX = 10; // space between the top bar and the backboard
// With a hoop the camera looks a little higher so the raised backboard clears the HUD, and the
// stage is a little shallower so the front row of balls stays in frame.
const CAMERA_TARGET_Y = 0.35;
const CAMERA_TARGET_Y_HOOP = 0.6;
let hoopRestY = HOOP_Y;
const hudEl = section.querySelector(".rs-hud");
const CLICK_DRAG_THRESHOLD_PX = 6;
const SWIPE_THRESHOLD_PX = 60;
const BOUNDS_PULL = 3.0;
const LOW_TEX_W = 256;

const stageBounds = { minX: -2.4, maxX: 2.4, minZ: WALL_Z, maxZ: 1.7 };
const HOOP_MAX_Z = 1.4;

// ---------- runtime state ----------
let renderer, scene, camera, composer, physicsWorld, floorBody, paperPhysMat;
let animData = null;
let pages = [];
const papers = [];
let activePaper = null;
let current = -1; // index of the open page; pages.length once the last page has been crumpled
let pendingArrival = null; // read mode: { index, cancel } while waiting for a tossed sheet to land
let hoverPaper = null; // ball under the pointer (or tapped once on touch)
let tipEl = null;
const HOVER_GLOW = new THREE.Color(token("--jg-cyan", "#00bdff"));
let hoop = null;
let hoopShown = false; // requested state; the mesh eases toward it in updateHoop()
let hoopArmed = false; // colliders are live only once it has settled into place
const score = { made: 0, shots: 0 };
let throwCounter = 0;
let pointerState = null;
let prevTime = null;
let running = false;
let visible = false;
let collisionRadius = 0.25;
let restCenterY = FLOOR_VISUAL_Y + 0.25;
let restMeshY = 0.02;
const crumpleCenter = new THREE.Vector3(0, 0.2, 0);
const flatSize = { width: 1, depth: 1.4 };

// ==================================================
// Boot — reveal the stage and lazy-load it when it nears the viewport
// ==================================================
function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGL2RenderingContext && c.getContext("webgl2"));
  } catch {
    return false;
  }
}

function boot() {
  if (!webglAvailable()) return; // #resume stays as the plain document
  section.hidden = false;
  document.body.classList.add("has-stage");

  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      start().catch(fail);
    },
    { rootMargin: "600px 0px" },
  );
  io.observe(section);
}

function fail(err) {
  console.error("[resume stage]", err);
  if (renderer) renderer.setAnimationLoop(null);
  section.hidden = true;
  document.body.classList.remove("has-stage");
}

async function start() {
  await waitForFonts();
  const compact = container.clientWidth < 640;
  pages = paginate(readResume(resumeEl), { compact, continuationBand: CONTINUATION_BAND, layout: SHEET_LAYOUT });
  buildControls();
  buildScene();

  const { loadVATData } = await import("../vendor/paper-crumple/paper-vat.js");
  animData = await loadVATData(new URL("../vat/", import.meta.url).href);
  measureCrumple();
  if (HOOP) buildHoop();

  loadingEl.hidden = true;
  if (MODE === "read") {
    // Nothing on the floor yet — the first sheet simply arrives open.
    setTimeout(() => goTo(0), reduceMotion ? 50 : 300);
    return;
  }
  const dropStagger = reduceMotion ? 0 : 70;
  pages.forEach((page, i) => {
    setTimeout(() => spawnPaper(page, !reduceMotion), i * dropStagger);
  });
  // Unfold the first sheet once the pile has landed.
  setTimeout(() => goTo(0), reduceMotion ? 50 : pages.length * dropStagger + 900);
}

// ==================================================
// Scene
// ==================================================
function buildScene() {
  const ink = token("--jg-ink", "#1d1b1b");
  const floorColor = token("--jg-charcoal", "#404143");

  scene = new THREE.Scene();
  scene.background = new THREE.Color(ink);

  camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Vertical page scroll still works over an embedded stage; a fullscreen stage owns vertical swipes.
  renderer.domElement.style.touchAction = FULL ? "none" : "pan-y";
  container.appendChild(renderer.domElement);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 12),
    new THREE.MeshStandardMaterial({ color: floorColor }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_VISUAL_Y, 1);
  floor.receiveShadow = true;
  scene.add(floor);

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 6),
    new THREE.MeshStandardMaterial({ color: ink }),
  );
  wall.position.set(0, FLOOR_VISUAL_Y + 3, WALL_Z);
  wall.receiveShadow = true;
  scene.add(wall);

  scene.add(new THREE.AmbientLight(0xffffff, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(-2, 2.6, 1.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -3, near: 0.1, far: 12 });
  key.shadow.bias = -0.001;
  scene.add(key);

  // SSAO darkens the creases and dents
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const ssao = new SSAOPass(scene, camera, 1, 1);
  ssao.kernelRadius = 0.01;
  ssao.minDistance = 0.0001;
  ssao.maxDistance = 0.08;
  composer.addPass(ssao);
  composer.addPass(new OutputPass());

  // Physics — crumpled paper is a sphere rigid body
  physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -7.0, 0) });
  physicsWorld.allowSleep = false;
  physicsWorld.defaultContactMaterial.friction = 0.8;
  physicsWorld.defaultContactMaterial.restitution = 0.15;
  paperPhysMat = new CANNON.Material("paper");
  const floorPhysMat = new CANNON.Material("floor");
  physicsWorld.addContactMaterial(
    new CANNON.ContactMaterial(paperPhysMat, floorPhysMat, { friction: 1.0, restitution: 0.12 }),
  );
  physicsWorld.addContactMaterial(
    new CANNON.ContactMaterial(paperPhysMat, paperPhysMat, { friction: 0.6, restitution: 0.3 }),
  );
  floorBody = new CANNON.Body({
    mass: 0,
    material: floorPhysMat,
    shape: new CANNON.Plane(),
    position: new CANNON.Vec3(0, FLOOR_VISUAL_Y, 0),
    quaternion: new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0),
  });
  physicsWorld.addBody(floorBody);
  if (HOOP) {
    // With a hoop the back wall is solid too (a Plane faces +z by default, toward the camera)
    physicsWorld.addBody(
      new CANNON.Body({ mass: 0, material: floorPhysMat, shape: new CANNON.Plane(), position: new CANNON.Vec3(0, 0, WALL_Z) }),
    );
  }

  // Preview label for the ball under the pointer
  tipEl = document.createElement("div");
  tipEl.className = "rs-tip";
  tipEl.setAttribute("aria-hidden", "true");
  tipEl.hidden = true;
  tipEl.innerHTML = '<span class="rs-tip__title"></span><span class="rs-tip__meta"></span>';
  viewport.appendChild(tipEl);
  renderer.domElement.addEventListener("pointerleave", () => setHover(null));

  resize();
  new ResizeObserver(resize).observe(container);

  // Only render while the stage is on screen
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    setRunning(visible && !document.hidden);
  }).observe(section);
  document.addEventListener("visibilitychange", () => setRunning(visible && !document.hidden));

  bindPointer();
}

function setRunning(on) {
  if (on === running) return;
  running = on;
  prevTime = performance.now() / 1000;
  renderer.setAnimationLoop(on ? tick : null);
}

function resize() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  fitCamera(w / h);
}

// Pull the camera back on narrow screens and shrink the floor so every ball stays in frame.
function fitCamera(aspect) {
  camera.aspect = aspect;
  const pull = THREE.MathUtils.clamp(1.5 / aspect, 1, 1.7);
  const targetY = HOOP ? CAMERA_TARGET_Y_HOOP : CAMERA_TARGET_Y;
  camera.position.set(0, CAMERA_BASE.y * pull, CAMERA_BASE.z * pull);
  camera.lookAt(0, targetY, 0);
  camera.updateProjectionMatrix();

  const dist = camera.position.distanceTo(new THREE.Vector3(0, targetY, 0));
  const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist * aspect;
  stageBounds.maxX = Math.min(2.4, halfW * 0.88);
  stageBounds.minX = -stageBounds.maxX;
  updateOpenPose();
  placeHoop();
}

// ==================================================
// Hoop + scoring
// ==================================================
function buildHoop() {
  hoop = createHoop({
    scene,
    world: physicsWorld,
    wallZ: WALL_Z,
    y: HOOP_Y,
    ballRadius: collisionRadius,
    paperMaterial: paperPhysMat,
    colors: {
      board: token("--jg-charcoal", "#404143"),
      frame: token("--jg-surface-bright", "#f4f3f3"),
      rim: token("--jg-orange", "#d7481e"),
      net: token("--jg-surface-bright", "#f4f3f3"),
    },
    logoUrl: new URL("../../ds-bundle/components/Brand/Logo/jg-wht.svg", import.meta.url).href,
  });
  stageBounds.maxZ = HOOP_MAX_Z;
  hoop.group.visible = false;
  placeHoop();
  hoop.group.position.y = hoopAwayY();
}

function placeHoop() {
  if (!hoop) return;
  hoop.place(0); // centre of the back wall
  hoopRestY = fitHoopUnderHud();
  hoop.setY(hoopRestY);
}

// Rim height that puts the backboard's top edge just under the HUD bar: project the bar's bottom
// edge (plus a small gap) onto the backboard plane and subtract the board height above the rim.
const _hudRay = new THREE.Raycaster();
const _boardPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const _hudHit = new THREE.Vector3();
function fitHoopUnderHud() {
  const h = container.clientHeight;
  if (!hudEl || !h) return HOOP_Y;
  const top = container.getBoundingClientRect().top;
  const edge = hudEl.getBoundingClientRect().bottom - top + HUD_GAP_PX;
  _hudRay.setFromCamera(new THREE.Vector2(0, 1 - (2 * edge) / h), camera);
  _boardPlane.constant = -hoop.faceZ;
  if (!_hudRay.ray.intersectPlane(_boardPlane, _hudHit)) return HOOP_Y;
  return THREE.MathUtils.clamp(_hudHit.y - hoop.topOffset, HOOP_Y_MIN, HOOP_Y_MAX);
}

const hoopAwayY = () => hoopRestY + 2.8; // parked above the top of the view

// Drops the hoop in once the last page has been read; lifts it away when a page is reopened.
function setHoopShown(on) {
  if (!hoop || on === hoopShown) return;
  hoopShown = on;
  if (on) {
    hoop.group.visible = true;
  } else {
    hoopArmed = false;
    hoop.arm(false);
  }
}

function updateHoop(dt) {
  if (!hoop || !hoop.group.visible) return;
  const target = hoopShown ? hoopRestY : hoopAwayY();
  const g = hoop.group;
  g.position.y = reduceMotion ? target : THREE.MathUtils.damp(g.position.y, target, 5, dt);
  const settled = Math.abs(g.position.y - target) < 0.005;
  if (settled) g.position.y = target;
  if (hoopShown && settled && !hoopArmed) {
    hoopArmed = true;
    hoop.arm(true);
  } else if (!hoopShown && settled) {
    g.visible = false;
  }
}

// A basket: a shot ball's centre crosses the plane just under the rim, heading down, inside the
// rim. Checked every frame against the previous position so a fast ball can't slip between steps.
function checkBaskets() {
  if (!hoop || !hoopArmed) return;
  const gateY = hoop.center.y - hoop.rimRadius * 0.6;
  const inside = (hoop.rimRadius * 0.95) ** 2;
  for (const p of papers) {
    if (!p || !p.throw || !p.throw.shot || p.throw.scored) continue;
    const b = p.body;
    const y = b.position.y;
    const prevY = p.throw.prevY;
    p.throw.prevY = y;
    if (prevY === undefined || !(prevY > gateY && y <= gateY) || b.velocity.y >= 0) continue;
    const dx = b.position.x - hoop.center.x;
    const dz = b.position.z - hoop.center.z;
    if (dx * dx + dz * dz > inside) continue;
    p.throw.scored = true;
    score.made++;
    updateScore(true);
  }
}

// Lift per unit of horizontal flick speed. The rim height follows the layout (it sits under the
// HUD, so it is higher on portrait screens), and a full-strength flick must always be able to
// peak HOOP_CLEARANCE above it.
function throwLift() {
  const g = -physicsWorld.gravity.y;
  const rise = hoopRestY + HOOP_CLEARANCE - (restCenterY + GRAB_LIFT);
  const needed = rise > 0 ? Math.sqrt(2 * g * rise) / THROW_MAX_SPEED_HOOP : 0;
  return Math.max(THROW_LIFT, needed);
}

function markShot(paper) {
  paper.throw.shot = ++throwCounter;
  score.shots++;
  updateScore(false);
}

function updateScore(made) {
  if (!scoreEl) return;
  scoreEl.hidden = false;
  scoreMadeEl.textContent = String(score.made);
  scoreShotsEl.textContent = String(score.shots);
  if (!made) return;
  scoreEl.classList.remove("is-bump");
  void scoreEl.offsetWidth; // restart the animation
  scoreEl.classList.add("is-bump");
  statusEl.textContent = `Basket! ${score.made} of ${score.shots}.`;
}

// A shot in flight (or a held ball) — the open sheet fades so the hoop stays visible behind it.
function aimingAtHoop() {
  return papers.some(
    (p) =>
      p &&
      (p.state === "grabbed" ||
        (p.state === "rolling" && p.throw && p.throw.shot && p.time < 4 && !isOnGround(p.body))),
  );
}

function updateSheetDim(dt) {
  if (!HOOP || !hoopShown || !activePaper || activePaper.state !== "open") return;
  const mat = activePaper.material;
  const target = aimingAtHoop() ? SHEET_DIM : 1;
  mat.opacity = THREE.MathUtils.damp(mat.opacity, target, 8, dt);
  mat.transparent = mat.opacity < 0.999;
}

// ==================================================
// Paper meshes + sheet textures
// ==================================================
function measureCrumple() {
  flatSize.width = animData.flat.width;
  flatSize.depth = animData.flat.depth;
  crumpleCenter.fromArray(animData.crumple.center);
  collisionRadius = animData.crumple.radius * CLOSED_SCALE;
  restCenterY = FLOOR_VISUAL_Y + collisionRadius * 1.08;
  restMeshY = restCenterY - crumpleCenter.y * CLOSED_SCALE;
  floorBody.position.y = restCenterY - collisionRadius;
}

function makeSheetTexture(page, width) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round((width * PAGE_H) / PAGE_W);
  drawPage(canvas.getContext("2d"), page, width / PAGE_W);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Match the VAT mesh UVs
  tex.rotation = Math.PI;
  tex.center.set(0.5, 0.5);
  tex.repeat.set(1, -1);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// Balls wear a small texture; only the sheet being read gets a full-resolution one.
function hiResWidth() {
  const sheetCssH = container.clientHeight * OPEN_HEIGHT_RATIO;
  const px = (sheetCssH * PAGE_W) / PAGE_H * renderer.getPixelRatio();
  return THREE.MathUtils.clamp(Math.ceil(px / 256) * 256, 768, 1536);
}

function setHiRes(paper, on) {
  if (on && !paper.hiTex) {
    paper.hiTex = makeSheetTexture(paper.page, hiResWidth());
    paper.material.map = paper.hiTex;
  } else if (!on && paper.hiTex) {
    paper.material.map = paper.lowTex;
    paper.hiTex.dispose();
    paper.hiTex = null;
  }
}

function createPaperMesh(material) {
  const { vertexCount, indices, uvs, positions, normals } = animData;
  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(new Float32Array(positions.subarray(0, vertexCount * 3)), 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttr);
  const normalAttr = new THREE.BufferAttribute(new Float32Array(normals.subarray(0, vertexCount * 3)), 3);
  normalAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("normal", normalAttr);
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
  return { mesh: new THREE.Mesh(geometry, material), positionAttr, normalAttr };
}

// Sets the geometry to a (fractional) VAT frame, lerping between neighbours.
function updatePaperFrame(paper, frameIdx) {
  const { vertexCount, frameCount, positions, normals } = animData;
  const len = vertexCount * 3;
  const f0 = Math.floor(frameIdx);
  const t = frameIdx - f0;
  const off0 = f0 * len;
  const off1 = Math.min(f0 + 1, frameCount - 1) * len;
  const pos = paper.positionAttr.array;
  const nrm = paper.normalAttr.array;
  const s = 1 - t;
  for (let i = 0; i < len; i++) {
    pos[i] = positions[off0 + i] * s + positions[off1 + i] * t;
    nrm[i] = normals[off0 + i] * s + normals[off1 + i] * t;
  }
  paper.positionAttr.needsUpdate = true;
  paper.normalAttr.needsUpdate = true;
  paper.mesh.geometry.computeBoundingSphere();
  paper.mesh.geometry.computeBoundingBox();
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

// Which side of the stage a page belongs on: even pages left, odd pages right, so the pile
// spreads beside the open sheet and the centre lane stays clear.
const sideOf = (page) => (page.index % 2 === 0 ? -1 : 1);

function spawnPosition(side = 0) {
  const margin = collisionRadius * 1.3;
  const lane = collisionRadius * 1.5; // keep clear of the centre line
  const pos = new THREE.Vector3(0, restMeshY, 0);
  for (let attempt = 0; attempt < 40; attempt++) {
    pos.x =
      side < 0
        ? randomRange(stageBounds.minX + margin, -lane)
        : side > 0
          ? randomRange(lane, stageBounds.maxX - margin)
          : randomRange(stageBounds.minX + margin, stageBounds.maxX - margin);
    pos.z = randomRange(stageBounds.minZ + margin, stageBounds.maxZ - margin);
    const clear = papers.every((p) => {
      if (!p) return true; // read mode: unread pages have no paper yet
      const dx = p.body.position.x - pos.x;
      const dz = p.body.position.z - pos.z;
      return dx * dx + dz * dz > (collisionRadius * 2.2) ** 2;
    });
    if (clear) break;
  }
  return pos;
}

function spawnPaper(page, dropIn, dropHeight = randomRange(3.5, 6.5)) {
  const maxFrame = animData.frameCount - 1;
  const lowTex = makeSheetTexture(page, LOW_TEX_W);
  const material = new THREE.MeshStandardMaterial({
    map: lowTex,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const base = createPaperMesh(material);
  base.mesh.castShadow = true;
  base.mesh.rotation.set(0, Math.PI + randomRange(-0.25, 0.25), randomRange(-0.18, 0.18));
  base.mesh.position.copy(spawnPosition(sideOf(page)));
  base.mesh.scale.setScalar(CLOSED_SCALE);
  scene.add(base.mesh);

  const paper = {
    ...base,
    page,
    material,
    lowTex,
    hiTex: null,
    body: null,
    frameIdx: maxFrame,
    state: "closed",
    time: 0,
    start: null,
    target: null,
    throw: null,
    grab: null,
  };
  paper.body = createPaperBody(paper);
  updatePaperFrame(paper, maxFrame);
  papers[page.index] = paper;

  if (dropIn) {
    paper.state = "rolling";
    paper.throw = { settleTimer: 0 };
    paper.body.position.y += dropHeight;
    paper.body.angularVelocity.set(randomRange(-1.5, 1.5), randomRange(-0.5, 0.5), randomRange(-1.5, 1.5));
    syncMeshToBody(paper);
  }
  return paper;
}

function removePaper(paper) {
  if (pointerState && pointerState.paper === paper) pointerState = null;
  if (activePaper === paper) activePaper = null;
  scene.remove(paper.mesh);
  physicsWorld.removeBody(paper.body);
  paper.mesh.geometry.dispose();
  paper.lowTex.dispose();
  if (paper.hiTex) paper.hiTex.dispose();
  paper.material.dispose();
  papers[paper.page.index] = undefined;
}

const _camUp = new THREE.Vector3();
function cameraUp() {
  return _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
}

// Read mode: a sheet that arrives already open, fading in from just above the open pose.
function spawnOpen(page) {
  const paper = spawnPaper(page, false);
  setPaperBodyDynamic(paper, false);
  setHiRes(paper, true);
  const pose = computeOpenPose();
  paper.frameIdx = OPEN_FRAME;
  updatePaperFrame(paper, OPEN_FRAME);
  paper.mesh.quaternion.copy(pose.quaternion);
  paper.target = { ...pose, frameIdx: OPEN_FRAME };
  paper.start = {
    position: pose.position.clone().addScaledVector(cameraUp(), ARRIVE_LIFT),
    scale: pose.scale * 0.94,
  };
  paper.mesh.position.copy(paper.start.position);
  paper.mesh.scale.setScalar(paper.start.scale);
  paper.material.transparent = true;
  paper.material.opacity = 0;
  paper.state = "arriving";
  paper.time = 0;
  return paper;
}

// Read mode: fade a sheet out and remove it. An open sheet floats up as it goes; a ball just fades.
function startVanish(paper, lift) {
  if (paper.state === "vanishing") return;
  setPaperBodyDynamic(paper, false);
  paper.state = "vanishing";
  paper.time = 0;
  paper.material.transparent = true;
  paper.vanishFrom = paper.material.opacity;
  paper.start = lift
    ? {
        position: paper.mesh.position.clone(),
        exit: paper.mesh.position.clone().addScaledVector(cameraUp(), ARRIVE_LIFT),
      }
    : null;
}

// Read mode: run `cb` once a tossed sheet touches the floor (or another ball), with a fallback timer.
// Returns a cancel function.
function awaitLanding(paper, cb) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    paper.body.removeEventListener("collide", finish);
    clearTimeout(timer);
    cb();
  };
  const timer = setTimeout(finish, reduceMotion ? 0 : LAND_TIMEOUT_MS);
  paper.body.addEventListener("collide", finish);
  return () => {
    done = true;
    paper.body.removeEventListener("collide", finish);
    clearTimeout(timer);
  };
}

// ==================================================
// Physics helpers (from the demo)
// ==================================================
const _crumpleOffset = new THREE.Vector3();
function crumpleWorldOffset(scale, quaternion) {
  return _crumpleOffset.copy(crumpleCenter).multiplyScalar(scale).applyQuaternion(quaternion);
}

function createPaperBody(paper) {
  const off = crumpleWorldOffset(CLOSED_SCALE, paper.mesh.quaternion);
  const body = new CANNON.Body({
    mass: PAPER_MASS,
    material: paperPhysMat,
    shape: new CANNON.Sphere(collisionRadius),
    linearDamping: 0.15,
    angularDamping: 0.35,
    position: new CANNON.Vec3(
      paper.mesh.position.x + off.x,
      paper.mesh.position.y + off.y,
      paper.mesh.position.z + off.z,
    ),
  });
  const q = paper.mesh.quaternion;
  body.quaternion.set(q.x, q.y, q.z, q.w);
  physicsWorld.addBody(body);
  return body;
}

function setPaperBodyDynamic(paper, enabled) {
  const body = paper.body;
  body.type = enabled ? CANNON.Body.DYNAMIC : CANNON.Body.KINEMATIC;
  body.mass = enabled ? PAPER_MASS : 0;
  body.collisionFilterGroup = enabled ? 1 : 0;
  body.collisionFilterMask = enabled ? 1 : 0;
  if (!enabled) {
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.force.set(0, 0, 0);
    body.torque.set(0, 0, 0);
  }
  body.updateMassProperties();
  body.wakeUp();
}

function syncBodyToMesh(paper) {
  const off = crumpleWorldOffset(paper.mesh.scale.x, paper.mesh.quaternion);
  const p = paper.mesh.position;
  const q = paper.mesh.quaternion;
  paper.body.position.set(p.x + off.x, p.y + off.y, p.z + off.z);
  paper.body.quaternion.set(q.x, q.y, q.z, q.w);
}

function syncMeshToBody(paper, scale = CLOSED_SCALE) {
  const bq = paper.body.quaternion;
  paper.mesh.quaternion.set(bq.x, bq.y, bq.z, bq.w);
  const off = crumpleWorldOffset(scale, paper.mesh.quaternion);
  const bp = paper.body.position;
  paper.mesh.position.set(bp.x - off.x, bp.y - off.y, bp.z - off.z);
  paper.mesh.scale.setScalar(scale);
}

function isOnGround(body) {
  return body.position.y <= restCenterY + 0.05;
}

function applyRollingResistance(body, dt) {
  const linearDecay = Math.exp(-ROLL_LINEAR_RESISTANCE * dt);
  const angularDecay = Math.exp(-ROLL_ANGULAR_RESISTANCE * dt);
  body.velocity.x *= linearDecay;
  body.velocity.z *= linearDecay;
  body.angularVelocity.x *= angularDecay;
  body.angularVelocity.y *= angularDecay;
  body.angularVelocity.z *= angularDecay;
}

// Reflect bodies that leave the floor and ease them back in (no teleporting).
function applyPhysicsBounds(dt) {
  const minX = stageBounds.minX + collisionRadius;
  const maxX = stageBounds.maxX - collisionRadius;
  const minZ = stageBounds.minZ + collisionRadius;
  const maxZ = stageBounds.maxZ - collisionRadius;
  for (const paper of papers) {
    if (!paper || paper.body.type !== CANNON.Body.DYNAMIC) continue;
    const { position: p, velocity: v } = paper.body;
    if (p.x < minX) {
      if (v.x < 0) v.x = Math.abs(v.x) * 0.42;
      v.x += BOUNDS_PULL * dt;
    } else if (p.x > maxX) {
      if (v.x > 0) v.x = -Math.abs(v.x) * 0.42;
      v.x -= BOUNDS_PULL * dt;
    }
    if (p.z < minZ) {
      if (v.z < 0) v.z = Math.abs(v.z) * 0.42;
      v.z += BOUNDS_PULL * dt;
    } else if (p.z > maxZ) {
      if (v.z > 0) v.z = -Math.abs(v.z) * 0.42;
      v.z -= BOUNDS_PULL * dt;
    }
  }
}

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const lerp = (a, b, t) => a + (b - a) * t;

function captureTransform(paper) {
  return {
    position: paper.mesh.position.clone(),
    quaternion: paper.mesh.quaternion.clone(),
    scale: paper.mesh.scale.x,
    frameIdx: paper.frameIdx,
  };
}

// The open sheet faces the camera OPEN_DISTANCE ahead of it, as large as the view allows.
const _viewDir = new THREE.Vector3();
function computeOpenPose() {
  camera.getWorldDirection(_viewDir);
  const position = camera.position.clone().addScaledVector(_viewDir, OPEN_DISTANCE);
  const yAxis = _viewDir.clone().negate();
  const zAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis),
  );
  const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * OPEN_DISTANCE;
  const viewW = viewH * camera.aspect;
  const scale = Math.min(
    (viewH * OPEN_HEIGHT_RATIO) / flatSize.depth,
    (viewW * OPEN_WIDTH_RATIO) / flatSize.width,
  );
  return { position, quaternion, scale };
}

function updateOpenPose() {
  if (!activePaper) return;
  const pose = computeOpenPose();
  if (activePaper.state === "opening" || activePaper.state === "arriving") {
    activePaper.target.position.copy(pose.position);
    activePaper.target.quaternion.copy(pose.quaternion);
    activePaper.target.scale = pose.scale;
  } else if (activePaper.state === "open") {
    activePaper.mesh.position.copy(pose.position);
    activePaper.mesh.quaternion.copy(pose.quaternion);
    activePaper.mesh.scale.setScalar(pose.scale);
  }
}

// ==================================================
// Open / discard
// ==================================================
function startOpen(paper) {
  // A ball on the floor or in hand has its mesh at closed scale; a sheet mid-discard doesn't.
  if (paper.state !== "discarding") syncMeshToBody(paper);
  if (paper.state === "grabbed" && pointerState) pointerState = null;
  setPaperBodyDynamic(paper, false);
  setHiRes(paper, true);
  paper.state = "opening";
  paper.time = 0;
  paper.start = captureTransform(paper);
  const pose = computeOpenPose();
  paper.target = { ...pose, frameIdx: OPEN_FRAME };
}

// direction: -1 tosses to the left (paging forward), +1 to the right (paging back)
// Crumples the open sheet and tosses it to its side of the stage (see sideOf), a little backward.
function startDiscard(paper) {
  if (paper.state === "discarding" || paper.state === "rolling") return;
  const dir = new THREE.Vector3(
    sideOf(paper.page) * randomRange(0.75, 1),
    0,
    randomRange(-0.55, 0.05),
  ).normalize();
  paper.material.opacity = 1;
  paper.material.transparent = false;
  paper.state = "discarding";
  paper.time = 0;
  paper.start = captureTransform(paper);
  setPaperBodyDynamic(paper, true);
  syncBodyToMesh(paper);
  paper.body.velocity.set(dir.x * randomRange(1.4, 2.0), randomRange(0.5, 0.9), dir.z * randomRange(1.4, 2.0));
  paper.body.angularVelocity.set(randomRange(-2.4, 2.4), randomRange(-0.8, 0.8), randomRange(-2.4, 2.4));
  paper.throw = { settleTimer: 0 };
}

// ==================================================
// Navigation
// ==================================================
// index === pages.length means "finished": every page is crumpled on the floor, nothing is open.
function goTo(index) {
  if (!animData || !pages.length) return;
  index = Math.max(0, Math.min(index, pages.length));
  closeMenu(false);
  if (index === current) return;
  if (MODE === "read") goToRead(index);
  else goToPile(index);
  current = index;
  setHover(null);
  setHoopShown(index >= pages.length);
  updateControls(true);
}

// Pile mode: every sheet already exists as a ball; swap which one is open.
function goToPile(index) {
  if (activePaper) startDiscard(activePaper);
  activePaper = null;
  const target = papers[index];
  if (!target) return; // finished — everything is on the pile
  startOpen(target);
  activePaper = target;
}

// Read mode: the floor holds exactly the sheets before `current`, as balls.
function goToRead(index) {
  const leaving = activePaper;
  activePaper = null;

  // Navigated again before the next sheet arrived: that sheet was never read. Moving on past it
  // drops it on the floor like any skipped page; moving back just forgets it.
  if (pendingArrival) {
    pendingArrival.cancel();
    const skipped = pendingArrival.index;
    pendingArrival = null;
    if (index > skipped && !papers[skipped]) spawnPaper(pages[skipped], true);
  }

  if (index > current) {
    // Skipped sheets land on the floor as read, raining in one after another.
    for (let i = current + 1; i < index; i++) {
      if (!papers[i]) spawnPaper(pages[i], true, 3 + (i - current) * 0.5);
    }
    if (index >= pages.length) {
      if (leaving) startDiscard(leaving);
      return; // finished — nothing else to open
    }
    if (!leaving) {
      activePaper = spawnOpen(pages[index]);
      return;
    }
    // The finished sheet is crumpled and tossed; the next one arrives once it has landed.
    startDiscard(leaving);
    const cancel = awaitLanding(leaving, () => {
      pendingArrival = null;
      activePaper = spawnOpen(pages[index]);
    });
    pendingArrival = { index, cancel };
    return;
  }

  if (leaving) startVanish(leaving, true);
  for (let i = index + 1; i < current; i++) {
    if (papers[i]) startVanish(papers[i], false);
  }
  const target = papers[index];
  if (target && target.state !== "vanishing") {
    startOpen(target);
    activePaper = target;
  } else {
    activePaper = spawnOpen(pages[index]);
  }
}

const next = () => goTo(current + 1);
const prev = () => goTo(current - 1);

// "Code42", "Code42 (cont.)", or "Code42 (cont.) · Linnihan Foy" when sections share a sheet
function pageLabel(page) {
  return page.parts.map((p) => (p.cont ? `${p.title} (cont.)` : p.title)).join(" · ");
}

function buildControls() {
  // One chip per section, pointing at the sheet where it starts
  tocEl.replaceChildren();
  pages.toc.forEach((entry) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rs-chip jg-heading";
      btn.textContent = entry.nav;
      btn.dataset.section = String(entry.sectionIndex);
      btn.addEventListener("click", () => goTo(entry.pageIndex));
      li.append(btn);
      tocEl.append(li);
    });

  prevBtns.forEach((b) => b.addEventListener("click", prev));
  nextBtns.forEach((b) => b.addEventListener("click", next));
  viewport.addEventListener("keydown", onKey);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  const bar = section.querySelector(".rs-stage__bar");
  if (bar) bar.addEventListener("keydown", onKey);

  if (textToggle) {
    textToggle.addEventListener("click", () => {
      const open = resumeEl.classList.toggle("is-open");
      textToggle.setAttribute("aria-expanded", String(open));
      textToggle.textContent = open ? "Hide text version" : "Read as text";
      closeMenu(false);
      if (open) resumeEl.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    });
  }

  if (menuBtn && menuEl) {
    menuBtn.addEventListener("click", openMenu);
    menuEl.querySelector("[data-menu-close]")?.addEventListener("click", () => closeMenu(true));
    menuEl.addEventListener("click", (e) => {
      if (e.target === menuEl) closeMenu(true); // backdrop
    });
    menuEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu(true);
      }
    });
  }

  updateControls(false);
}

// ---------- navigation overlay (v2) ----------
const menuOpen = () => !!menuEl && !menuEl.hidden;

function openMenu() {
  if (!menuEl || menuOpen()) return;
  menuEl.hidden = false;
  menuBtn.setAttribute("aria-expanded", "true");
  (menuEl.querySelector("[data-menu-close]") || menuEl).focus();
}

// restoreFocus: back to the Menu button when the visitor dismissed it; otherwise (a page was
// chosen) focus lands on the stage so the arrow keys keep working.
function closeMenu(restoreFocus) {
  if (!menuOpen()) return;
  menuEl.hidden = true;
  menuBtn.setAttribute("aria-expanded", "false");
  if (restoreFocus) menuBtn.focus();
  else viewport.focus({ preventScroll: true });
}

function onKey(e) {
  const keys = {
    ArrowRight: next,
    ArrowDown: next,
    PageDown: next,
    ArrowLeft: prev,
    ArrowUp: prev,
    PageUp: prev,
    Home: () => goTo(0),
    End: () => goTo(pages.length - 1),
  };
  const action = keys[e.key];
  if (!action || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  action();
}

// Scrolling over the stage turns pages. At either end the event is left alone so the rest of the
// site still scrolls normally.
let wheelLockUntil = 0;
function onWheel(e) {
  if (!animData || !pages.length || menuOpen() || Math.abs(e.deltaY) < WHEEL_MIN_DELTA) return;
  const forward = e.deltaY > 0;
  if (forward ? current >= pages.length : current <= 0) return;
  e.preventDefault();
  const now = performance.now();
  if (now < wheelLockUntil) return;
  wheelLockUntil = now + WHEEL_COOLDOWN_MS;
  if (forward) next();
  else prev();
}

function updateControls(announce) {
  const total = pages.length;
  const finished = current >= total;
  const page = finished ? null : pages[Math.max(current, 0)];
  const pad = (n) => String(n).padStart(2, "0");
  const counter = `${pad(finished ? total : Math.max(current, 0) + 1)} / ${pad(total)}`;
  const label = finished ? (HOOP ? "All pages read · shoot!" : "All pages read") : page ? pageLabel(page) : "";
  counterEls.forEach((el) => (el.textContent = counter));
  labelEls.forEach((el) => (el.textContent = label));
  prevBtns.forEach((b) => (b.disabled = current <= 0));
  nextBtns.forEach((b) => (b.disabled = current < 0 || finished));
  for (const chip of tocEl.querySelectorAll("button")) {
    const on = !!page && page.parts.some((p) => String(p.sectionIndex) === chip.dataset.section);
    chip.classList.toggle("is-active", on);
    if (on) chip.setAttribute("aria-current", "step");
    else chip.removeAttribute("aria-current");
  }
  if (!announce) return;
  statusEl.textContent = finished
    ? HOOP
      ? `All ${total} pages read. A hoop has dropped onto the back wall — flick a crumpled page at it. Use Back or click a page to reopen one.`
      : `All ${total} pages read. Use Back or click a crumpled page to reopen one.`
    : page
      ? `Page ${current + 1} of ${total}: ${pageLabel(page)}`
      : "";
}

// ==================================================
// Pointer — click a ball to jump to it, click the open sheet to turn the page,
// swipe to page, drag a ball to pick it up and toss it
// ==================================================
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const grabPlane = new THREE.Plane();
const grabHitPoint = new THREE.Vector3();

function updatePointer(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

// Nearest paper under the pointer — except that a ball sitting behind the open sheet wins over
// the sheet, so balls stay grabbable when the sheet covers most of the view (phones, the hoop).
function pickPaper(e) {
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  const live = papers.filter(Boolean);
  const hits = raycaster.intersectObjects(live.map((p) => p.mesh));
  if (!hits.length) return null;
  const byMesh = (h) => live.find((p) => p.mesh === h.object) || null;
  const ball = hits.map(byMesh).find((p) => p && isGrabbable(p));
  return ball || byMesh(hits[0]);
}

const isGrabbable = (p) => p.state === "closed" || p.state === "rolling";

function bindPointer() {
  const el = renderer.domElement;

  el.addEventListener("pointerdown", (e) => {
    if (!animData || pointerState) return;
    const p = pickPaper(e);
    pointerState = { paper: p, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, grabbing: false };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events may carry an invalid pointerId
    }
    if (p && p.state === "rolling") beginGrab(p, e);
  });

  el.addEventListener("pointermove", (e) => {
    if (!pointerState) {
      updateHoverCursor(e);
      return;
    }
    if (e.pointerId !== pointerState.pointerId) return;
    if (!pointerState.grabbing) {
      const p = pointerState.paper;
      const moved = Math.hypot(e.clientX - pointerState.startX, e.clientY - pointerState.startY);
      if (p && isGrabbable(p) && moved > CLICK_DRAG_THRESHOLD_PX) beginGrab(p, e);
    }
    if (pointerState.grabbing) updateGrabTarget(pointerState.paper, e);
  });

  el.addEventListener("pointerup", (e) => {
    if (!pointerState || e.pointerId !== pointerState.pointerId) return;
    const dx = e.clientX - pointerState.startX;
    const dy = e.clientY - pointerState.startY;
    if (pointerState.grabbing) {
      releaseGrab(pointerState.paper, true);
    } else if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) next();
      else prev();
    } else if (FULL && Math.abs(dy) > SWIPE_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx) * 1.5) {
      // Fullscreen: a vertical swipe turns the page; past the last page it scrolls on to the site.
      if (dy > 0) prev();
      else if (current >= pages.length) window.scrollBy({ top: window.innerHeight * 0.9, behavior: reduceMotion ? "auto" : "smooth" });
      else next();
    } else if (Math.hypot(dx, dy) <= CLICK_DRAG_THRESHOLD_PX * 2) {
      handleClick(e);
    }
    pointerState = null;
  });

  el.addEventListener("pointercancel", (e) => {
    if (!pointerState || e.pointerId !== pointerState.pointerId) return;
    if (pointerState.grabbing) releaseGrab(pointerState.paper, false);
    pointerState = null;
  });
}

function updateHoverCursor(e) {
  if (!animData) return;
  const p = pickPaper(e);
  renderer.domElement.style.cursor = p ? (isGrabbable(p) ? "grab" : "pointer") : "";
  if (e.pointerType !== "touch") setHover(p && isGrabbable(p) ? p : null);
}

// ---------- hover / tap preview ----------
function setHover(paper) {
  if (paper === hoverPaper) return;
  if (hoverPaper) hoverPaper.material.emissive.set(0x000000);
  hoverPaper = paper;
  if (!paper) {
    tipEl.hidden = true;
    return;
  }
  paper.material.emissive.copy(HOVER_GLOW);
  paper.material.emissiveIntensity = 0.35;
  const page = paper.page;
  tipEl.querySelector(".rs-tip__title").textContent = page.parts.map((p) => p.title).join(" · ");
  tipEl.querySelector(".rs-tip__meta").textContent =
    `Page ${page.index + 1} / ${pages.length}` + (page.parts[0].cont ? " · continued" : "");
  tipEl.hidden = false;
  updateTip();
}

const _tipPos = new THREE.Vector3();
function updateTip() {
  if (!hoverPaper) return;
  if (!isGrabbable(hoverPaper)) {
    setHover(null);
    return;
  }
  _tipPos.copy(hoverPaper.mesh.position).project(camera);
  const w = container.clientWidth;
  const h = container.clientHeight;
  const x = ((_tipPos.x + 1) / 2) * w;
  const y = ((1 - _tipPos.y) / 2) * h;
  const lift = collisionRadius * 2.2 * (h / 2) / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.distanceTo(hoverPaper.mesh.position));
  tipEl.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${(y - lift).toFixed(1)}px)`;
}

function handleClick(e) {
  const p = pickPaper(e);
  if (!p || p.state === "vanishing") {
    setHover(null);
    return;
  }
  if (p === activePaper) {
    next();
    return;
  }
  // Touch has no hover: the first tap previews the page, a second tap on it opens it.
  if (e.pointerType === "touch" && isGrabbable(p) && hoverPaper !== p) {
    setHover(p);
    return;
  }
  goTo(p.page.index);
}

function beginGrab(paper, e) {
  setHover(null);
  pointerState.grabbing = true;
  paper.state = "grabbed";
  paper.time = 0;
  const body = paper.body;
  body.type = CANNON.Body.KINEMATIC;
  body.mass = 0;
  body.updateMassProperties();
  body.velocity.set(0, 0, 0);
  body.angularVelocity.set(0, 0, 0);
  body.collisionFilterGroup = 1; // keep shoving other balls while held
  body.collisionFilterMask = 1;
  body.wakeUp();
  paper.grab = { target: new THREE.Vector3(body.position.x, restCenterY + GRAB_LIFT, body.position.z), samples: [] };
  updateGrabTarget(paper, e);
  renderer.domElement.style.cursor = "grabbing";
}

function updateGrabTarget(paper, e) {
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  grabPlane.normal.set(0, 1, 0);
  grabPlane.constant = -(restCenterY + GRAB_LIFT);
  if (!raycaster.ray.intersectPlane(grabPlane, grabHitPoint)) return;
  paper.grab.target.set(
    THREE.MathUtils.clamp(grabHitPoint.x, stageBounds.minX + collisionRadius, stageBounds.maxX - collisionRadius),
    restCenterY + GRAB_LIFT,
    THREE.MathUtils.clamp(grabHitPoint.z, stageBounds.minZ + collisionRadius, stageBounds.maxZ - collisionRadius),
  );
  // Keep a short history of where the pointer was, so a release can measure the flick itself
  // (independent of frame rate and of how far the ball lags behind the pointer).
  const samples = paper.grab.samples;
  samples.push({ t: performance.now(), x: grabHitPoint.x, z: grabHitPoint.z });
  while (samples.length > 1 && samples[0].t < samples[samples.length - 1].t - FLICK_WINDOW_MS) samples.shift();
}

// Pointer velocity over the last FLICK_WINDOW_MS, on the grab plane (world units per second).
function flickVelocity(paper) {
  const samples = paper.grab && paper.grab.samples;
  if (!samples || samples.length < 2) return null;
  const a = samples[0];
  const b = samples[samples.length - 1];
  const dt = (b.t - a.t) / 1000;
  if (dt < 0.016) return null;
  return { x: (b.x - a.x) / dt, z: (b.z - a.z) / dt };
}

function releaseGrab(paper, withThrow) {
  if (!paper || paper.state !== "grabbed") return;
  const body = paper.body;
  // Throw with the pointer's own flick velocity; fall back to the spring velocity (e.g. no samples)
  const flick = withThrow ? flickVelocity(paper) : null;
  let vx = withThrow ? (flick ? flick.x : body.velocity.x) : 0;
  let vz = withThrow ? (flick ? flick.z : body.velocity.z) : 0;
  let speed = Math.hypot(vx, vz);
  const maxSpeed = HOOP ? THROW_MAX_SPEED_HOOP : THROW_MAX_SPEED;
  if (speed > maxSpeed) {
    vx *= maxSpeed / speed;
    vz *= maxSpeed / speed;
    speed = maxSpeed;
  }
  // With a hoop, every flick lobs: lift scales with how hard it was thrown
  const vy = HOOP && withThrow ? speed * throwLift() : 0;
  body.type = CANNON.Body.DYNAMIC;
  body.mass = PAPER_MASS;
  body.updateMassProperties();
  body.velocity.set(vx, vy, vz);
  body.angularVelocity.set((vz / collisionRadius) * 0.6, 0, (-vx / collisionRadius) * 0.6);
  body.wakeUp();
  paper.state = "rolling";
  paper.time = 0;
  paper.throw = { settleTimer: 0 };
  if (HOOP && hoopArmed && withThrow && speed >= SHOT_MIN_SPEED) markShot(paper);
  renderer.domElement.style.cursor = "grab";
}

// ==================================================
// Frame loop
// ==================================================
function tick() {
  const now = performance.now() / 1000;
  const dt = now - prevTime;
  prevTime = now;

  if (animData) {
    physicsWorld.step(PHYSICS_STEP, Math.min(dt, 0.05), 3);
    applyPhysicsBounds(dt);
    for (const p of papers) if (p) updatePaperMotion(p, dt);
    updateHoop(dt);
    checkBaskets();
    updateSheetDim(dt);
    updateTip();
  }
  composer.render();
}

function updatePaperMotion(paper, dt) {
  const maxFrame = animData.frameCount - 1;

  if (paper.state === "opening") {
    paper.time += dt * SPEED;
    const t = clamp01(paper.time / OPEN_DURATION);
    const e = easeOutCubic(t);
    paper.mesh.position.lerpVectors(paper.start.position, paper.target.position, e);
    paper.mesh.quaternion.slerpQuaternions(paper.start.quaternion, paper.target.quaternion, e);
    paper.mesh.scale.setScalar(lerp(paper.start.scale, paper.target.scale, e));
    paper.frameIdx = lerp(paper.start.frameIdx, paper.target.frameIdx, easeInCubic(t));
    updatePaperFrame(paper, paper.frameIdx);
    if (t >= 1) {
      paper.state = "open";
      paper.frameIdx = paper.target.frameIdx;
      paper.mesh.position.copy(paper.target.position);
      paper.mesh.quaternion.copy(paper.target.quaternion);
      paper.mesh.scale.setScalar(paper.target.scale);
      syncBodyToMesh(paper);
      updatePaperFrame(paper, paper.frameIdx);
    }
    return;
  }

  if (paper.state === "arriving") {
    paper.time += dt * SPEED;
    const t = clamp01(paper.time / ARRIVE_DURATION);
    const e = easeOutCubic(t);
    paper.mesh.position.lerpVectors(paper.start.position, paper.target.position, e);
    paper.mesh.scale.setScalar(lerp(paper.start.scale, paper.target.scale, e));
    paper.material.opacity = e;
    if (t >= 1) {
      paper.state = "open";
      paper.material.opacity = 1;
      paper.material.transparent = false;
      paper.mesh.position.copy(paper.target.position);
      paper.mesh.scale.setScalar(paper.target.scale);
      syncBodyToMesh(paper);
    }
    return;
  }

  if (paper.state === "vanishing") {
    paper.time += dt * SPEED;
    const t = clamp01(paper.time / VANISH_DURATION);
    paper.material.opacity = paper.vanishFrom * (1 - t);
    if (paper.start) {
      paper.mesh.position.lerpVectors(paper.start.position, paper.start.exit, easeInCubic(t));
    }
    if (t >= 1) removePaper(paper);
    return;
  }

  if (paper.state === "discarding") {
    paper.time += dt * SPEED;
    const t = clamp01(paper.time / DISCARD_DURATION);
    const e = easeOutCubic(t);
    paper.frameIdx = lerp(paper.start.frameIdx, maxFrame, e);
    syncMeshToBody(paper, lerp(paper.start.scale, CLOSED_SCALE, e));
    updatePaperFrame(paper, paper.frameIdx);
    if (t >= 1) {
      paper.state = "rolling";
      paper.time = 0;
      paper.frameIdx = maxFrame;
      updatePaperFrame(paper, paper.frameIdx);
      setHiRes(paper, false);
    }
    return;
  }

  if (paper.state === "grabbed") {
    const body = paper.body;
    const target = paper.grab.target;
    // Spring toward the pointer; KINEMATIC so step() integrates it and it shoves other balls
    let vx = (target.x - body.position.x) * GRAB_STIFFNESS;
    let vy = (target.y - body.position.y) * GRAB_STIFFNESS;
    let vz = (target.z - body.position.z) * GRAB_STIFFNESS;
    const speed = Math.hypot(vx, vy, vz);
    if (speed > GRAB_MAX_SPEED) {
      const k = GRAB_MAX_SPEED / speed;
      vx *= k;
      vy *= k;
      vz *= k;
    }
    body.velocity.set(vx, vy, vz);
    syncMeshToBody(paper);
    return;
  }

  if (paper.state === "rolling") {
    paper.time += dt;
    const grounded = isOnGround(paper.body);
    if (grounded) applyRollingResistance(paper.body, dt);
    syncMeshToBody(paper);
    const speed = paper.body.velocity.lengthSquared() + paper.body.angularVelocity.lengthSquared() * 0.02;
    paper.throw.settleTimer = grounded && speed < ROLL_SETTLE_SPEED ? paper.throw.settleTimer + dt : 0;
    if (paper.throw.settleTimer > 0.35) {
      paper.state = "closed";
      paper.time = 0;
    }
    return;
  }

  if (paper.state === "closed") {
    if (isOnGround(paper.body)) applyRollingResistance(paper.body, dt);
    syncMeshToBody(paper);
  }
}

// Test hook: lets a headless driver read the stage state (which page is open, what's on the floor).
section.__stage = () => ({
  current,
  pending: pendingArrival && pendingArrival.index,
  papers: papers.map((p) => p && p.state),
  score: { ...score },
  ballRadius: collisionRadius,
  hoop: hoop ? { ...hoop.center, r: hoop.rimRadius, shown: hoopShown, armed: hoopArmed, visible: hoop.group.visible, meshY: +hoop.group.position.y.toFixed(2) } : null,
  activeOpacity: activePaper ? activePaper.material.opacity : null,
  throwLift: HOOP && physicsWorld ? throwLift() : null,
  releaseY: restCenterY + GRAB_LIFT,
  hover: hoverPaper ? hoverPaper.page.index : null,
  tip: tipEl && !tipEl.hidden ? tipEl.textContent : null,
  pos: (i) => papers[i] && papers[i].body.position.toArray(),
  vel: (i) => papers[i] && papers[i].body.velocity.toArray(),
  // client-pixel position of a ball, for scripted pointer flicks
  screen: (i) => {
    const p = papers[i];
    if (!p) return null;
    const v = p.mesh.position.clone().project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  },
  // drop a ball from directly above the rim — must always score
  drop: (i) => {
    const p = papers[i];
    if (!p || !hoopArmed) return false;
    setPaperBodyDynamic(p, true);
    p.body.position.set(hoop.center.x, hoop.center.y + 0.7, hoop.center.z);
    p.body.velocity.set(0, 0, 0);
    p.body.angularVelocity.set(0, 0, 0);
    p.state = "rolling";
    p.time = 0;
    p.throw = { settleTimer: 0 };
    markShot(p);
    return true;
  },
  // launch a ball with an exact velocity (optionally from a given point), to exercise the rim
  shoot: (i, vx, vy, vz, from) => {
    const p = papers[i];
    if (!p || !hoopArmed) return false;
    setPaperBodyDynamic(p, true);
    if (from) p.body.position.set(from[0], from[1], from[2]);
    p.body.velocity.set(vx, vy, vz);
    p.state = "rolling";
    p.time = 0;
    p.throw = { settleTimer: 0 };
    markShot(p);
    return true;
  },
});

boot();
