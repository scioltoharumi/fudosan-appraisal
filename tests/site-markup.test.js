// tests/site-markup.test.js — 生成HTMLに Markdown の記法が生のまま漏れていないかを検査する
// 経緯(2026-08-29): 物件YAMLの自由文(caveats / source / hazard_check.note / 較正の根拠文)は
// Markdown風の **強調** で書かれてきたが、描画側は esc() だけを通していたため、
// **230箇所が生の ** として全物件ページに表示されていた**。layout.js の escRich() で解消した。
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, defaultAsOf } from "../engine/appraise.js";
import { loadAreaConfig, loadProperty, listPropertyIds } from "../engine/io.js";
import { loadHouseDeals } from "../engine/retail.js";
import { calibrate } from "../engine/calibrate.js";
import { escRich, esc, crawlIdUrl, crawlLinksOf } from "../site/templates/layout.js";
import { readFileSync } from "node:fs";
import { renderProperty } from "../site/templates/property.js";
import { renderMarketBasis } from "../site/templates/market-basis.js";

// **dist/ は読まない**。CIは `npm test` を `npm run build` より先に走らせるので、
// 生成物に依存すると実行順で結果が変わる(2026-08-29に実際にCIだけ落ちた)。
// build.js と同じ手順でテンプレートをその場で描画して検査する
const areaConfig = loadAreaConfig();
const cal = calibrate();
const houseDeals = loadHouseDeals();
const asOf = defaultAsOf(new Date(Date.UTC(2026, 7, 29)));
const SEEN = JSON.parse(readFileSync(new URL("../market/crawl/seen.json", import.meta.url), "utf8"));

function renderAll() {
  const pages = [];
  for (const id of listPropertyIds()) {
    const property = loadProperty(id);
    property.crawl_links = crawlLinksOf(property, SEEN);
    const r = evaluate(property, areaConfig, { houseDeals, cal, asOf });
    const rRef = evaluate(property, areaConfig, { houseDeals, asOf });
    const chosen = cal.byArea[property.location?.area]?.chosen ?? null;
    const marketCal = { chosen, rRef, dealsN: cal.byArea[property.location?.area]?.deals.n ?? 0 };
    pages.push([`property/${id}.html`, renderProperty(r, property, marketCal, houseDeals)]);
    if (chosen || r.retail) {
      pages.push([`property/${id}-market.html`,
        renderMarketBasis(r, property, marketCal, cal.byArea[property.location?.area] ?? null)]);
    }
  }
  return pages;
}
// <style> と <script> の中は利用者に見えないので除外する(CSSコメントに ** を使っている箇所がある)
const visibleText = (s) =>
  s.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script>[\s\S]*?<\/script>/g, "");

test("escRich: エスケープを先に通してからマーカーを変換する(HTML注入されない)", () => {
  assert.equal(escRich("**強調**"), "<b>強調</b>");
  assert.equal(escRich("前**中**後"), "前<b>中</b>後");
  assert.equal(escRich("**A**と**B**"), "<b>A</b>と<b>B</b>");
  // 変換より先にエスケープされること。ここが逆だと任意のHTMLを流し込める
  assert.equal(escRich("**<script>x</script>**"), "<b>&lt;script&gt;x&lt;/script&gt;</b>");
  assert.equal(escRich("<b>生タグ</b>"), "&lt;b&gt;生タグ&lt;/b&gt;");
  assert.equal(escRich("**<img src=x onerror=alert(1)>**"),
    "<b>&lt;img src=x onerror=alert(1)&gt;</b>");
  // 対応しないもの: 空・改行跨ぎ・片側だけ
  assert.equal(escRich("****"), "****");
  assert.equal(escRich("**未閉じ"), "**未閉じ");
  assert.equal(escRich("**改行を\n跨ぐ**"), "**改行を\n跨ぐ**");
  // マーカーが無ければ esc() と完全に同じ
  for (const v of ["ふつうの文", "a<b>&\"'", "", null, undefined]) {
    assert.equal(escRich(v), esc(v), `マーカー無しで esc() と差が出た: ${JSON.stringify(v)}`);
  }
});

test("物件ページの本文に Markdown の ** が生のまま残っていない", () => {
  const pages = renderAll();
  assert.ok(pages.length >= 17, `全物件を描画できている: ${pages.length}ページ`);
  const leaks = [];
  for (const [name, html] of pages) {
    const body = visibleText(html);
    if (body.includes("**")) {
      const at = body.indexOf("**");
      leaks.push(`${name}: …${body.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, " ")}…`);
    }
  }
  assert.equal(leaks.length, 0, `Markdownの ** が本文に漏れている:\n  ${leaks.join("\n  ")}`);
});

// ---- 雨のシナリオ対照表(2026-08-31ユーザー要望「人に伝えるために表で」) ----
// 岸町2-4-9の浸水の整理を共有用の表にしたもの。YAMLの hazard_check.rain_scenarios から描画される。
// 表の3行(特別警報/計画規模/想定最大)・結論・出典が物件ページに出ることを固定する
// (YAMLから消えたり、描画が外れたりしたら落ちる)。描画は rainScenariosHtml(property.js)
test("雨のシナリオ対照表: 岸町2-4-9のページに3シナリオと結論・出典が描画される", () => {
  const page = renderAll().find(([name]) => name === "property/kishimachi2-mirasumo-204.html");
  assert.ok(page, "岸町2-4-9の物件ページが描画されている");
  const body = visibleText(page[1]);
  assert.ok(body.includes("雨のシナリオ対照表"), "表の見出しが無い");
  for (const label of ["特別警報クラス", "計画規模(L1)", "想定最大規模(L2)"]) {
    assert.ok(body.includes(label), `シナリオ行が無い: ${label}`);
  }
  // 数値の骨格(公式ソースで裏取りした値)が表に出ていること
  for (const v of ["3日間548mm", "3日間632mm", "1時間115mm"]) {
    assert.ok(body.includes(v), `雨量の値が無い: ${v}`);
  }
  assert.ok(body.includes("結論"), "結論が無い");
  assert.ok(body.includes("出典"), "出典の開示が無い");
  // 「千年に1回」の読み方と気候変動の補足(2026-08-31ユーザー要望で追記)
  assert.ok(body.includes("気候変動"), "気候変動の補足が無い");
  assert.ok(body.includes("流域全体"), "地点雨量と流域平均の区別の説明が無い");
  // 「逆算・目安は公式の地点値ではない」の開示(黙って断定しないためのガード)
  assert.ok(body.includes("公式の地点値ではない"), "逆算・目安の開示が無い");
});

// source_url を意図的に空にしている物件(岸町2 MIRASUMO)でも、人が掲載元へ辿れること。
// 2026-09-02ユーザー指摘「掲載元はどこにいった？リンク先が台帳になくて」。
// watch の誤報を避けるために source_url を空にした設計は正しいが、リンクが消えるのは別の実害。
test("crawlIdUrl: 掲載IDから媒体URLを復元し、種別が分からないnc_は推測しない", () => {
  assert.equal(crawlIdUrl("at_1195752621"), "https://www.athome.co.jp/kodate/1195752621/");
  assert.equal(crawlIdUrl("nc_1", { kind: "chuko" }), "https://suumo.jp/chukoikkodate/tokyo/sc_kita/nc_1/");
  assert.equal(crawlIdUrl("nc_1", { kind: "shinchiku" }), "https://suumo.jp/ikkodate/tokyo/sc_kita/nc_1/");
  assert.equal(crawlIdUrl("nc_1", { kind: "tochi" }), "https://suumo.jp/tochi/tokyo/sc_kita/nc_1/");
  assert.equal(crawlIdUrl("nc_1", undefined), null, "seen に無い nc_ は URL を捏造しない");
  assert.equal(crawlIdUrl("nc_1", { kind: "unknown" }), null);
  assert.equal(crawlIdUrl("garbage<script>", { kind: "chuko" }), null, "不正なIDはリンクにしない");
  assert.equal(crawlIdUrl(null), null);
});

test("source_url が空の物件は crawl_ids から参照掲載リンクが出る(岸町2 MIRASUMO)", () => {
  const pages = Object.fromEntries(renderAll());
  const prop = loadProperty("kishimachi2-mirasumo-204");
  assert.equal(prop.source_url ?? "", "", "前提: この物件は source_url を意図的に空にしている");
  assert.ok((prop.crawl_ids ?? []).includes("nc_21089174"), "前提: crawl_ids に nc_21089174 がある");
  const page = pages["property/kishimachi2-mirasumo-204.html"];
  assert.ok(page, "物件ページが描画されている");
  assert.match(page, /https:\/\/suumo\.jp\/tochi\/tokyo\/sc_kita\/nc_21089174\//, "参照掲載のリンクがページに出る");
  assert.match(page, /参照掲載/, "「掲載元」ではなく参照掲載として区別されている(価格の正本ではない)");
});

// 状況更新(status_updates)は YAML に書くだけではページに出ない(2026-09-05に発覚: 岸町2 MIRASUMO の
// 「建築確認済み・同額の建売プラン」が YAML にだけ入り、ページは登録時のまま『建築確認未取得』と読めた)。
// 日付・出所・事実(確認済証の番号)がページに出ること、無い物件には欄が出ないことを固定する
test("status_updates があるページには状況更新の欄が日付・出所・事実つきで描かれる", () => {
  const pages = Object.fromEntries(renderAll());
  const body = visibleText(pages["property/kishimachi2-mirasumo-204.html"]);
  assert.ok(body.includes("状況更新"), "欄の見出しが無い");
  assert.ok(body.includes("2026-09-05"), "更新日が無い");
  assert.ok(body.includes("出所:"), "出所の開示が無い");
  assert.ok(body.includes("第26UDI1S建01787号"), "確認済証の番号が事実として出ていない");
  assert.ok(body.includes("査定の読みへの影響"), "事実と読みが分けて描かれていない");
  assert.ok(!body.includes("**"), "状況更新の中で ** が生のまま漏れている");
  assert.ok(!visibleText(pages["property/takinogawa6-21587170.html"]).includes("状況更新"), "status_updates の無い物件には出ない");
});

// 精密照合(site_scan)は代表点の照合(official)とは別に、ページのハザード欄に描かれること(2026-09-04)。
// 代表点で caution だった岸町2の更地が、徒歩分で絞ると斜面帯・土砂警戒区域の縁に掛かると分かった。
// official だけ描いて site_scan を落とすと、ページは「代表点で該当なし」としか言わず実態と逆に読める
test("hazard_check.site_scan があるページには精密照合の結果が描かれる", () => {
  const pages = Object.fromEntries(renderAll());
  const p = pages["property/kishimachi2-21624274.html"];
  assert.ok(p, "岸町2更地のページ");
  assert.match(p, /精密照合\(徒歩分による位置絞り込み/, "見出しが出る");
  assert.match(p, /要確認 ── 土砂災害警戒区域の縁に掛かる位置/, "verdict=suspect の文言");
  assert.match(p, /レッド1点・イエロー2点/, "根拠の数字が出る");
  const q = pages["property/kishimachi2-21611051.html"];
  assert.match(q, /位置を絞れず/, "verdict=unknown はその旨を出す(黙って省かない)");
  // site_scan の無い物件には出ない
  assert.ok(!/精密照合\(徒歩分/.test(pages["property/takinogawa6-21587170.html"]), "無い物件には出ない");
});
