// crawler/geohazard.mjs — 公式ハザードマップ(国土地理院タイル)との機械照合。
//
// 背景(2026-08-13): それまでの hazard_check は SUUMO/athome の「その他制限事項・備考(法令等制限)」
// しか見ていなかった。この欄には土砂災害警戒区域は載るが、**洪水浸水想定区域は原則載らない**
// (水害ハザードマップは2020年8月から重要事項説明の義務項目だが、広告掲載欄の項目ではない)。
// その結果、荒川低地にある志茂1丁目・志茂3丁目の物件が「suumo: none / athome: none」のまま
// 台帳に残っていた(実測: 想定最大規模で3〜5m / 5〜10m・標高2.5m / 1.8m)。掲載欄の確認だけでは
// 浸水を検知できない、という構造的な穴を塞ぐためのモジュール。
//
// 限界(重要): 住所は媒体が丁目までしか出さないため、照合は**丁目の代表点**で行う。
//   - 面的なハザード(荒川の氾濫=丁目全域が水没)には強い。志茂は代表点も周辺25点もほぼ全滅で確定。
//   - 帯状のハザード(崖線沿いの土砂災害警戒区域)は**取りこぼす**。実際、レッドゾーンで除外した
//     西が丘2の現場は、丁目代表点±400mの81点サンプルでレッド0点・イエロー2点しか出ない。
//     athomeの備考欄だけが特別警戒区域を明記していた。
//   → 公式マップ照合は掲載欄チェックの**代替ではなく追加**。両方を必ず通すこと。
//
// 出典: 国土地理院 ハザードマップポータル(disaportaldata.gsi.go.jp)/ 住所検索API・標高API(gsi.go.jp)

import zlib from "node:zlib";

export const Z = 17;   // タイルズームレベル(この層は2〜17で提供)

// ---- タイル座標(Web メルカトル) ----
export function tileXY(lat, lon, z = Z) {
  const n = 2 ** z;
  const fx = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x: Math.floor(fx), y: Math.floor(fy), px: Math.floor((fx % 1) * 256), py: Math.floor((fy % 1) * 256) };
}

// ---- 最小PNGデコーダ(8bit・colorType 2/3/6)。依存ゼロ方針のため自前 ----
export function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0, bd = 0, plte = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; }
    else if (type === "PLTE") plte = d;
    else if (type === "tRNS") trns = d;
    else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error("bitDepth " + bd + " は未対応");
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      if (f === 1) line[i] = (line[i] + a) & 255;
      else if (f === 2) line[i] = (line[i] + b) & 255;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(out, y * stride);
    prev = line;
  }
  return { w, h, ct, bpp, data: out, plte, trns };
}

export function pixelAt(img, px, py) {
  const i = (py * img.w + px) * img.bpp;
  if (img.ct === 6) return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
  if (img.ct === 2) return [img.data[i], img.data[i + 1], img.data[i + 2], 255];
  const k = img.data[i];
  return [img.plte[k * 3], img.plte[k * 3 + 1], img.plte[k * 3 + 2], img.trns ? (img.trns[k] ?? 255) : 255];
}

// ---- 浸水深の標準凡例(ハザードマップポータル) ----
export const DEPTH_LEGEND = [
  { rgb: [247, 245, 169], label: "0.5m未満", max: 0.5 },
  { rgb: [255, 216, 192], label: "0.5〜3.0m", max: 3.0 },
  { rgb: [255, 183, 183], label: "3.0〜5.0m", max: 5.0 },
  { rgb: [255, 145, 145], label: "5.0〜10.0m", max: 10.0 },
  { rgb: [242, 133, 201], label: "10.0〜20.0m", max: 20.0 },
  { rgb: [220, 122, 220], label: "20.0m以上", max: 99 },
];

// 凡例色との最近傍で区分を決める。距離が離れていれば「不明」として生RGBを残す(勝手に丸めない)
export function depthLabel(rgba) {
  if (!rgba || rgba[3] === 0) return null;
  let best = null, bd = Infinity;
  for (const e of DEPTH_LEGEND) {
    const d = (e.rgb[0] - rgba[0]) ** 2 + (e.rgb[1] - rgba[1]) ** 2 + (e.rgb[2] - rgba[2]) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return bd <= 900 ? best : { rgb: rgba.slice(0, 3), label: `不明(RGB ${rgba.slice(0, 3).join(",")})`, max: null };
}

export const LAYERS = {
  flood_l2: { id: "01_flood_l2_shinsuishin_data", name: "洪水浸水想定区域(想定最大規模)", kind: "depth" },
  flood_keizoku: { id: "01_flood_l2_keizoku_data", name: "浸水継続時間(想定最大規模)", kind: "flag" },
  kaoku_hanran: { id: "01_flood_l2_kaokutoukai_hanran_data", name: "家屋倒壊等氾濫想定区域(氾濫流)", kind: "flag" },
  kaoku_kagan: { id: "01_flood_l2_kaokutoukai_kagan_data", name: "家屋倒壊等氾濫想定区域(河岸侵食)", kind: "flag" },
  hightide: { id: "03_hightide_l2_shinsuishin_data", name: "高潮浸水想定区域(想定最大規模)", kind: "depth" },
  tsunami: { id: "04_tsunami_newlegend_data", name: "津波浸水想定", kind: "depth" },
  dosekiryu: { id: "05_dosekiryukeikaikuiki", name: "土砂災害警戒区域(土石流)", kind: "flag" },
  dosekiryu_red: { id: "05_dosekiryutokubetsukeikaikuiki", name: "土砂災害特別警戒区域(土石流)", kind: "flag" },
  kyukeisha: { id: "05_kyukeishakeikaikuiki", name: "土砂災害警戒区域(急傾斜地)", kind: "flag" },
  kyukeisha_red: { id: "05_kyukeishatokubetsukeikaikuiki", name: "土砂災害特別警戒区域(急傾斜地)", kind: "flag" },
  jisuberi: { id: "05_jisuberikeikaikuiki", name: "土砂災害警戒区域(地すべり)", kind: "flag" },
  jisuberi_red: { id: "05_jisuberitokubetsukeikaikuiki", name: "土砂災害特別警戒区域(地すべり)", kind: "flag" },
};

// ---- ネットワーク層(fetchは注入可能にしてテストから切り離す) ----
export function createReader({ fetchImpl = fetch, zoom = Z } = {}) {
  const cache = new Map();
  return async function read(layerId, lat, lon) {
    const t = tileXY(lat, lon, zoom);
    const key = `${layerId}/${t.x}/${t.y}`;
    if (!cache.has(key)) {
      const r = await fetchImpl(`https://disaportaldata.gsi.go.jp/raster/${layerId}/${zoom}/${t.x}/${t.y}.png`);
      cache.set(key, r.ok ? decodePng(Buffer.from(await r.arrayBuffer())) : null);
    }
    const img = cache.get(key);
    if (!img) return null;                       // タイル無し = その層のデータが無い(=区域外)
    const c = pixelAt(img, t.px, t.py);
    return c[3] > 0 ? c : null;                  // 透明 = 区域外
  };
}

export async function geocode(address, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl("https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(address));
  const j = await r.json();
  if (!j.length) return null;
  const [lon, lat] = j[0].geometry.coordinates;
  return { lat, lon, matched: j[0].properties?.title ?? null };
}

export async function elevation(lat, lon, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lon}&lat=${lat}&outtype=JSON`);
  const j = await r.json();
  return typeof j.elevation === "number" ? j.elevation : null;
}

// 丁目代表点 + 周辺±200mの25点を見る。面的ハザードは周辺サンプルの被覆率で確度が上がる
export async function officialHazard(address, opts = {}) {
  const g = await geocode(address, opts);
  if (!g) return { address, error: "住所検索でヒットなし" };
  const read = createReader(opts);
  const el = await elevation(g.lat, g.lon, opts);
  const layers = {};
  for (const [key, L] of Object.entries(LAYERS)) {
    const c = await read(L.id, g.lat, g.lon);
    if (!c) continue;
    layers[key] = L.kind === "depth" ? (depthLabel(c)?.label ?? null) : "該当";
  }
  let hit = 0, total = 0;
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const c = await read(LAYERS.flood_l2.id, g.lat + i * 0.0009, g.lon + j * 0.0011);
      total++;
      if (c) hit++;
    }
  }
  return { address, lat: g.lat, lon: g.lon, elevation_m: el, layers, floodCoverage: hit / total, sampled: total };
}

// ---- スクリーニング ----
// 台帳の掲載条件は「台地側(荒川低地の浸水想定域外)」。荒川の氾濫域を落とすのが目的なので、
// 台地上でも局所的に出る0.5m未満の着色まで一律KOにはしない(赤羽西4=標高21mでも0.5m未満が出る)。
export function screenOfficial(h) {
  if (!h || h.error) return { verdict: "unknown", codes: ["GEO_NG"], reasons: [h?.error ?? "照合できず"] };
  const codes = [], reasons = [];
  const depth = h.layers?.flood_l2 ?? null;
  const deep = depth && /^(3\.0〜5\.0|5\.0〜10\.0|10\.0〜20\.0|20\.0m以上)/.test(depth);
  const lowland = h.elevation_m != null && h.elevation_m < 5;

  if (deep) {
    codes.push("KO4_FLOOD_DEEP");
    reasons.push(`洪水浸水想定(想定最大規模)で浸水深 ${depth}。標高${h.elevation_m}m・周辺25点の被覆率${Math.round(h.floodCoverage * 100)}%`);
  } else if (lowland && depth) {
    codes.push("KO4_LOWLAND");
    reasons.push(`標高${h.elevation_m}mの低地で浸水想定${depth}に該当。掲載条件「台地側(荒川低地の浸水想定域外)」から外れる`);
  }
  for (const k of ["dosekiryu_red", "kyukeisha_red", "jisuberi_red"]) {
    if (h.layers?.[k]) { codes.push("KO4_DOSHA_RED"); reasons.push(`${LAYERS[k].name}に該当(レッドゾーン)`); }
  }
  if (codes.length) return { verdict: "block", codes, reasons };

  const cautions = [];
  for (const k of ["dosekiryu", "kyukeisha", "jisuberi"]) {
    if (h.layers?.[k]) cautions.push(`${LAYERS[k].name}に該当(イエローゾーン)`);
  }
  if (h.layers?.kaoku_hanran) cautions.push("家屋倒壊等氾濫想定区域(氾濫流)に該当");
  if (h.layers?.kaoku_kagan) cautions.push("家屋倒壊等氾濫想定区域(河岸侵食)に該当");
  if (h.layers?.hightide) cautions.push(`高潮浸水想定 ${h.layers.hightide}`);
  if (depth) cautions.push(`洪水浸水想定 ${depth}(浅い区分)`);
  if (cautions.length) return { verdict: "caution", codes: ["OFFICIAL_CAUTION"], reasons: cautions };
  return { verdict: "pass", codes: [], reasons: [] };
}

export const CAVEAT =
  "照合点は丁目の代表点(媒体が丁目までしか住所を出さないため)。荒川の氾濫のような面的ハザードは" +
  "丁目全域に及ぶため確度が高いが、崖線沿いの帯状の土砂災害警戒区域は代表点では取りこぼす" +
  "(西が丘2のレッドゾーン現場は代表点±400mの81点で0点。athomeの備考欄のみが明記していた)。" +
  "掲載欄の確認と併用し、個別区画の確定は番地・現地・重要事項説明で行うこと。";

// ---- CLI: node crawler/geohazard.mjs "東京都北区志茂1丁目" [...] ----
if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const targets = args.length ? args : [];
  if (!targets.length) {
    console.error('使い方: node crawler/geohazard.mjs "東京都北区志茂1丁目" ["東京都北区..."]');
    process.exit(2);
  }
  const out = [];
  for (const a of targets) {
    const h = await officialHazard(a);
    const s = screenOfficial(h);
    out.push({ ...h, screen: s });
    console.log(`\n■ ${a}  標高${h.elevation_m}m  (${h.lat?.toFixed(5)}, ${h.lon?.toFixed(5)})`);
    for (const [k, v] of Object.entries(h.layers ?? {})) console.log(`   ${LAYERS[k].name}: ${v}`);
    if (!Object.keys(h.layers ?? {}).length) console.log("   公式マップ上の該当なし(代表点)");
    console.log(`   判定: ${s.verdict}${s.reasons.length ? " ── " + s.reasons.join(" / ") : ""}`);
  }
  console.log("\n※ " + CAVEAT);
}
