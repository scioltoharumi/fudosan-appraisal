// crawler/rent-pool.mjs — 北区の戸建賃貸の**募集**賃料プールを収集し market/rent-listings.csv を作る。
// 使い方: node crawler/rent-pool.mjs                     (SUUMOから取得。2.2秒間隔)
//         RENT_CACHE_DIR=/path node crawler/rent-pool.mjs (取得済みHTMLから再生成=ネットワークに出ない)
//
// 重要な性格づけ: これは**成約ではなく募集(売り手の希望)**である。購入台帳の house-deals.csv は
// 成約価格だが、賃貸の成約賃料は公開されていない。募集賃料は「その値段で決まった」ことを
// 意味しないため、水準比較は必ずこの前提を添えて読む(site/templates/rent-basis.js が開示する)。
//
// 2026-08-19の監査で直したこと:
//  ① **1物件1行にする(名寄せ)**。同一物件が複数の店舗・媒体から掲載されるため、掲載をそのまま
//     行にすると同じ物件を何度も数えることになる(pseudo-replication)。残差が実際より狭く出て、
//     徒歩分の係数が「判別可能」へ反転しかねない。listing_count に元の掲載数を残す。
//  ② **import しただけで main() が走らない**ようにした(テストからCSVを上書きする事故の形だった)。
//
// **既知の限界(2026-08-19の監査で実測)**: 母集団はSUUMO単独である。athomeにのみ出ている
// 北区の賃貸一戸建てが8〜10件あり、一戸建ての和集合に対するSUUMOの被覆は約85%。
// 逆にSUUMOにしか無い掲載も12件あるので、どちらも他方の上位集合ではない。
// athomeは現在ボット対策の認証画面を返すため機械取得の経路を確立できていない。
// この限界は site/templates/rent-basis.js が開示する。media 列は将来の第2媒体のために持っている。
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../engine/io.js";
import { parseRentDetail, flattenDetail, seismicOf } from "./rent-screen.mjs";
import { makeFetcher } from "./http.mjs";

const LIST_BASE = "https://suumo.jp/chintai/tokyo/sc_kita/ikkodate/";
const MAX_LIST_PAGES = 8;
const OUT = join(ROOT, "market", "rent-listings.csv");
const CACHE = process.env.RENT_CACHE_DIR ?? null;

// 一覧カードから詳細URLを集める。賃貸の詳細は /chintai/jnc_<12桁>/
export function detailUrlsFrom(html) {
  const urls = new Set();
  for (const m of String(html).matchAll(/href="(\/chintai\/jnc_\d+\/[^"]*)"/g)) urls.add(m[1]);
  return [...urls];
}

const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const POOL_COLUMNS = ["captured_at", "media", "source_id", "listing_count", "district", "chome",
  "rent_man", "kanri_man", "total_man", "area_m2", "layout", "rooms", "has_ldk",
  "built_year", "built_month", "age_y", "seismic", "walk_min", "walk_lines", "structure",
  "contract_type", "contract_years", "shiki_months", "rei_months", "shikibiki_raw", "madori_detail",
  "parking", "toilet2", "building_type", "source_url"];

export function poolRow(detail, id, asOf, media = "suumo") {
  const age = detail.built_year ? Math.max(0, Number(String(asOf).slice(0, 4)) - detail.built_year) : null;
  return {
    captured_at: asOf,
    media,
    source_id: id,
    listing_count: 1,
    district: detail.district,
    chome: detail.chome,
    rent_man: detail.rent_man,
    kanri_man: detail.kanri_man,
    total_man: detail.total_man,
    area_m2: detail.area_m2,
    layout: detail.layout,
    rooms: detail.rooms,
    has_ldk: detail.has_ldk === null ? "" : detail.has_ldk ? 1 : 0,
    built_year: detail.built_year,
    built_month: detail.built_month,
    age_y: age,
    seismic: seismicOf(detail.built_year, detail.built_month).level,
    walk_min: detail.walk_min,
    walk_lines: detail.walks.map((w) => `${w.line}/${w.station}:${w.walk_min}`).join(" "),
    structure: detail.structure,
    contract_type: detail.contract.type,
    contract_years: detail.contract.years,
    shiki_months: detail.shiki_months,
    rei_months: detail.rei_months,
    // 敷引・償却は敷金のうち**返ってこない**部分(礼金と同じ一時金)。原文のまま持つ
    shikibiki_raw: detail.shikibiki_raw && !/^[-－ー]$/.test(detail.shikibiki_raw) ? detail.shikibiki_raw : "",
    // 間取り詳細(「和8 洋6 洋4.5 LDK17.5」)。専有面積との整合検査に使う——
    // 出典側の誤記で専有面積が壊れている掲載が実在し(3LDKで26.5m2)、標本が小さいと係数を数%動かす
    madori_detail: detail.madori_detail ?? "",
    parking: detail.parking,
    // 記載があれば1、無ければ空欄。**空欄は「トイレが1つ」ではなく「掲載に記載が無い」**
    toilet2: detail.toilet2 === true ? 1 : "",
    building_type: detail.building_type,
    source_url: media === "athome" ? `https://www.athome.co.jp/chintai/${id}/` : `https://suumo.jp/chintai/${id}/`,
  };
}

// 同一物件の判定キー。媒体・店舗が違っても諸元は一致する
export const propertyKey = (r) =>
  [r.district ?? "?", r.chome ?? "?", r.area_m2 ?? "?", r.total_man ?? "?", r.built_year ?? "?", r.layout ?? "?"].join("|");

// 掲載の配列を**1物件1行**へ畳む。
// 諸元が割れる項目(徒歩分・建物種別・間取り)はグループ内で食い違うことがあるので、
// 徒歩は最小値(掲載により駅の選び方が違うだけ)、建物種別は割れたら "混在" として人の判断へ回す。
export function dedupeRows(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = propertyKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [], conflicts = [];
  for (const [k, g] of groups) {
    const base = { ...g[0] };
    base.listing_count = g.length;
    const walks = g.map((x) => x.walk_min).filter((v) => Number.isFinite(v));
    if (walks.length) base.walk_min = Math.min(...walks);
    const types = [...new Set(g.map((x) => x.building_type).filter(Boolean))];
    if (types.length > 1) { base.building_type = "混在"; conflicts.push({ key: k, field: "building_type", values: types }); }
    const walkSet = [...new Set(walks)];
    if (walkSet.length > 1) conflicts.push({ key: k, field: "walk_min", values: walkSet });
    // 掲載が複数媒体にまたがるときは media を "suumo+athome" のように残す
    const medias = [...new Set(g.map((x) => x.media))].sort();
    base.media = medias.join("+");
    base.source_id = g.map((x) => x.source_id).join(" ");
    out.push(base);
  }
  return { rows: out, conflicts };
}

export function toCsv(rows) {
  const head = POOL_COLUMNS.join(",");
  const body = rows.map((r) => POOL_COLUMNS.map((c) => csvCell(r[c])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

async function collectSuumo(fetchPage, asOf) {
  const urls = [];
  let truncated = false;
  for (let p = 1; p <= MAX_LIST_PAGES; p++) {
    const { html, status, error } = await fetchPage(p === 1 ? LIST_BASE : `${LIST_BASE}?page=${p}`);
    if (error || status !== 200) { console.error(`  SUUMO一覧 page${p} 取得失敗 http=${status}`); truncated = true; break; }
    const found = detailUrlsFrom(html);
    if (!found.length) break;
    urls.push(...found);
    if (!html.includes(`?page=${p + 1}`)) break;
    // 次ページのリンクが残っているのに上限に達した=取りこぼしがある。黙って減らさない
    if (p === MAX_LIST_PAGES) { console.error(`  ⚠ SUUMO一覧が上限${MAX_LIST_PAGES}頁に達したが次ページが残っている`); truncated = true; }
  }
  const uniq = [...new Set(urls.map((u) => u.match(/jnc_\d+/)[0]))];
  console.error(`SUUMO一覧: 掲載${uniq.length}件`);
  const out = [];
  for (const id of uniq) {
    const { html, status, error } = await fetchPage(`https://suumo.jp/chintai/${id}/`);
    if (error || status !== 200) { console.error(`  詳細取得失敗 ${id} http=${status}`); continue; }
    out.push([id, parseRentDetail(html), "suumo"]);
  }
  return { details: out, truncated };
}

async function main() {
  const asOf = new Date().toISOString().slice(0, 10);
  const { fetchPage } = makeFetcher({});
  let details = [];
  let truncated = false;

  if (CACHE) {
    for (const f of readdirSync(CACHE).filter((x) => x.endsWith(".html")).sort()) {
      const html = readFileSync(join(CACHE, f), "utf8");
      const id = f.replace(/\.html$/, "");
      if (!/\|建物種別\|/.test(flattenDetail(html))) continue;   // 一覧ページ・掲載終了ページは飛ばす
      details.push([id, parseRentDetail(html), "suumo"]);
    }
    console.error(`cache: ${details.length}件 (${CACHE})`);
  } else {
    const s = await collectSuumo(fetchPage, asOf);
    details = details.concat(s.details); truncated = truncated || s.truncated;
  }

  // 内訳を必ず出す(黙って減らさない)
  const noRent = details.filter(([, d]) => d.rent_man == null);
  const notHouse = details.filter(([, d]) => d.rent_man != null && !/一戸建/.test(d.building_type ?? ""));
  const kept = details.filter(([, d]) => d.rent_man != null && /一戸建/.test(d.building_type ?? ""));
  const listings = kept.map(([id, d, media]) => poolRow(d, id, asOf, media))
    .sort((a, b) => String(a.source_id).localeCompare(String(b.source_id)));
  const { rows, conflicts } = dedupeRows(listings);
  rows.sort((a, b) => String(a.source_id).localeCompare(String(b.source_id)));

  mkdirSync(join(ROOT, "market"), { recursive: true });
  writeFileSync(OUT, toCsv(rows), "utf8");
  console.error(`取得${details.length}掲載 → 一戸建て${kept.length}掲載` +
    `(賃料が読めず除外${noRent.length} / 連棟など建物種別で除外${notHouse.length})` +
    ` → 名寄せ後${rows.length}物件`);
  if (noRent.length) console.error(`  賃料が読めなかった掲載: ${noRent.map(([id]) => id).join(" ")}`);
  for (const c of conflicts) console.error(`  ⚠ 諸元が割れる物件: ${c.key} の ${c.field} = ${JSON.stringify(c.values)}`);
  if (truncated) console.error("  ⚠ 一覧の走査が完全でない。母集団に取りこぼしがある可能性がある");
  console.error(`✓ ${OUT}`);
}

// import しただけでは実行しない(購入版 crawler/daily.mjs と同じ判定)。
// 以前は環境変数で抑止していたため、テストから import すると実クロールが走り
// market/rent-listings.csv を上書きしうる形になっていた(2026-08-19の監査指摘)
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
