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
import { escRich, esc } from "../site/templates/layout.js";
import { renderProperty } from "../site/templates/property.js";
import { renderMarketBasis } from "../site/templates/market-basis.js";

// **dist/ は読まない**。CIは `npm test` を `npm run build` より先に走らせるので、
// 生成物に依存すると実行順で結果が変わる(2026-08-29に実際にCIだけ落ちた)。
// build.js と同じ手順でテンプレートをその場で描画して検査する
const areaConfig = loadAreaConfig();
const cal = calibrate();
const houseDeals = loadHouseDeals();
const asOf = defaultAsOf(new Date(Date.UTC(2026, 7, 29)));

function renderAll() {
  const pages = [];
  for (const id of listPropertyIds()) {
    const property = loadProperty(id);
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
