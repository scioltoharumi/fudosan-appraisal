// crawler/daily.mjs — 日次クロール(観測と差分検出のみ。台帳YAMLは書き換えない)
// 仕様: docs/requirements-daily-crawl.md / 運用手順: .claude/skills/daily-crawl
// 使い方: node crawler/daily.mjs [--watch-only|--discover-only]
// 出力: stdout に機械可読JSONレポート。seen.json(market/crawl/)のみ本スクリプトが更新する。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, loadProperty, listPropertyIds } from "../engine/io.js";
import { buildExcludedIndex, matchExcludedSite, scanKO, koScreen } from "./screen.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SLEEP_MS = 2200;              // N1: リクエスト間隔2秒以上
// N1: 1実行あたりの取得上限。watch(台帳件数ぶん)を先に消費し、残りがdiscoverの探索予算になる。
// 到達しても例外にせず打ち切る(2026-08-12監査: 例外だとレポート不出力のまま異常終了し無人運用で沈黙した)。
// 現在の最大需要は watch 17 + discover 32(4媒体×8頁) + KO詳細 8 = 57
const MAX_PAGES = 72;
// 新着のKO判定に使う詳細ページ取得の上限。一覧の走査に予算を食われてKO判定が
// 「詳細未取得」で終わらないよう、この枠を先に取り置く(discover側が reserve として尊重する)
const KO_DETAIL_MAX = 8;
const EXCLUDED_PATH = join(ROOT, "market", "crawl", "excluded.json");
const PRICE_RANGE = [5000, 9000];   // discover対象(万円)
const WALK_MAX = 20;                // discover徒歩上限(分)
export const DISTRICTS = ["上十条", "中十条", "十条仲原", "岩淵町", "志茂", "神谷", "西が丘", "赤羽", "赤羽北", "赤羽南", "赤羽台", "赤羽西"];
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

// 上限到達は例外にしない(投げるとレポートが1行も出ずに異常終了し、無人運用で沈黙する)。
// budget切れは呼び出し側が判定できるよう exhausted フラグで返し、errors[]に開示する
async function fetchPage(url, reserve = 0) {
  // reserve: この呼び出しが使ってはいけない取り置き枠(KO判定用の詳細取得ぶん)
  if (fetchCount >= MAX_PAGES - reserve) {
    errors.push({ where: "fetchPage", detail: `ページ上限${MAX_PAGES}(取り置き${reserve})到達につき取得を打ち切り: ${url}` });
    return { html: "", status: 0, exhausted: true, error: `page budget exhausted (${MAX_PAGES})` };
  }
  if (fetchCount > 0) await sleep(SLEEP_MS);
  fetchCount++;
  try {
    const out = execFileSync("curl", ["-sS", "-L", "--max-time", "30", "-A", UA,
      "-H", "Accept-Language: ja,en;q=0.8",
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

// 複数戸掲載(新築分譲)のSUUMOページは号棟ごとの構造化データ(madoriList)を持つ。
// 台帳YAMLの土地・建物面積で該当戸を特定して価格を取る(ページ代表価格を拾うと毎日
// 誤って値下げ扱いになる。2026-08-12監査: nishigaoka2-21063164 で顕在化)。
// 戸が特定できない場合は null を返し、呼び出し側でエラーとして開示する
function parseUnitPriceSuumo(html, landM2, floorM2) {
  const units = [...html.matchAll(/title\s*:\s*"([^"]{1,20}号棟[^"]{0,10})"[\s\S]{0,300}?kakakuDisp\s*:\s*"(\d+)"[\s\S]{0,400}?tochiMensekiDisp\s*:\s*"([\d.]+)"[\s\S]{0,200}?tatemonoMensekiDisp\s*:\s*"([\d.]+)"/g)]
    .map((m) => ({ title: m[1], man: Math.round(Number(m[2]) / 10000), land: Number(m[3]), floor: Number(m[4]) }));
  if (units.length < 2) return { multi: false };
  const hit = units.filter((u) => Math.abs(u.land - landM2) < 0.02 && Math.abs(u.floor - floorM2) < 0.02);
  if (hit.length !== 1) return { multi: true, price: null, units };
  return { multi: true, price: hit[0].man, unit: hit[0].title, units };
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
    const { html, status, error, exhausted } = await fetchPage(p.source_url);
    if (exhausted) { results.push({ id, status: "skipped_budget" }); continue; }
    if (error || status !== 200) {
      const entry = { id, status: status === 404 ? "delisted_suspect" : "fetch_error", http: status, error };
      if (status !== 404) errors.push({ where: `watch:${id}`, detail: `http=${status} ${error ?? ""}` });
      results.push(entry); continue;
    }
    if (DELISTED_RE.test(strip(html))) { results.push({ id, status: "delisted_suspect", http: 200 }); continue; }
    const isAthome = /athome\.co\.jp/.test(p.source_url);
    // 複数戸掲載は面積で戸を特定してから価格を取る(ページ代表価格の誤検出を防ぐ)
    const unitInfo = isAthome ? { multi: false }
      : parseUnitPriceSuumo(html, p.land?.registered_m2 ?? -1, p.building?.floor_m2 ?? -1);
    let price, unitLabel = null;
    if (unitInfo.multi) {
      price = unitInfo.price; unitLabel = unitInfo.unit ?? null;
      if (price === null) {
        errors.push({ where: `watch:${id}`, detail: `複数戸掲載(${unitInfo.units.length}戸)で該当戸を面積特定できず。掲載の戸: ` +
          unitInfo.units.map((u) => `${u.title} ${u.man}万/${u.land}/${u.floor}`).join(" | ") + ` (台帳: 土地${p.land?.registered_m2}/建物${p.building?.floor_m2})` });
        results.push({ id, status: "unit_unresolved", http: 200, units: unitInfo.units }); continue;
      }
    } else {
      price = isAthome ? parseDetailPriceAthome(html) : parseDetailPrice(html);
    }
    let infoDate = parseInfoDate(html);
    // 抽出失敗は1回だけ再取得を試す(媒体側の一時的な応答差で毎日エラー通知が出るのを防ぐ)。
    // それでも失敗ならエラーとして開示する(前回値の複写は絶対にしない)
    if (price === null) {
      const retry = await fetchPage(p.source_url);
      if (retry.status === 200) {
        price = isAthome ? parseDetailPriceAthome(retry.html) : parseDetailPrice(retry.html);
        infoDate = parseInfoDate(retry.html) ?? infoDate;
      }
    }
    if (price === null) {
      errors.push({ where: `watch:${id}`, detail: "価格抽出失敗(再取得後も失敗。ページ構造変化の疑い)" });
      results.push({ id, status: "parse_error", http: 200 }); continue;
    }
    results.push({
      id, status: price === last.price_man ? "unchanged" : "price_changed",
      price_man: price, prev_price_man: last.price_man ?? null,
      diff_man: last.price_man != null ? price - last.price_man : null,
      info_date: infoDate, url: p.source_url, unit: unitLabel,
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

// 媒体横断の同一物件指紋: 地区丁目|価格|土地面積|建物面積。
// 2026-08-12: 建物面積を追加。新築の複数戸掲載は一覧が開発の代表価格(下限値)を出すため、
// 価格+土地面積だけだと別戸どうしが同じ指紋になりうる(西が丘2の1号棟/2号棟で顕在化)。
// 面積が取れない掲載は指紋なし=名寄せ対象外(重複の可能性はレポート側で人が判断)
export function fingerprint(district, chome, price, land, floor) {
  if (!district || price == null || land == null) return null;
  return `${district}${chome ?? ""}|${price}|${land}|${floor ?? "?"}`;
}
const chomeOf = (addr) => (zen(addr ?? "").match(/北区\D+([0-9]+)/) ?? [])[1] ?? null;
function unitFingerprint(u, districtOfFn) {
  return fingerprint(districtOfFn(u.address), chomeOf(u.address), u.price_man, u.land_m2, u.floor_m2);
}
// 「同一開発の別戸」候補の検出: 地区丁目が同じで、価格か面積のどちらかが一致するのに
// 指紋は一致しない掲載。重複と誤断して取りこぼす事故(2026-08-12)を防ぐため明示的に旗を立てる
export function siblingHint(u, districtOfFn, ledgerUnits) {
  const d = districtOfFn(u.address), c = chomeOf(u.address);
  if (!d) return null;
  for (const L of ledgerUnits) {
    if (L.district !== d || L.chome !== c) continue;
    const samePrice = L.price_man === u.price_man;
    const sameLand = L.land_m2 != null && u.land_m2 != null && Math.abs(L.land_m2 - u.land_m2) < 0.02;
    const sameFloor = L.floor_m2 != null && u.floor_m2 != null && Math.abs(L.floor_m2 - u.floor_m2) < 0.02;
    if (sameLand && sameFloor) continue;              // 完全一致は同一戸(別で除外済み)
    const ref = `台帳の ${L.id}(${L.price_man}万・土地${L.land_m2}・建物${L.floor_m2})`;
    // パターン別に確度を出し分ける。「価格一致・土地不一致」が2026-08-12に取りこぼした型
    if (samePrice && sameLand) {
      const d = (u.floor_m2 != null && L.floor_m2 != null) ? (u.floor_m2 - L.floor_m2).toFixed(2) : "?";
      return `[同一戸の疑い] ${ref}と価格・土地面積が一致し建物面積のみ差${d}m²。` +
        `媒体間の延床表記差(車庫の算入有無など)の可能性が高い。台帳の面積表記を見直す価値はあるが新規登録は不要な公算`;
    }
    if (samePrice && !sameLand) {
      return `[別戸の可能性・要判断] ${ref}と価格が一致するが土地面積が違う(${L.land_m2}→${u.land_m2})。` +
        `新築の複数戸掲載は一覧が開発の代表価格を出すため、価格一致は同一戸の根拠にならない。` +
        `重複と断定せず、掲載元の区画情報で戸を特定して登録要否を判断すること`;
    }
    if (sameLand && !samePrice) {
      return `[別戸または価格改定・要判断] ${ref}と土地面積が一致するが価格が違う(${L.price_man}→${u.price_man}万)。` +
        `同一開発で区画面積が同じ別戸のことがある(西が丘2のC号棟/D号棟が実例)。掲載元で戸を特定すること`;
    }
    if (sameFloor) {
      return `[別戸の可能性] ${ref}と建物面積が一致するが価格・土地面積が違う。同一プランの別区画の可能性`;
    }
  }
  return null;
}

async function discover(ledgerNcs, ledgerFps, ledgerUnits) {
  const seen = existsSync(SEEN_PATH) ? JSON.parse(readFileSync(SEEN_PATH, "utf8")) : {};
  const found = [];
  let exhausted = false;
  for (const src of LIST_SOURCES) {
    if (exhausted) break;
    for (let pn = 1; pn <= 8; pn++) {
      // ページ送り: SUUMOは ?page=N、athomeは /list/pageN/(どちらも誤URLは404にならず1ページ目が返るため厳密に)
      const url = pn === 1 ? src.base
        : src.media === "suumo" ? `${src.base}?page=${pn}` : `${src.base}page${pn}/`;
      // 一覧の走査はKO判定用の枠を残して打ち切る(判定不能の新着を出さないため)
      const { html, status, error, exhausted: ex } = await fetchPage(url, KO_DETAIL_MAX);
      // 予算切れは打ち切り(N2: 黙って減らさず errors[] に開示済み)。以降の媒体も走査しない
      if (ex) { exhausted = true; break; }
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
      chomeOf(v.address), v.price_man, v.land_m2 ?? null, v.floor_m2 ?? null)).filter(Boolean));
  // 除外済み現場の索引(ハザード等で見送った現場。業者を替えた別番号の再掲を止める)
  const excluded = existsSync(EXCLUDED_PATH) ? JSON.parse(readFileSync(EXCLUDED_PATH, "utf8")) : {};
  const exIndex = buildExcludedIndex(excluded);
  let koFetches = 0;
  const report = [];
  for (const u of matches) {
    const prev = seen[u.nc];
    const fp = unitFingerprint(u, districtOf);
    if (!prev) {
      if (fp && seenFps.has(fp)) continue;       // 別キーで既見(媒体違いの同一物件)
      const cand = { ...u, district: districtOf(u.address), chome: chomeOf(u.address) };
      // 段階1(取得ゼロ): 除外済み現場との諸元照合。ここで確定するものは詳細を取りに行かない
      const siteHit = matchExcludedSite(cand, exIndex);
      // 段階2: 生き残りだけ詳細ページを1回取得し、KO信号と査定入力の実値を機械抽出する
      let scan = null;
      if (siteHit?.level !== "exact" && koFetches < KO_DETAIL_MAX) {
        const d = await fetchPage(u.url);
        if (!d.exhausted && !d.error && d.status === 200) { koFetches++; scan = scanKO(d.html, u.media); }
        else errors.push({ where: `ko:${u.nc}`, detail: `詳細取得失敗 http=${d.status} ${d.error ?? ""}` });
      }
      const ko = koScreen({ unit: cand, siteHit, scan });
      // 徒歩分は詳細ページの値を正とする(一覧カードは隣接カードを巻き込んで誤抽出することがある)
      const walkDetail = ko.attrs?.walk_min ?? null;
      const walk = walkDetail ?? u.walk_min;
      const entry = { ...cand, walk_min: walk, walk_min_list: u.walk_min, ko,
        sibling_hint: siblingHint(u, districtOf, ledgerUnits) };
      seen[u.nc] = { first_seen: today, price_man: u.price_man, address: u.address, walk_min: walk,
        kind: u.kind, media: u.media, land_m2: ko.attrs?.land_m2 ?? u.land_m2, floor_m2: ko.attrs?.floor_m2 ?? u.floor_m2 };
      if (walkDetail != null && walkDetail > WALK_MAX) {
        // 一覧の徒歩分が過小で通過していた圏外物件。以後の再判定が要らないよう seen に記録して落とす
        seen[u.nc].out_of_scope = `徒歩${walkDetail}分(上限${WALK_MAX})`;
        report.push({ ...entry, event: "new_out_of_scope" });
      } else if (ko.verdict === "block") {
        seen[u.nc].ko_blocked = true; seen[u.nc].ko_codes = ko.codes;
        report.push({ ...entry, event: "new_ko_blocked" });
      } else if (ko.verdict === "suspect") {
        report.push({ ...entry, event: "new_ko_suspect" });
      } else {
        report.push({ ...entry, event: "new" });
      }
    } else if (prev.price_man !== u.price_man) {
      seen[u.nc].price_man = u.price_man;
      // KO済み・圏外と判定済みの掲載は値下げしても再提案しない(判断は現場属性で決まり価格で変わらない)
      if (prev.ko_blocked || prev.out_of_scope) continue;
      report.push({ ...u, district: districtOf(u.address), event: "price_changed", prev_price_man: prev.price_man, first_seen: prev.first_seen });
    }
  }
  mkdirSync(join(ROOT, "market", "crawl"), { recursive: true });
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 1) + "\n", "utf8");
  return { report, scanned: byNc.size, matched: matches.length };
}

// ---- main ----
// import された場合(テスト等)は実行しない。直接起動時のみクロールする
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
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
  return fingerprint(d, chome, ph.length ? ph[ph.length - 1].price_man : null, p.land?.registered_m2 ?? null, p.building?.floor_m2 ?? null);
}).filter(Boolean));
// 台帳物件の要約(別戸判定に使う)
const ledgerUnits = listPropertyIds().map((id) => {
  const p = loadProperty(id);
  const ph = [...(p.price_history ?? [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  return { id, district: DISTRICTS.find((x) => String(p.location?.address ?? "").startsWith("北区" + x)) ?? null,
    chome: (zen(p.location?.address ?? "").match(/北区\D+([0-9]+)/) ?? [])[1] ?? null,
    price_man: ph.length ? ph[ph.length - 1].price_man : null,
    land_m2: p.land?.registered_m2 ?? null, floor_m2: p.building?.floor_m2 ?? null };
}).filter((x) => x.district);
const out = { crawled_at: new Date().toISOString(), watch: [], discover: [], errors };
if (mode !== "--discover-only") out.watch = await watch();
if (mode !== "--watch-only") out.discover = (await discover(ledgerNcs, ledgerFps, ledgerUnits)).report;
out.summary = {
  price_changes: out.watch.filter((w) => w.status === "price_changed").length,
  delisted_suspects: out.watch.filter((w) => w.status === "delisted_suspect").length,
  // new_listings = KOスクリーニングを通過し「自動登録の対象になる」件数。
  // 落とした件数も黙って消さず開示する(ko_blocked / ko_suspects / out_of_scope)
  new_listings: out.discover.filter((d) => d.event === "new").length,
  ko_blocked: out.discover.filter((d) => d.event === "new_ko_blocked").length,
  ko_suspects: out.discover.filter((d) => d.event === "new_ko_suspect").length,
  out_of_scope: out.discover.filter((d) => d.event === "new_out_of_scope").length,
  sibling_suspects: out.discover.filter((d) => d.sibling_hint).length,
  discover_price_changes: out.discover.filter((d) => d.event === "price_changed").length,
  errors: errors.length, pages_fetched: fetchCount, page_budget: MAX_PAGES,
  budget_exhausted: fetchCount >= MAX_PAGES,
  watch_skipped: out.watch.filter((w) => w.status === "skipped_budget").length,
};
console.log(JSON.stringify(out, null, 1));
}
