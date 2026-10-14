// site/client/plan3d.js — 間取りシミュレーターのブラウザ側(ビルド時に plan3d.html へそのまま埋め込まれる)。
// データの正本は site/templates/plan3d.js の PLAN(window.PLAN として注入)。ここは編集・2D描画・3D描画だけを持ち、
// 寸法・面積・隙間を測って見せる。判定はしない。変更は localStorage(このブラウザだけ)に保存する。
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

const P = window.PLAN;
const CAT = P.ITEM_CATALOG;
const FLOOR_IDS = Object.keys(P.FLOORS);
const LS_KEY = "fudosan-plan3d-kamiya2-v1";
const SNAP_ITEM = 0.01, SNAP_WALL = P.GRID / 10;   // 設備1cm・壁45.5mm
const RISER = P.LEVELS["1F"].story / (P.STAIR.winders + P.STAIR.straight);
const TREAD = (P.STAIR.yTurn - P.STAIR.yTop) / P.STAIR.straight;

// ---------- 状態 ----------
let uid = 1;
const nid = () => `i${uid++}`;
function initialState() {
  const floors = {};
  for (const fid of FLOOR_IDS) {
    const f = P.FLOORS[fid];
    floors[fid] = {
      walls: f.walls.map((w) => ({ ...w, id: nid() })),
      items: [
        ...f.items.map((it) => ({ id: nid(), rot: 0, ...it })),
        ...f.openings.filter((o) => o.type === "door").map((o) => ({ id: nid(), ...o })),
      ],
    };
  }
  return { version: 1, floors };
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) ?? "null");
    if (!s || s.version !== 1 || !s.floors) return null;
    for (const fid of FLOOR_IDS) if (!s.floors[fid]) return null;
    // id の採番を復元後の最大値に合わせる(重複防止)
    for (const f of Object.values(s.floors)) for (const o of [...f.walls, ...f.items]) { const n = Number(String(o.id).slice(1)); if (n >= uid) uid = n + 1; }
    return s;
  } catch { return null; }
}
const loaded = loadState();
let state = loaded ?? initialState();
window.plan3dState = () => JSON.parse(JSON.stringify(state));   // 検査用(tests/ui/plan3d.ui.mjs)
let saved = !!loaded;
const undoStack = [];
function pushUndo() { undoStack.push(JSON.stringify(state)); if (undoStack.length > 40) undoStack.shift(); }
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); saved = true; } catch { saved = false; }
  const el = document.getElementById("saveState");
  el.textContent = saved ? "このブラウザに保存済み(自動)" : "保存できませんでした(プライベートモード等)";
}

let cur = FLOOR_IDS[0];
let tool = "select";
let viewMode = "floor";      // floor | all | explode
let wallH = "1.2";
let selected = null;         // {kind:"item"|"wall", id}
let measure = { a: null, b: null };
let areaResult = null;       // {cells:Set, area, bbox}
let wallDraft = null;
let lastClickWorld = null;

const $ = (s) => document.querySelector(s);
const F = () => state.floors[cur];
const itemDims = (it) => {
  const c = CAT[it.type] ?? CAT.box;
  const w = it.w ?? c.w, d = it.d ?? c.d, h = it.h ?? c.h;
  const r = ((it.rot ?? 0) % 360 + 360) % 360;
  return { w, d, h, r, hx: (r % 180 === 0 ? w : d) / 2, hy: (r % 180 === 0 ? d : w) / 2 };
};
const aabb = (it) => { const m = itemDims(it); return { x0: it.x - m.hx, x1: it.x + m.hx, y0: it.y - m.hy, y1: it.y + m.hy }; };
const wallRect = (w) => {
  const t = (w.kind === "ext" ? P.WALL_T.ext : w.kind === "void" ? 0.02 : P.WALL_T.int) / 2;
  return { x0: Math.min(w.x1, w.x2) - t, x1: Math.max(w.x1, w.x2) + t, y0: Math.min(w.y1, w.y2) - t, y1: Math.max(w.y1, w.y2) + t, t };
};
const frontVec = (r) => [[0, -1], [1, 0], [0, 1], [-1, 0]][((Math.round((r ?? 0) / 90) % 4) + 4) % 4];
// 推奨スペース(目安)の矩形。背面を設備の背面に揃えて前方へ伸ばす
function spaceRect(it) {
  const c = CAT[it.type]; if (!c?.space) return null;
  const m = itemDims(it); const [fx, fy] = frontVec(m.r);
  const sw = c.space.w, sd = c.space.d;
  // 中心: 背面(前方向の逆)に m.d/2 戻った点から前方へ sd/2
  const cx = it.x + fx * (sd / 2 - m.d / 2), cy = it.y + fy * (sd / 2 - m.d / 2);
  const hx = (m.r % 180 === 0 ? sw : sd) / 2, hy = (m.r % 180 === 0 ? sd : sw) / 2;
  return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy };
}

// ---------- 隙間(クリアランス)と頭上高さ ----------
function gapInDir(box, dir, fid, exceptId) {
  const f = state.floors[fid];
  const obs = [
    ...f.walls.map(wallRect),
    ...f.items.filter((o) => o.id !== exceptId && o.type !== "door" && o.type !== "window").map(aabb),
  ];
  const eps = 0.005;
  let best = Infinity, hit = null;
  for (const o of obs) {
    if (dir === "N" || dir === "S") {
      if (o.x1 <= box.x0 + eps || o.x0 >= box.x1 - eps) continue;
      const g = dir === "N" ? box.y0 - o.y1 : o.y0 - box.y1;
      const ov = dir === "N" ? o.y0 < box.y0 : o.y1 > box.y1;   // 障害物が設備の内側まで食い込んでいる
      if ((g >= -eps || ov) && g < best) { best = g; hit = o; }
    } else {
      if (o.y1 <= box.y0 + eps || o.y0 >= box.y1 - eps) continue;
      const g = dir === "W" ? box.x0 - o.x1 : o.x0 - box.x1;
      const ov = dir === "W" ? o.x0 < box.x0 : o.x1 > box.x1;
      if ((g >= -eps || ov) && g < best) { best = g; hit = o; }
    }
  }
  return { gap: best, hit };
}
// 階段の裏面の高さ(床から)。該当階の階段(1F→2F は1Fで、2F→3F は2Fで見る)
function stairUnderside(fid, y) {
  if (fid !== "1F" && fid !== "2F") return null;
  const s = P.STAIR;
  if (y < s.yTop || y > s.yBottom) return null;
  const story = P.LEVELS[fid].story;
  const riser = story / (s.winders + s.straight);
  const hTurn = riser * s.winders;
  let top;
  if (y >= s.yTurn) top = hTurn * (s.yBottom - y) / (s.yBottom - s.yTurn);
  else top = hTurn + (story - hTurn) * (s.yTurn - y) / (s.yTurn - s.yTop);
  return Math.max(0, top - s.thickness);
}

// ---------- 2D ----------
const c2 = $("#plan2d");
const VIEW = { x0: -1.3, x1: 4.7, y0: -1.9, y1: 9.9 };
let scale = 70, ox = 0, oy = 0, dpr = 1;
function fit2d() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = c2.clientWidth || 440;
  scale = cssW / (VIEW.x1 - VIEW.x0);
  const cssH = Math.round((VIEW.y1 - VIEW.y0) * scale);
  c2.style.height = cssH + "px";
  c2.width = Math.round(cssW * dpr); c2.height = Math.round(cssH * dpr);
  ox = -VIEW.x0 * scale; oy = -VIEW.y0 * scale;
}
const toPx = (x, y) => [ox + x * scale, oy + y * scale];
const toW = (px, py) => [(px - ox) / scale, (py - oy) / scale];
const mm = (v) => Math.round(v * 1000).toLocaleString();

function draw2d() {
  const ctx = c2.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, c2.width, c2.height);
  const f = F(); const fl = P.FLOORS[cur];
  // 敷地・道路・B区画
  ctx.fillStyle = "#F2F4F0"; poly(ctx, P.LOT.polygon); ctx.fill();
  ctx.strokeStyle = "#8A9AA6"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); poly(ctx, P.LOT.polygon); ctx.stroke();
  poly(ctx, P.LOT.b); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = "#D9DEE3"; rect(ctx, -2.5, -1.15 - 6, 9, 6); ctx.fill();
  txt(ctx, "道路 幅員6.0m(北)", 0.4, -1.55, 10, "#43566B");
  txt(ctx, "B区画", -1.25, 2.0, 10, "#8A9AA6");
  txt(ctx, "敷地 A区画 47.52m²", -0.4, 9.65, 10, "#43566B");
  // 床
  const slab = fl.floorRect ?? { x0: 0, y0: 0, x1: P.W, y1: P.L };
  ctx.fillStyle = "#FFFFFF"; rect(ctx, slab.x0, slab.y0, slab.x1 - slab.x0, slab.y1 - slab.y0); ctx.fill();
  // 部屋(種類で塗る)
  for (const r of fl.rooms) {
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    if (r.kind === "outside") { ctx.fillStyle = "#EEF1EC"; rect(ctx, r.x0, r.y0, w, h); ctx.fill(); ctx.strokeStyle = "#B8C0C8"; ctx.setLineDash([3, 3]); rect(ctx, r.x0, r.y0, w, h); ctx.stroke(); ctx.setLineDash([]); }
    else if (r.kind === "void") { ctx.strokeStyle = "#B8C0C8"; ctx.setLineDash([5, 4]); rect(ctx, r.x0, r.y0, w, h); ctx.stroke(); ctx.setLineDash([]); cross(ctx, r); }
    else if (r.kind === "stair") stairTreads(ctx, r);
    else if (r.kind === "closet") { ctx.fillStyle = "#F5F1E8"; rect(ctx, r.x0, r.y0, w, h); ctx.fill(); }
    else if (r.kind === "garage") { ctx.fillStyle = "#F3F3F3"; rect(ctx, r.x0, r.y0, w, h); ctx.fill(); }
  }
  // 部屋の広さツールの結果
  if (areaResult && areaResult.fid === cur) {
    ctx.fillStyle = "rgba(46,110,142,.18)";
    const cs = areaResult.cs;
    for (const k of areaResult.cells) { const i = k % areaResult.nx, j = (k - i) / areaResult.nx; rect(ctx, areaResult.x0 + i * cs, areaResult.y0 + j * cs, cs, cs); ctx.fill(); }
  }
  // 階段裏面の高さ(1F・2F)— 階段下の天井勾配を薄く表示
  if (cur === "1F" || cur === "2F") {
    const s = P.STAIR;
    for (let y = s.yTop; y < s.yBottom; y += 0.2275) {
      const h = stairUnderside(cur, y + 0.11);
      ctx.fillStyle = h < 1.0 ? "rgba(201,58,43,.10)" : h < 1.9 ? "rgba(176,124,16,.10)" : "rgba(44,110,73,.06)";
      rect(ctx, s.x0, y, s.x1 - s.x0, 0.2275); ctx.fill();
    }
  }
  // 推奨スペース(目安)
  if ($("#chkSpace").checked) for (const it of f.items) { const sr = spaceRect(it); if (!sr) continue; ctx.fillStyle = "rgba(201,58,43,.10)"; ctx.strokeStyle = "rgba(201,58,43,.55)"; ctx.setLineDash([3, 2]); rect(ctx, sr.x0, sr.y0, sr.x1 - sr.x0, sr.y1 - sr.y0); ctx.fill(); ctx.stroke(); ctx.setLineDash([]); }
  // 設備
  for (const it of f.items) if (it.type !== "door") drawItem(ctx, it, selected?.kind === "item" && selected.id === it.id);
  // 壁
  for (const w of f.walls) {
    const r = wallRect(w); const sel = selected?.kind === "wall" && selected.id === w.id;
    ctx.fillStyle = w.kind === "void" ? "#B8C0C8" : sel ? "#C93A2B" : "#16232E";
    rect(ctx, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); ctx.fill();
  }
  // 窓(静的)・ドア(可動)
  for (const o of fl.openings) if (o.type === "window") drawWindow(ctx, o);
  for (const it of f.items) if (it.type === "door") drawDoor(ctx, it, selected?.kind === "item" && selected.id === it.id);
  // 部屋名
  if ($("#chkLabels").checked) for (const r of fl.rooms) if (r.kind !== "outside" || r.name === "バルコニー") roomLabel(ctx, r);
  // 寸法の目盛(壁芯の位置・mm)
  dims(ctx, f);
  // 寸法ツール
  if (measure.a) {
    const [ax, ay] = toPx(...measure.a); ctx.fillStyle = "#C93A2B"; ctx.beginPath(); ctx.arc(ax, ay, 4, 0, 7); ctx.fill();
    if (measure.b) {
      const [bx, by] = toPx(...measure.b); ctx.strokeStyle = "#C93A2B"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.beginPath(); ctx.arc(bx, by, 4, 0, 7); ctx.fill();
      const dx = measure.b[0] - measure.a[0], dy = measure.b[1] - measure.a[1];
      const d = Math.hypot(dx, dy);
      const lab = `${mm(d)}mm` + (Math.abs(dx) > 0.01 && Math.abs(dy) > 0.01 ? ` (x${mm(Math.abs(dx))}・y${mm(Math.abs(dy))})` : "");
      txtBox(ctx, lab, (ax + bx) / 2, (ay + by) / 2 - 10);
    }
  }
  if (wallDraft) { const [ax, ay] = toPx(wallDraft.x1, wallDraft.y1), [bx, by] = toPx(wallDraft.x2, wallDraft.y2); ctx.strokeStyle = "#C93A2B"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
  // 北矢印
  txt(ctx, "N↑", 4.35, -1.4, 12, "#16232E");
}
function poly(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => { const [px, py] = toPx(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); }
function rect(ctx, x, y, w, h) { const [px, py] = toPx(x, y); ctx.beginPath(); ctx.rect(px, py, w * scale, h * scale); }
function txt(ctx, s, x, y, size, color, align = "left") { const [px, py] = toPx(x, y); ctx.font = `${size}px "Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(s, px, py); }
function roomLabel(ctx, r) { // 部屋名: 左上に白地で。部屋幅に入らなければ短縮(「洋室 7.9帖(上部吹抜)」→「洋室 7.9帖」→「洋室」)
  const wpx = (r.x1 - r.x0) * scale - 6; const [px, py] = toPx(r.x0 + 0.06, r.y0 + 0.14);
  ctx.font = `9px "Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif`;
  let s = r.name; while (ctx.measureText(s).width > wpx && s.length > 2) s = s.includes("(") ? s.replace(/\s*\([^)]*\)$/, "") : s.includes(" ") ? s.replace(/\s\S*$/, "") : s.slice(0, -1);
  const w = ctx.measureText(s).width + 4; ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.fillRect(px - 2, py - 6, w, 12);
  ctx.fillStyle = "#43566B"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(s, px, py);
}
function txtBox(ctx, s, px, py) { ctx.font = `11px Consolas,Menlo,monospace`; const w = ctx.measureText(s).width + 8; ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillRect(px - w / 2, py - 8, w, 16); ctx.strokeStyle = "#C93A2B"; ctx.lineWidth = 1; ctx.strokeRect(px - w / 2, py - 8, w, 16); ctx.fillStyle = "#C93A2B"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(s, px, py); }
function cross(ctx, r) { const [a, b] = toPx(r.x0, r.y0), [c, d] = toPx(r.x1, r.y1); ctx.strokeStyle = "#C8CED4"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.moveTo(c, b); ctx.lineTo(a, d); ctx.stroke(); }
function stairTreads(ctx, r) {
  ctx.strokeStyle = "#8A9AA6"; ctx.lineWidth = 1;
  const s = P.STAIR;
  const yA = Math.max(r.y0, s.yTop), yB = Math.min(r.y1, s.yTurn);
  for (let k = 0; k <= s.straight; k++) { const y = s.yTop + k * TREAD; if (y < yA - 1e-6 || y > yB + 1e-6) continue; const [a, b] = toPx(r.x0, y), [c] = toPx(r.x1, y); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, b); ctx.stroke(); }
  if (r.y1 > s.yTurn + 1e-6) { // 回り段(扇形)
    const [px, py] = toPx(r.x0, s.yTurn);
    for (let k = 1; k < s.winders; k++) { const a = (Math.PI / 2) * k / s.winders; const [qx, qy] = toPx(r.x0 + Math.sin(a) * 1.3, s.yTurn + Math.cos(a) * 1.3); ctx.save(); rect(ctx, r.x0, s.yTurn, r.x1 - r.x0, r.y1 - s.yTurn); ctx.clip(); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(qx, qy); ctx.stroke(); ctx.restore(); }
  }
  txt(ctx, cur === "3F" ? "DN" : "UP", (r.x0 + r.x1) / 2, r.y1 - 0.25, 9, "#43566B", "center");
}
function drawItem(ctx, it, sel) {
  const c = CAT[it.type] ?? CAT.box; const b = aabb(it); const m = itemDims(it);
  ctx.fillStyle = c.color + (it.type === "person" || it.type === "person_wheel" ? "99" : "CC");
  rect(ctx, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.fill();
  ctx.strokeStyle = sel ? "#C93A2B" : "#4A5560"; ctx.lineWidth = sel ? 2.5 : 1; ctx.stroke();
  // 前面の印
  const [fx, fy] = frontVec(m.r); const [px, py] = toPx(it.x + fx * (m.r % 180 === 0 ? m.hy : m.hx) * 0.8, it.y + fy * (m.r % 180 === 0 ? m.hy : m.hx) * 0.8);
  ctx.fillStyle = "#4A5560"; ctx.beginPath(); ctx.arc(px, py, 2, 0, 7); ctx.fill();
  const label = it.label ?? c.name.replace(/\(.*$/, "").replace(/ .*$/, "");
  ctx.font = `9px "Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif`;
  const tw = ctx.measureText(label).width;
  if (tw <= (b.x1 - b.x0) * scale - 4 && (b.y1 - b.y0) * scale >= 12) txt(ctx, label, it.x, it.y, 9, "#16232E", "center");
  else if (sel) txtBox(ctx, label, ...toPx(it.x, b.y0 - 0.12));
}
function drawWindow(ctx, o) {
  ctx.strokeStyle = "#6FB1C9"; ctx.lineWidth = 2;
  const horiz = o.dir === "N" || o.dir === "S";
  const [ax, ay] = toPx(horiz ? o.x - o.w / 2 : o.x, horiz ? o.y : o.y - o.w / 2);
  const [bx, by] = toPx(horiz ? o.x + o.w / 2 : o.x, horiz ? o.y : o.y + o.w / 2);
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
}
function drawDoor(ctx, d, sel) {
  const horiz = d.dir === "N" || d.dir === "S";
  const onExt = (horiz ? [0, P.L] : [0, P.W]).some((v) => Math.abs((horiz ? d.y : d.x) - v) < 0.02);
  const t = (onExt ? P.WALL_T.ext : P.WALL_T.int) / 2 + 0.01;
  // 開口(壁を白で抜く)
  ctx.fillStyle = "#FFFFFF";
  if (horiz) rect(ctx, d.x - d.w / 2, d.y - t, d.w, 2 * t); else rect(ctx, d.x - t, d.y - d.w / 2, 2 * t, d.w);
  ctx.fill();
  // 吊元と扉・円弧
  const swing = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[d.dir];
  let hx, hy; // 吊元
  if (horiz) { hx = d.x + (d.hinge === "E" ? d.w / 2 : -d.w / 2); hy = d.y; } else { hx = d.x; hy = d.y + (d.hinge === "S" ? d.w / 2 : -d.w / 2); }
  const [px, py] = toPx(hx, hy);
  const r = (d.fold ? d.w / 2 : d.w) * scale;
  const a0 = Math.atan2(swing[1], swing[0]);
  const toward = horiz ? (d.hinge === "E" ? Math.PI : 0) : (d.hinge === "S" ? -Math.PI / 2 : Math.PI / 2);
  ctx.strokeStyle = sel ? "#C93A2B" : "#43566B"; ctx.lineWidth = sel ? 2 : 1;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a0) * r, py + Math.sin(a0) * r); ctx.stroke();
  ctx.beginPath(); ctx.setLineDash([2, 2]);
  const cw = ((toward - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI; // 0..±π/2
  ctx.arc(px, py, r, a0, a0 + (cw > 0 ? Math.PI / 2 : -Math.PI / 2), cw < 0); ctx.stroke(); ctx.setLineDash([]);
  if (d.fold) { // 折戸: もう一枚
    const [qx, qy] = toPx(horiz ? d.x - (d.hinge === "E" ? -d.w / 2 : d.w / 2) * -1 : hx, horiz ? hy : d.y - (d.hinge === "S" ? -d.w / 2 : d.w / 2) * -1);
    ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(qx + Math.cos(a0) * r, qy + Math.sin(a0) * r); ctx.stroke();
  }
}
function dims(ctx, f) {
  const xs = new Set([0, P.W]), ys = new Set([0, P.L]);
  for (const w of f.walls) { if (Math.abs(w.x1 - w.x2) < 1e-6) xs.add(round3(w.x1)); if (Math.abs(w.y1 - w.y2) < 1e-6) ys.add(round3(w.y1)); }
  ctx.strokeStyle = "#8A9AA6"; ctx.lineWidth = 1;
  const yTop = -1.0, xLeft = -0.72;
  let prevX = -9, alt = false;
  for (const x of [...xs].sort((a, b) => a - b)) { const [px, py] = toPx(x, yTop); ctx.beginPath(); ctx.moveTo(px, py - 4); ctx.lineTo(px, py + 4); ctx.stroke(); alt = (x - prevX) * scale < 30 ? !alt : false; txt(ctx, mm(x), x, yTop - (alt ? 0.30 : 0.14), 8, "#43566B", "center"); prevX = x; }
  let prevY = -9, altY = false;
  for (const y of [...ys].sort((a, b) => a - b)) { const [px, py] = toPx(xLeft, y); ctx.beginPath(); ctx.moveTo(px - 4, py); ctx.lineTo(px + 4, py); ctx.stroke(); altY = (y - prevY) * scale < 11 ? !altY : false; txt(ctx, mm(y), xLeft - (altY ? 0.42 : 0.08), y, 8, "#43566B", "right"); prevY = y; }
  { const [a, b] = toPx(0, yTop), [c] = toPx(P.W, yTop); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, b); ctx.stroke(); }
  { const [a, b] = toPx(xLeft, 0), [, d] = toPx(xLeft, P.L); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(a, d); ctx.stroke(); }
}
const round3 = (v) => Math.round(v * 1000) / 1000;

// ---------- 2D 操作 ----------
let drag = null;
function hitTest(wx, wy) {
  const f = F();
  // 小さい設備を優先(面積の昇順)
  const items = f.items.filter((it) => it.type !== "door").map((it) => ({ it, b: aabb(it) })).filter(({ b }) => wx >= b.x0 && wx <= b.x1 && wy >= b.y0 && wy <= b.y1)
    .sort((p, q) => (p.b.x1 - p.b.x0) * (p.b.y1 - p.b.y0) - (q.b.x1 - q.b.x0) * (q.b.y1 - q.b.y0));
  if (items.length) return { kind: "item", id: items[0].it.id };
  const tol = 6 / scale;
  for (const d of f.items.filter((it) => it.type === "door")) { const horiz = d.dir === "N" || d.dir === "S"; const b = horiz ? { x0: d.x - d.w / 2, x1: d.x + d.w / 2, y0: d.y - tol, y1: d.y + tol } : { x0: d.x - tol, x1: d.x + tol, y0: d.y - d.w / 2, y1: d.y + d.w / 2 }; if (wx >= b.x0 && wx <= b.x1 && wy >= b.y0 && wy <= b.y1) return { kind: "item", id: d.id }; }
  for (const w of f.walls) { if (w.kind === "void") continue; const r = wallRect(w); if (wx >= r.x0 - tol && wx <= r.x1 + tol && wy >= r.y0 - tol && wy <= r.y1 + tol) return { kind: "wall", id: w.id }; }
  return null;
}
const snapTo = (v, s) => Math.round(v / s) * s;
function nearestWallPoint(wx, wy) {
  let best = null;
  for (const w of F().walls) {
    if (w.kind === "void") continue;
    const horiz = Math.abs(w.y1 - w.y2) < 1e-6;
    const px = horiz ? Math.min(Math.max(wx, Math.min(w.x1, w.x2)), Math.max(w.x1, w.x2)) : w.x1;
    const py = horiz ? w.y1 : Math.min(Math.max(wy, Math.min(w.y1, w.y2)), Math.max(w.y1, w.y2));
    const d = Math.hypot(px - wx, py - wy);
    if (!best || d < best.d) best = { d, x: px, y: py, horiz };
  }
  return best;
}
c2.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !e.isPrimary) return;
  const r = c2.getBoundingClientRect(); const [wx, wy] = toW(e.clientX - r.left, e.clientY - r.top);
  lastClickWorld = [wx, wy];
  c2.setPointerCapture(e.pointerId);
  if (tool === "measure") {
    const p = snapPoint(wx, wy);
    if (!measure.a || measure.b) measure = { a: p, b: null }; else measure.b = p;
    draw2d(); return;
  }
  if (tool === "area") { selected = null; areaResult = floodArea(wx, wy); draw2d(); renderProps(); request3d(); return; }
  if (tool === "wall") { wallDraft = { x1: snapTo(wx, SNAP_WALL), y1: snapTo(wy, SNAP_WALL), x2: snapTo(wx, SNAP_WALL), y2: snapTo(wy, SNAP_WALL) }; draw2d(); return; }
  const h = hitTest(wx, wy);
  selected = h;
  if (h) {
    const obj = h.kind === "item" ? F().items.find((o) => o.id === h.id) : F().walls.find((o) => o.id === h.id);
    drag = { kind: h.kind, obj, sx: wx, sy: wy, orig: JSON.parse(JSON.stringify(obj)), moved: false };
  }
  draw2d(); renderProps();
});
c2.addEventListener("pointermove", (e) => {
  const r = c2.getBoundingClientRect(); const [wx, wy] = toW(e.clientX - r.left, e.clientY - r.top);
  if (wallDraft) { // 直交にスナップ
    const dx = wx - wallDraft.x1, dy = wy - wallDraft.y1;
    if (Math.abs(dx) > Math.abs(dy)) { wallDraft.x2 = snapTo(wx, SNAP_WALL); wallDraft.y2 = wallDraft.y1; } else { wallDraft.y2 = snapTo(wy, SNAP_WALL); wallDraft.x2 = wallDraft.x1; }
    draw2d(); return;
  }
  if (!drag) return;
  if (!drag.moved) { pushUndo(); drag.moved = true; }
  const noSnap = e.altKey;
  if (drag.kind === "item") {
    const it = drag.obj;
    if (it.type === "door") {
      const np = nearestWallPoint(wx, wy); if (!np) return;
      it.x = np.x; it.y = np.y;
      const newHoriz = np.horiz; const wasHoriz = it.dir === "N" || it.dir === "S";
      if (newHoriz !== wasHoriz) { it.dir = newHoriz ? "S" : "E"; it.hinge = newHoriz ? "W" : "N"; }
    } else {
      const s = noSnap ? 0.001 : e.shiftKey ? SNAP_WALL : SNAP_ITEM;
      it.x = snapTo(drag.orig.x + (wx - drag.sx), s); it.y = snapTo(drag.orig.y + (wy - drag.sy), s);
    }
  } else {
    const w = drag.obj; const horiz = Math.abs(drag.orig.y1 - drag.orig.y2) < 1e-6;
    const s = noSnap ? 0.001 : e.shiftKey ? SNAP_ITEM : SNAP_WALL;
    if (horiz) { const ny = snapTo(drag.orig.y1 + (wy - drag.sy), s); w.y1 = ny; w.y2 = ny; }
    else { const nx = snapTo(drag.orig.x1 + (wx - drag.sx), s); w.x1 = nx; w.x2 = nx; }
  }
  sched();
});
let rafId = 0;
function sched() { if (rafId) return; rafId = requestAnimationFrame(() => { rafId = 0; draw2d(); renderProps(); request3d(); }); }
function endDrag() {
  if (wallDraft) {
    const len = Math.hypot(wallDraft.x2 - wallDraft.x1, wallDraft.y2 - wallDraft.y1);
    if (len >= SNAP_WALL - 1e-6) { pushUndo(); const w = { ...wallDraft, kind: "int", id: nid() }; F().walls.push(w); selected = { kind: "wall", id: w.id }; }
    wallDraft = null; save(); draw2d(); renderProps(); request3d(); return;
  }
  if (drag?.moved) { save(); areaResult = null; draw2d(); request3d(); }
  drag = null;
}
c2.addEventListener("pointerup", endDrag); c2.addEventListener("pointercancel", endDrag);
function snapPoint(wx, wy) { // 壁の面・設備の辺に8px以内なら吸着
  const tol = 8 / scale; let bx = wx, by = wy;
  const xs = [], ys = [];
  for (const w of F().walls) { const r = wallRect(w); xs.push(r.x0, r.x1); ys.push(r.y0, r.y1); }
  for (const it of F().items) if (it.type !== "door") { const b = aabb(it); xs.push(b.x0, b.x1); ys.push(b.y0, b.y1); }
  for (const x of xs) if (Math.abs(x - wx) < tol && Math.abs(x - wx) < Math.abs(bx - wx) + 1e-9) bx = x;
  for (const y of ys) if (Math.abs(y - wy) < tol && Math.abs(y - wy) < Math.abs(by - wy) + 1e-9) by = y;
  return [bx, by];
}
// 部屋の広さ: 2.5cmラスタで壁(厚み込み)を障害物として塗りつぶす。ドアは閉じているものとして壁を連続扱い(部屋ごとに分かれる)
function floodArea(wx, wy) {
  const cs = 0.025; const fid = cur; const fl = P.FLOORS[fid];
  const hasNorth = F().walls.some((w) => w.kind === "ext" && Math.abs(w.y1) < 1e-6 && Math.abs(w.y2) < 1e-6);
  const slab = fl.floorRect ?? { x0: 0, y0: hasNorth ? -0.91 : 0, x1: P.W, y1: P.L };
  const x0 = slab.x0 - 0.08, y0 = slab.y0 - 0.08, nx = Math.ceil((slab.x1 - slab.x0 + 0.16) / cs), ny = Math.ceil((slab.y1 - slab.y0 + 0.16) / cs);
  const blocked = new Uint8Array(nx * ny);
  const rects = F().walls.map(wallRect);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cx = x0 + (i + 0.5) * cs, cy = y0 + (j + 0.5) * cs;
    if (cx < slab.x0 || cx > slab.x1 || cy < slab.y0 || cy > slab.y1) { blocked[j * nx + i] = 1; continue; }
    for (const r of rects) if (cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1) { blocked[j * nx + i] = 1; break; }
  }
  const si = Math.floor((wx - x0) / cs), sj = Math.floor((wy - y0) / cs);
  if (si < 0 || sj < 0 || si >= nx || sj >= ny || blocked[sj * nx + si]) return null;
  const cells = new Set(); const q = [sj * nx + si]; blocked[sj * nx + si] = 2;
  let bx0 = si, bx1 = si, by0 = sj, by1 = sj;
  while (q.length) {
    const k = q.pop(); cells.add(k); const i = k % nx, j = (k - i) / nx;
    bx0 = Math.min(bx0, i); bx1 = Math.max(bx1, i); by0 = Math.min(by0, j); by1 = Math.max(by1, j);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue; const nk = nj * nx + ni; if (!blocked[nk]) { blocked[nk] = 2; q.push(nk); } }
    if (cells.size > 400000) break;
  }
  return { fid, cells, cs, nx, x0, y0, area: cells.size * cs * cs, bw: (bx1 - bx0 + 1) * cs, bh: (by1 - by0 + 1) * cs };
}

// ---------- プロパティ欄 ----------
function renderProps() {
  const el = $("#props");
  if (areaResult && areaResult.fid === cur && !selected) {
    el.innerHTML = `<div><span class="k">部屋の広さ(内法・壁は閉じた扱い)</span></div><div class="v" style="font-size:1.05rem">${areaResult.area.toFixed(2)} m² ≈ ${(areaResult.area / 1.62).toFixed(2)} 帖</div>
      <div class="hint">塗られた範囲の外接 ${mm(areaResult.bw)}×${mm(areaResult.bh)}mm(内法の目安)。1帖=1.62m²。ドアの開口は壁として閉じているので、廊下と部屋はドアで分かれます。</div>`;
    return;
  }
  if (!selected) { el.innerHTML = `<span class="k">何も選択していません。</span><div class="hint">平面図の設備をクリックすると寸法と周囲の隙間が出ます。<kbd>R</kbd> 回転 / <kbd>Del</kbd> 削除 / <kbd>矢印</kbd> 1cm移動(<kbd>Shift</kbd>で45.5mm) / ドラッグ移動。壁は線をドラッグ(垂直方向に動きます)。</div>`; return; }
  const f = F();
  if (selected.kind === "wall") {
    const w = f.walls.find((o) => o.id === selected.id); if (!w) { selected = null; return renderProps(); }
    const horiz = Math.abs(w.y1 - w.y2) < 1e-6;
    el.innerHTML = `<div><span class="k">壁(${w.kind === "ext" ? "外壁 150mm" : "内壁 90mm"})</span></div>
      <div class="v">${horiz ? `y=${mm(w.y1)}  x ${mm(Math.min(w.x1, w.x2))}〜${mm(Math.max(w.x1, w.x2))}` : `x=${mm(w.x1)}  y ${mm(Math.min(w.y1, w.y2))}〜${mm(Math.max(w.y1, w.y2))}`} (芯・mm)</div>
      <div class="toolbar"><span class="lbl">位置</span><input class="inp" id="wpos" value="${mm(horiz ? w.y1 : w.x1).replace(/,/g, "")}"> mm
        <button class="btn" id="wapply">反映</button><button class="btn warn" id="wdel">この壁を消す</button></div>
      <div class="hint">壁は芯線で持つ。ドラッグで45.5mm刻み(<kbd>Shift</kbd>で1cm・<kbd>Alt</kbd>でスナップなし)。壁を動かしても設備は動かないので、必要なら設備も動かす。外壁を動かすと建物の大きさが変わる(確認申請の前提が変わる)。</div>`;
    $("#wapply").onclick = () => { pushUndo(); const v = Number($("#wpos").value) / 1000; if (!Number.isFinite(v)) return; if (horiz) { w.y1 = v; w.y2 = v; } else { w.x1 = v; w.x2 = v; } save(); draw2d(); request3d(); renderProps(); };
    $("#wdel").onclick = () => { pushUndo(); f.walls = f.walls.filter((o) => o.id !== w.id); selected = null; save(); draw2d(); request3d(); renderProps(); };
    return;
  }
  const it = f.items.find((o) => o.id === selected.id); if (!it) { selected = null; return renderProps(); }
  if (it.type === "door") {
    el.innerHTML = `<div><span class="k">ドア ${it.label ?? ""}</span> <span class="v">幅 ${mm(it.w)}mm・開く向き ${it.dir}・吊元 ${it.hinge}${it.fold ? "・折戸" : ""}</span></div>
      <div class="toolbar"><span class="lbl">幅</span><input class="inp" id="dw" value="${mm(it.w).replace(/,/g, "")}"> mm <button class="btn" id="dapply">反映</button>
        <button class="btn" id="dflip">開く向きを反転</button><button class="btn" id="dhinge">吊元を反転</button><button class="btn" id="dfold">${it.fold ? "開き戸に" : "折戸に"}</button><button class="btn warn" id="ddel">消す</button></div>
      <div class="hint">ドラッグすると最寄りの壁に沿って動く。開き戸は円弧の範囲が通路・設備と重ならないかを見る(引戸にする手もある)。</div>`;
    $("#dapply").onclick = () => { pushUndo(); const v = Number($("#dw").value) / 1000; if (v > 0.3 && v < 3) it.w = v; save(); draw2d(); request3d(); renderProps(); };
    $("#dflip").onclick = () => { pushUndo(); it.dir = { N: "S", S: "N", E: "W", W: "E" }[it.dir]; save(); draw2d(); request3d(); renderProps(); };
    $("#dhinge").onclick = () => { pushUndo(); it.hinge = { E: "W", W: "E", N: "S", S: "N" }[it.hinge]; save(); draw2d(); request3d(); renderProps(); };
    $("#dfold").onclick = () => { pushUndo(); it.fold = !it.fold; save(); draw2d(); request3d(); renderProps(); };
    $("#ddel").onclick = () => { pushUndo(); f.items = f.items.filter((o) => o.id !== it.id); selected = null; save(); draw2d(); request3d(); renderProps(); };
    return;
  }
  const c = CAT[it.type] ?? CAT.box; const m = itemDims(it); const b = aabb(it);
  const dirs = { 前: frontVec(m.r), 後: frontVec((m.r + 180) % 360), 右: frontVec((m.r + 90) % 360), 左: frontVec((m.r + 270) % 360) };
  const dName = (v) => (v[0] === 1 ? "E" : v[0] === -1 ? "W" : v[1] === 1 ? "S" : "N");
  const gaps = Object.fromEntries(Object.entries(dirs).map(([k, v]) => [k, gapInDir(b, dName(v), cur, it.id)]));
  const need = c.space ? Math.max(0, c.space.d - m.d) : null; // 前方に要る余地(目安)
  const cell = (k) => { const g = gaps[k].gap; const cls = k === "前" && need != null ? (g >= need - 1e-6 ? "ok" : "ng") : ""; return `<div class="${g < -0.005 ? "ng" : cls}">${k}(${dName(dirs[k])})<b>${g < -0.005 ? "重なり" : Number.isFinite(g) ? mm(g) + "mm" : "開放"}</b></div>`; };
  const hu0 = stairUnderside(cur, b.y0), hu1 = stairUnderside(cur, b.y1);
  const under = (hu0 != null || hu1 != null) && b.x1 > P.STAIR.x0 && b.x0 < P.STAIR.x1;
  const head = under ? `<div class="hint" style="color:var(--stamp)">階段の下: 頭上の高さ 北端 ${hu0 != null ? hu0.toFixed(2) : "—"}m / 南端 ${hu1 != null ? hu1.toFixed(2) : "—"}m(床から階段裏まで。段割りの仮定に依存)</div>`
    : `<div class="hint">階段の下ではない(頭上は天井高 ${P.LEVELS[cur].ceil}m)</div>`;
  el.innerHTML = `<div><span class="k">${c.cat}</span> <b>${it.label ?? c.name}</b></div>
    <div class="v">中心 x${mm(it.x)} y${mm(it.y)} / 向き ${["北", "東", "南", "西"][m.r / 90]} / 外形 ${mm(b.x1 - b.x0)}×${mm(b.y1 - b.y0)}mm</div>
    <div class="toolbar"><span class="lbl">寸法 mm</span> 幅<input class="inp" id="iw" value="${mm(m.w).replace(/,/g, "")}"> 奥行<input class="inp" id="id" value="${mm(m.d).replace(/,/g, "")}"> 高さ<input class="inp" id="ih" value="${mm(m.h).replace(/,/g, "")}"> <button class="btn" id="iapply">反映</button></div>
    <div class="toolbar"><select class="sel" id="itype">${Object.entries(CAT).map(([k, v]) => `<option value="${k}"${k === it.type ? " selected" : ""}>${v.cat}: ${v.name}</option>`).join("")}</select>
      <button class="btn" id="irot">回転 R</button><button class="btn" id="idup">複製</button><button class="btn warn" id="idel">消す</button></div>
    <div class="k">周囲の隙間(設備の面から最寄りの壁面・設備まで)</div>
    <div class="clear">${["前", "後", "左", "右"].map(cell).join("")}</div>
    ${c.space ? `<div class="hint">目安: ${c.space.note}。前方に必要な余地 ${mm(need)}mm に対し ${Number.isFinite(gaps["前"].gap) ? mm(gaps["前"].gap) : "開放"}mm。赤い点線が推奨スペース(目安で、判定ではない)。</div>` : ""}
    ${c.note ? `<div class="hint">${c.note}</div>` : ""}${head}`;
  $("#iapply").onclick = () => { pushUndo(); const v = (id) => Number($(id).value) / 1000; if (v("#iw") > 0.05) it.w = v("#iw"); if (v("#id") > 0.05) it.d = v("#id"); if (v("#ih") > 0.01) it.h = v("#ih"); save(); draw2d(); request3d(); renderProps(); };
  $("#itype").onchange = (e) => { pushUndo(); it.type = e.target.value; delete it.w; delete it.d; delete it.h; delete it.label; save(); draw2d(); request3d(); renderProps(); };
  $("#irot").onclick = () => rotateSel();
  $("#idup").onclick = () => { pushUndo(); const n = { ...it, id: nid(), x: it.x + 0.3, y: it.y + 0.3 }; f.items.push(n); selected = { kind: "item", id: n.id }; save(); draw2d(); request3d(); renderProps(); };
  $("#idel").onclick = () => deleteSel();
}
function rotateSel() { if (selected?.kind !== "item") return; const it = F().items.find((o) => o.id === selected.id); if (!it || it.type === "door") return; pushUndo(); it.rot = ((it.rot ?? 0) + 90) % 360; save(); draw2d(); request3d(); renderProps(); }
function deleteSel() { if (!selected) return; pushUndo(); const f = F(); if (selected.kind === "item") f.items = f.items.filter((o) => o.id !== selected.id); else f.walls = f.walls.filter((o) => o.id !== selected.id); selected = null; save(); draw2d(); request3d(); renderProps(); }

// ---------- UI配線 ----------
document.querySelectorAll("#floorTabs [data-floor]").forEach((b) => b.onclick = () => { const prevZ = floorZ(cur); cur = b.dataset.floor; followFloor(prevZ); selected = null; areaResult = null; measure = { a: null, b: null }; document.querySelectorAll("#floorTabs [data-floor]").forEach((x) => x.classList.toggle("on", x === b)); draw2d(); renderProps(); request3d(); });
document.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => { const prevZ = floorZ(cur); viewMode = b.dataset.view; followFloor(prevZ); document.querySelectorAll("[data-view]").forEach((x) => x.classList.toggle("on", x === b)); request3d(); });
document.querySelectorAll("[data-wallh]").forEach((b) => b.onclick = () => { wallH = b.dataset.wallh; document.querySelectorAll("[data-wallh]").forEach((x) => x.classList.toggle("on", x === b)); request3d(); });
document.querySelectorAll("[data-tool]").forEach((b) => b.onclick = () => { tool = b.dataset.tool; document.querySelectorAll("[data-tool]").forEach((x) => x.classList.toggle("on", x === b)); if (tool !== "measure") measure = { a: null, b: null }; if (tool !== "area") areaResult = null; c2.style.cursor = tool === "select" ? "default" : "crosshair"; draw2d(); renderProps(); });
$("#btnUndo").onclick = () => { const s = undoStack.pop(); if (!s) return; state = JSON.parse(s); selected = null; areaResult = null; save(); draw2d(); renderProps(); request3d(); };
$("#btnAdd").onclick = () => { pushUndo(); const type = $("#addSel").value; const [x, y] = lastClickWorld && lastClickWorld[0] > 0 && lastClickWorld[0] < P.W ? lastClickWorld : [P.W / 2, cur === "LOFT" ? 4.7 : 4.5]; const it = { id: nid(), type, x: snapTo(x, SNAP_ITEM), y: snapTo(y, SNAP_ITEM), rot: 0 }; F().items.push(it); selected = { kind: "item", id: it.id }; save(); draw2d(); renderProps(); request3d(); };
$("#btnDoor").onclick = () => { const np = nearestWallPoint(...(lastClickWorld ?? [P.W / 2, 4.5])); if (!np) return; pushUndo(); const d = { id: nid(), type: "door", x: np.x, y: np.y, w: 0.73, dir: np.horiz ? "S" : "E", hinge: np.horiz ? "W" : "N" }; F().items.push(d); selected = { kind: "item", id: d.id }; save(); draw2d(); renderProps(); request3d(); };
$("#btnExport").onclick = () => { const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `plan3d-kamiya2-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };
$("#fileImport").onchange = async (e) => { const file = e.target.files[0]; if (!file) return; try { const s = JSON.parse(await file.text()); if (s.version !== 1 || !s.floors) throw new Error("形式が違う"); pushUndo(); state = s; for (const f of Object.values(s.floors)) for (const o of [...f.walls, ...f.items]) { const n = Number(String(o.id).slice(1)); if (n >= uid) uid = n + 1; } selected = null; save(); draw2d(); renderProps(); request3d(); } catch (err) { alert("読み込めませんでした: " + err.message); } e.target.value = ""; };
$("#btnReset").onclick = () => { if (!confirm("この階だけでなく全階を図面の初期配置に戻します。よいですか?")) return; pushUndo(); state = initialState(); selected = null; areaResult = null; save(); draw2d(); renderProps(); request3d(); };
$("#chkLot").onchange = () => { staticDirty = true; request3d(); }; $("#chkLabels").onchange = () => { draw2d(); request3d(); }; $("#chkSpace").onchange = () => { draw2d(); request3d(); };
document.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); $("#btnUndo").click(); return; }
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSel(); return; }
  if (e.key.toLowerCase() === "r" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); rotateSel(); return; }
  if (selected?.kind === "item" && e.key.startsWith("Arrow")) {
    const it = F().items.find((o) => o.id === selected.id); if (!it || it.type === "door") return;
    e.preventDefault(); pushUndo(); const s = e.shiftKey ? SNAP_WALL : SNAP_ITEM;
    if (e.key === "ArrowLeft") it.x = round3(it.x - s); if (e.key === "ArrowRight") it.x = round3(it.x + s); if (e.key === "ArrowUp") it.y = round3(it.y - s); if (e.key === "ArrowDown") it.y = round3(it.y + s);
    save(); draw2d(); renderProps(); request3d();
  }
});

// ---------- 3D ----------
const c3 = $("#view3d");
const renderer = new THREE.WebGLRenderer({ canvas: c3, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xE9EEF2);
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
const controls = new OrbitControls(camera, c3); controls.enableDamping = true; controls.dampingFactor = 0.12; controls.maxPolarAngle = Math.PI / 2 + 0.3;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899AA, 0.95));
const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(-4, 12, -6); scene.add(sun);
const staticG = new THREE.Group(); const bldG = new THREE.Group(); scene.add(staticG, bldG);
const GL = -P.floorHeightGL;
const MAT = {
  lot: new THREE.MeshLambertMaterial({ color: 0xDDE4D6, side: THREE.DoubleSide }), road: new THREE.MeshLambertMaterial({ color: 0xB9C0C7 }), b: new THREE.MeshLambertMaterial({ color: 0xE6E9E3, side: THREE.DoubleSide }),
  slab: new THREE.MeshLambertMaterial({ color: 0xF4F2EC }), slabOut: new THREE.MeshLambertMaterial({ color: 0xDADDD6 }), found: new THREE.MeshLambertMaterial({ color: 0xA8ACB0 }),
  wallExt: new THREE.MeshLambertMaterial({ color: 0xC9CDD1 }), wallInt: new THREE.MeshLambertMaterial({ color: 0xE3E0D6 }),
  stair: new THREE.MeshLambertMaterial({ color: 0xB69A72 }), stairUnder: new THREE.MeshLambertMaterial({ color: 0x8E7A5E, side: THREE.DoubleSide }),
  glass: new THREE.MeshLambertMaterial({ color: 0x9FD2E8, transparent: true, opacity: 0.55 }), door: new THREE.MeshLambertMaterial({ color: 0x9C7B52 }),
  space: new THREE.MeshBasicMaterial({ color: 0xC93A2B, transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  sel: new THREE.LineBasicMaterial({ color: 0xC93A2B }), ghost: new THREE.MeshLambertMaterial({ color: 0xC9CDD1, transparent: true, opacity: 0.25, depthWrite: false }), ladder: new THREE.MeshLambertMaterial({ color: 0x8E7A5E }),
};
const itemMats = {};
const matFor = (color) => itemMats[color] ??= new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
const matGlassy = (color) => itemMats["t" + color] ??= new THREE.MeshLambertMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.45, depthWrite: false });
// 再構築のたびに geometry と非共有 material を捨てる(three の Group.clear() は remove するだけ=GPUバッファが溜まる)
function disposeGroup(g) { g.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m && !Object.values(MAT).includes(m) && !Object.values(itemMats).includes(m)) m.dispose?.(); }); g.clear(); }
function box(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }
function flatPoly(pts, mat, y, holes = []) { const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z))); for (const h of holes) sh.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, z)))); const g = new THREE.ShapeGeometry(sh); const m = new THREE.Mesh(g, mat); m.rotation.x = Math.PI / 2; m.position.y = y; m.scale.y = 1; return m; }
function slabMesh(x0, z0, x1, z1, y, t, mat, holes = []) {
  const sh = new THREE.Shape([new THREE.Vector2(x0, z0), new THREE.Vector2(x1, z0), new THREE.Vector2(x1, z1), new THREE.Vector2(x0, z1)]);
  for (const h of holes) sh.holes.push(new THREE.Path([new THREE.Vector2(h.x0, h.y0), new THREE.Vector2(h.x1, h.y0), new THREE.Vector2(h.x1, h.y1), new THREE.Vector2(h.x0, h.y1)]));
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false }); const m = new THREE.Mesh(g, mat); m.rotation.x = Math.PI / 2; m.position.y = y; return m;
}
function prism(tri, y0, y1, mat) { // 三角柱(回り段)
  const sh = new THREE.Shape(tri.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: false }); const m = new THREE.Mesh(g, mat); m.rotation.x = Math.PI / 2; m.position.y = y1; return m;
}
const labelCache = {};
function label(text, size = 0.32) {
  if (!labelCache[text]) { const cv = document.createElement("canvas"); const ctx = cv.getContext("2d"); ctx.font = "28px 'Hiragino Kaku Gothic ProN','Yu Gothic',Meiryo,sans-serif"; const w = Math.ceil(ctx.measureText(text).width) + 16; cv.width = w; cv.height = 40; ctx.font = "28px 'Hiragino Kaku Gothic ProN','Yu Gothic',Meiryo,sans-serif"; ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(0, 0, w, 40); ctx.fillStyle = "#16232E"; ctx.textBaseline = "middle"; ctx.fillText(text, 8, 20); const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter; labelCache[text] = { tex, ratio: w / 40 }; }
  const lc = labelCache[text]; lc.mat ??= new THREE.SpriteMaterial({ map: lc.tex, depthTest: false, transparent: true }); const sp = new THREE.Sprite(lc.mat); sp.scale.set(size * lc.ratio, size, 1); sp.renderOrder = 10; return sp;
}
let staticDirty = true;
function buildStatic() {
  staticDirty = false; disposeGroup(staticG);
  if (!$("#chkLot").checked) return;
  staticG.add(flatPoly(P.LOT.polygon, MAT.lot, GL - 0.002));
  staticG.add(flatPoly(P.LOT.b, MAT.b, GL - 0.004));
  const road = box(14, 0.02, 6, MAT.road, 1.7, GL - 0.02, -1.15 - 3); staticG.add(road);
  // 道路境界の縁石
  staticG.add(box(14, 0.12, 0.15, MAT.found, 1.7, GL + 0.06, -1.15 - 0.075));
  const l1 = label("道路 6.0m"); l1.position.set(1.7, GL + 0.6, -3.5); staticG.add(l1);
  const l2 = label("B区画"); l2.position.set(-2.6, GL + 0.6, 4); staticG.add(l2);
  // 10mの高さ制限の枠(GLから)
  const eg = new THREE.EdgesGeometry(new THREE.BoxGeometry(P.W, 10, P.L)); const ln = new THREE.LineSegments(eg, new THREE.LineDashedMaterial({ color: 0x8A9AA6, dashSize: 0.3, gapSize: 0.2 })); ln.computeLineDistances(); ln.position.set(P.W / 2, GL + 5, P.L / 2); staticG.add(ln);
  const l3 = label("高さ10m", 0.22); l3.position.set(0, GL + 10.15, 0); staticG.add(l3);
  // 基礎(GL→1F床の1cm下。床板と同一平面にするとちらつく)
  const fh = P.floorHeightGL - 0.01; staticG.add(box(P.W + 0.15, fh, P.L + 0.15, MAT.found, P.W / 2, GL + fh / 2, P.L / 2));
}
function stairMeshes(g, fid, zOff) {
  const s = P.STAIR; const story = P.LEVELS[fid].story; const riser = story / (s.winders + s.straight); const hTurn = riser * s.winders;
  // 回り段: 北西角を軸に、西辺→北辺へ扇形
  const pv = [s.x0, s.yTurn]; const sq = s.yBottom - s.yTurn;
  const ray = (a) => { const dx = Math.sin(a), dz = Math.cos(a); const t = Math.min(dx > 1e-6 ? sq / dx : Infinity, dz > 1e-6 ? sq / dz : Infinity); return [pv[0] + dx * t, pv[1] + dz * t]; };
  for (let i = 0; i < s.winders; i++) {
    const a0 = (Math.PI / 2) * i / s.winders, a1 = (Math.PI / 2) * (i + 1) / s.winders;
    const tri = [pv, ray(a0), ray(a1)]; if (i === s.winders - 1 || (a0 < Math.PI / 4 && a1 > Math.PI / 4)) tri.splice(2, 0, [s.x1, s.yBottom]);
    g.add(prism(tri, zOff, zOff + riser * (i + 1), MAT.stair));
  }
  // 直階段: 段板 + 裏面の斜め板
  for (let k = 0; k < s.straight; k++) {
    const yA = s.yTurn - (k + 1) * TREAD; const top = hTurn + riser * (k + 1);
    g.add(box(s.x1 - s.x0 - 0.02, 0.04, TREAD, MAT.stair, (s.x0 + s.x1) / 2, zOff + top - 0.02, yA + TREAD / 2));
    g.add(box(s.x1 - s.x0 - 0.02, riser - 0.04, 0.03, MAT.stair, (s.x0 + s.x1) / 2, zOff + top - 0.04 - (riser - 0.04) / 2, yA + TREAD - 0.015)); // 蹴込み(段板の下まで)
  }
  const run = s.yTurn - s.yTop, rise = story - hTurn; const len = Math.hypot(run, rise);
  const under = box(s.x1 - s.x0 - 0.02, s.thickness, len, MAT.stairUnder, (s.x0 + s.x1) / 2, zOff + hTurn + rise / 2 - s.thickness / 2 - 0.02, (s.yTop + s.yTurn) / 2);
  under.rotation.x = Math.atan2(rise, run); g.add(under);
}
function buildFloor(fid, zOff, showLabels) {
  const g = new THREE.Group(); const f = state.floors[fid]; const fl = P.FLOORS[fid]; const lv = P.LEVELS[fid];
  const wh = wallH === "full" ? lv.ceil : Number(wallH);
  const slab = fl.floorRect ?? { x0: 0, y0: 0, x1: P.W, y1: P.L };
  const holes = [];
  if (fid === "2F") holes.push({ x0: P.STAIR.x0, y0: P.STAIR.yTop, x1: P.STAIR.x1, y1: P.STAIR.yBottom });
  if (fid === "3F") holes.push({ x0: P.STAIR.x0, y0: P.STAIR.yTop, x1: P.STAIR.x1, y1: P.STAIR.yTurn });
  g.add(slabMesh(slab.x0, slab.y0, slab.x1, slab.y1, zOff, 0.12, MAT.slab, holes));
  for (const r of fl.rooms) if (r.kind === "outside") { g.add(slabMesh(r.x0, r.y0, r.x1, r.y1, zOff - (fid === "1F" ? 0.3 : 0), 0.1, MAT.slabOut)); if (fid !== "1F") { g.add(box(r.x1 - r.x0, 1.1, 0.05, MAT.wallExt, (r.x0 + r.x1) / 2, zOff + 0.55, r.y0 + 0.025)); g.add(box(0.05, 1.1, r.y1 - r.y0, MAT.wallExt, r.x0 + 0.025, zOff + 0.55, (r.y0 + r.y1) / 2)); g.add(box(0.05, 1.1, r.y1 - r.y0, MAT.wallExt, r.x1 - 0.025, zOff + 0.55, (r.y0 + r.y1) / 2)); } }
  for (const w of f.walls) { if (w.kind === "void") continue; const r = wallRect(w); const h = wh; g.add(box(r.x1 - r.x0, h, r.y1 - r.y0, w.kind === "ext" ? MAT.wallExt : MAT.wallInt, (r.x0 + r.x1) / 2, zOff + h / 2, (r.y0 + r.y1) / 2)); }
  for (const o of fl.openings) if (o.type === "window" && wh > 0.9) { const horiz = o.dir === "N" || o.dir === "S"; const wy = Math.min(wh, 2.0); g.add(box(horiz ? o.w : 0.18, wy - 0.9, horiz ? 0.18 : o.w, MAT.glass, o.x, zOff + 0.9 + (wy - 0.9) / 2, o.y)); }
  for (const it of f.items) {
    if (it.type === "door") { const horiz = it.dir === "N" || it.dir === "S"; const swing = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[it.dir]; let hx, hy; if (horiz) { hx = it.x + (it.hinge === "E" ? it.w / 2 : -it.w / 2); hy = it.y; } else { hx = it.x; hy = it.y + (it.hinge === "S" ? it.w / 2 : -it.w / 2); } const leaf = it.fold ? it.w / 2 : it.w; const dh = Math.min(2.0, Math.max(wh, 0.9)); g.add(box(horiz ? 0.04 : leaf, dh, horiz ? leaf : 0.04, MAT.door, hx + swing[0] * leaf / 2, zOff + dh / 2, hy + swing[1] * leaf / 2)); const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 13 }, (_, i) => { const a = Math.atan2(swing[1], swing[0]); const toward = horiz ? (it.hinge === "E" ? Math.PI : 0) : (it.hinge === "S" ? -Math.PI / 2 : Math.PI / 2); const cw = ((toward - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI; const t = a + (cw > 0 ? 1 : -1) * (Math.PI / 2) * i / 12; return new THREE.Vector3(hx + Math.cos(t) * leaf, zOff + 0.012, hy + Math.sin(t) * leaf); })), MAT.sel); g.add(arc); continue; }
    const c = CAT[it.type] ?? CAT.box; const m = itemDims(it); const b = aabb(it);
    const mesh = box(b.x1 - b.x0, m.h, b.y1 - b.y0, matFor(c.color), it.x, zOff + m.h / 2, it.y);
    if (it.type === "ub1316" || it.type === "ub1616" || it.type === "ub1216") mesh.material = matGlassy(c.color);
    g.add(mesh);
    if (selected?.kind === "item" && selected.id === it.id && fid === cur) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), MAT.sel); e.position.copy(mesh.position); g.add(e); }
    if ($("#chkSpace").checked) { const sr = spaceRect(it); if (sr) g.add(slabMesh(sr.x0, sr.y0, sr.x1, sr.y1, zOff + 0.008, 0.004, MAT.space)); }
    if (showLabels && selected?.kind === "item" && selected.id === it.id) { const l = label(it.label ?? c.name.replace(/\(.*$/, ""), 0.22); l.position.set(it.x, zOff + m.h + 0.15, it.y); g.add(l); }
  }
  if (fid === "1F" || fid === "2F") stairMeshes(g, fid, zOff);
  if (showLabels) for (const r of fl.rooms) if (r.kind !== "outside" && r.kind !== "stair" && r.kind !== "closet") { const l = label(r.name, 0.26); l.position.set((r.x0 + r.x1) / 2, zOff + 0.9, (r.y0 + r.y1) / 2); g.add(l); }
  return g;
}
let need3d = false;
function request3d() { need3d = true; }
function build3d() {
  disposeGroup(bldG); if (staticDirty) buildStatic();
  const labels = $("#chkLabels").checked;
  const list = viewMode === "floor" ? [cur] : FLOOR_IDS;
  for (const fid of list) { const z = floorZ(fid); bldG.add(buildFloor(fid, z, labels && (viewMode === "floor" || fid === cur))); }
  if (viewMode === "floor") for (const fid of FLOOR_IDS) { if (fid === cur) break; const lv = P.LEVELS[fid]; bldG.add(box(P.W + 0.15, lv.story - 0.03, P.L + 0.15, MAT.ghost, P.W / 2, lv.z + (lv.story - 0.03) / 2, P.L / 2)); }
  // 1F床=0・GLは −0.461。表示は常に建物座標(1F床=0)
  $("#info3d").textContent = `${P.FLOORS[cur].label}: 床 GL+${(P.floorHeightGL + P.LEVELS[cur].z).toFixed(2)}m・天井高 ${P.LEVELS[cur].ceil}m(仮定)。` +
    (viewMode === "floor" ? "この階だけ表示中(上の階は非表示)。" : viewMode === "explode" ? "全階を1.2m離して表示。" : "全階を実際の高さで重ねて表示。") +
    (wallH === "full" ? "壁は天井まで(ドア・窓は壁に埋まって見えない)。" : `壁の高さを${wallH}mで切って表示(ドールハウス)。`);
}
// 表示中の階の床高(ばらす表示では階ごとに1.2m上乗せ)。階を切り替えたらカメラと注視点を同じ分だけ持ち上げる
const floorZ = (fid) => P.LEVELS[fid].z + (viewMode === "explode" ? FLOOR_IDS.indexOf(fid) * 1.2 : 0);
function followFloor(prevZ) { const dz = floorZ(cur) - prevZ; if (!dz) return; camera.position.y += dz; controls.target.y += dz; controls.update(); }
let last3d = "";
function resize3d() { const w = c3.clientWidth || 600, h = c3.clientHeight || 560; const k = w + "x" + h; if (k === last3d) return; last3d = k; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
function setCam(mode) {
  const z0 = floorZ(cur);
  const cx = P.W / 2, cz = P.L / 2;
  if (mode === "bird") { camera.position.set(cx + 9, z0 + 9, cz + 9); controls.target.set(cx, z0 + 0.8, cz); }
  if (mode === "top") { camera.position.set(cx + 0.001, z0 + 16, cz); controls.target.set(cx, z0, cz); }
  if (mode === "north") { camera.position.set(cx + 1.5, z0 + 3.5, -10); controls.target.set(cx, z0 + 1.2, cz); }
  if (mode === "eye") {
    let x = cx, y = 4.5, tx = cx, ty = 0;
    if (selected?.kind === "item") { const it = F().items.find((o) => o.id === selected.id); if (it) { const m = itemDims(it); const [fx, fy] = frontVec(m.r || 0); x = it.x + fx * 1.3; y = it.y + fy * 1.3; tx = it.x; ty = it.y; } }
    else if (lastClickWorld) { x = lastClickWorld[0]; y = lastClickWorld[1]; tx = x; ty = y - 2; }
    camera.position.set(x, z0 + 1.5, y); controls.target.set(tx, z0 + 0.9, ty);
  }
  controls.update();
}
document.querySelectorAll("[data-cam]").forEach((b) => b.onclick = () => setCam(b.dataset.cam));
function loop() { requestAnimationFrame(loop); if (need3d) { need3d = false; build3d(); } controls.update(); renderer.render(scene, camera); }

// ---------- 起動 ----------
function init() {
  fit2d(); draw2d(); renderProps(); resize3d(); build3d(); setCam("bird"); loop();
  const el = document.getElementById("saveState"); el.textContent = saved ? "このブラウザに保存した配置を復元しました" : "図面の初期配置(変更すると自動保存)";
  window.addEventListener("resize", () => { fit2d(); draw2d(); resize3d(); });
}
init();
