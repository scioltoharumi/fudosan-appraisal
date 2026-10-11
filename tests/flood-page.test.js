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

test("flood page: 4枚の図の構成と開示(桁の目安・公式の確率ではない・最悪の絵)", () => {
  const svgs = html.match(/<svg [^>]*>/g) ?? [];
  assert.equal(svgs.length, 4, "SVGが4枚(3因子・ドット図・横棒・家の断面)");
  for (const s of svgs) assert.ok(s.includes('role="img"') && s.includes("aria-label"), "role/aria-label");
  assert.ok(!html.includes("rotate(-90"), "rotate(-90) を使っていない(運用ルール5)");
  for (const k of ["図1", "図2", "図3", "図4", "よくある誤解 3つ", "出典・限界"]) assert.ok(text.includes(k), `構成: ${k}`);
  assert.ok(text.includes("フェルミ推定=桁の目安"), "桁の目安の開示");
  assert.ok(text.includes("公式の確率ではない"), "公式の確率ではない、の開示");
  assert.ok(text.includes("最悪の絵"), "包絡=最悪の絵の説明");
  assert.ok(text.includes("複数破堤なら") && text.includes("1か所だけ切れると置いた"), "複数破堤の意味の説明");
  assert.ok(text.includes("2週間以上"), "継続時間");
  assert.ok(text.includes("判定はしない"), "判定しない宣言");
  assert.ok(html.includes("property/kamiya2-adcast-a.html"), "物件ページ(正本)への導線");
});
