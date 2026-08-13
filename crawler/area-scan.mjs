// crawler/area-scan.mjs — 探索エリア候補(町丁目)の機械スクリーニング。
//
// 目的: 「どの丁目まで探索範囲を広げるか」を、思い込みではなく公式データで洗い出す。
// 物件単位の crawler/geohazard.mjs は**丁目代表点1点**しか見ないため、崖線沿いの帯状ハザードを
// 取りこぼす(既知の限界。CLAUDE.md 穴3)。エリア選定では丁目そのものが評価対象なので、
// ここでは代表点±200mの25点グリッドで面的に見る(丁目の実サイズは概ね200〜400m角)。
//
// 出すもの(丁目ごと):
//   - 標高: 中央/近傍25点の最小・最大(高低差が大きい=崖線に掛かっている)
//   - 洪水浸水想定(想定最大規模): 代表点の浸水深 / 近傍の最悪値 / 被覆率
//   - 土砂災害警戒区域等: 近傍25点のレッド/イエロー点数(3レイヤ合成)
//   - 各駅への徒歩分(不動産公正競争規約の 1分=道路80m。直線距離×迂回率で近似)
//   - 三角形(赤羽駅・王子駅・板橋駅)の内外
//   - 既存の査定データ資産(house-deals/benchmarks/area-config/クロール対象)の有無
//
// 実行: node crawler/area-scan.mjs            (既定=北区全町丁目+板橋区・豊島区の縁)
//       node crawler/area-scan.mjs --json     (JSONのみ標準出力)
//       node crawler/area-scan.mjs "東京都北区王子本町1丁目" ...  (任意の住所だけを見る)
// 出力: market/area-scan.json(--json時は書き出しも行う)
//
// 出典: 国土地理院ハザードマップポータル(洪水浸水想定区域・土砂災害警戒区域等)/
//       国土地理院 標高タイル(dem5a_png・dem_png)/ 国土地理院 住所検索API /
//       駅座標は OpenStreetMap(下記 STATIONS のコメント参照)

import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../engine/io.js";
import { decodePng, pixelAt, tileXY, depthLabel, DEPTH_LEGEND, geocode, doshaClass } from "./geohazard.mjs";

const OUT = join(ROOT, "market", "area-scan.json");
const DOSHA_LAYERS = ["05_kyukeishakeikaikuiki", "05_dosekiryukeikaikuiki", "05_jisuberikeikaikuiki"];
const FLOOD_LAYER = "01_flood_l2_shinsuishin_data";

// ---- 駅座標 ----
// 出典: OpenStreetMap (Overpass API, node/way["railway"="station"] within bbox 35.735,139.695,35.795,139.760)。
// keihin=true が今回の主目的(京浜東北線に徒歩10分以内)。他線は参考列として出す。
export const STATIONS = [
  { name: "赤羽", line: "京浜東北/埼京/湘南新宿", lat: 35.77814, lon: 139.72080, keihin: true },
  { name: "東十条", line: "京浜東北", lat: 35.76385, lon: 139.72687, keihin: true },
  { name: "王子", line: "京浜東北/南北", lat: 35.75235, lon: 139.73827, keihin: true },
  { name: "十条", line: "埼京", lat: 35.76001, lon: 139.72231 },
  { name: "板橋", line: "埼京", lat: 35.74527, lon: 139.71944 },
  { name: "上中里", line: "京浜東北", lat: 35.74658, lon: 139.74698, keihin: true },
  { name: "北赤羽", line: "埼京", lat: 35.78678, lon: 139.70603 },
  { name: "赤羽岩淵", line: "南北", lat: 35.78345, lon: 139.72210 },
  { name: "志茂", line: "南北", lat: 35.77790, lon: 139.73253 },
  { name: "王子神谷", line: "南北", lat: 35.76506, lon: 139.73572 },
  { name: "西ケ原", line: "南北", lat: 35.74605, lon: 139.74217 },
  { name: "本蓮沼", line: "三田", lat: 35.76852, lon: 139.70244 },
  { name: "板橋本町", line: "三田", lat: 35.76143, lon: 139.70552 },
  { name: "新板橋", line: "三田", lat: 35.74880, lon: 139.71990 },
  { name: "板橋区役所前", line: "三田", lat: 35.75135, lon: 139.71004 },
  { name: "西巣鴨", line: "三田", lat: 35.74355, lon: 139.72870 },
  { name: "下板橋", line: "東上", lat: 35.74525, lon: 139.71548 },
  { name: "大山", line: "東上", lat: 35.74862, lon: 139.70243 },
];

// ユーザー指定のターゲット三角形(赤羽駅・王子駅・板橋駅)
export const TRIANGLE = [
  { name: "赤羽", lat: 35.77814, lon: 139.72080 },
  { name: "王子", lat: 35.75235, lon: 139.73827 },
  { name: "板橋", lat: 35.74527, lon: 139.71944 },
];

// ---- 候補の町丁目 ----
// 北区は「浮間(荒川対岸)」以外の全町丁目。加えて三角形の西辺・南辺に接する板橋区・豊島区の町。
// 明らかに三角形外の低地(志茂・神谷・堀船・豊島など)もあえて入れる: 手法が既知の結論
// (志茂=低地で除外済み)を再現できるかの対照になるため。
export const NORTH_WARD = {
  赤羽: 3, 赤羽台: 4, 赤羽西: 6, 赤羽南: 2, 赤羽北: 3, 桐ケ丘: 2, 岩淵町: 0, 志茂: 5,
  神谷: 3, 西が丘: 3, 上十条: 5, 中十条: 4, 十条仲原: 4, 十条台: 2, 東十条: 6,
  王子: 6, 王子本町: 3, 岸町: 2, 豊島: 8, 堀船: 4, 昭和町: 3, 栄町: 0,
  滝野川: 7, 西ケ原: 4, 中里: 3, 上中里: 3, 田端: 6,
};
export const FRINGE = {
  "板橋区": { 板橋: 4, 稲荷台: 0, 大和町: 0, 清水町: 0, 氷川町: 0, 仲宿: 0, 本町: 0, 双葉町: 0, 蓮沼町: 0, 泉町: 0, 小豆沢: 4 },
  "豊島区": { 西巣鴨: 4, 上池袋: 4 },
};

export function candidates() {
  const out = [];
  for (const [town, n] of Object.entries(NORTH_WARD)) {
    if (n === 0) out.push({ ward: "北区", town, chome: null, address: `東京都北区${town}` });
    else for (let i = 1; i <= n; i++) out.push({ ward: "北区", town, chome: i, address: `東京都北区${town}${i}丁目` });
  }
  for (const [ward, towns] of Object.entries(FRINGE)) {
    for (const [town, n] of Object.entries(towns)) {
      if (n === 0) out.push({ ward, town, chome: null, address: `東京都${ward}${town}` });
      else for (let i = 1; i <= n; i++) out.push({ ward, town, chome: i, address: `東京都${ward}${town}${i}丁目` });
    }
  }
  return out;
}

// ---- 幾何 ----
const R = 6371000, rad = (d) => (d * Math.PI) / 180;
export function distM(a, b) {
  return Math.hypot(rad(b.lon - a.lon) * Math.cos(rad((a.lat + b.lat) / 2)), rad(b.lat - a.lat)) * R;
}
// 不動産公正競争規約: 徒歩1分=道路距離80m(端数切上げ)。道路距離は直線距離×迂回率で近似する。
// 迂回率は市街地で概ね1.15〜1.40(geohazard.siteFromWalk と同じ前提)。既定1.25は台帳の掲載徒歩分
// (赤羽台3=11分/赤羽西4=13分など)を±1分で再現する値。
export const DETOUR = 1.25;
export function walkMin(fromPoint, station, detour = DETOUR) {
  return Math.ceil((distM(fromPoint, station) * detour) / 80);
}
export function inTriangle(p, tri = TRIANGLE) {
  const cross = (o, a, b) => (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
  const s = [cross(tri[0], tri[1], p), cross(tri[1], tri[2], p), cross(tri[2], tri[0], p)];
  return s.every((v) => v >= 0) || s.every((v) => v <= 0);
}

// ---- タイル ----
const cache = new Map();
let fetched = 0, misses = 0;
async function tile(layer, z, x, y, host = "disaportaldata.gsi.go.jp", dir = "raster") {
  const key = `${layer}/${z}/${x}/${y}`;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const r = await fetch(`https://${host}/${dir}/${layer}/${z}/${x}/${y}.png`);
    fetched++;
    if (!r.ok) { misses++; return null; }
    try { return decodePng(Buffer.from(await r.arrayBuffer())); } catch { misses++; return null; }
  })();
  cache.set(key, p);
  return p;
}
async function pixel(layer, lat, lon, z = 17, host, dir) {
  const t = tileXY(lat, lon, z);
  const img = await tile(layer, z, t.x, t.y, host, dir);
  if (!img) return null;
  const c = pixelAt(img, t.px, t.py);
  return c[3] > 0 ? c : null;
}
// 標高タイル: h = R*65536 + G*256 + B、2^23以上は負値。(128,0,0)は無効値
function demElev(rgba) {
  if (!rgba) return null;
  const [r, g, b] = rgba;
  if (r === 128 && g === 0 && b === 0) return null;
  const v = r * 65536 + g * 256 + b;
  return (v < 2 ** 23 ? v : v - 2 ** 24) * 0.01;
}
async function elevAt(lat, lon) {
  let e = demElev(await pixel("dem5a_png", lat, lon, 15, "cyberjapandata.gsi.go.jp", "xyz"));
  if (e == null) e = demElev(await pixel("dem_png", lat, lon, 14, "cyberjapandata.gsi.go.jp", "xyz"));
  return e;
}

// ---- 1丁目ぶんの面的サンプリング(代表点±200mの5×5=25点) ----
export const GRID_D_LAT = 0.0009;    // 約100m
export const GRID_D_LON = 0.0011;
export async function scanPoint(g) {
  const pts = [];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    pts.push({ lat: g.lat + i * GRID_D_LAT, lon: g.lon + j * GRID_D_LON, center: i === 0 && j === 0 });
  }
  let floodHit = 0, worstIdx = -1, centerDepth = null, deep = 0;
  const hist = {};
  let red = 0, yellow = 0, centerDosha = null;
  const elevs = [];
  for (const p of pts) {
    const c = await pixel(FLOOD_LAYER, p.lat, p.lon);
    const d = c ? depthLabel(c) : null;
    if (d) {
      floodHit++;
      hist[d.label] = (hist[d.label] ?? 0) + 1;
      if (d.max != null && d.max > 3.0) deep++;
      const idx = DEPTH_LEGEND.findIndex((e) => e.label === d.label);
      if (idx > worstIdx) worstIdx = idx;
      if (p.center) centerDepth = d.label;
    }
    let cls = null;
    for (const L of DOSHA_LAYERS) {
      const cd = doshaClass(await pixel(L, p.lat, p.lon));
      if (cd === "red") { cls = "red"; break; }
      if (cd === "yellow") cls = "yellow";
    }
    if (cls === "red") red++; else if (cls === "yellow") yellow++;
    if (p.center) centerDosha = cls;
    const e = await elevAt(p.lat, p.lon);
    if (e != null) elevs.push(e);
  }
  const centerElev = await elevAt(g.lat, g.lon);
  return {
    elev_center_m: centerElev == null ? null : Math.round(centerElev * 10) / 10,
    elev_min_m: elevs.length ? Math.round(Math.min(...elevs) * 10) / 10 : null,
    elev_max_m: elevs.length ? Math.round(Math.max(...elevs) * 10) / 10 : null,
    flood_center: centerDepth,
    flood_worst: worstIdx >= 0 ? DEPTH_LEGEND[worstIdx].label : null,
    flood_worst_max_m: worstIdx >= 0 ? DEPTH_LEGEND[worstIdx].max : null,
    flood_coverage: floodHit / pts.length,
    flood_hist: hist,
    flood_deep_pts: deep,          // 浸水深3.0m超の点数(荒川氾濫域の指標。台地上の浅い滞水と分ける)
    dosha_center: centerDosha,
    dosha_red_pts: red,
    dosha_yellow_pts: yellow,
    sampled: pts.length,
  };
}

// ---- エリア判定 ----
// 台帳の掲載条件は「台地側(荒川低地の浸水想定域外)」+「土砂災害区域外」。エリア単位では
// 丁目まるごとの可否ではなく「その丁目を探索対象に入れてよいか/入れるなら何に注意するか」を出す。
//
// 重要な前提(CLAUDE.md・screenOfficial と同じ):**台地上でも0.5m未満の着色は普通に出る**
// (赤羽西4=標高21mでも出る。中小河川・内水由来の浅い滞水)。これを除外理由にすると台帳が壊れる。
// 荒川低地かどうかを分けるのは「3.0m超が面的に出るか」と「代表点の標高」。
//
//   exclude : 丁目のほぼ全域が荒川低地の深い浸水想定。物件単位で救えない
//   edge    : 代表点は台地上だが、丁目が低地/レッドゾーンの縁に掛かる。番地次第=個別照合が要る
//   caution : 浅い浸水(0.5〜3.0m)またはイエローゾーンが丁目内にある
//   clear   : ハザードなし(0.5m未満の着色のみは clear 扱い)
export const DEEP_M = 3.0;              // これを超える浸水深を「荒川低地の指標」とする
export const EXCLUDE_DEEP_FRAC = 0.5;   // 近傍25点のうち深い浸水がこの比率を超えたら丁目まるごと除外
export function classify(s) {
  const n = s.sampled || 25;
  const deepPts = s.flood_deep_pts ?? 0;
  const centerDeep = s.flood_center != null && (DEPTH_LEGEND.find((e) => e.label === s.flood_center)?.max ?? 0) > DEEP_M;
  const centerShallowMid = s.flood_center != null && !centerDeep && s.flood_center !== "0.5m未満";
  const low = s.elev_center_m != null && s.elev_center_m < 5;
  const midPts = Object.entries(s.flood_hist ?? {}).filter(([k]) => k !== "0.5m未満" && (DEPTH_LEGEND.find((e) => e.label === k)?.max ?? 0) <= DEEP_M)
    .reduce((a, [, v]) => a + v, 0);
  const notes = [];
  let verdict = "clear";

  if (centerDeep || deepPts / n > EXCLUDE_DEEP_FRAC) {
    verdict = "exclude";
    notes.push(`浸水想定(想定最大規模)${s.flood_worst}。標高${s.elev_center_m}mで近傍25点中${deepPts}点が3m超`);
  } else if (low && s.flood_center) {
    verdict = "exclude";
    notes.push(`標高${s.elev_center_m}mの低地で代表点が浸水想定${s.flood_center}に該当`);
  } else if (deepPts > 0) {
    verdict = "edge";
    notes.push(`丁目の縁が低地に掛かる(近傍25点中${deepPts}点が3m超の浸水想定・標高${s.elev_min_m}〜${s.elev_max_m}m)`);
  } else if (centerShallowMid || midPts > 0) {
    verdict = "caution";
    notes.push(`浸水想定0.5〜3.0mが近傍25点中${midPts}点${centerShallowMid ? "(代表点を含む)" : ""}`);
  }

  if (s.dosha_red_pts > 0) {
    if (verdict !== "exclude") verdict = "edge";
    notes.push(`土砂災害特別警戒区域(レッド)が近傍${s.dosha_red_pts}点`);
  } else if (s.dosha_yellow_pts > 0) {
    if (verdict === "clear") verdict = "caution";
    notes.push(`土砂災害警戒区域(イエロー)が近傍${s.dosha_yellow_pts}点`);
  }
  if (s.elev_max_m != null && s.elev_min_m != null && s.elev_max_m - s.elev_min_m >= 10) {
    notes.push(`近傍の高低差${Math.round(s.elev_max_m - s.elev_min_m)}m(崖線に掛かる)`);
  }
  if (verdict === "clear" && s.flood_coverage > 0) {
    notes.push(`0.5m未満の着色は近傍${Math.round(s.flood_coverage * n)}点にあるが、台地上では通常出るため除外理由にしない`);
  }
  return { verdict, notes };
}

// ---- 既存の査定データ資産 ----
function assets() {
  const dealDistricts = new Map();
  const csv = readFileSync(join(ROOT, "market", "house-deals.csv"), "utf8").split("\n");
  for (const line of csv) {
    if (!line || line.startsWith("#")) continue;
    const d = line.split(",")[1];
    if (d && d !== "district") dealDistricts.set(d, (dealDistricts.get(d) ?? 0) + 1);
  }
  const bench = new Set();
  for (const m of readFileSync(join(ROOT, "market", "benchmarks.yaml"), "utf8").matchAll(/district:\s*([^\s,]+)/g)) bench.add(m[1]);
  const crawl = ["上十条", "中十条", "十条仲原", "岩淵町", "志茂", "神谷", "西が丘", "赤羽", "赤羽北", "赤羽南", "赤羽台", "赤羽西"];
  return { dealDistricts, bench, crawl };
}

// ---- 本体 ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 保存済みの計測値から判定だけを引き直す(判定式を変えるたびにタイルを取り直さないため)
function reclassify() {
  const j = JSON.parse(readFileSync(OUT, "utf8"));
  for (const r of j.rows) if (!r.error) Object.assign(r, classify(r));
  j.reclassified_at = new Date().toISOString().slice(0, 10);
  writeFileSync(OUT, JSON.stringify(j, null, 1), "utf8");
  return j.rows;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");
  const explicit = args.filter((a) => !a.startsWith("--"));
  const list = explicit.length
    ? explicit.map((address) => ({ ward: null, town: address, chome: null, address }))
    : candidates();
  const A = assets();
  const log = (...m) => console.error(...m);
  const rows = args.includes("--reclassify") ? reclassify() : [];
  if (args.includes("--reclassify")) { render(rows); return; }

  log(`候補 ${list.length}件をスクリーニング中(1件あたり25点サンプル)...`);
  for (const [i, c] of list.entries()) {
    const g = await geocode(c.address);
    await sleep(80);
    if (!g) { rows.push({ ...c, error: "住所検索でヒットなし" }); log(`  ${c.address}: ヒットなし`); continue; }
    const s = await scanPoint(g);
    const p = { lat: g.lat, lon: g.lon };
    const walks = STATIONS.map((st) => ({ name: st.name, line: st.line, keihin: !!st.keihin, min: walkMin(p, st), m: Math.round(distM(p, st)) }))
      .sort((a, b) => a.min - b.min);
    const keihin = walks.filter((w) => w.keihin)[0];
    rows.push({
      ...c, lat: +g.lat.toFixed(5), lon: +g.lon.toFixed(5), matched: g.matched,
      ...s, ...classify(s),
      in_triangle: inTriangle(p),
      keihin_station: keihin.name, keihin_walk_min: keihin.min, keihin_m: keihin.m,
      nearest: walks[0], walks: walks.slice(0, 5),
      deals_n: A.dealDistricts.get(c.town) ?? 0,
      has_benchmark: A.bench.has(c.town),
      in_crawl_scope: A.crawl.includes(c.town),
    });
    if ((i + 1) % 10 === 0) log(`  ${i + 1}/${list.length}件`);
  }

  const out = {
    _readme: "探索エリア候補の機械スクリーニング。再生成: node crawler/area-scan.mjs" +
      " / verdict は clear=近傍25点ハザードなし partial=丁目内に混在(番地次第) caution=イエローあり exclude=面的な深い浸水" +
      " / keihin_walk_min は代表点からの直線距離×迂回率1.25÷80mの近似(掲載の徒歩分とは±2分ずれうる)",
    generated_at: new Date().toISOString().slice(0, 10),
    source: "国土地理院ハザードマップポータル / 国土地理院 標高タイル / 国土地理院 住所検索API / 駅座標: OpenStreetMap",
    triangle: TRIANGLE, detour: DETOUR, grid: "代表点±200mの5×5=25点",
    stations: STATIONS, rows,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");
  log(`\n書き出し: ${OUT}(タイル取得 ${fetched}件 / うちデータ無し ${misses}件)`);
  if (jsonOnly) return;
  render(rows);
}

function render(rows) {
  const mark = { clear: "○", caution: "△", edge: "▲", exclude: "×" };
  const fmt = (r) => [
    (!r.ward || r.ward === "北区" ? "" : `[${r.ward}]`) + r.town + (r.chome ?? ""),
    r.in_triangle ? "内" : "外",
    r.keihin_station + r.keihin_walk_min + "分",
    (r.nearest.keihin ? "" : `${r.nearest.name}${r.nearest.min}分`),
    r.elev_center_m + "m",
    `${r.elev_min_m}〜${r.elev_max_m}`,
    mark[r.verdict],
    r.notes.join(" / "),
  ];
  const ok = rows.filter((r) => !r.error).sort((a, b) => a.keihin_walk_min - b.keihin_walk_min || a.town.localeCompare(b.town));
  const head = ["町丁目", "三角", "京浜東北", "他線最寄", "標高", "近傍標高", "判", "所見"];
  const table = [head, ...ok.map(fmt)];
  const w = head.map((_, i) => Math.max(...table.map((r) => [...String(r[i] ?? "")].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0))));
  const pad = (s, n) => String(s ?? "") + " ".repeat(Math.max(0, n - [...String(s ?? "")].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
  for (const r of table) console.log(r.map((c, i) => pad(c, w[i])).join(" │ "));
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) await main();
