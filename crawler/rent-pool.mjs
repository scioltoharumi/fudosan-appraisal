// crawler/rent-pool.mjs — 北区の戸建賃貸の**募集**賃料プールを収集し market/rent-listings.csv を作る。
// 使い方: node crawler/rent-pool.mjs            (SUUMOから取得。一覧4頁+詳細N件。2.2秒間隔)
//         RENT_CACHE_DIR=/path node crawler/rent-pool.mjs   (取得済みHTMLから再生成=ネットワークに出ない)
//
// 重要な性格づけ: これは**成約ではなく募集(売り手の希望)**である。購入台帳の house-deals.csv は
// 成約価格だが、賃貸の成約賃料は公開されていない。募集賃料は「その値段で決まった」ことを
// 意味しないため、水準比較は必ずこの前提を添えて読む(site/templates/rent-basis.js が開示する)。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../engine/io.js";
import { parseRentDetail, flattenDetail, seismicOf } from "./rent-screen.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SLEEP_MS = 2200;
const LIST_BASE = "https://suumo.jp/chintai/tokyo/sc_kita/ikkodate/";
const MAX_LIST_PAGES = 8;
const OUT = join(ROOT, "market", "rent-listings.csv");
const CACHE = process.env.RENT_CACHE_DIR ?? null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fetched = 0;
async function get(url) {
  if (fetched > 0) await sleep(SLEEP_MS);
  fetched++;
  return execFileSync("curl", ["-sS", "-L", "--max-time", "30", "-A", UA,
    "-H", "Accept-Language: ja,en;q=0.8", url], { maxBuffer: 16 * 1024 * 1024, encoding: "utf8" });
}

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

export const POOL_COLUMNS = ["captured_at", "source_id", "district", "chome", "rent_man", "kanri_man", "total_man",
  "area_m2", "layout", "rooms", "has_ldk", "built_year", "built_month", "age_y", "seismic",
  "walk_min", "walk_lines", "structure", "contract_type", "contract_years",
  "shiki_months", "rei_months", "parking", "toilet2", "building_type", "source_url"];

export function poolRow(detail, id, asOf) {
  const age = detail.built_year ? Math.max(0, Number(asOf.slice(0, 4)) - detail.built_year) : null;
  return {
    captured_at: asOf,
    source_id: id,
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
    parking: detail.parking,
    // 記載があれば1、無ければ空欄。**空欄は「トイレが1つ」ではなく「掲載に記載が無い」**
    toilet2: detail.toilet2 === true ? 1 : "",
    building_type: detail.building_type,
    source_url: `https://suumo.jp/chintai/${id}/`,
  };
}

export function toCsv(rows) {
  const head = POOL_COLUMNS.join(",");
  const body = rows.map((r) => POOL_COLUMNS.map((c) => csvCell(r[c])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

async function main() {
  const asOf = new Date().toISOString().slice(0, 10);
  const details = [];
  if (CACHE) {
    for (const f of readdirSync(CACHE).filter((x) => x.endsWith(".html")).sort()) {
      const html = readFileSync(join(CACHE, f), "utf8");
      if (!/\|建物種別\|/.test(flattenDetail(html))) continue;   // 一覧ページは飛ばす
      details.push([f.replace(/\.html$/, ""), parseRentDetail(html)]);
    }
    console.error(`cache: ${details.length}件 (${CACHE})`);
  } else {
    const urls = [];
    for (let p = 1; p <= MAX_LIST_PAGES; p++) {
      const html = await get(p === 1 ? LIST_BASE : `${LIST_BASE}?page=${p}`);
      const found = detailUrlsFrom(html);
      if (!found.length) break;
      urls.push(...found);
      if (!html.includes(`?page=${p + 1}`)) break;
    }
    const uniq = [...new Set(urls.map((u) => u.match(/jnc_\d+/)[0]))];
    console.error(`一覧: ${uniq.length}件`);
    for (const id of uniq) {
      try {
        const html = await get(`https://suumo.jp/chintai/${id}/`);
        details.push([id, parseRentDetail(html)]);
      } catch (e) {
        console.error(`  詳細取得失敗 ${id}: ${String(e.message ?? e).slice(0, 120)}`);
      }
    }
  }
  // 一戸建て以外(テラス・タウンハウス)はプールから外す。比較対象を揃えるため
  const rows = details
    .filter(([, d]) => d.rent_man != null && /一戸建/.test(d.building_type ?? ""))
    .map(([id, d]) => poolRow(d, id, asOf))
    .sort((a, b) => String(a.source_id).localeCompare(String(b.source_id)));
  mkdirSync(join(ROOT, "market"), { recursive: true });
  writeFileSync(OUT, toCsv(rows), "utf8");
  console.error(`✓ ${OUT} (${rows.length}件 / 取得${details.length}件)`);
}

if (!process.env.RENT_POOL_NO_MAIN) await main();
