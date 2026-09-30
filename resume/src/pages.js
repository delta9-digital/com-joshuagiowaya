// ==================================================
// Resume → paper sheets
// Reads the semantic resume markup (#resume), flows it onto as many sheets as it needs,
// and draws any sheet onto a canvas at any resolution. Layout is in sheet units (1024 × 1400).
// ==================================================

export const PAGE_W = 1024;
export const PAGE_H = 1400;

const MARGIN_X = 96;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const BODY_BOTTOM = 1262;
const FOOTER_Y = 1340;
const MIN_TAIL_BLOCKS = 3; // a continuation sheet should never hold fewer items than this

// Header band heights (left edge, right edge) — the bottom edge is a diagonal, per the brand.
const BAND_FIRST = [372, 318];
const BAND_CONT = [196, 164];

const rootStyle = getComputedStyle(document.documentElement);
const token = (name, fallback) => rootStyle.getPropertyValue(name).trim() || fallback;

const COLOR = {
  ink: token("--jg-ink", "#1d1b1b"),
  muted: token("--jg-gray-600", "#4d4d4e"),
  rule: token("--jg-gray-300", "#a7a39e"),
  paper: token("--jg-surface-bright", "#f4f3f3"),
  onDark: token("--jg-text-on-dark", "#f4f3f3"),
  accent: token("--jg-cyan", "#00bdff"),
};
const FONT = {
  display: token("--jg-font-display", '"Blackout Sunrise", Impact, sans-serif'),
  heading: token("--jg-font-heading", '"Norwester", "Arial Narrow", sans-serif'),
  body: token("--jg-font-body", '"Open Sans", system-ui, sans-serif'),
};

/** Resolves once the brand faces used on the sheets are ready (or after a timeout). */
export function waitForFonts(timeoutMs = 4000) {
  if (!document.fonts) return Promise.resolve();
  const loads = Promise.all([
    document.fonts.load(`100px "Blackout Sunrise"`),
    document.fonts.load(`100px "Norwester"`),
    document.fonts.load(`400 32px "Open Sans"`),
    document.fonts.load(`600 32px "Open Sans"`),
  ]);
  return Promise.race([loads, new Promise((r) => setTimeout(r, timeoutMs))]);
}

// ---------- reading the markup ----------

function textOf(el) {
  if (!el) return "";
  const clone = el.cloneNode(true);
  clone.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
  return clone.textContent.replace(/\s+/g, " ").trim();
}

function listItems(el) {
  if (!el) return [];
  const parts = el.children.length ? [...el.children].map(textOf) : [textOf(el)];
  return parts.filter(Boolean);
}

/**
 * Sections, in reading order. Each becomes one or more sheets:
 *   { key, nav, eyebrow, title, subtitle, meta: string[], blocks: [{ type, text | term }] }
 */
export function readResume(root = document.getElementById("resume")) {
  const sections = [];

  const profile = root.querySelector('[data-section="profile"]');
  const summary = root.querySelector('[data-section="summary"]');
  sections.push({
    key: "profile",
    nav: "Profile",
    eyebrow: "Resume",
    title: textOf(profile.querySelector("[data-title]")),
    subtitle: textOf(profile.querySelector("[data-subtitle]")),
    meta: listItems(profile.querySelector("[data-meta]")),
    blocks: [
      { type: "subhead", text: textOf(summary.querySelector("[data-title]")) },
      ...[...summary.querySelectorAll("li")].map((li) => ({ type: "bullet", text: textOf(li) })),
    ],
  });

  const skills = root.querySelector('[data-section="skills"]');
  sections.push({
    key: "skills",
    nav: "Skills",
    eyebrow: "Toolkit",
    title: textOf(skills.querySelector("[data-title]")),
    subtitle: "",
    meta: [],
    blocks: [...skills.querySelectorAll("dl > div")].map((row) => ({
      type: "def",
      term: textOf(row.querySelector("dt")),
      text: textOf(row.querySelector("dd")),
    })),
  });

  const jobs = [...root.querySelectorAll('[data-section="job"]')];
  jobs.forEach((job, i) => {
    const title = textOf(job.querySelector("[data-title]"));
    sections.push({
      key: `job-${i}`,
      nav: title,
      eyebrow: `Experience · ${String(i + 1).padStart(2, "0")}`,
      title,
      subtitle: textOf(job.querySelector("[data-subtitle]")),
      meta: listItems(job.querySelector("[data-meta]")),
      blocks: [...job.querySelectorAll("li")].map((li) => ({ type: "bullet", text: textOf(li) })),
    });
  });

  return sections;
}

// ---------- measuring ----------

function wrap(ctx, text, maxW) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Like wrap(), but only breaks between whole items (e.g. "email · phone · city").
const META_SEP = "  ·  ";
function wrapItems(ctx, items, maxW) {
  const lines = [];
  let line = "";
  for (const item of items) {
    const next = line ? line + META_SEP + item : item;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = item;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function typeScale(compact) {
  // Compact (phone-width) sheets use bigger type and therefore more sheets.
  const body = compact ? 42 : 34;
  return {
    body,
    lead: Math.round(body * 1.45),
    term: compact ? 42 : 36,
    subhead: compact ? 44 : 38,
    bulletIndent: 46,
    gap: compact ? 20 : 16,
  };
}

// Pre-wraps a block and returns its height; the wrapped lines are kept for drawing.
function layoutBlock(ctx, block, t) {
  if (block.type === "subhead") {
    return { ...block, height: t.subhead + 34 };
  }
  if (block.type === "def") {
    ctx.font = `400 ${t.body}px ${FONT.body}`;
    const lines = wrap(ctx, block.text, CONTENT_W);
    return { ...block, lines, height: t.term + 16 + lines.length * t.lead + t.gap * 2 };
  }
  ctx.font = `400 ${t.body}px ${FONT.body}`;
  const lines = wrap(ctx, block.text, CONTENT_W - t.bulletIndent);
  return { ...block, lines, height: lines.length * t.lead + t.gap };
}

// Where the body starts on a section's first sheet vs. its continuation sheets.
function bodyTop(section, first) {
  if (!first) return BAND_CONT[0] + 70;
  let y = BAND_FIRST[0] + 40;
  if (section.subtitle) y += 76;
  if (section.metaLines) y += 30 + section.metaLines * 44;
  return y + 64;
}

// Greedy fill where each sheet may use `ratio` of its own body space; returns block lists per sheet.
// `startsSection` says whether the first sheet produced is the section's opening sheet.
function fill(section, blocks, t, ratio, startsSection = true) {
  const sheets = [];
  let sheet = null;
  let y = 0;
  let bottom = BODY_BOTTOM;
  const newSheet = () => {
    sheet = [];
    sheets.push(sheet);
    y = bodyTop(section, startsSection && sheets.length === 1);
    bottom = y + (BODY_BOTTOM - y) * ratio;
  };
  newSheet();
  for (const block of blocks) {
    // Don't strand a subhead at the bottom of a sheet.
    const need = block.type === "subhead" ? block.height + t.lead * 2 : block.height;
    if (y + need > bottom && sheet.length) newSheet();
    sheet.push({ ...block, y });
    y += block.height;
  }
  return sheets;
}

/**
 * Flows every section onto as many sheets as it needs. Blocks never split across sheets, and a
 * section's last sheet is rebalanced with the one before it so it never holds a lone bullet.
 * Returns [{ index, total, section, sectionIndex, first, blocks: [{...block, y}] }].
 */
export function paginate(sections, { compact = false } = {}) {
  const t = typeScale(compact);
  const ctx = document.createElement("canvas").getContext("2d");
  const pages = [];

  sections.forEach((section, sectionIndex) => {
    ctx.font = `400 34px ${FONT.body}`;
    section.metaLines = wrapItems(ctx, section.meta, CONTENT_W).length;

    const blocks = section.blocks.map((b) => layoutBlock(ctx, b, t));
    let sheets = fill(section, blocks, t, 1);
    // Fill sheets fully, but if the last one would be nearly empty, rebalance the final two:
    // shrink their usable share as far as it goes while still fitting on two sheets.
    if (sheets.length > 1 && sheets[sheets.length - 1].length < MIN_TAIL_BLOCKS) {
      const head = sheets.slice(0, -2);
      const tailBlocks = sheets.slice(-2).flat();
      const startsSection = head.length === 0;
      let tail = fill(section, tailBlocks, t, 1, startsSection);
      for (let ratio = 0.97; ratio > 0.4; ratio -= 0.03) {
        const tighter = fill(section, tailBlocks, t, ratio, startsSection);
        if (tighter.length > 2) break;
        tail = tighter;
      }
      sheets = [...head, ...tail];
    }
    sheets.forEach((sheetBlocks, i) => {
      pages.push({ section, sectionIndex, first: i === 0, blocks: sheetBlocks, type: t });
    });
  });

  pages.forEach((p, i) => {
    p.index = i;
    p.total = pages.length;
  });
  return pages;
}

// ---------- drawing ----------

function drawDiamond(ctx, cx, cy, r, fill) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  } else {
    ctx.strokeStyle = COLOR.accent;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

function fitFont(ctx, text, family, maxSize, minSize, maxW) {
  let size = maxSize;
  ctx.font = `${size}px ${family}`;
  while (ctx.measureText(text).width > maxW && size > minSize) {
    size -= 4;
    ctx.font = `${size}px ${family}`;
  }
  return size;
}

function drawTitle(ctx, text, first) {
  const title = text.toUpperCase();
  ctx.fillStyle = COLOR.onDark;
  if (!first) {
    fitFont(ctx, title, FONT.display, 72, 44, CONTENT_W);
    ctx.fillText(title, MARGIN_X, 148);
    return;
  }
  // One line if it fits at a display-worthy size, otherwise the most balanced two-line split.
  fitFont(ctx, title, FONT.display, 150, 100, CONTENT_W);
  if (ctx.measureText(title).width <= CONTENT_W) {
    ctx.fillText(title, MARGIN_X, 262);
    return;
  }
  const words = title.split(" ");
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (!best || w < best.w) best = { lines, w };
  }
  if (!best) return;
  const longest = best.lines.reduce((a, b) => (ctx.measureText(a).width > ctx.measureText(b).width ? a : b));
  fitFont(ctx, longest, FONT.display, 118, 56, CONTENT_W);
  ctx.fillText(best.lines[0], MARGIN_X, 208);
  ctx.fillText(best.lines[1], MARGIN_X, 316);
}

function drawBand(ctx, page) {
  const [left, right] = page.first ? BAND_FIRST : BAND_CONT;
  ctx.fillStyle = COLOR.ink;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(PAGE_W, 0);
  ctx.lineTo(PAGE_W, right);
  ctx.lineTo(0, left);
  ctx.closePath();
  ctx.fill();

  // Eyebrow — section label, cyan, letterspaced Norwester
  const eyebrow = (page.first ? page.section.eyebrow : `${page.section.eyebrow} · continued`).toUpperCase();
  ctx.fillStyle = COLOR.accent;
  ctx.font = `${page.first ? 34 : 28}px ${FONT.heading}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "4px";
  ctx.fillText(eyebrow, MARGIN_X, page.first ? 100 : 72);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  drawTitle(ctx, page.section.title, page.first);
}

function drawIntro(ctx, page) {
  const { section } = page;
  let y = BAND_FIRST[0] + 40;
  if (section.subtitle) {
    y += 56;
    ctx.fillStyle = COLOR.ink;
    fitFont(ctx, section.subtitle.toUpperCase(), FONT.heading, 52, 34, CONTENT_W);
    ctx.fillText(section.subtitle.toUpperCase(), MARGIN_X, y);
    y += 20;
  }
  if (section.meta.length) {
    ctx.fillStyle = COLOR.muted;
    ctx.font = `400 34px ${FONT.body}`;
    for (const line of wrapItems(ctx, section.meta, CONTENT_W)) {
      y += 44;
      ctx.fillText(line, MARGIN_X, y);
    }
    y += 30;
  }
  // Rule with a diamond cap
  y += 20;
  ctx.strokeStyle = COLOR.rule;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X + 26, y);
  ctx.lineTo(PAGE_W - MARGIN_X, y);
  ctx.stroke();
  drawDiamond(ctx, MARGIN_X + 10, y, 10, COLOR.accent);
}

function drawBlocks(ctx, page) {
  const t = page.type;
  for (const block of page.blocks) {
    if (block.type === "subhead") {
      ctx.fillStyle = COLOR.ink;
      ctx.font = `${t.subhead}px ${FONT.heading}`;
      ctx.fillText(block.text.toUpperCase(), MARGIN_X, block.y + t.subhead);
      continue;
    }
    if (block.type === "def") {
      ctx.fillStyle = COLOR.ink;
      ctx.font = `${t.term}px ${FONT.heading}`;
      ctx.fillText(block.term.toUpperCase(), MARGIN_X, block.y + t.gap + t.term);
      ctx.fillStyle = COLOR.muted;
      ctx.font = `400 ${t.body}px ${FONT.body}`;
      let y = block.y + t.gap + t.term + 16;
      for (const line of block.lines) {
        y += t.lead;
        ctx.fillText(line, MARGIN_X, y - (t.lead - t.body) / 2);
      }
      continue;
    }
    // bullet
    const firstBaseline = block.y + t.lead - (t.lead - t.body) / 2;
    drawDiamond(ctx, MARGIN_X + 11, firstBaseline - t.body * 0.36, 9);
    ctx.fillStyle = COLOR.ink;
    ctx.font = `400 ${t.body}px ${FONT.body}`;
    block.lines.forEach((line, i) => {
      ctx.fillText(line, MARGIN_X + t.bulletIndent, firstBaseline + i * t.lead);
    });
  }
}

function drawFooter(ctx, page) {
  ctx.strokeStyle = COLOR.rule;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, FOOTER_Y - 44);
  ctx.lineTo(PAGE_W - MARGIN_X, FOOTER_Y - 44);
  ctx.stroke();

  ctx.font = `26px ${FONT.heading}`;
  ctx.fillStyle = COLOR.muted;
  ctx.textAlign = "left";
  ctx.fillText("JOSHUA GIOWAYA  ·  JGDZINE.COM", MARGIN_X, FOOTER_Y);

  const num = `${String(page.index + 1).padStart(2, "0")} / ${String(page.total).padStart(2, "0")}`;
  ctx.font = `34px ${FONT.heading}`;
  ctx.fillStyle = COLOR.ink;
  ctx.textAlign = "right";
  ctx.fillText(num, PAGE_W - MARGIN_X, FOOTER_Y + 2);
  ctx.textAlign = "left";
}

/** Draws a sheet onto ctx; `scale` maps sheet units to canvas pixels. */
export function drawPage(ctx, page, scale = 1) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = COLOR.paper;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  // Faint ruled grid so the sheet reads as paper
  ctx.strokeStyle = "rgba(167, 163, 158, 0.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let y = 48; y < PAGE_H; y += 48) {
    ctx.moveTo(0, y);
    ctx.lineTo(PAGE_W, y);
  }
  ctx.stroke();

  drawBand(ctx, page);
  if (page.first) drawIntro(ctx, page);
  drawBlocks(ctx, page);
  drawFooter(ctx, page);
  ctx.restore();
}
