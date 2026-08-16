// tests/simulate.test.js — 保有年数シミュレーター(simulate.html)の回帰ガード
// ページの計算はclient側スクリプトが行うため、ここでは「注入データが正しく・完全に埋まること」を検査する。
// (式そのものの妥当性は engine/appraise.js と formula.js の既存テストが担保している)
import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, defaultAsOf } from "../engine/appraise.js";
import { loadAreaConfig, loadProperty, listPropertyIds } from "../engine/io.js";
import { loadHouseDeals } from "../engine/retail.js";
import { calibrate } from "../engine/calibrate.js";
import { ageCurveCI } from "../site/templates/formula.js";
import { renderSimulate } from "../site/templates/simulate.js";

const areaConfig = loadAreaConfig();
const cal = calibrate();
const houseDeals = loadHouseDeals();
const asOf = defaultAsOf(new Date(Date.UTC(2026, 7, 16)));
const results = listPropertyIds().map((id) => {
  const property = loadProperty(id);
  return { r: evaluate(property, areaConfig, { houseDeals, cal, asOf }), property };
});
const curve = ageCurveCI(houseDeals);
const html = renderSimulate(results, curve, { asOf: "2026-08-16" });
const dataM = html.match(/<script type="application\/json" id="simdata">(.*?)<\/script>/s);

test("simulate: 注入データがJSONとして完全(全物件・必須数値が有限)", () => {
  assert.ok(dataM, "simdata の script ブロックがある");
  const d = JSON.parse(dataM[1]);
  assert.equal(d.props.length, results.length, "台帳の全物件が選択肢に入る");
  for (const p of d.props) {
    for (const k of ["ask", "fee", "repair", "land2", "demo", "age", "floorTsubo", "rebuild", "bm", "fairMid"]) {
      assert.ok(Number.isFinite(p[k]), `${p.id}.${k} が有限数値: ${p[k]}`);
    }
    assert.ok(p.land2 > 0 && p.ask > 0, `${p.id} の土地・売出が正`);
  }
  // 既定の比較対象が実在する(台帳から消えたらフォールバックする設計だが、現状は本物件を指す)
  assert.ok(d.props.some((p) => p.id === d.defA), "既定Aが台帳に実在");
  assert.ok(d.props.some((p) => p.id === d.defB), "既定Bが台帳に実在");
});

test("simulate: 出口の実測カーブは cliff.html と同一の帯構成で崖を含む", () => {
  const d = JSON.parse(dataM[1]);
  assert.equal(d.SIMC.rows.length, curve.rows.length, "帯の数が ageCurveCI と一致");
  for (const b of d.SIMC.rows) {
    assert.ok(Number.isFinite(b.m) && Number.isFinite(b.lo95) && Number.isFinite(b.hi95), `${b.label} の中央値・CIが数値`);
    assert.ok(b.lo95 <= b.m && b.m <= b.hi95, `${b.label} で lo95<=med<=hi95`);
  }
  // 築31年以上の帯は若い側の全帯中央値より低い(崖)。ここが崩れたらデータ異常
  const young = d.SIMC.rows.filter((b) => b.lo < 31).map((b) => b.m);
  const old = d.SIMC.rows.filter((b) => b.lo >= 31).map((b) => b.m);
  assert.ok(old.length >= 1, "築31年以上の帯がある");
  assert.ok(Math.max(...old) < Math.min(...young), "崖: 築31年以上の帯中央値 < 若い側の全帯中央値");
  // 築年の全域がどこかの帯に落ちる(client側 bucketAt の前提)
  for (const age of [0, 5, 15, 30.5, 31, 45, 80]) {
    assert.ok(d.SIMC.rows.some((b) => age >= b.lo && age < b.hi), `築${age}年が帯に落ちる`);
  }
});

test("simulate: 判定語を出さない(エンジンv3.0.0の思想の回帰ガード)", () => {
  // 「買い」「見送り」等のスタンプ語をページの地の文に出さないこと。
  // (「判定をしません」の宣言文と一覧ページの用語説明は除き、単独の判定語が無いことを検査)
  assert.ok(html.includes("このページは判定をしません"), "判定しない宣言がある");
  assert.ok(!/class="stamp"/.test(html), "判定スタンプのUI部品を持たない");
});
