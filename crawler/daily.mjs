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
const MAX_PAGES = 45;               // N1: 1実行あたりの上限(Phase2でathome追加につき30→45)
const PRICE_RANGE = [5000, 9000];   // discover対象(万円)
const WALK_MAX = 20;                // discover徒歩上限(分)
const DISTRICTS = ["上十条", "中十条", "十条仲原", "岩淵町", "志茂", "神谷", "西が丘", "赤羽", "赤羽北", "赤羽南", "赤羽台", "赤羽西"];
// 媒体横断の同一物件は指紋(地区丁目|価格|土地面積)で名寄せする。先頭の媒体を優先採用
// するため、SUUMO(watch対象と同じ媒体・物件番号で台帳と直結)を先に置く
const LIST_SOURCES = [
  { media: "suumo", kind: "chuko", base: "https://suumo.jp/chukoikkodate/tokyo/sc_kita/" },
  { media: "suumo", kind: "shinchiku", base: "https://suumo.jp/ikkodate/tokyo/sc_kita/" },
  { media: "athome", kind: "chuko", base: "https://www.athome.co.jp/kodate/chuko/tokyo/kita-city/list/" },
  { media: "athome", kind: "shinchiku", base: "https://www.athome.co.jp/kodate/shinchiku/tokyo/kita-city/list/" },
];
// 全角英数字→半角(athomeは「７Ｋ」等の全角表記)
const zen = (s) => String(s ?? "").replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
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

// athome詳細: 広告枠の他物件価格が本体より高頻度に出るため、モード方式でなく
// 「価格」ラベル直後の値を採用。複数ヒットが割れたら失敗扱い(誤検出を価格変動と誤認しない)
function parseDetailPriceAthome(html) {
  const hits = [...strip(html).matchAll(/価格\s*([0-9][0-9,]{1,7})\s*万円/g)].map((m) => Number(m[1].replace(/,/g, "")));
  if (!hits.length) return null;
  return hits.every((v) => v === hits[0]) ? hits[0] : null;
}

function parseInfoDate(html) {
  const m = strip(html).match(/(?:情報提供日|情報公開日)[\s:：]*([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日/);
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
    const price = /athome\.co\.jp/.test(p.source_url) ? parseDetailPriceAthome(html) : parseDetailPrice(html);
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
function parseSuumoUnits(html, kind) {
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
    units.push({ nc: link[2], media: "suumo", url: "https://suumo.jp" + link[1], kind, price_man: price, address: addr,
      walk_min: walks.length ? Math.min(...walks) : null, land_m2: land ? Number(land) : null,
      floor_m2: floor ? Number(floor) : null, layout, built });
  }
  return units;
}

// athome: Angular SSRのカード単位で分割。表記は全角混じりのため半角へ正規化してから抽出
function parseAthomeUnits(html, kind) {
  const units = [];
  const parts = html.split("<athome-csite-pc-part-bukken-card-ryutsu-sell-living").slice(1);
  for (const part of parts) {
    const link = part.match(/href="\/kodate\/([0-9]+)\//);
    if (!link) continue;
    const seg = zen(strip(part.slice(0, 30000)));
    const price = (() => { const m = seg.match(/([0-9]+億[0-9,]*万?円|[0-9][0-9,]{1,7}万円)/); return m ? parseMan(m[1]) : null; })();
    const addrM = seg.match(/所在地\s+北区\s?(\S+?)(?:丁目)?(?:\s|$)/);
    const addr = addrM ? "東京都北区" + addrM[1].replace(/丁目$/, "") : null;
    const walks = [...seg.matchAll(/徒歩\s?([0-9]+)分/g)].map((m) => Number(m[1]));
    const land = (seg.match(/土地面積\s+([0-9.]+)\s*m/) ?? [])[1] ?? null;
    const floor = (seg.match(/建物面積\s+([0-9.]+)\s*m/) ?? [])[1] ?? null;
    const layout = (seg.match(/間取り\s+([0-9SLDK+]+(?:\([^)]*\))?)/) ?? [])[1] ?? null;
    const built = (seg.match(/築年月\s+([0-9]{4}年[0-9]{1,2}月)/) ?? [])[1] ?? null;
    units.push({ nc: "at_" + link[1], media: "athome", url: `https://www.athome.co.jp/kodate/${link[1]}/`, kind,
      price_man: price, address: addr, walk_min: walks.length ? Math.min(...walks) : null,
      land_m2: land ? Number(land) : null, floor_m2: floor ? Number(floor) : null, layout, built });
  }
  return units;
}

// 媒体横断の同一物件指紋: 地区丁目|価格|土地面積(公簿は媒体間で一致するのが通常)。
// 面積が取れない掲載は指紋なし=名寄せ対象外(重複の可能性はレポート側で人が判断)
function fingerprint(district, chome, price, land) {
  if (!district || price == null || land == null) return null;
  return `${district}${chome ?? ""}|${price}|${land}`;
}
function unitFingerprint(u, districtOfFn) {
  const d = districtOfFn(u.address);
  const chome = (zen(u.address ?? "").match(/北区\D+([0-9]+)/) ?? [])[1] ?? null;
  return fingerprint(d, chome, u.price_man, u.land_m2);
}

async function discover(ledgerNcs, ledgerFps) {
  const seen = existsSync(SEEN_PATH) ? JSON.parse(readFileSync(SEEN_PATH, "utf8")) : {};
  const found = [];
  for (const src of LIST_SOURCES) {
    for (let pn = 1; pn <= 8; pn++) {
      // ページ送り: SUUMOは ?page=N、athomeは /list/pageN/(どちらも誤URLは404にならず1ページ目が返るため厳密に)
      const url = pn === 1 ? src.base
        : src.media === "suumo" ? `${src.base}?page=${pn}` : `${src.base}page${pn}/`;
      const { html, status, error } = await fetchPage(url);
      if (error || status !== 200) { errors.push({ where: `discover:${src.media}:${src.kind}:page${pn}`, detail: `http=${status} ${error ?? ""}` }); break; }
      const units = src.media === "suumo" ? parseSuumoUnits(html, src.kind) : parseAthomeUnits(html, src.kind);
      if (units.length === 0) break;   // 最終ページ超過
      found.push(...units);
      const nextMark = src.media === "suumo" ? `?page=${pn + 1}` : `/list/page${pn + 1}`;
      if (!html.includes(nextMark)) break;   // 次ページへのリンクが無ければ最終ページ
    }
  }
  const districtOf = (addr) => DISTRICTS.find((d) => zen(String(addr ?? "")).startsWith("東京都北区" + d)) ?? null;
  // 重複統合: ①同一キー(媒体内) ②媒体横断の指紋一致(LIST_SOURCES順=SUUMO優先で初出を採用)
  const byNc = new Map();
  const fpSeen = new Set();
  for (const u of found) {
    if (byNc.has(u.nc)) continue;
    const fp = unitFingerprint(u, districtOf);
    if (fp && fpSeen.has(fp)) continue;          // 他媒体の同一物件
    if (fp) fpSeen.add(fp);
    byNc.set(u.nc, u);
  }
  const matches = [...byNc.values()].filter((u) =>
    u.price_man !== null && u.price_man >= PRICE_RANGE[0] && u.price_man <= PRICE_RANGE[1] &&
    districtOf(u.address) !== null &&
    u.walk_min !== null && u.walk_min <= WALK_MAX &&
    !ledgerNcs.has(u.nc) &&
    !(unitFingerprint(u, districtOf) && ledgerFps.has(unitFingerprint(u, districtOf))));   // 台帳物件の他媒体掲載
  const today = new Date().toISOString().slice(0, 10);
  // 既見物件の媒体横断照合用: seen済みエントリの指紋(媒体が違ってもキーが違っても同一物件を再報告しない)
  const seenFps = new Set(Object.entries(seen).map(([k, v]) =>
    fingerprint(DISTRICTS.find((d) => zen(String(v.address ?? "")).startsWith("東京都北区" + d)) ?? null,
      (zen(v.address ?? "").match(/北区\D+([0-9]+)/) ?? [])[1] ?? null, v.price_man, v.land_m2 ?? null)).filter(Boolean));
  const report = [];
  for (const u of matches) {
    const prev = seen[u.nc];
    const fp = unitFingerprint(u, districtOf);
    if (!prev) {
      if (fp && seenFps.has(fp)) continue;       // 別キーで既見(媒体違いの同一物件)
      seen[u.nc] = { first_seen: today, price_man: u.price_man, address: u.address, walk_min: u.walk_min, kind: u.kind, media: u.media, land_m2: u.land_m2 };
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
const ledgerNcs = new Set(listPropertyIds().flatMap((id) => {
  const u = loadProperty(id).source_url ?? "";
  const at = u.match(/athome\.co\.jp\/kodate\/([0-9]+)/)?.[1];
  return [u.match(/nc_[0-9]+/)?.[0], at ? "at_" + at : null].filter(Boolean);
}));
// 台帳物件の指紋(他媒体の同一掲載を新着扱いしないため)
const ledgerFps = new Set(listPropertyIds().map((id) => {
  const p = loadProperty(id);
  const ph = [...(p.price_history ?? [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  const d = DISTRICTS.find((x) => String(p.location?.address ?? "").startsWith("北区" + x)) ?? null;
  const chome = (zen(p.location?.address ?? "").match(/北区\D+([0-9]+)/) ?? [])[1] ?? null;
  return fingerprint(d, chome, ph.length ? ph[ph.length - 1].price_man : null, p.land?.registered_m2 ?? null);
}).filter(Boolean));
const out = { crawled_at: new Date().toISOString(), watch: [], discover: [], errors };
if (mode !== "--discover-only") out.watch = await watch();
if (mode !== "--watch-only") out.discover = (await discover(ledgerNcs, ledgerFps)).report;
out.summary = {
  price_changes: out.watch.filter((w) => w.status === "price_changed").length,
  delisted_suspects: out.watch.filter((w) => w.status === "delisted_suspect").length,
  new_listings: out.discover.filter((d) => d.event === "new").length,
  discover_price_changes: out.discover.filter((d) => d.event === "price_changed").length,
  errors: errors.length, pages_fetched: fetchCount,
};
console.log(JSON.stringify(out, null, 1));
