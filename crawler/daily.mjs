// crawler/daily.mjs — 日次クロール(観測と差分検出のみ。台帳YAMLは書き換えない)
// 仕様: docs/requirements-daily-crawl.md / 運用手順: .claude/skills/daily-crawl
// 使い方: node crawler/daily.mjs [--watch-only|--discover-only]
// 出力: stdout に機械可読JSONレポート。seen.json(market/crawl/)のみ本スクリプトが更新する。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadProperty, listPropertyIds } from "../engine/io.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SLEEP_MS = 2200;              // N1: リクエスト間隔2秒以上
const MAX_PAGES = 30;               // N1: 1実行あたりの上限
const PRICE_RANGE = [5000, 9000];   // discover対象(万円)
const WALK_MAX = 20;                // discover徒歩上限(分)
const DISTRICTS = ["上十条", "中十条", "十条仲原", "岩淵町", "志茂", "神谷", "西が丘", "赤羽", "赤羽北", "赤羽南", "赤羽台", "赤羽西"];
const LIST_SOURCES = [
  { kind: "chuko", label: "中古一戸建て", base: "https://suumo.jp/chukoikkodate/tokyo/sc_kita/" },
  { kind: "shinchiku", label: "新築一戸建て", base: "https://suumo.jp/ikkodate/tokyo/sc_kita/" },
];
const SEEN_PATH = join(ROOT, "market", "crawl", "seen.json");

let fetchCount = 0;
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url) {
  if (fetchCount >= MAX_PAGES) throw new Error(`ページ上限${MAX_PAGES}超過: ${url}`);
  if (fetchCount > 0) await sleep(SLEEP_MS);
  fetchCount++;
  try {
    const out = execFileSync("curl", ["-sS", "-L", "--max-time", "30", "-A", UA,
      "-w", "\n@@HTTP_CODE@@%{http_code}", url], { maxBuffer: 16 * 1024 * 1024, encoding: "utf8" });
    const m = out.match(/@@HTTP_CODE@@(\d+)\s*$/);
    return { html: out.replace(/\n@@HTTP_CODE@@\d+\s*$/, ""), status: m ? Number(m[1]) : 0 };
  } catch (e) {
    return { html: "", status: 0, error: String(e.message ?? e).slice(0, 200) };
  }
}

const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// 「6,580万円」「1億2000万円」→ 万円整数。価格以外の万円表記と混同しないよう呼び出し側で文脈を絞る
function parseMan(text) {
  const m = String(text).match(/([0-9]+)億\s*([0-9,]*)万?円|([0-9][0-9,]{1,7})万円/);
  if (!m) return null;
  if (m[1] !== undefined) return Number(m[1]) * 10000 + (m[2] ? Number(m[2].replace(/,/g, "")) : 0);
  return Number(m[3].replace(/,/g, ""));
}

// 物件詳細ページ: 本体価格 = 出現頻度が最多の「N万円」(500万未満は諸費用等として除外)。
// F1: 抽出失敗は null を返す(0や前回値の複写をしない)
function parseDetailPrice(html) {
  const counts = {};
  for (const m of strip(html).matchAll(/([0-9]+億[0-9,]*万?円|[0-9][0-9,]{1,7}万円)/g)) {
    const v = parseMan(m[1]);
    if (v !== null && v >= 500) counts[v] = (counts[v] ?? 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 3 ? Number(best[0]) : null;   // 最低3回出現を本体価格の条件とする
}

function parseInfoDate(html) {
  const m = strip(html).match(/情報提供日[\s:：]*([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日/);
  return m ? `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}` : null;
}

const DELISTED_RE = /掲載を終了|現在掲載されて(いま|おりま)せん|販売を終了/;

// ---- watch: 台帳物件の更新チェック ----
async function watch() {
  const results = [];
  for (const id of listPropertyIds()) {
    const p = loadProperty(id);
    if (!p.source_url) { results.push({ id, status: "no_source_url" }); continue; }
    const ph = p.price_history ?? [];
    const last = ph[ph.length - 1] ?? {};
    const { html, status, error } = await fetchPage(p.source_url);
    if (error || status !== 200) {
      const entry = { id, status: status === 404 ? "delisted_suspect" : "fetch_error", http: status, error };
      if (status !== 404) errors.push({ where: `watch:${id}`, detail: `http=${status} ${error ?? ""}` });
      results.push(entry); continue;
    }
    if (DELISTED_RE.test(strip(html))) { results.push({ id, status: "delisted_suspect", http: 200 }); continue; }
    const price = parseDetailPrice(html);
    const infoDate = parseInfoDate(html);
    if (price === null) {
      errors.push({ where: `watch:${id}`, detail: "価格抽出失敗(ページ構造変化の疑い)" });
      results.push({ id, status: "parse_error", http: 200 }); continue;
    }
    results.push({
      id, status: price === last.price_man ? "unchanged" : "price_changed",
      price_man: price, prev_price_man: last.price_man ?? null,
      diff_man: last.price_man != null ? price - last.price_man : null,
      info_date: infoDate, url: p.source_url,
    });
  }
  return results;
}

// ---- discover: 新着探索(12地区・5000〜9000万・徒歩20分以内) ----
function parseListUnits(html, kind) {
  const units = [];
  const parts = html.split(/property_unit-title/).slice(1);
  for (const part of parts) {
    const link = part.match(/href="(\/(?:chukoikkodate|ikkodate)\/[^"]*?(nc_[0-9]+)\/)"/);
    if (!link) continue;
    const seg = strip(part.slice(0, 6000));
    const price = (() => { const m = seg.match(/販売価格\s*([0-9]+億[0-9,]*万?円|[0-9][0-9,]{1,7}万円)/); return m ? parseMan(m[1]) : null; })();
    const addr = (seg.match(/所在地\s*(東京都北区\S+)/) ?? [])[1] ?? null;
    const walks = [...seg.matchAll(/徒歩([0-9]+)分/g)].map((m) => Number(m[1]));
    const land = (seg.match(/土地面積\s*([0-9.]+)\s*m/) ?? [])[1] ?? null;
    const floor = (seg.match(/建物面積\s*([0-9.]+)\s*m/) ?? [])[1] ?? null;
    const layout = (seg.match(/間取り\s*([0-9SLDK+]+(?:\([^)]*\))?)/) ?? [])[1] ?? null;
    const built = (seg.match(/築年月\s*([0-9]{4}年[0-9]{1,2}月)/) ?? [])[1] ?? null;
    units.push({ nc: link[2], url: "https://suumo.jp" + link[1], kind, price_man: price, address: addr,
      walk_min: walks.length ? Math.min(...walks) : null, land_m2: land ? Number(land) : null,
      floor_m2: floor ? Number(floor) : null, layout, built });
  }
  return units;
}

async function discover(ledgerNcs) {
  const seen = existsSync(SEEN_PATH) ? JSON.parse(readFileSync(SEEN_PATH, "utf8")) : {};
  const found = [];
  for (const src of LIST_SOURCES) {
    for (let pn = 1; pn <= 6; pn++) {
      const url = pn === 1 ? src.base : `${src.base}pn${pn}/`;
      const { html, status, error } = await fetchPage(url);
      if (error || status !== 200) { errors.push({ where: `discover:${src.kind}:pn${pn}`, detail: `http=${status} ${error ?? ""}` }); break; }
      const units = parseListUnits(html, src.kind);
      if (units.length === 0) break;   // 最終ページ超過
      found.push(...units);
      if (!html.includes(`pn${pn + 1}`) && !html.includes(`pn=${pn + 1}`)) break;
    }
  }
  // 重複統合(同一ncは初出を採用)→ 条件フィルタ
  const byNc = new Map();
  for (const u of found) if (!byNc.has(u.nc)) byNc.set(u.nc, u);
  const districtOf = (addr) => DISTRICTS.find((d) => String(addr ?? "").startsWith("東京都北区" + d)) ?? null;
  const matches = [...byNc.values()].filter((u) =>
    u.price_man !== null && u.price_man >= PRICE_RANGE[0] && u.price_man <= PRICE_RANGE[1] &&
    districtOf(u.address) !== null &&
    u.walk_min !== null && u.walk_min <= WALK_MAX &&
    !ledgerNcs.has(u.nc));
  const today = new Date().toISOString().slice(0, 10);
  const report = [];
  for (const u of matches) {
    const prev = seen[u.nc];
    if (!prev) {
      seen[u.nc] = { first_seen: today, price_man: u.price_man, address: u.address, walk_min: u.walk_min, kind: u.kind };
      report.push({ ...u, district: districtOf(u.address), event: "new" });
    } else if (prev.price_man !== u.price_man) {
      report.push({ ...u, district: districtOf(u.address), event: "price_changed", prev_price_man: prev.price_man, first_seen: prev.first_seen });
      seen[u.nc].price_man = u.price_man;
    }
  }
  mkdirSync(join(ROOT, "market", "crawl"), { recursive: true });
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 1) + "\n", "utf8");
  return { report, scanned: byNc.size, matched: matches.length };
}

// ---- main ----
const mode = process.argv[2] ?? "";
const ledgerNcs = new Set(listPropertyIds().map((id) => (loadProperty(id).source_url ?? "").match(/nc_[0-9]+/)?.[0]).filter(Boolean));
const out = { crawled_at: new Date().toISOString(), watch: [], discover: [], errors };
if (mode !== "--discover-only") out.watch = await watch();
if (mode !== "--watch-only") out.discover = (await discover(ledgerNcs)).report;
out.summary = {
  price_changes: out.watch.filter((w) => w.status === "price_changed").length,
  delisted_suspects: out.watch.filter((w) => w.status === "delisted_suspect").length,
  new_listings: out.discover.filter((d) => d.event === "new").length,
  discover_price_changes: out.discover.filter((d) => d.event === "price_changed").length,
  errors: errors.length, pages_fetched: fetchCount,
};
console.log(JSON.stringify(out, null, 1));
