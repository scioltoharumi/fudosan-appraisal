// crawler/daily.mjs — 日次クロール(観測と差分検出のみ。台帳YAMLは書き換えない)
// 仕様: docs/requirements-daily-crawl.md / 運用手順: .claude/skills/daily-crawl
// 使い方: node crawler/daily.mjs [--watch-only|--discover-only]
// 出力: stdout に機械可読JSONレポート。seen.json(market/crawl/)のみ本スクリプトが更新する。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, loadProperty, listPropertyIds } from "../engine/io.js";
import { buildExcludedIndex, matchExcludedSite, scanKO, koScreen, buildAreaHazardIndex, areaHazardBlock } from "./screen.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SLEEP_MS = 2200;              // N1: リクエスト間隔2秒以上
// N1: 1実行あたりの取得上限。watch(台帳件数ぶん)を先に消費し、残りがdiscoverの探索予算になる。
// 到達しても例外にせず打ち切る(2026-08-12監査: 例外だとレポート不出力のまま異常終了し無人運用で沈黙した)。
// 現在の最大需要は watch 17 + discover 32(4媒体×8頁) + KO詳細 8 = 57
const MAX_PAGES = 72 + Math.max(0, Number(process.env.KO_DETAIL_MAX ?? 8) - 8);
// 新着のKO判定に使う詳細ページ取得の上限。一覧の走査に予算を食われてKO判定が
// 「詳細未取得」で終わらないよう、この枠を先に取り置く(discover側が reserve として尊重する)
// 平時は8。**未審査の積み残しを一気に消化する棚卸しのときだけ** 環境変数で引き上げる
// (例: KO_DETAIL_MAX=40 node crawler/daily.mjs --discover-only)。
// 相手サイトへの間隔2.2秒は crawler/http.mjs 側で常に効くので、上げるのは件数だけ
const KO_DETAIL_MAX = Number(process.env.KO_DETAIL_MAX ?? 8);
const EXCLUDED_PATH = join(ROOT, "market", "crawl", "excluded.json");
const AREA_SCAN_PATH = join(ROOT, "market", "area-scan.json");
const PRICE_RANGE = [5000, 9000];   // discover対象(万円)
const WALK_MAX = 20;                // discover徒歩上限(分)
const FLOOR_MIN_M2 = 70;            // 掲載条件「延床70m2超」(CLAUDE.md)。これ以下は自動登録候補から外す
// ---- 土地(分譲地)の探索(2026-08-29ユーザー決定「土地カテゴリは当然ここも考慮したいので入れたい」)----
// 岸町2-4-9(建築条件なし土地)が土地カテゴリ非巡回のせいで機械探索に一度も乗らなかったことを受けて追加。
// 建物条件(延床70m2超・3室以上)は土地に適用できないため、土地側の圏外条件は次の2つ:
//   価格 2,500〜7,500万(総予算9,000万 − ローコスト建築1,500万〜 の逆算。上下限はClaudeの置いた既定で要調整)
//   土地 45m2以上(実効容積160%=前面4m×0.4 なら延床72m2 ≒「延床70m2超」の土地への翻訳)
// KO1(再建築不可)/KO2(所有権以外)/KO6(通行料)/丁目ハザード遮断は戸建と同じ網を通す
const TOCHI_PRICE_RANGE = [2500, 7500];
const TOCHI_LAND_MIN_M2 = 45;
const ROOMS_MIN = 3;                // 掲載条件「3室以上」。2LDK=2室 / 2LDK+S=3室 / 4LDK=4室
// 掲載条件の圏外判定。新着と、値下げ時の再判定の**両方**から呼ぶ
// (2026-08-25: 再判定側に入れ忘れており、延床65.72m2の滝野川1が候補として上がった)
export function scopeMissOf(attrs, walkDetail, kind = null, priceMan = null) {
  if (walkDetail != null && walkDetail > WALK_MAX) return `徒歩${walkDetail}分(上限${WALK_MAX})`;
  if (kind === "tochi") {
    // 土地に建物条件は適用できない。面積が読めない掲載は判定しない(数えられないものは落とさない規律)
    const land = attrs?.land_m2 ?? null;
    if (land != null && land < TOCHI_LAND_MIN_M2) return `土地${land}m2(土地の条件は${TOCHI_LAND_MIN_M2}m2以上)`;
    // 建築条件付土地(2026-09-01ユーザー決定で対象に含めた)は、**掲載価格が土地だけ**で
    // 建物が別建てになる。総額で見ないと予算帯を大きく超える物件が通る:
    // 滝野川4 nc_21551661 は土地7,798万+建物3,300万=**1億1,098万**なのに「7,798万」として通っていた。
    // 総額は戸建と同じ帯(PRICE_RANGE)で判定する——土地+建物の合計は戸建の総額と同じ意味だから。
    // 建物価格が読めない掲載(参考プランの無い純粋な土地)は**判定しない**(従来どおり土地価格だけで通す)
    const bldg = attrs?.building_price_man ?? null;
    if (priceMan != null && bldg != null) {
      const total = priceMan + bldg;
      if (total < PRICE_RANGE[0] || total > PRICE_RANGE[1]) {
        return `土地建物総額${total}万(土地${priceMan}+建物${bldg}。総額の条件は${PRICE_RANGE[0]}〜${PRICE_RANGE[1]}万)`;
      }
    }
    return null;
  }
  const floor = attrs?.floor_m2 ?? null;
  const rooms = roomsOf(attrs?.layout);
  if (floor != null && floor <= FLOOR_MIN_M2) return `延床${floor}m2(条件は${FLOOR_MIN_M2}m2超)`;
  if (rooms != null && rooms < ROOMS_MIN) return `${attrs.layout}=${rooms}室(条件は${ROOMS_MIN}室以上)`;
  return null;
}

// 間取り文字列から居室数を数える。「2LDK+2S(納戸)」=4室、「2LDK+S」=3室、「4LDK」=4室。
// 数えられない表記(「1DKK+」のような媒体側の崩れ)は null を返し、条件判定を行わない(誤って落とさない)
export function roomsOf(layout) {
  const t = zen(String(layout ?? "")).replace(/＋/g, "+");   // ＋(U+FF0B)は zen の変換対象外
  const m = t.match(/^([0-9]{1,2})\s*[SLDKR]/);
  if (!m) return null;
  let n = Number(m[1]);
  for (const s of t.slice(m[0].length - 1).matchAll(/\+\s*([0-9]{1,2})?\s*S/g)) n += s[1] ? Number(s[1]) : 1;
  return n;
}
// 探索対象の地区。2026-08-13にユーザー決定で王子・上中里方面へ拡張(docs/area-expansion-2026-08.md)。
// 追加分は「京浜東北線(赤羽・東十条・王子・上中里)徒歩10分前後 かつ 台地側」で選んだ6地区。
// 低地の地区(志茂・神谷・岩淵町・赤羽南など)が残っているのは、値下げ追跡と相場観測の母集団としては
// 使うため。**登録可否は丁目単位のハザード判定(screen.mjs の areaHazardBlock)で別途止める**
export const DISTRICTS = ["上十条", "中十条", "十条仲原", "岩淵町", "志茂", "神谷", "西が丘", "赤羽", "赤羽北", "赤羽南", "赤羽台", "赤羽西",
  "王子本町", "岸町", "滝野川", "西ケ原", "中里", "上中里"];
// 住所→地区名。**長い名前を優先**して照合する。DISTRICTS は "赤羽" が "赤羽北"/"赤羽西" より
// 前にあるため、素朴な find だと「赤羽北2」が "赤羽" に当たって丁目ハザードを「赤羽2」として引く。
// 2026-08-28に実害を確認: 赤羽北2(浸水5〜10m)が赤羽2(3〜5m)として報告された。より深刻なのは
// **赤羽西1〜3が赤羽1〜3として誤ってブロックされる**こと(台帳の中核地区なのに候補を取りこぼす)
const DISTRICTS_BY_LEN = [...DISTRICTS].sort((a, b) => b.length - a.length);
export function districtOfAddress(addr, prefix = "東京都北区") {
  const t = zen(String(addr ?? ""));
  return DISTRICTS_BY_LEN.find((d) => t.startsWith(prefix + d)) ?? null;
}

// 媒体横断の同一物件は指紋(地区丁目|価格|土地面積)で名寄せする。先頭の媒体を優先採用
// するため、SUUMO(watch対象と同じ媒体・物件番号で台帳と直結)を先に置く
const LIST_SOURCES = [
  { media: "suumo", kind: "chuko", base: "https://suumo.jp/chukoikkodate/tokyo/sc_kita/" },
  { media: "suumo", kind: "shinchiku", base: "https://suumo.jp/ikkodate/tokyo/sc_kita/" },
  // 土地は当面SUUMOのみ(athomeはボット保護で取得経路なし=賃貸と同じ限界)
  { media: "suumo", kind: "tochi", base: "https://suumo.jp/tochi/tokyo/sc_kita/" },
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
// 戸が特定できない場合は null を返し、呼び出し側でエラーとして開示する。
//
// 2026-08-29追加(salesUnitsOf): **構造化データが不完全な複数戸掲載**がある。
// 滝野川3 nc_21133135 は madoriList が1件ぶんしか無く(tochiMensekiDisp が1つだけ)、
// 号棟別の価格は写真キャプションにしか載っていない。この形だと units.length<2 で
// 「単独掲載」と誤認し、ページ代表価格=**最安戸の価格**をその戸の価格として拾ってしまう。
// 実害: 台帳のA号棟6,380万に対しB号棟6,180万を拾い、**毎日「-200万の値下げ」と誤報**していた。
// 掲載の「販売戸数」欄は構造化データが壊れていても読めるので、これで複数戸を検出して
// 既存の unit_unresolved ガードへ落とす(誤検出を価格変動と誤認しない、の原則どおり)。
export function salesUnitsOf(html) {
  const t = strip(html);
  for (const re of [/販売戸数[^0-9]{0,8}([0-9]+)\s*戸/, /総戸数[^0-9]{0,8}([0-9]+)\s*戸/]) {
    const m = t.match(re);
    if (m) return Number(m[1]);
  }
  return null;   // 記載なし=判定しない
}

function parseUnitPriceSuumo(html, landM2, floorM2) {
  const units = [...html.matchAll(/title\s*:\s*"([^"]{1,20}号棟[^"]{0,10})"[\s\S]{0,300}?kakakuDisp\s*:\s*"(\d+)"[\s\S]{0,400}?tochiMensekiDisp\s*:\s*"([\d.]+)"[\s\S]{0,200}?tatemonoMensekiDisp\s*:\s*"([\d.]+)"/g)]
    .map((m) => ({ title: m[1], man: Math.round(Number(m[2]) / 10000), land: Number(m[3]), floor: Number(m[4]) }));
  if (units.length < 2) {
    // 構造化データからは戸を並べられなかった。掲載欄が複数戸だと言っているなら代表価格を使わない
    const sold = salesUnitsOf(html);
    if (sold !== null && sold >= 2) {
      return { multi: true, price: null, units, salesUnits: sold, structuredBroken: true };
    }
    return { multi: false };
  }
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
        errors.push({ where: `watch:${id}`, detail: unitInfo.structuredBroken
          ? `複数戸掲載(掲載の販売戸数${unitInfo.salesUnits}戸)だが号棟別の構造化データが不完全で戸を特定できず。`
            + `ページ代表価格は最安戸の価格なので採用しない(台帳: 土地${p.land?.registered_m2}/建物${p.building?.floor_m2})。`
            + `価格の確認は掲載元の号棟別表記を人が見ること`
          : `複数戸掲載(${unitInfo.units.length}戸)で該当戸を面積特定できず。掲載の戸: `
            + unitInfo.units.map((u) => `${u.title} ${u.man}万/${u.land}/${u.floor}`).join(" | ")
            + ` (台帳: 土地${p.land?.registered_m2}/建物${p.building?.floor_m2})` });
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

// 既見の掲載を再審査すべきか。**価格が動いたときだけ**見ていると、初見時に詳細取得の予算
// (KO_DETAIL_MAX)が尽きて verdict=unknown になった掲載が、価格が動かない限り永久に再審査されない。
// 2026-08-29に実害を確認: 岸町2 nc_21485594(7,180万・新築)が2026-08-13の初見から16日間、
// 一度も報告されないまま埋もれていた(ユーザーが店舗でチラシを受け取って初めて発覚)。
// seen.json 全113件のうち82件が同じ「印が1つも無い=一度も詳細まで審査していない」状態だった。
// 判定済み(ko_blocked / out_of_scope / ko_screened)のものは価格が動いたときだけ見れば足りる。
// 「審査済み」の印を立ててよい判定か。**unknown(詳細未取得)に印を立てると、その掲載は
// 二度と再審査されない**——2026-08-13の取りこぼしと同じ穴で、2026-08-29の土地カテゴリ初回クロールで
// 再発を確認した(NO_DETAILの24件に ko_screened が付いていた)。pass/suspectだけが審査済み
export function isScreenedVerdict(v) { return v === "pass" || v === "suspect"; }

export function needsRescreen(prev, priceMan) {
  if (!prev) return false;                                    // 新着は呼び出し側の別経路
  if (prev.ko_blocked || prev.out_of_scope) return false;     // 判定済み。現場属性は価格で覆らない
  if (!prev.ko_screened) return true;                         // 未審査 → 価格が同じでも審査する
  return prev.price_man !== priceMan;
}

// ---- crawl_ids で台帳物件と紐付いた掲載の価格変動(2026-08-30) ----
// source_url を意図的に空にしている物件は watch の監視外になる(実例: 岸町2-4-9 MIRASUMO=掲載が
// 土地単体5,810万で台帳の総額7,480万と恒常的に食い違い、source_url に置くと毎日誤報するため空)。
// 一方 discover は台帳紐付きIDを matches から除外するので、価格が動いても誰にも届かない
// (seen が静かに更新されるだけ)。この穴を、一覧の価格を突き合わせる小さな報告で塞ぐ。
// 判定済み(ko_blocked)でも報告する——判定は現場属性で決まるが、価格の動きは
// 指値・交渉のタイミング判断の材料になる。seen を更新するので同じ変動は一度しか報告されない
export function ledgerLinkedPriceEvents(units, seen, crawlIdIndex, today) {
  const events = [];
  for (const u of units) {
    const pid = crawlIdIndex.get(u.nc);
    if (!pid) continue;
    const prev = seen[u.nc];
    if (!prev) {   // 初見なら基準値を記録するだけ(基準が無いので変動は報告できない)
      seen[u.nc] = { first_seen: today, price_man: u.price_man, address: u.address, kind: u.kind, media: u.media };
      continue;
    }
    if (u.price_man == null || prev.price_man === u.price_man) continue;
    events.push({ event: "ledger_linked_price_changed", nc: u.nc, property_id: pid,
      address: u.address, kind: u.kind, media: u.media,
      prev_price_man: prev.price_man, price_man: u.price_man });
    prev.price_man = u.price_man;
  }
  return events;
}

// ---- discover: 新着探索(12地区・5000〜9000万・徒歩20分以内) ----
function parseSuumoUnits(html, kind) {
  const units = [];
  const parts = html.split(/property_unit-title/).slice(1);
  for (const part of parts) {
    const link = part.match(/href="(\/(?:chukoikkodate|ikkodate|tochi)\/[^"]*?(nc_[0-9]+)\/)"/);
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

async function discover(ledgerNcs, ledgerFps, ledgerUnits, ledgerCrawlIdIndex = new Map()) {
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
  const districtOf = (addr) => districtOfAddress(addr);
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
  const rangeOf = (u) => (u.kind === "tochi" ? TOCHI_PRICE_RANGE : PRICE_RANGE);
  const matches = [...byNc.values()].filter((u) =>
    u.price_man !== null && u.price_man >= rangeOf(u)[0] && u.price_man <= rangeOf(u)[1] &&
    districtOf(u.address) !== null &&
    u.walk_min !== null && u.walk_min <= WALK_MAX &&
    !ledgerNcs.has(u.nc) &&
    !(unitFingerprint(u, districtOf) && ledgerFps.has(unitFingerprint(u, districtOf))));   // 台帳物件の他媒体掲載
  const today = new Date().toISOString().slice(0, 10);
  // 既見物件の媒体横断照合用: seen済みエントリの指紋(媒体が違ってもキーが違っても同一物件を再報告しない)
  const seenFps = new Set(Object.entries(seen).map(([k, v]) =>
    fingerprint(districtOfAddress(v.address),
      chomeOf(v.address), v.price_man, v.land_m2 ?? null, v.floor_m2 ?? null)).filter(Boolean));
  // 除外済み現場の索引(ハザード等で見送った現場。業者を替えた別番号の再掲を止める)
  const excluded = existsSync(EXCLUDED_PATH) ? JSON.parse(readFileSync(EXCLUDED_PATH, "utf8")) : {};
  const exIndex = buildExcludedIndex(excluded);
  // 丁目単位のハザード索引。町名が同じでも丁目で台地/低地が分かれる地区(上中里・岸町・王子本町等)を
  // 掲載欄の記載に依らず止める。ファイルが無ければ索引は空になり、従来どおりの判定に戻る
  const areaIndex = buildAreaHazardIndex(existsSync(AREA_SCAN_PATH) ? JSON.parse(readFileSync(AREA_SCAN_PATH, "utf8")) : null);
  let koFetches = 0;
  let backlogPending = 0;   // 未審査のまま今回も予算に届かなかった件数(黙って減らさないため返す)
  const report = [];
  // crawl_ids 紐付き掲載の価格変動(watch監視外の受け皿。matches からは除外されているので byNc 全体を見る)
  report.push(...ledgerLinkedPriceEvents([...byNc.values()], seen, ledgerCrawlIdIndex, today));
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
      const ko = koScreen({ unit: cand, siteHit, scan, areaHazard: areaHazardBlock(cand, areaIndex) });
      // 徒歩分は詳細ページの値を正とする(一覧カードは隣接カードを巻き込んで誤抽出することがある)
      const walkDetail = ko.attrs?.walk_min ?? null;
      const walk = walkDetail ?? u.walk_min;
      const entry = { ...cand, walk_min: walk, walk_min_list: u.walk_min, ko,
        sibling_hint: siblingHint(u, districtOf, ledgerUnits) };
      seen[u.nc] = { first_seen: today, price_man: u.price_man, address: u.address, walk_min: walk,
        kind: u.kind, media: u.media, land_m2: ko.attrs?.land_m2 ?? u.land_m2, floor_m2: ko.attrs?.floor_m2 ?? u.floor_m2 };
      // 掲載条件(CLAUDE.md「登録条件」)のうち掲載から機械判定できるもの。KOではなく「圏外」扱いにして、
      // 報告には出しつつ自動登録の候補から外す。2026-08-13: 滝野川1の2件(延床65.24/65.72)が
      // verdict=pass のまま自動登録候補に上がり、人が延床70m2超の条件で弾く必要があった
      const scopeMiss = scopeMissOf(ko.attrs, walkDetail, u.kind, u.price_man ?? null);
      if (scopeMiss) {
        // 以後の再判定が要らないよう seen に記録して落とす(諸元は掲載が変わらない限り動かない)
        seen[u.nc].out_of_scope = scopeMiss;
        report.push({ ...entry, event: "new_out_of_scope", out_of_scope: scopeMiss });
      } else if (ko.verdict === "block") {
        seen[u.nc].ko_blocked = true; seen[u.nc].ko_codes = ko.codes;
        report.push({ ...entry, event: "new_ko_blocked" });
      } else if (ko.verdict === "suspect") {
        // 詳細まで取って「人へ回す」と判定済み。印を付けないと needsRescreen が毎回取りに行くため、
        // 審査済みの印とコードを残す(人はレポートの new_ko_suspect を見て判断する)
        seen[u.nc].ko_screened = true; seen[u.nc].ko_suspect = ko.codes;
        report.push({ ...entry, event: "new_ko_suspect" });
      } else {
        // 新着として詳細まで審査を通した掲載は、以後の値下げで再取得しない。
        // **詳細未取得(unknown)には印を立てない**——立てると needsRescreen が二度と拾わない
        if (isScreenedVerdict(ko.verdict)) seen[u.nc].ko_screened = true;
        report.push({ ...entry, event: "new" });
      }
    } else if (needsRescreen(prev, u.price_man)) {
      // 価格が動いた再判定と、未審査のまま溜まっていた掲載の初回審査を、同じ経路で処理する。
      // 後者は first_seen が古いだけで中身は新着と同じなので、レポートの event も new 系に揃える
      // **旧価格は代入の前に退避する**(2026-08-31修正)。`prev` は seen[u.nc] への参照なので、
      // 先に seen[u.nc].price_man を書き換えると prev.price_man も同時に変わり、
      // このブロックの全レポートが `prev_price_man` に**新価格を入れて**しまう。
      // 実害: 赤羽台3 nc_21580542 の 4,280万→5,280万(+1,000万)が「5280→5280」と報告され、
      // 変化なしにしか見えなかった(2026-08-31の日次クロールで発覚)
      const prevPriceMan = prev.price_man ?? null;
      const priceMoved = prevPriceMan !== u.price_man;
      seen[u.nc].price_man = u.price_man;
      // 諸元は後から使うので毎回埋め直す(KOスクリーニング導入前の既見エントリは持っていない)
      if (u.land_m2 != null) seen[u.nc].land_m2 = u.land_m2;
      if (u.floor_m2 != null) seen[u.nc].floor_m2 = u.floor_m2;
      // KO済み・圏外と判定済みの掲載は値下げしても再提案しない(判断は現場属性で決まり価格で変わらない)
      if (prev.ko_blocked || prev.out_of_scope) continue;
      // 2026-08-21: KOスクリーニング導入前に初見だった掲載は ko 印も諸元も持たないため、
      // 値下げのたびに除外済み現場が再提案されていた(西が丘2のレッドゾーン1号棟が nc_20593134 として再出現)。
      // 新着と同じ現場照合をここでも掛ける。取得ゼロで済む(一覧から取れた諸元だけで判定できる)
      const cand = { ...u, district: districtOf(u.address), chome: chomeOf(u.address) };
      const hit = matchExcludedSite(cand, exIndex);
      // 丁目単位のハザードも同時に見る。除外台帳(個別の現場)と丁目判定(面)は別の網なので、
      // 片方だけ掛けると素通りする(2026-08-22: 志茂2の値下げが候補として上がった)
      const area = areaHazardBlock(cand, areaIndex);
      const blocked = hit?.level === "exact" ? { code: hit.hazard ? "KO4_hazard" : "KO_excluded",
          reason: `除外済み現場と諸元一致(${hit.ref}${hit.unit ? " " + hit.unit : ""}・照合=${hit.by})。${hit.reason}` }
        : area?.level === "block" ? { code: "KO4_area_hazard",
            reason: `${cand.district}${cand.chome ?? ""}丁目は公式マップ照合で掲載条件外(${area.notes.join(" / ")})` }
        : null;
      if (blocked) {
        seen[u.nc].ko_blocked = true;
        seen[u.nc].ko_codes = [blocked.code];
        report.push({ ...cand, event: "ko_blocked_on_recheck", prev_price_man: prevPriceMan, first_seen: prev.first_seen,
          ko: { verdict: "block", codes: seen[u.nc].ko_codes, site_match: hit ?? null, reasons: [blocked.reason] } });
        continue;
      }
      // 一度もKO判定を通っていない既見掲載(導入前の初見)は、ここで詳細まで審査する。
      // 2026-08-22: 中里3の値下げ2件が候補として上がったが、実際は土地が旧法賃借権(KO2)で
      // 宅地造成工事規制区域(KO4)だった。面の判定(丁目)と点の判定(除外台帳)だけでは掲載固有のKOを見逃す。
      // 一度通れば ko_screened を立てて以後は取りに行かない(値下げのたびに取得しない)
      if (!prev.ko_screened && koFetches < KO_DETAIL_MAX) {
        const d = await fetchPage(u.url);
        if (!d.exhausted && !d.error && d.status === 200) {
          koFetches++;
          const ko = koScreen({ unit: cand, siteHit: hit, scan: scanKO(d.html, u.media), areaHazard: area });
          if (ko.verdict === "block") {
            seen[u.nc].ko_blocked = true; seen[u.nc].ko_codes = ko.codes;
            report.push({ ...cand, event: "ko_blocked_on_recheck", prev_price_man: prevPriceMan, first_seen: prev.first_seen, ko });
            continue;
          }
          // KOを通っても掲載条件(延床70m2超・3室以上・徒歩20分以内)を外れていれば候補にしない
          const miss = scopeMissOf(ko.attrs, ko.attrs?.walk_min ?? null, u.kind, u.price_man ?? null);
          if (miss) {
            seen[u.nc].out_of_scope = miss;
            report.push({ ...cand, event: "out_of_scope_on_recheck", out_of_scope: miss,
              prev_price_man: prevPriceMan, first_seen: prev.first_seen, ko });
            continue;
          }
          seen[u.nc].ko_screened = true;
          if (ko.verdict === "suspect") seen[u.nc].ko_suspect = ko.codes;
          const ev = priceMoved ? "price_changed" : (ko.verdict === "suspect" ? "new_ko_suspect" : "new");
          report.push({ ...cand, event: ev, backlog: !priceMoved,
            prev_price_man: prevPriceMan, first_seen: prev.first_seen, ko });
          continue;
        }
        errors.push({ where: `ko-recheck:${u.nc}`, detail: `詳細取得失敗 http=${d.status} ${d.error ?? ""}` });
      }
      // 予算切れ等で審査できなかった未審査分は **price_changed を騙らない**。
      // 次回以降も needsRescreen が拾うので、件数だけ返して黙って持ち越す
      if (!priceMoved) { backlogPending++; continue; }
      report.push({ ...u, district: districtOf(u.address), event: "price_changed", prev_price_man: prevPriceMan, first_seen: prev.first_seen });
    }
  }
  mkdirSync(join(ROOT, "market", "crawl"), { recursive: true });
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 1) + "\n", "utf8");
  return { report, scanned: byNc.size, matched: matches.length, backlog_pending: backlogPending };
}

// ---- main ----
// import された場合(テスト等)は実行しない。直接起動時のみクロールする
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
const mode = process.argv[2] ?? "";
const ledgerNcs = new Set(listPropertyIds().flatMap((id) => {
  const p = loadProperty(id);
  const u = p.source_url ?? "";
  const at = u.match(/athome\.co\.jp\/kodate\/([0-9]+)/)?.[1];
  // crawl_ids: source_url に置けない掲載ID(例: 土地物件で価格の正本が「土地+参考建物」の合成のため、
  // 土地単体価格の掲載を source_url にすると watch が毎日誤って値下げ報告する)。discover の重複報告だけ止める
  return [u.match(/nc_[0-9]+/)?.[0], at ? "at_" + at : null, ...(p.crawl_ids ?? [])].filter(Boolean);
}));
// crawl_ids だけの索引(掲載ID→物件ID)。source_url に置けない掲載は watch が見ないため、
// discover 側で価格変動を報告する(ledgerLinkedPriceEvents)。現状は岸町2-4-9 の nc_21089174 のみ
const ledgerCrawlIdIndex = new Map(listPropertyIds().flatMap((id) =>
  (loadProperty(id).crawl_ids ?? []).map((nc) => [nc, id])));
// 台帳物件の指紋(他媒体の同一掲載を新着扱いしないため)
const ledgerFps = new Set(listPropertyIds().map((id) => {
  const p = loadProperty(id);
  const ph = [...(p.price_history ?? [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  const d = districtOfAddress(p.location?.address, "北区");
  const chome = (zen(p.location?.address ?? "").match(/北区\D+([0-9]+)/) ?? [])[1] ?? null;
  return fingerprint(d, chome, ph.length ? ph[ph.length - 1].price_man : null, p.land?.registered_m2 ?? null, p.building?.floor_m2 ?? null);
}).filter(Boolean));
// 台帳物件の要約(別戸判定に使う)
const ledgerUnits = listPropertyIds().map((id) => {
  const p = loadProperty(id);
  const ph = [...(p.price_history ?? [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  return { id, district: districtOfAddress(p.location?.address, "北区"),
    chome: (zen(p.location?.address ?? "").match(/北区\D+([0-9]+)/) ?? [])[1] ?? null,
    price_man: ph.length ? ph[ph.length - 1].price_man : null,
    land_m2: p.land?.registered_m2 ?? null, floor_m2: p.building?.floor_m2 ?? null };
}).filter((x) => x.district);
const out = { crawled_at: new Date().toISOString(), watch: [], discover: [], errors };
if (mode !== "--discover-only") out.watch = await watch();
let discovered = null;
if (mode !== "--watch-only") { discovered = await discover(ledgerNcs, ledgerFps, ledgerUnits, ledgerCrawlIdIndex); out.discover = discovered.report; }
out.summary = {
  price_changes: out.watch.filter((w) => w.status === "price_changed").length,
  delisted_suspects: out.watch.filter((w) => w.status === "delisted_suspect").length,
  // new_listings = KOスクリーニングを通過し「自動登録の対象になる」件数。
  // 落とした件数も黙って消さず開示する(ko_blocked / ko_suspects / out_of_scope)
  new_listings: out.discover.filter((d) => d.event === "new").length,
  // 未審査のまま積み残っていた既見掲載のうち、今回審査できた件数と、予算に届かず持ち越した件数。
  // 「価格が動いたときだけ再審査する」設計で16日埋もれた事故(岸町2 nc_21485594)の再発を可視化する
  backlog_screened: out.discover.filter((d) => d.backlog === true).length,
  backlog_pending: discovered?.backlog_pending ?? 0,
  // 既見だった掲載が再判定でKOになったぶんも同じ枠で数える(黙って減らさない)
  ko_blocked: out.discover.filter((d) => d.event === "new_ko_blocked" || d.event === "ko_blocked_on_recheck").length,
  ko_suspects: out.discover.filter((d) => d.event === "new_ko_suspect").length,
  out_of_scope: out.discover.filter((d) => d.event === "new_out_of_scope" || d.event === "out_of_scope_on_recheck").length,
  sibling_suspects: out.discover.filter((d) => d.sibling_hint).length,
  discover_price_changes: out.discover.filter((d) => d.event === "price_changed").length,
  errors: errors.length, pages_fetched: fetchCount, page_budget: MAX_PAGES,
  budget_exhausted: fetchCount >= MAX_PAGES,
  watch_skipped: out.watch.filter((w) => w.status === "skipped_budget").length,
};
console.log(JSON.stringify(out, null, 1));
}
