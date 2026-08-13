// crawler/hazard-grid.mjs — 台帳エリア一帯のハザード・標高をラスタとして焼き込む。
//
// なぜ焼き込むのか: サイトのビルドはオフラインで完結させる方針(vendor同梱・npm install不要)。
// 地図ページの描画時に国土地理院のタイルサーバを叩くと、ビルドとページ表示が外部依存になり、
// 再現性も失われる。そこでこのスクリプトを**手動で**走らせて market/hazard-grid.json を更新し、
// site/ 側はそのJSONだけを読んでSVGを描く。
//
// 実行: node crawler/hazard-grid.mjs            (既定のbbox=台帳エリア一帯)
//       node crawler/hazard-grid.mjs --cell 25  (セルサイズをmで指定)
//
// 出典: 国土地理院ハザードマップポータルサイト(洪水浸水想定区域・土砂災害警戒区域等)/
//       国土地理院 標高タイル(dem5a_png・dem_png)/ 国土地理院 住所検索API
//       いずれも出典明示で利用可。浸水想定・警戒区域の指定主体は国・東京都。

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, listPropertyIds, loadProperty } from "../engine/io.js";
import { decodePng, pixelAt, tileXY, depthLabel, DEPTH_LEGEND, geocode } from "./geohazard.mjs";

const OUT = join(ROOT, "market", "hazard-grid.json");

// 台帳エリア(赤羽西・西が丘・赤羽台・十条仲原・中十条・志茂)を余白込みで覆う範囲
const BBOX = { lat0: 35.7596, lat1: 35.7871, lon0: 139.7066, lon1: 139.7418 };
const M_PER_DEG_LAT = 111132;
const cellArg = process.argv.indexOf("--cell");
const CELL_M = cellArg > 0 ? Number(process.argv[cellArg + 1]) : 25;

const DOSHA = {
  y: ["05_kyukeishakeikaikuiki", "05_dosekiryukeikaikuiki", "05_jisuberikeikaikuiki"],
  r: ["05_kyukeishatokubetsukeikaikuiki", "05_dosekiryutokubetsukeikaikuiki", "05_jisuberitokubetsukeikaikuiki"],
};

// ---- タイル取得(同時実行数を絞る。404は「その層のデータ無し」として正常扱い) ----
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
async function pool(items, n, fn) {
  const it = items[Symbol.iterator]();
  await Promise.all(Array.from({ length: n }, async () => {
    for (let x = it.next(); !x.done; x = it.next()) await fn(x.value);
  }));
}

const depthIndex = (rgba) => {
  const d = depthLabel(rgba);
  if (!d) return null;
  const i = DEPTH_LEGEND.findIndex((e) => e.label === d.label);
  return i < 0 ? null : i;
};

// 標高タイル: h = R*65536 + G*256 + B、2^23以上は負値。(128,0,0)は無効値
function demElev(rgba) {
  if (!rgba) return null;
  const [r, g, b] = rgba;
  if (r === 128 && g === 0 && b === 0) return null;
  const v = r * 65536 + g * 256 + b;
  return (v < 2 ** 23 ? v : v - 2 ** 24) * 0.01;
}

const main = async () => {
  const nx = Math.round(((BBOX.lon1 - BBOX.lon0) * M_PER_DEG_LAT * Math.cos((BBOX.lat0 * Math.PI) / 180)) / CELL_M);
  const ny = Math.round(((BBOX.lat1 - BBOX.lat0) * M_PER_DEG_LAT) / CELL_M);
  const latOf = (j) => BBOX.lat1 - ((j + 0.5) / ny) * (BBOX.lat1 - BBOX.lat0);   // 行0が北
  const lonOf = (i) => BBOX.lon0 + ((i + 0.5) / nx) * (BBOX.lon1 - BBOX.lon0);
  console.error(`グリッド ${nx}×${ny} (セル${CELL_M}m / 約${Math.round(nx * CELL_M / 100) / 10}km×${Math.round(ny * CELL_M / 100) / 10}km)`);

  // 先に必要なタイルを列挙して並列取得(セルごとに逐次fetchすると遅い)
  const zH = 17, zD = 15;
  const need = new Set();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const t = tileXY(latOf(j), lonOf(i), zH);
      need.add(`${t.x},${t.y}`);
    }
  }
  const hazardLayers = ["01_flood_l2_shinsuishin_data", ...DOSHA.y, ...DOSHA.r];
  const jobs = [];
  for (const L of hazardLayers) for (const k of need) { const [x, y] = k.split(","); jobs.push([L, +x, +y]); }
  console.error(`ハザードタイル ${jobs.length}件を取得中...`);
  await pool(jobs, 8, async ([L, x, y]) => { await tile(L, zH, x, y); });

  const demNeed = new Set();
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const t = tileXY(latOf(j), lonOf(i), zD);
    demNeed.add(`${t.x},${t.y}`);
  }
  console.error(`標高タイル ${demNeed.size * 2}件を取得中...`);
  await pool([...demNeed], 6, async (k) => {
    const [x, y] = k.split(",").map(Number);
    await tile("dem5a_png", zD, x, y, "cyberjapandata.gsi.go.jp", "xyz");
    const t14 = { x: x >> 1, y: y >> 1 };
    await tile("dem_png", 14, t14.x, t14.y, "cyberjapandata.gsi.go.jp", "xyz");   // 5mメッシュ欠測時の代替
  });

  const flood = [], dosha = [], elev = [];
  for (let j = 0; j < ny; j++) {
    let fRow = "", dRow = "";
    const eRow = [];
    for (let i = 0; i < nx; i++) {
      const lat = latOf(j), lon = lonOf(i);
      const t = tileXY(lat, lon, zH);
      const img = await tile("01_flood_l2_shinsuishin_data", zH, t.x, t.y);
      const c = img ? pixelAt(img, t.px, t.py) : null;
      const di = c && c[3] > 0 ? depthIndex(c) : null;
      fRow += di == null ? "." : String(di);

      let d = ".";
      for (const L of DOSHA.y) {
        const im = await tile(L, zH, t.x, t.y);
        if (im && pixelAt(im, t.px, t.py)[3] > 0) { d = "y"; break; }
      }
      for (const L of DOSHA.r) {
        const im = await tile(L, zH, t.x, t.y);
        if (im && pixelAt(im, t.px, t.py)[3] > 0) { d = "r"; break; }
      }
      dRow += d;

      const td = tileXY(lat, lon, zD);
      let e = demElev(await tile("dem5a_png", zD, td.x, td.y, "cyberjapandata.gsi.go.jp", "xyz")
        .then((im) => (im ? pixelAt(im, td.px, td.py) : null)));
      if (e == null) {
        const t14 = tileXY(lat, lon, 14);
        e = demElev(await tile("dem_png", 14, t14.x, t14.y, "cyberjapandata.gsi.go.jp", "xyz")
          .then((im) => (im ? pixelAt(im, t14.px, t14.py) : null)));
      }
      eRow.push(e == null ? -999 : Math.round(e));
    }
    flood.push(fRow); dosha.push(dRow); elev.push(eRow);
    if (j % 20 === 0) console.error(`  ${j}/${ny}行`);
  }

  // 地区の代表点。台帳・除外台帳に出てくる丁目を住所検索APIで引き、辞書として持ち回る
  // (サイト側は地区名→座標をこの辞書から引くだけ。ビルドはオフラインのまま)
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).geocode ?? {} : {};
  const districts = new Set();
  for (const id of listPropertyIds()) districts.add(loadProperty(id).location?.address);
  const excluded = JSON.parse(readFileSync(join(ROOT, "market", "crawl", "excluded.json"), "utf8"));
  for (const [k, v] of Object.entries(excluded)) if (!k.startsWith("_") && v.address) districts.add(v.address.replace(/^東京都/, ""));
  const geo = { ...prev };
  for (const d of districts) {
    if (!d || geo[d]) continue;
    const g = await geocode("東京都" + d + "丁目");
    if (!g) { console.error(`  住所検索でヒットなし: ${d}`); continue; }
    // 標高はグリッドから引く(同じソースで一貫させる)
    const j = Math.round(((BBOX.lat1 - g.lat) / (BBOX.lat1 - BBOX.lat0)) * ny - 0.5);
    const i = Math.round(((g.lon - BBOX.lon0) / (BBOX.lon1 - BBOX.lon0)) * nx - 0.5);
    const inside = j >= 0 && j < ny && i >= 0 && i < nx;
    geo[d] = { lat: +g.lat.toFixed(5), lon: +g.lon.toFixed(5), elev_m: inside ? elev[j][i] : null };
  }

  const out = {
    _readme: "台帳エリアのハザード・標高ラスタ。site/templates/map.js が読む。再生成: node crawler/hazard-grid.mjs" +
      " / flood は洪水浸水想定(想定最大規模)の凡例インデックス('.'=区域外) / dosha は土砂災害警戒区域(y=警戒 r=特別警戒)" +
      " / elev は標高m(-999=欠測)。行0が北端、列0が西端",
    generated_at: new Date().toISOString().slice(0, 10),
    source: "国土地理院ハザードマップポータルサイト(洪水浸水想定区域・土砂災害警戒区域等)/ 国土地理院 標高タイル / 国土地理院 住所検索API",
    bbox: BBOX, cell_m: CELL_M, nx, ny,
    depth_legend: DEPTH_LEGEND.map((e) => ({ label: e.label, rgb: e.rgb })),
    geocode: geo,
    flood, dosha, elev,
  };
  writeFileSync(OUT, JSON.stringify(out), "utf8");
  console.error(`\n書き出し: ${OUT} (タイル取得 ${fetched}件 / うちデータ無し ${misses}件)`);
};

await main();
