// crawler/rent-daily.mjs — 戸建賃貸の日次クロール(観測と差分検出のみ。台帳YAMLは書き換えない)
// 使い方: node crawler/rent-daily.mjs [--watch-only|--discover-only]
// 出力: stdout に機械可読JSONレポート。rent-seen.json(market/crawl/)のみ本スクリプトが更新する。
//
// 購入版 daily.mjs との違い:
//   ① 賃貸は在庫の回転が速い。掲載終了(=申込が入った)の検出が値下げ検出より重要
//   ② 一覧カードからは契約種別(定期借家)が読めない。**KO判定には必ず詳細ページが要る**ため、
//      詳細取得の予算を購入版より厚く取る(北区の戸建賃貸は全部で70件程度しかなく現実的)
//   ③ ハザードは掲載条件から外した(2026-08-18ユーザー決定)。丁目ハザード遮断は掛けない
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, loadRental, listRentalIds } from "../engine/io.js";
import { parseRentDetail, rentKoScreen, rentScopeCheck, isRentOnlyScope, RENT_SCOPE, seismicOf } from "./rent-screen.mjs";
import { makeFetcher } from "./http.mjs";

// 1実行あたりの取得上限。watch(台帳件数)+一覧8頁+新着の詳細判定ぶん。
// 上限到達は例外にせず打ち切り、errors[]で開示する(購入版の2026-08-12監査と同じ理由:
// 例外だとレポート不出力のまま異常終了し、無人運用で沈黙する)
const MAX_PAGES = 60;
const KO_DETAIL_MAX = 24;      // 新着のKO判定に取り置く詳細取得の枠
const LIST_BASE = "https://suumo.jp/chintai/tokyo/sc_kita/ikkodate/";
const MAX_LIST_PAGES = 8;
const SEEN_PATH = join(ROOT, "market", "crawl", "rent-seen.json");
const EXCLUDED_PATH = join(ROOT, "market", "crawl", "rent-excluded.json");

const errors = [];
const { fetchPage, count: fetchedCount } = makeFetcher({ maxPages: MAX_PAGES, errors });

// 賃貸の掲載終了。SUUMOは掲載が切れると検索結果へ誘導するページを返す
// 掲載終了の判定。**「成約済」を入れてはいけない**——SUUMOの全ページ共通フッタに
// 「『成約済にもかかわらず掲載されている』…」という定型文があり、生きている掲載66/66に誤爆する
// (2026-08-19の監査で実測)。逆に、掲載終了は /library/ へ転送されて HTTP 200 を返すことがあり、
// その転送先は「過去の掲載情報を元に作成」を必ず含む(生きている掲載には出現しない)
export const RENT_DELISTED_RE = /掲載(?:を|が)?終了|募集(?:を|が)?終了|現在掲載されて(?:いま|おりま)せん|この物件は(?:現在)?(?:ご)?紹介できません|過去の掲載情報を元に作成/;

export function detailIdsFrom(html) {
  const ids = new Set();
  for (const m of String(html).matchAll(/href="\/chintai\/(jnc_\d+)\//g)) ids.add(m[1]);
  return [...ids];
}

// 台帳の契約条件と掲載の食い違い。null なら食い違いなし
export function contractConflict(terms, contract) {
  if (!terms || !contract) return null;
  if (terms.contract_type != null && contract.type != null && terms.contract_type !== contract.type) {
    return `契約種別 台帳=${terms.contract_type} / 掲載=${contract.type}`;
  }
  if (terms.contract_years != null && contract.years != null && terms.contract_years !== contract.years) {
    return `契約年数 台帳=${terms.contract_years}年 / 掲載=${contract.years}年`;
  }
  if (terms.contract_type === "teiki" && contract.type === "teiki" && contract.years == null) {
    return `掲載の契約期間が年数で読めなくなった(${contract.raw ?? "不明"})`;
  }
  return null;
}

// ---- watch: 台帳物件の更新チェック ----
async function watch() {
  const results = [];
  for (const id of listRentalIds()) {
    const p = loadRental(id);
    if (!p.source_url) { results.push({ id, status: "no_source_url" }); continue; }
    const hist = p.rent_history ?? [];
    const last = hist[hist.length - 1] ?? {};
    const { html, status, error, exhausted } = await fetchPage(p.source_url);
    if (exhausted) { results.push({ id, status: "skipped_budget" }); continue; }
    if (error || status !== 200) {
      if (status !== 404) errors.push({ where: `watch:${id}`, detail: `http=${status} ${error ?? ""}` });
      results.push({ id, status: status === 404 ? "delisted_suspect" : "fetch_error", http: status, error });
      continue;
    }
    const d = parseRentDetail(html);
    // 賃料が読めない=掲載構造が変わったか掲載終了。**前回値の複写は絶対にしない**
    if (d.rent_man == null) {
      // 詳細ページの構造でない(建物種別の欄が無い)なら掲載終了の転送先とみて良い
      if (RENT_DELISTED_RE.test(html) || !d.is_detail) { results.push({ id, status: "delisted_suspect", http: 200 }); continue; }
      errors.push({ where: `watch:${id}`, detail: "賃料抽出失敗(ページ構造変化の疑い)" });
      results.push({ id, status: "parse_error", http: 200 });
      continue;
    }
    const totalPrev = (last.rent_man ?? 0) + (last.kanri_man ?? 0);
    const changed = d.rent_man !== last.rent_man || (d.kanri_man ?? 0) !== (last.kanri_man ?? 0);
    // 契約期間が後から入ることがある(suspectだった物件が定期借家と判明する=KO)
    const ko = rentKoScreen(d);
    results.push({
      id, status: changed ? "rent_changed" : "unchanged",
      rent_man: d.rent_man, kanri_man: d.kanri_man, total_man: d.total_man,
      prev_rent_man: last.rent_man ?? null, prev_total_man: hist.length ? totalPrev : null,
      diff_man: hist.length ? d.total_man - totalPrev : null,
      contract: d.contract, ko_verdict: ko.verdict, ko_codes: ko.codes,
      // 台帳が持っている契約種別と掲載が食い違ったら人へ知らせる(KOの根拠が動く)
      // 種別だけでなく**年数の変化も検出する**。定期借家は3年ちょうどのみ許容なので、
      // teiki のまま3年→2年に直されるとKOの根拠が動くのに種別比較では気づけない(2026-08-19の監査指摘)
      contract_conflict: contractConflict(p.terms, d.contract),
      url: p.source_url,
    });
  }
  return results;
}

// 一覧から消えた掲載を検出する純関数。listComplete=false のときは何も返さない
export function detectGone(seen, listedToday, today, { listComplete = true } = {}) {
  if (!listComplete) return [];
  const out = [];
  for (const [id, v] of Object.entries(seen)) {
    if (v.settled || listedToday.has(id) || v.gone_since) continue;
    if (v.last_seen && v.last_seen !== today) {
      v.gone_since = today;
      out.push({ id, event: "gone_from_list", last_seen: v.last_seen, rent_man: v.rent_man, address: v.address });
    }
  }
  return out;
}

// ---- discover: 新着探索 ----
async function discover(ledgerIds) {
  const seen = existsSync(SEEN_PATH) ? JSON.parse(readFileSync(SEEN_PATH, "utf8")) : {};
  const excluded = existsSync(EXCLUDED_PATH) ? JSON.parse(readFileSync(EXCLUDED_PATH, "utf8")) : {};
  const today = new Date().toISOString().slice(0, 10);
  const found = [];
  let listComplete = true;
  for (let pn = 1; pn <= MAX_LIST_PAGES; pn++) {
    const url = pn === 1 ? LIST_BASE : `${LIST_BASE}?page=${pn}`;
    const { html, status, error, exhausted } = await fetchPage(url, KO_DETAIL_MAX);
    if (exhausted) { listComplete = false; errors.push({ where: `discover:page${pn}`, detail: "取得予算切れで一覧を最後まで見ていない" }); break; }
    if (error || status !== 200) { listComplete = false; errors.push({ where: `discover:page${pn}`, detail: `http=${status} ${error ?? ""}` }); break; }
    const ids = detailIdsFrom(html);
    if (!ids.length) break;
    found.push(...ids);
    if (!html.includes(`?page=${pn + 1}`)) break;
    if (pn === MAX_LIST_PAGES) { listComplete = false; errors.push({ where: "discover", detail: `一覧が上限${MAX_LIST_PAGES}頁に達したが次ページが残っている` }); }
  }
  // **今日の一覧に載っていたIDの集合**。台帳・除外による絞り込みを掛ける前の生の集合を使う。
  // 絞り込み後の集合で「消えた」を判定していたため、台帳へ登録した物件が翌日から毎回
  // 「掲載が消えた」と誤報されていた(2026-08-19の監査で再現確認)
  const listedToday = new Set(found);
  const uniq = [...listedToday].filter((id) => !ledgerIds.has(id) && !excluded[id]);
  const report = [];
  let detailFetches = 0;
  for (const id of uniq) {
    if (seen[id]?.settled) continue;      // 既に KO / 圏外と確定済み(掲載が変わらない限り再判定しない)
    if (detailFetches >= KO_DETAIL_MAX) {
      // 判定できなかったぶんを黙って消さない。翌日の実行で再判定される
      report.push({ id, event: "new_undecided", reason: `詳細取得の予算${KO_DETAIL_MAX}件に達し未判定` });
      continue;
    }
    const d0 = await fetchPage(`https://suumo.jp/chintai/${id}/`);
    if (d0.exhausted || d0.error || d0.status !== 200) {
      errors.push({ where: `ko:${id}`, detail: `詳細取得失敗 http=${d0.status} ${d0.error ?? ""}` });
      report.push({ id, event: "new_undecided", reason: `詳細取得失敗 http=${d0.status}` });
      continue;
    }
    detailFetches++;
    const d = parseRentDetail(d0.html);
    const ko = rentKoScreen(d);
    const scope = rentScopeCheck(d);
    const entry = {
      id, event: null, url: `https://suumo.jp/chintai/${id}/`,
      address: d.address, district: d.district, chome: d.chome,
      rent_man: d.rent_man, kanri_man: d.kanri_man, total_man: d.total_man,
      layout: d.layout, rooms: d.rooms, area_m2: d.area_m2,
      built: d.built_raw, seismic: seismicOf(d.built_year, d.built_month).level,
      walk_min: d.walk_min, walks: d.walks, structure: d.structure,
      contract: d.contract, toilet2: d.toilet2, parking: d.parking,
      shiki_months: d.shiki_months, rei_months: d.rei_months,
      ko_codes: ko.codes, ko_notes: ko.notes,
    };
    const prev = seen[id];
    seen[id] = { first_seen: prev?.first_seen ?? today, last_seen: today,
      rent_man: d.rent_man, kanri_man: d.kanri_man, address: d.address, walk_min: d.walk_min };
    if (scope) {
      // 賃料の**上限超え**だけが理由なら値下げで条件内へ戻りうるので恒久除外にしない。
      // 恒久条件(徒歩・居室数・LDK・新耐震)や下限割れは settled にしてよい
      // (rentScopeCheck は恒久条件を先に返すので、ここに来る賃料理由は他の条件を通っている)
      const permanent = !isRentOnlyScope(scope);
      if (permanent) { seen[id].settled = true; }
      seen[id].out_of_scope = scope; seen[id].settled_by = permanent ? "permanent" : "rent_max";
      report.push({ ...entry, event: "new_out_of_scope", out_of_scope: scope, recheck_on_price_drop: !permanent });
    } else if (ko.verdict === "block") {
      seen[id].settled = true; seen[id].ko_codes = ko.codes;
      report.push({ ...entry, event: "new_ko_blocked" });
    } else if (ko.verdict === "suspect") {
      report.push({ ...entry, event: "new_ko_suspect" });   // settled にしない(掲載が補われる可能性)
    } else if (prev && (prev.rent_man !== d.rent_man || (prev.kanri_man ?? 0) !== (d.kanri_man ?? 0))) {
      report.push({ ...entry, event: "rent_changed", prev_rent_man: prev.rent_man });
    } else if (!prev) {
      report.push({ ...entry, event: "new" });
    }
  }
  // 消えた掲載(前回見えていたのに今回の一覧に無い)= 申込が入った可能性。賃貸ではこれが主要な変化。
  // **一覧を最後まで走査できなかった回は判定しない**——部分集合で判定すると未走査ページの掲載が
  // 全部「消えた」と報告され、gone_since は一度立つと解除されないので偽陽性が焼き付く
  report.push(...detectGone(seen, listedToday, today, { listComplete }));
  mkdirSync(join(ROOT, "market", "crawl"), { recursive: true });
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 1) + "\n", "utf8");
  return { report, scanned: found.length, unique: uniq.length, detailFetches };
}

// ---- main ----
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mode = process.argv[2] ?? "";
  const ledgerIds = new Set(listRentalIds().flatMap((id) => {
    const p = loadRental(id);
    return [String(p.source_url ?? "").match(/jnc_\d+/)?.[0], ...(p.duplicate_of ?? [])].filter(Boolean);
  }));
  const out = { crawled_at: new Date().toISOString(), scope: RENT_SCOPE, watch: [], discover: [], errors };
  if (mode !== "--discover-only") out.watch = await watch();
  let disc = null;
  if (mode !== "--watch-only") { disc = await discover(ledgerIds); out.discover = disc.report; }
  const ev = (e) => out.discover.filter((d) => d.event === e).length;
  out.summary = {
    rent_changes: out.watch.filter((w) => w.status === "rent_changed").length,
    delisted_suspects: out.watch.filter((w) => w.status === "delisted_suspect").length,
    contract_conflicts: out.watch.filter((w) => w.contract_conflict).length,
    // 台帳物件がKOへ転じたら最優先で人へ報告する(定期借家の年数変更などで起きる)
    watch_ko_blocked: out.watch.filter((w) => w.ko_verdict === "block").length,
    new_listings: ev("new"),
    ko_blocked: ev("new_ko_blocked"),
    ko_suspects: ev("new_ko_suspect"),
    out_of_scope: ev("new_out_of_scope"),
    undecided: ev("new_undecided"),
    gone_from_list: ev("gone_from_list"),
    discover_rent_changes: ev("rent_changed"),
    errors: errors.length, pages_fetched: fetchedCount(), page_budget: MAX_PAGES,
    budget_exhausted: fetchedCount() >= MAX_PAGES,
    watch_skipped: out.watch.filter((w) => w.status === "skipped_budget").length,
    scanned: disc?.unique ?? null,
  };
  console.log(JSON.stringify(out, null, 1));
}
