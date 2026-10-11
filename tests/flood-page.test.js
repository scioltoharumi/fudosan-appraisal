// tests/flood-page.test.js — 水の確率(flood.html)の回帰ガード
// 2026-10-11ユーザー要望「何が2.2%なのか初心者には分からない。文字少なめ・グラフィカルに・他の人にも伝わるページを」。
// 検査するのは「数値が手書きでなくモデルから注入されていること」「4枚の図の構成」「桁の目安・公式の確率ではない、の開示」「rotate(-90)不使用」
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadProperty } from "../engine/io.js";
import { renderFlood } from "../site/templates/flood.js";
import { exceedance, groupStats } from "../engine/flood.js";

const property = loadProperty("kamiya2-adcast-a");
const snapshot = JSON.parse(readFileSync(join(ROOT, property.hazard_check.flood_fermi.snapshot), "utf8"));
const html = renderFlood({ asOf: "2026-10-11", snapshot, property });
const text = html.replace(/<[^>]+>/g, " ");

test("flood page: 結論の数値がモデルの計算値と一致し、手書きでない", () => {
  const rows = exceedance(snapshot);
  const multi = exceedance(snapshot, { multiBreach: true });
  const at = (d) => rows.find((r) => r.depth_m === d);
  const pct1 = (p) => `${(p * 100).toFixed(1)}%`;
  assert.ok(text.includes(`1m以上の水が来る確率は約${pct1(at(1).cum.mid)}`), "1mの結論が計算値");
  assert.ok(text.includes(`3m以上は約${pct1(at(3).cum.mid)}`), "3mの結論が計算値");
  assert.ok(text.includes(`複数破堤なら ${pct1(multi.find((r) => r.depth_m === 3).cum.mid)}`), "複数破堤の値が計算値");
  const l2 = groupStats(snapshot.suibou_nav.groups.l2);
  assert.ok(text.includes(`${l2.total}か所のうち`) && text.includes(`ここに届くのは ${l2.reaching}か所`), "破堤点の件数が注入されている");
  assert.ok(text.includes("5mにする破堤点: 0か所"), "5m=0の件数");
  assert.ok(text.includes(`内水 ${snapshot.tokyo_naisui.nearest.depth_m}m`), "内水の地点値が注入されている");
});

test("flood page: 7枚の図の構成と開示(桁の目安・公式の確率ではない・最悪の絵)", () => {
  const svgs = html.match(/<svg [^>]*>/g) ?? [];
  assert.equal(svgs.length, 7, "SVGが7枚(3因子・ドット図・横棒・家の断面・内水・1階を上げるか・物差し)");
  for (const s of svgs) assert.ok(s.includes('role="img"') && s.includes("aria-label"), "role/aria-label");
  assert.ok(!html.includes("rotate(-90"), "rotate(-90) を使っていない(運用ルール5)");
  for (const k of ["図1", "図2", "図3", "図4", "図5", "図6", "図7", "よくある誤解 3つ", "出典・限界"]) assert.ok(text.includes(k), `構成: ${k}`);
  // 図5 内水: 公式値は153mmだけ、他は比例の目安、設計で防げる種類の水、の開示
  assert.ok(text.includes("公式の地点値は153mmだけ"), "内水の目安の限界の開示");
  assert.ok(text.includes("基礎高・車庫の床高・止水板で防げる"), "内水は設計で防げる、の説明");
  assert.ok(text.includes("75mmの雨は30年で68%"), "内水の頻度(75mm→68%)が計算値で出ている");
  // 1階床高(図面 GL+461mm)との対比: 最頻の内水は床下に収まる・想定最大で床上約37cm・床下浸水も無傷ではない、の3点
  assert.ok(text.includes("1階床は地面+46cm"), "1階床高が注入されている");
  assert.ok(text.includes("床下に収まり、居室への影響は限定的"), "最頻の内水が床下に収まる読みがある");
  assert.ok(text.includes("床上約37cm"), "想定最大153mmの床上の深さが床高との差で出ている");
  assert.ok(text.includes("床下浸水も無傷ではない"), "床下浸水のコストの開示がある");
  // 図6 1階を上げるか: 床高の段(今/+30/+50)と水の位置が計算で出る・外水には効かない・10mの枠はロフトと取り合い・床を上げない対策、の開示
  assert.ok(text.includes("床 +46cm") && text.includes("床 +76cm") && text.includes("床 +96cm"), "床高の3段が floor_height_m+steps_m から注入されている");
  assert.ok(text.includes("1階水没"), "外水(計画規模の中央値)は床を上げても1階水没");
  assert.ok(text.includes("高さの枠(日影規制の境 10m)") && text.includes("超過=ロフトを削る"), "10mの枠とロフトの取り合いの図");
  assert.ok(text.includes("床を上げずに内水の被害を止めるもの") && text.includes("排水の逆止弁"), "代替策が YAML から注入されている");
  assert.ok(text.includes("ロフトを捨ててまで上げる理由は薄い"), "結論の注記");
  // 図7 物差し: この地点の地震(J-SHIS)・全国平均の火災/交通事故・台帳の対照物件・期待損失、と「全国平均はこの家の確率ではない」の開示
  for (const k of ["震度6強以上の揺れ", "住宅火災(全国平均・1戸あたり)", "交通事故でけが", "岸町2-4-9", "上十条5-44-4", "期待損失", "この家・この人の確率ではない"]) {
    assert.ok(text.includes(k), `物差し: ${k}`);
  }
  assert.ok(text.includes("12.8%"), "J-SHIS の震度6強以上の30年確率が注入されている");
  assert.ok(text.includes("フェルミ推定=桁の目安"), "桁の目安の開示");
  assert.ok(text.includes("公式の確率ではない"), "公式の確率ではない、の開示");
  assert.ok(text.includes("最悪の絵"), "包絡=最悪の絵の説明");
  assert.ok(text.includes("複数破堤なら") && text.includes("1か所だけ切れると置いた"), "複数破堤の意味の説明");
  assert.ok(text.includes("2週間以上"), "継続時間");
  assert.ok(text.includes("判定はしない"), "判定しない宣言");
  assert.ok(html.includes("property/kamiya2-adcast-a.html"), "物件ページ(正本)への導線");
});
