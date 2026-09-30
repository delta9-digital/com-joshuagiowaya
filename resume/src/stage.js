// ==================================================
// Resume paper stage
// Every resume sheet is a crumpled paper ball. Back/Next unfolds the next sheet toward the
// camera and tosses the current one back onto the floor. Scene, VAT playback, and physics
// are adapted from item-develop/paper-crumple-demo (MIT).
// ==================================================
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { readResume, paginate, drawPage, waitForFonts, PAGE_W, PAGE_H } from "./pages.js";

const section = document.querySelector(".rs-stage");
const viewport = section.querySelector(".rs-stage__viewport");
const container = document.getElementById("stage");
const loadingEl = document.getElementById("stage-loading");
const prevBtn = section.querySelector('[data-nav="prev"]');
const nextBtn = section.querySelector('[data-nav="next"]');
const counterEl = section.querySelector("[data-counter]");
const labelEl = section.querySelector("[data-label]");
const tocEl = section.querySelector("[data-toc]");
const statusEl = section.querySelector("[data-status]");
const textToggle = section.querySelector("[data-text-toggle]");
const resumeEl = document.getElementById("resume");

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
const CLICK_DRAG_THRESHOLD_PX = 6;
const SWIPE_THRESHOLD_PX = 60;
const BOUNDS_PULL = 3.0;
const LOW_TEX_W = 256;

const stageBounds = { minX: -2.4, maxX: 2.4, minZ: WALL_Z, maxZ: 1.7 };

// ---------- runtime state ----------
let renderer, scene, camera, composer, physicsWorld, floorBody, paperPhysMat;
let animData = null;
let pages = [];
const papers = [];
let activePaper = null;
let current = -1;
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
  pages = paginate(readResume(resumeEl), { compact });
  buildControls();
  buildScene();

  const { loadVATData } = await import("../vendor/paper-crumple/paper-vat.js");
  animData = await loadVATData(new URL("../vat/", import.meta.url).href);
  measureCrumple();

  loadingEl.hidden = true;
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
  renderer.domElement.style.touchAction = "pan-y"; // vertical page scroll still works over the stage
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
  camera.position.set(0, CAMERA_BASE.y * pull, CAMERA_BASE.z * pull);
  camera.lookAt(0, CAMERA_BASE.targetY, 0);
  camera.updateProjectionMatrix();

  const dist = camera.position.distanceTo(new THREE.Vector3(0, CAMERA_BASE.targetY, 0));
  const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist * aspect;
  stageBounds.maxX = Math.min(2.4, halfW * 0.88);
  stageBounds.minX = -stageBounds.maxX;
  updateOpenPose();
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

function spawnPosition() {
  const margin = collisionRadius * 1.3;
  const pos = new THREE.Vector3(0, restMeshY, 0);
  for (let attempt = 0; attempt < 40; attempt++) {
    pos.x = randomRange(stageBounds.minX + margin, stageBounds.maxX - margin);
    pos.z = randomRange(stageBounds.minZ + margin, stageBounds.maxZ - margin);
    const clear = papers.every((p) => {
      const dx = p.body.position.x - pos.x;
      const dz = p.body.position.z - pos.z;
      return dx * dx + dz * dz > (collisionRadius * 2.2) ** 2;
    });
    if (clear) break;
  }
  return pos;
}

function spawnPaper(page, dropIn) {
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
  base.mesh.position.copy(spawnPosition());
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
    paper.body.position.y += randomRange(3.5, 6.5);
    paper.body.angularVelocity.set(randomRange(-1.5, 1.5), randomRange(-0.5, 0.5), randomRange(-1.5, 1.5));
    syncMeshToBody(paper);
  }
  return paper;
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
  if (activePaper.state === "opening") {
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
function startDiscard(paper, direction) {
  if (paper.state === "discarding" || paper.state === "rolling") return;
  const dir = new THREE.Vector3(
    direction * randomRange(0.35, 1),
    0,
    randomRange(-1.3, -0.45),
  ).normalize();
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
function goTo(index) {
  if (!animData || !pages.length) return;
  index = Math.max(0, Math.min(index, pages.length - 1));
  const target = papers[index];
  if (!target || (target === activePaper && current === index)) return;

  if (activePaper) startDiscard(activePaper, index > current ? -1 : 1);
  startOpen(target);
  activePaper = target;
  current = index;
  updateControls(true);
}

const next = () => goTo(current + 1);
const prev = () => goTo(current - 1);

function pageLabel(page) {
  return page.first ? page.section.title : `${page.section.title} (cont.)`;
}

function buildControls() {
  // One chip per section, pointing at its first sheet
  tocEl.replaceChildren();
  pages
    .filter((p) => p.first)
    .forEach((page) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rs-chip jg-heading";
      btn.textContent = page.section.nav;
      btn.dataset.section = String(page.sectionIndex);
      btn.addEventListener("click", () => goTo(page.index));
      li.append(btn);
      tocEl.append(li);
    });

  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);
  viewport.addEventListener("keydown", onKey);
  section.querySelector(".rs-stage__bar").addEventListener("keydown", onKey);

  textToggle.addEventListener("click", () => {
    const open = resumeEl.classList.toggle("is-open");
    textToggle.setAttribute("aria-expanded", String(open));
    textToggle.textContent = open ? "Hide text version" : "Read as text";
    if (open) resumeEl.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  });

  updateControls(false);
}

function onKey(e) {
  const keys = { ArrowRight: next, ArrowLeft: prev, Home: () => goTo(0), End: () => goTo(pages.length - 1) };
  const action = keys[e.key];
  if (!action || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  action();
}

function updateControls(announce) {
  const total = pages.length;
  const page = pages[Math.max(current, 0)];
  const pad = (n) => String(n).padStart(2, "0");
  counterEl.textContent = `${pad(Math.max(current, 0) + 1)} / ${pad(total)}`;
  labelEl.textContent = page ? pageLabel(page) : "";
  prevBtn.disabled = current <= 0;
  nextBtn.disabled = current < 0 || current >= total - 1;
  for (const chip of tocEl.querySelectorAll("button")) {
    const on = page && chip.dataset.section === String(page.sectionIndex);
    chip.classList.toggle("is-active", on);
    if (on) chip.setAttribute("aria-current", "step");
    else chip.removeAttribute("aria-current");
  }
  if (announce && page) statusEl.textContent = `Page ${current + 1} of ${total}: ${pageLabel(page)}`;
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

function pickPaper(e) {
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  const live = papers.filter(Boolean);
  const hit = raycaster.intersectObjects(live.map((p) => p.mesh));
  return hit.length ? live.find((p) => p.mesh === hit[0].object) || null : null;
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
}

function handleClick(e) {
  const p = pickPaper(e);
  if (!p) return;
  if (p === activePaper) next();
  else goTo(p.page.index);
}

function beginGrab(paper, e) {
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
  paper.grab = { target: new THREE.Vector3(body.position.x, restCenterY + GRAB_LIFT, body.position.z) };
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
}

function releaseGrab(paper, withThrow) {
  if (!paper || paper.state !== "grabbed") return;
  const body = paper.body;
  let vx = withThrow ? body.velocity.x : 0;
  let vz = withThrow ? body.velocity.z : 0;
  const speed = Math.hypot(vx, vz);
  if (speed > THROW_MAX_SPEED) {
    vx *= THROW_MAX_SPEED / speed;
    vz *= THROW_MAX_SPEED / speed;
  }
  body.type = CANNON.Body.DYNAMIC;
  body.mass = PAPER_MASS;
  body.updateMassProperties();
  body.velocity.set(vx, 0, vz);
  body.angularVelocity.set((vz / collisionRadius) * 0.6, 0, (-vx / collisionRadius) * 0.6);
  body.wakeUp();
  paper.state = "rolling";
  paper.time = 0;
  paper.throw = { settleTimer: 0 };
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

boot();
