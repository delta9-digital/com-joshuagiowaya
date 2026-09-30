// ==================================================
// Resume → paper sheets
// Reads the semantic resume markup (#resume), flows it onto as many sheets as it needs,
// and draws any sheet onto a canvas at any resolution. Layout is in sheet units (1024 × 1400).
// ==================================================

export const PAGE_W = 1024;
export const PAGE_H = 1400;

const MIN_TAIL_BLOCKS = 3; // a continuation sheet should never hold fewer items than this

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

// Sheet layouts. "notebook" (default): ruled paper, every section opens a fresh sheet under a big
// header band. "print": plain bright paper with tighter margins and type; each section opens with
// a compact header strip instead of the big band. Sections never share a sheet — every job starts
// on its own page.
// Header band heights are [left edge, right edge]; the bottom edge is a diagonal, per the brand.
const LAYOUTS = {
  notebook: {
    marginX: 96,
    bodyBottom: 1262,
    footerY: 1340,
    bandFirst: [372, 318],
    bandCont: [196, 164],
    bodyTopPlain: 150, // continuation sheets without a band start here
    paper: COLOR.paper,
    ruled: true,
    flow: false,
  },
  print: {
    marginX: 76,
    bodyBottom: 1296,
    footerY: 1356,
    bandFirst: [372, 318],
    bandCont: [196, 164],
    bodyTopPlain: 72, // top of every sheet in flow mode
    paper: "#fdfdfc",
    ruled: false,
    flow: true,
  },
};
for (const l of Object.values(LAYOUTS)) l.contentW = PAGE_W - l.marginX * 2;
let L = LAYOUTS.notebook; // the layout being measured or drawn (set by paginate / drawPage)

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

function typeScale(compact, print) {
  // Compact (phone-width) sheets use bigger type and therefore more sheets.
  if (print) {
    const body = compact ? 36 : 28;
    return {
      body,
      lead: Math.round(body * 1.38),
      term: compact ? 36 : 29,
      subhead: compact ? 38 : 30,
      bulletIndent: 38,
      gap: compact ? 12 : 9,
      k: compact ? 1.2 : 1, // header strip scale
    };
  }
  const body = compact ? 42 : 34;
  return {
    body,
    lead: Math.round(body * 1.45),
    term: compact ? 42 : 36,
    subhead: compact ? 44 : 38,
    bulletIndent: 46,
    gap: compact ? 20 : 16,
    k: 1,
  };
}

// Pre-wraps a block and returns its height; the wrapped lines are kept for drawing.
// Compact header strip used in flow layouts: full-bleed ink strip (eyebrow + title), then role,
// meta and a rule. Metrics are shared by layoutBlock (height) and drawHeader (drawing).
function headerMetrics(section, t) {
  const k = t.k;
  const strip = Math.round(132 * k);
  const sub = section.subtitle ? Math.round(50 * k) : Math.round(12 * k);
  const metaLine = Math.round(36 * k);
  // before: space above the strip when it follows another section on the same sheet
  return { k, strip, sub, metaLine, rule: Math.round(24 * k), after: Math.round(26 * k), before: Math.round(30 * k) };
}

function layoutBlock(ctx, block, t) {
  if (block.type === "header") {
    const m = headerMetrics(block.section, t);
    ctx.font = `400 ${Math.round(26 * m.k)}px ${FONT.body}`;
    const metaLines = wrapItems(ctx, block.section.meta, L.contentW);
    return { ...block, metaLines, height: m.strip + m.sub + metaLines.length * m.metaLine + m.rule + m.after };
  }
  if (block.type === "subhead") {
    return { ...block, height: t.subhead + 34 };
  }
  if (block.type === "def") {
    ctx.font = `400 ${t.body}px ${FONT.body}`;
    const lines = wrap(ctx, block.text, L.contentW);
    return { ...block, lines, height: t.term + 16 + lines.length * t.lead + t.gap * 2 };
  }
  ctx.font = `400 ${t.body}px ${FONT.body}`;
  const lines = wrap(ctx, block.text, L.contentW - t.bulletIndent);
  return { ...block, lines, height: lines.length * t.lead + t.gap };
}

// Where the body starts on a section's first sheet vs. its continuation sheets.
function bodyTop(section, first, continuationBand) {
  if (!first) return continuationBand ? L.bandCont[0] + 70 : L.bodyTopPlain;
  let y = L.bandFirst[0] + 40;
  if (section.subtitle) y += 76;
  if (section.metaLines) y += 30 + section.metaLines * 44;
  return y + 64;
}

// Greedy fill where each sheet may use `ratio` of its own body space; returns block lists per sheet.
// `startsSection` says whether the first sheet produced is the section's opening sheet.
function fill(section, blocks, t, ratio, startsSection, continuationBand) {
  const sheets = [];
  let sheet = null;
  let y = 0;
  let bottom = L.bodyBottom;
  const newSheet = () => {
    sheet = [];
    sheets.push(sheet);
    y = bodyTop(section, startsSection && sheets.length === 1, continuationBand);
    bottom = y + (L.bodyBottom - y) * ratio;
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
 * With `continuationBand: false`, only a section's first sheet carries the dark header band.
 * With `layout: "print"`, sections flow onto shared sheets (see LAYOUTS).
 * Returns [{ index, total, section, sectionIndex, first, band, parts, blocks: [{...block, y}] }]
 * where parts lists the sections on the sheet ({ sectionIndex, title, cont }), plus
 * pages.toc = [{ sectionIndex, nav, pageIndex }] — where each section starts.
 */
export function paginate(sections, { compact = false, continuationBand = true, layout = "notebook" } = {}) {
  L = LAYOUTS[layout] || LAYOUTS.notebook;
  const t = typeScale(compact, layout === "print");
  const ctx = document.createElement("canvas").getContext("2d");
  const pages = L.flow ? paginateFlow(sections, t, ctx) : [];
  if (L.flow) return finishPages(pages, sections);

  sections.forEach((section, sectionIndex) => {
    ctx.font = `400 34px ${FONT.body}`;
    section.metaLines = wrapItems(ctx, section.meta, L.contentW).length;

    const blocks = section.blocks.map((b) => layoutBlock(ctx, b, t));
    let sheets = fill(section, blocks, t, 1, true, continuationBand);
    // Fill sheets fully, but if the last one would be nearly empty, rebalance the final two:
    // shrink their usable share as far as it goes while still fitting on two sheets.
    if (sheets.length > 1 && sheets[sheets.length - 1].length < MIN_TAIL_BLOCKS) {
      const head = sheets.slice(0, -2);
      const tailBlocks = sheets.slice(-2).flat();
      const startsSection = head.length === 0;
      let tail = fill(section, tailBlocks, t, 1, startsSection, continuationBand);
      for (let ratio = 0.97; ratio > 0.4; ratio -= 0.03) {
        const tighter = fill(section, tailBlocks, t, ratio, startsSection, continuationBand);
        if (tighter.length > 2) break;
        tail = tighter;
      }
      sheets = [...head, ...tail];
    }
    sheets.forEach((sheetBlocks, i) => {
      const first = i === 0;
      pages.push({
        section,
        sectionIndex,
        first,
        band: first || continuationBand,
        parts: [{ sectionIndex, title: section.title, cont: !first }],
        blocks: sheetBlocks,
        type: t,
        layout: L,
      });
    });
  });
  return finishPages(pages, sections);
}

// Print layout: every section is led by a header strip and always starts a fresh sheet (sections
// never share one). A section that almost fits one sheet is condensed — its text steps down by up
// to FIT_MIN_SCALE — so it does; otherwise it flows onto more sheets at full size and a sparse
// last sheet is rebalanced with the one before it.
const FIT_SCALES = [1, 0.96, 0.92, 0.88, 0.84];

function scaleType(t, f) {
  if (f === 1) return t;
  const r = (v) => Math.round(v * f);
  return { ...t, body: r(t.body), lead: r(t.lead), term: r(t.term), subhead: r(t.subhead), bulletIndent: r(t.bulletIndent), gap: r(t.gap) };
}

function stack(section, sectionIndex, t, ctx) {
  const blocks = [layoutBlock(ctx, { type: "header", section, sectionIndex }, t)];
  for (const b of section.blocks) blocks.push({ ...layoutBlock(ctx, b, t), sectionIndex });
  return blocks;
}

function paginateFlow(sections, t, ctx) {
  const pages = [];
  const sectionStart = new Map(); // sectionIndex -> index of its first page
  sections.forEach((section, sectionIndex) => {
    const room = L.bodyBottom - L.bodyTopPlain;
    let tt = t;
    let blocks = null;
    for (const f of FIT_SCALES) {
      const candidate = stack(section, sectionIndex, scaleType(t, f), ctx);
      if (candidate.reduce((h, b) => h + b.height, 0) <= room) {
        tt = scaleType(t, f);
        blocks = candidate;
        break;
      }
    }
    if (!blocks) blocks = stack(section, sectionIndex, t, ctx);

    let page = null;
    let y = 0;
    const newPage = () => {
      page = { blocks: [], type: tt, layout: L, band: false };
      pages.push(page);
      y = L.bodyTopPlain;
    };
    newPage();
    sectionStart.set(sectionIndex, pages.length - 1);
    for (const block of blocks) {
      if (y + block.height > L.bodyBottom && page.blocks.length) newPage();
      page.blocks.push({ ...block, y });
      y += block.height;
    }
  });
  rebalanceTails(pages, sectionStart, t);
  for (const p of pages) {
    const lead = p.blocks[0];
    p.sectionIndex = lead.sectionIndex;
    p.section = sections[lead.sectionIndex];
    p.first = lead.type === "header";
    p.parts = [{ sectionIndex: lead.sectionIndex, title: p.section.title, cont: !p.first }];
  }
  return pages;
}

// If a section's last sheet holds fewer than MIN_TAIL_BLOCKS items, move items back from the
// sheet before it until both are about equally full, then re-stack their y positions.
function rebalanceTails(pages, sectionStart, t) {
  const bySection = new Map();
  pages.forEach((p, i) => {
    const si = p.blocks[0].sectionIndex;
    if (!bySection.has(si)) bySection.set(si, []);
    bySection.get(si).push(i);
  });
  for (const idx of bySection.values()) {
    if (idx.length < 2) continue;
    const last = pages[idx[idx.length - 1]];
    const prev = pages[idx[idx.length - 2]];
    const used = (p) => p.blocks.reduce((h, b) => h + b.height, 0);
    while (last.blocks.length < MIN_TAIL_BLOCKS && prev.blocks.length > 2) {
      const move = prev.blocks[prev.blocks.length - 1];
      if (move.type === "header") break;
      if (used(last) + move.height > L.bodyBottom - L.bodyTopPlain) break;
      prev.blocks.pop();
      last.blocks.unshift(move);
      if (used(last) >= used(prev)) break;
    }
    let y = L.bodyTopPlain;
    for (const b of last.blocks) {
      b.y = y;
      y += b.height;
    }
  }
}

function finishPages(pages, sections) {
  pages.forEach((p, i) => {
    p.index = i;
    p.total = pages.length;
  });
  pages.toc = sections.map((section, sectionIndex) => {
    const start = pages.find((p) => p.parts.some((part) => part.sectionIndex === sectionIndex && !part.cont));
    return { sectionIndex, nav: section.nav, pageIndex: start ? start.index : 0 };
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
    fitFont(ctx, title, FONT.display, 72, 44, L.contentW);
    ctx.fillText(title, L.marginX, 148);
    return;
  }
  // One line if it fits at a display-worthy size, otherwise the most balanced two-line split.
  fitFont(ctx, title, FONT.display, 150, 100, L.contentW);
  if (ctx.measureText(title).width <= L.contentW) {
    ctx.fillText(title, L.marginX, 262);
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
  fitFont(ctx, longest, FONT.display, 118, 56, L.contentW);
  ctx.fillText(best.lines[0], L.marginX, 208);
  ctx.fillText(best.lines[1], L.marginX, 316);
}

function drawBand(ctx, page) {
  const [left, right] = page.first ? L.bandFirst : L.bandCont;
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
  ctx.fillText(eyebrow, L.marginX, page.first ? 100 : 72);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  drawTitle(ctx, page.section.title, page.first);
}

function drawIntro(ctx, page) {
  const { section } = page;
  let y = L.bandFirst[0] + 40;
  if (section.subtitle) {
    y += 56;
    ctx.fillStyle = COLOR.ink;
    fitFont(ctx, section.subtitle.toUpperCase(), FONT.heading, 52, 34, L.contentW);
    ctx.fillText(section.subtitle.toUpperCase(), L.marginX, y);
    y += 20;
  }
  if (section.meta.length) {
    ctx.fillStyle = COLOR.muted;
    ctx.font = `400 34px ${FONT.body}`;
    for (const line of wrapItems(ctx, section.meta, L.contentW)) {
      y += 44;
      ctx.fillText(line, L.marginX, y);
    }
    y += 30;
  }
  // Rule with a diamond cap
  y += 20;
  ctx.strokeStyle = COLOR.rule;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(L.marginX + 26, y);
  ctx.lineTo(PAGE_W - L.marginX, y);
  ctx.stroke();
  drawDiamond(ctx, L.marginX + 10, y, 10, COLOR.accent);
}

function drawHeader(ctx, block, t) {
  const { section } = block;
  const m = headerMetrics(section, t);
  const y = block.y;
  // Full-bleed ink strip with a diagonal bottom edge
  ctx.fillStyle = COLOR.ink;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(PAGE_W, y);
  ctx.lineTo(PAGE_W, y + m.strip - Math.round(20 * m.k));
  ctx.lineTo(0, y + m.strip);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = COLOR.accent;
  ctx.font = `${Math.round(24 * m.k)}px ${FONT.heading}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
  ctx.fillText(section.eyebrow.toUpperCase(), L.marginX, y + Math.round(40 * m.k));
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  const title = section.title.toUpperCase();
  ctx.fillStyle = COLOR.onDark;
  fitFont(ctx, title, FONT.display, Math.round(72 * m.k), Math.round(40 * m.k), L.contentW);
  ctx.fillText(title, L.marginX, y + Math.round(104 * m.k));

  let yy = y + m.strip;
  if (section.subtitle) {
    yy += Math.round(40 * m.k);
    ctx.fillStyle = COLOR.ink;
    fitFont(ctx, section.subtitle.toUpperCase(), FONT.heading, Math.round(34 * m.k), Math.round(24 * m.k), L.contentW);
    ctx.fillText(section.subtitle.toUpperCase(), L.marginX, yy);
    yy += m.sub - Math.round(40 * m.k);
  } else {
    yy += m.sub;
  }
  ctx.fillStyle = COLOR.muted;
  ctx.font = `400 ${Math.round(26 * m.k)}px ${FONT.body}`;
  for (const line of block.metaLines) {
    yy += m.metaLine;
    ctx.fillText(line, L.marginX, yy - Math.round(6 * m.k));
  }
  yy += Math.round(12 * m.k);
  ctx.strokeStyle = COLOR.rule;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(L.marginX + 22, yy);
  ctx.lineTo(PAGE_W - L.marginX, yy);
  ctx.stroke();
  drawDiamond(ctx, L.marginX + 8, yy, 8, COLOR.accent);
}

function drawBlocks(ctx, page) {
  const t = page.type;
  for (const block of page.blocks) {
    if (block.type === "header") {
      drawHeader(ctx, block, t);
      continue;
    }
    if (block.type === "subhead") {
      ctx.fillStyle = COLOR.ink;
      ctx.font = `${t.subhead}px ${FONT.heading}`;
      ctx.fillText(block.text.toUpperCase(), L.marginX, block.y + t.subhead);
      continue;
    }
    if (block.type === "def") {
      ctx.fillStyle = COLOR.ink;
      ctx.font = `${t.term}px ${FONT.heading}`;
      ctx.fillText(block.term.toUpperCase(), L.marginX, block.y + t.gap + t.term);
      ctx.fillStyle = COLOR.muted;
      ctx.font = `400 ${t.body}px ${FONT.body}`;
      let y = block.y + t.gap + t.term + 16;
      for (const line of block.lines) {
        y += t.lead;
        ctx.fillText(line, L.marginX, y - (t.lead - t.body) / 2);
      }
      continue;
    }
    // bullet
    const firstBaseline = block.y + t.lead - (t.lead - t.body) / 2;
    drawDiamond(ctx, L.marginX + 11, firstBaseline - t.body * 0.36, 9);
    ctx.fillStyle = COLOR.ink;
    ctx.font = `400 ${t.body}px ${FONT.body}`;
    block.lines.forEach((line, i) => {
      ctx.fillText(line, L.marginX + t.bulletIndent, firstBaseline + i * t.lead);
    });
  }
}

function drawFooter(ctx, page) {
  ctx.strokeStyle = COLOR.rule;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(L.marginX, L.footerY - 44);
  ctx.lineTo(PAGE_W - L.marginX, L.footerY - 44);
  ctx.stroke();

  const small = L.flow ? 22 : 26;
  ctx.font = `${small}px ${FONT.heading}`;
  ctx.fillStyle = COLOR.muted;
  ctx.textAlign = "left";
  ctx.fillText("JOSHUA GIOWAYA  ·  JGDZINE.COM", L.marginX, L.footerY);

  const num = `${String(page.index + 1).padStart(2, "0")} / ${String(page.total).padStart(2, "0")}`;
  ctx.font = `${L.flow ? 28 : 34}px ${FONT.heading}`;
  ctx.fillStyle = COLOR.ink;
  ctx.textAlign = "right";
  ctx.fillText(num, PAGE_W - L.marginX, L.footerY + 2);
  ctx.textAlign = "left";
}

/** Draws a sheet onto ctx; `scale` maps sheet units to canvas pixels. */
export function drawPage(ctx, page, scale = 1) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.textBaseline = "alphabetic";

  L = page.layout || LAYOUTS.notebook;
  ctx.fillStyle = L.paper;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  if (L.ruled) {
    // Faint ruled lines so the sheet reads as notebook paper
    ctx.strokeStyle = "rgba(167, 163, 158, 0.16)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = 48; y < PAGE_H; y += 48) {
      ctx.moveTo(0, y);
      ctx.lineTo(PAGE_W, y);
    }
    ctx.stroke();
  }

  if (page.band) drawBand(ctx, page);
  if (page.first && !L.flow) drawIntro(ctx, page);
  drawBlocks(ctx, page);
  drawFooter(ctx, page);
  ctx.restore();
}
