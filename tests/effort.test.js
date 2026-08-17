// tests/effort.test.js — 手間の解剖(effort.html)の回帰ガード
// このページの数値は成約実測ではなく積算目安なので、検査するのは
// 「目安である旨の開示が消えていないこと」「判定を出さないこと」「図と導線の構成」の3点。
import test from "node:test";
import assert from "node:assert/strict";
import { renderEffort } from "../site/templates/effort.js";

const html = renderEffort({ asOf: "2026-08-17" });

test("effort: 判定を出さず、数値の性質(積算目安)を開示している", () => {
  assert.ok(html.includes("このページは判定をしません"), "判定しない宣言がある");
  assert.ok(!/class="stamp"/.test(html), "判定スタンプのUI部品を持たない");
  // 時間・金額が実測でない旨の開示(この文言が消えたら数字が事実のふりをする)
  assert.ok(html.includes("積算目安"), "積算目安の開示がある");
  assert.ok(html.includes("実測ではない"), "実測でない旨の開示がある");
  // 比較の前提(同じ家に30年)が明記されている(前提が消えると図の意味が変わる)
  assert.ok(html.includes("同じ家に30年住み続ける"), "比較前提の明記がある");
});

test("effort: 図解の構成(SVG4枚・全てにrole/aria-label)と中心概念", () => {
  const svgs = html.match(/<svg [^>]*>/g) ?? [];
  assert.equal(svgs.length, 4, "SVGが4枚(タイムライン・取得・チェーン・合計)");
  for (const s of svgs) {
    assert.ok(s.includes('role="img"'), `role=img がある: ${s.slice(0, 60)}`);
    assert.ok(s.includes("aria-label"), `aria-label がある: ${s.slice(0, 60)}`);
  }
  // 中心概念「発注者業」と、賃貸側の価値(身軽さ)の両論併記が残っていること
  assert.ok(html.includes("発注者"), "発注者業の概念がある");
  assert.ok(html.includes("身軽さは賃貸の正当な価値"), "賃貸側の価値も併記(片側に寄らない)");
});

test("effort: 3パターンの30年合計が内訳の和と一致し、関連ページへの導線がある", () => {
  // 図5の表: 新築・中古(築15年)・賃貸の合計行が内訳の和になっている(EST定義と描画のずれ検知)
  const newBuild = [[20, 35], [0, 0], [10, 20], [5 * 30, 10 * 30], [3 * 6, 6 * 6], [10 * 2, 20 * 2], [30, 60]];
  const used15 = [[25, 45], [8, 20], [10, 20], [5 * 30, 10 * 30], [3 * 10, 6 * 10], [10 * 2, 20 * 2], [30, 60]];
  const rent = [[3, 5], [10, 20], [0.5 * 14, 1 * 14], [0.5 * 8, 1 * 8]];
  const sum = (rows, i) => rows.reduce((a, r) => a + r[i], 0);
  assert.ok(html.includes(`<b>${sum(newBuild, 0)}〜${sum(newBuild, 1)}h</b>`), `新築合計 ${sum(newBuild, 0)}〜${sum(newBuild, 1)}h が表にある`);
  assert.ok(html.includes(`<b>${sum(used15, 0)}〜${sum(used15, 1)}h</b>`), `中古(築15年)合計 ${sum(used15, 0)}〜${sum(used15, 1)}h が表にある`);
  assert.ok(html.includes(`<b>${sum(rent, 0)}〜${sum(rent, 1)}h</b>`), `賃貸合計 ${sum(rent, 0)}〜${sum(rent, 1)}h が表にある`);
  // 3パターン比較の核心(新築の保証の傘・中古の入口の山)が図に残っている
  assert.ok(html.includes("保証の傘"), "新築レーンの保証の傘がある");
  assert.ok(html.includes("入口に山"), "中古レーンの入口の山の注記がある");
  for (const link of ["simulate.html", "tradeoff.html", "map.html", "formula.html", "cliff.html", "index.html"]) {
    assert.ok(html.includes(`href="${link}"`), `${link} への導線がある`);
  }
});
