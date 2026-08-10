// engine/verify-data.mjs — 成約データの二重照合(データ信頼性検証)
// 使い方: node engine/verify-data.mjs   → market/verification.json を更新
//
// 検証の構造:
//   当方CSV(market/house-deals.csv)の各行を、国交省「不動産取引価格情報」の再掲サイト2社と突き合わせる。
//   [A] utinokati.com(一次取得元) … ライブページの埋込JSONと照合 = 転記の正しさの検証
//   [B] baikyaku-agent.com(独立の第二再掲) … 価格/面積/時期の一致 + 築年の相互検証 = 元データ齟齬の検出
// ステータス:
//   verified2  = 両ソース一致(築年も整合)
//   verified1  = 一次ソースのみ一致(第二ソースに未収載)
//   conflict   = 両ソースが同一取引を指すが築年等が矛盾 → 査定エンジンは当該行を除外する
//   unverified = ライブ照合できず(掲載ローテーション等)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./io.js";

const DISTRICT_CODES = {
  "赤羽西": "13117-U0030", "志茂": "13117-U0010", "赤羽": "13117-U0026", "赤羽北": "13117-U0027",
  "赤羽台": "13117-U0029", "赤羽南": "13117-U0028", "上十条": "13117-U0002", "中十条": "13117-U0003",
  "十条仲原": "13117-U0005", "西が丘": "13117-U0023", "岩淵町": "13117-U0008", "神谷": "13117-U0022",
};

function loadCsvRows() {
  const text = readFileSync(join(ROOT, "market", "house-deals.csv"), "utf8");
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const c = line.split(",");
    const row = Object.fromEntries(header.map((h, i) => [h, c[i]]));
    return { quarter: row.quarter, district: row.district, price_man: +row.price_man,
      land_m2: +row.land_m2, floor_m2: +row.floor_m2, age_y: +row.age_y, walk_min: +row.walk_min };
  });
}

const rowKey = (r) => [r.quarter, r.district, r.price_man, r.land_m2, r.floor_m2, r.age_y, r.walk_min].join("|");

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (data-verification)" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}

// [A] utinokati ライブページの埋込JSONを抽出
function parseUtinokati(html) {
  const recs = [];
  const re = /\{\\?"days_elapsed\\?":\s*(-?[\d.]+),[^}]*?\\?"dimension\\?":\s*([\d.]+),[^}]*?\\?"dimension_all\\?":\s*([\d.]+),[^}]*?\\?"id\\?":\s*\\?"([^"\\]+)\\?",[^}]*?\\?"price\\?":\s*(\d+),[^}]*?\\?"station_distance\\?":\s*([\d.]+),[^}]*?\\?"trade_elapsed\\?":\s*(\d+)/g;
  let m;
  while ((m = re.exec(html))) {
    recs.push({ age_y: +m[1] / 365.25, land_m2: +m[2], floor_m2: +m[3], mlit_ref: m[4],
      price_man: +m[5] / 10000, walk_min: +m[6], trade_elapsed_d: +m[7] });
  }
  return recs;
}

// [B] baikyaku-agent のテーブルをパース
function parseBaikyaku(html) {
  const recs = [];
  const re = /取引価格">([\d,]+)万円<\/td>\s*<td[^>]*面積">([\d,.]+)m&sup2;<\/td>\s*<td[^>]*延床面積">([\d,.]+)m&sup2;<\/td>\s*<td[^>]*建築年">(?:(\d{4})年)?[^<]*<\/td>\s*<td[^>]*建物構造">([^<]*)<\/td>\s*<td[^>]*取引時期">(\d{4})年第(\d)四半期/g;
  let m;
  while ((m = re.exec(html))) {
    recs.push({ price_man: +m[1].replace(/,/g, ""), land_m2: +m[2].replace(/,/g, ""), floor_m2: +m[3].replace(/,/g, ""),
      built: m[4] ? +m[4] : null, struct: m[5], quarter: `${m[6]}Q${m[7]}` });
  }
  return recs;
}

const quarterMidDate = (q) => { const [y, n] = [+q.slice(0, 4), +q.slice(5)]; return Date.UTC(y, (n - 1) * 3 + 1, 15); };

async function main() {
  const rows = loadCsvRows();
  const now = Date.now();
  const live = {}, second = {};
  for (const [dist, code] of Object.entries(DISTRICT_CODES)) {
    try { live[dist] = parseUtinokati(await fetchText(`https://utinokati.com/details/house/place/${code}/`)); }
    catch (e) { console.error(`utinokati ${dist}: ${e.message}`); live[dist] = null; }
    try { second[dist] = parseBaikyaku(await fetchText(`https://baikyaku-agent.com/seiyaku/kodate2.php?ac=13117&wa=${encodeURIComponent("北区")}&sa=${encodeURIComponent(dist)}`)); }
    catch (e) { console.error(`baikyaku ${dist}: ${e.message}`); second[dist] = null; }
  }

  const out = [];
  const summary = { verified2: 0, verified1: 0, conflict: 0, unverified: 0 };
  for (const r of rows) {
    // [A] 転記検証: ライブの埋込JSONに同一レコードが存在するか
    const lv = live[r.district];
    const qMid = quarterMidDate(r.quarter);
    const liveHit = lv?.find((x) =>
      x.price_man === r.price_man && x.land_m2 === r.land_m2 && x.floor_m2 === r.floor_m2 &&
      Math.abs(x.walk_min - r.walk_min) < 0.51 && Math.abs(x.age_y - r.age_y) < 0.6 &&
      Math.abs((now - x.trade_elapsed_d * 86400000) - qMid) < 120 * 86400000);
    // [B] 独立ソース照合(価格・面積・時期一致 → 築年の整合を検証)
    const sv = second[r.district];
    const secHit = sv?.find((x) =>
      x.price_man === r.price_man && Math.abs(x.land_m2 - r.land_m2) <= 5 &&
      Math.abs(x.floor_m2 - r.floor_m2) <= 5 && x.quarter === r.quarter);
    let status, note = "";
    if (secHit) {
      const y = +r.quarter.slice(0, 4), qn = +r.quarter.slice(5);
      const ageSec = secHit.built ? (y + (qn * 3 - 1.5) / 12) - secHit.built : null;
      if (ageSec != null && Math.abs(ageSec - r.age_y) > 2) {
        status = "conflict";
        note = `築年矛盾: 当方${r.age_y}年 vs 第二ソース築${secHit.built}年(≒${ageSec.toFixed(1)}年)。原典(国交省CSV)での裁定まで査定から除外`;
      } else {
        status = "verified2";
        if (secHit.struct && secHit.struct !== "木造") note = `構造=${secHit.struct}(第二ソース)`;
      }
    } else if (liveHit) { status = "verified1"; }
    else { status = "unverified"; note = "ライブページで再確認できず(掲載ローテーションの可能性)"; }
    summary[status]++;
    const code = DISTRICT_CODES[r.district];
    out.push({ key: rowKey(r), ...r, status, note,
      mlit_ref: liveHit?.mlit_ref ?? null,   // 国交省原典CSV内のレコード参照(再掲サイトの内部ID)
      source_primary: code ? `https://utinokati.com/details/house/place/${code}/` : null,
      source_secondary: `https://baikyaku-agent.com/seiyaku/kodate2.php?ac=13117&wa=%E5%8C%97%E5%8C%BA&sa=${encodeURIComponent(r.district)}`,
      source_origin: "https://www.reinfolib.mlit.go.jp/realEstatePrices/ (国交省 不動産情報ライブラリ・原典)" });
  }

  const json = {
    generated_at: new Date().toISOString().slice(0, 10),
    sources: {
      primary: "utinokati.com(国交省 不動産取引価格情報の再掲)",
      secondary: "baikyaku-agent.com(同・独立の再掲。建築年・構造を収載)",
      note: "両者とも再掲サイトであり原典は国交省。conflictの最終裁定には不動産情報ライブラリ(要APIキー)の原典照合が必要",
    },
    summary, rows: out,
  };
  writeFileSync(join(ROOT, "market", "verification.json"), JSON.stringify(json, null, 1));
  console.log(`━━ データ検証完了(${rows.length}件)`);
  console.log(`  verified2(二重照合一致): ${summary.verified2}`);
  console.log(`  verified1(一次のみ確認): ${summary.verified1}`);
  console.log(`  conflict(矛盾→査定除外): ${summary.conflict}`);
  console.log(`  unverified(要再確認)  : ${summary.unverified}`);
  for (const r of out.filter((x) => x.status === "conflict")) console.log(`  ⚠ ${r.quarter} ${r.district} ${r.price_man}万: ${r.note}`);
}
main();
