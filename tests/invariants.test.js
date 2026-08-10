// tests/invariants.test.js — 不変条件スイープ + 回帰値(F4-3)
// 回帰基準日は受入基準(§8-1)の照合日 2026-07-19 に固定する(時点修正が実行日依存のため)。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appraise, appraiseRange, evaluate, verdict,
  elapsedYears, monteCarlo, mulberry32,
} from "../engine/appraise.js";
import { loadAreaConfig, loadProperty } from "../engine/io.js";

const AS_OF = new Date(Date.UTC(2026, 6, 19));
const ELAPSED = elapsedYears(AS_OF);

// v1.2シミュレータの本物件プリセット(赤羽台3・6,560万・築26年10ヶ月)
const DEMO = {
  ppt: 230, rise: 0.10, ask: 6560,
  land: 91.44, setback: 14.04, walk: 11,
  roadq: -0.05, dir: 0.02, shape: 0, lc: 0,
  corner: false, mst: true, extra: 0,
  age: 27, floor: 68.6, bm: -0.05,
  rebuild: 70, demo: 150, repair: 800,
  fee: 0.05, rent: 22, expr: 0.15, yld: 0.045,
};

test("回帰値: 本物件(engineレベル)が受入基準と一致する", () => {
  const { mid, lo, hi } = appraiseRange(DEMO, ELAPSED);
  assert.equal(Math.round(mid.fair), 5952, "適正中央値");
  assert.equal(Math.round(hi.fair), 6562, "楽観上限");
  assert.equal(verdict(DEMO, mid, lo, hi).mark, "保留");
  assert.equal(mid.route, "land");
  // 2026-08監査: 建物逓減を22年→30年に更新したため築27年でも残価は僅かに残る。
  // ただし土地ルート優位のため fair は従来どおり(受入基準値は不変)
  assert.ok(mid.resid > 0 && mid.resid < 200, "築27年の残価は僅少: " + mid.resid);
});

test("回帰値: YAML→evaluate経由の基準値(時点修正の年次別統一後)", () => {
  // v1.2受入基準(5952/6562)は一律年率10%前提。2026-08第2次監査で時点修正を年次別実効レートに
  // 統一したため(実効約12%)、evaluate経由の値は意図的に更新。engineレベルの回帰(rise明示)は不変
  const r = evaluate(loadProperty("akabanedai3-20268457"), loadAreaConfig(), { asOf: AS_OF });
  // 2026年の将来外挿を+6%に保守化(R3監査)後の値。v1.2原典(5952/6562)にほぼ回帰している
  assert.equal(Math.round(r.mid.fair), 5938);
  assert.equal(Math.round(r.hi.fair), 6547);
  assert.equal(r.verdict.mark, "見送");  // ask 6560 vs hi 6547 の境界物件(差0.2%)
  // 修繕・解体・賃料のassumed項目が記録されていること(F1-3/監査性)
  assert.ok(r.assumptions.length >= 3, "assumed項目: " + JSON.stringify(r.assumptions));
});

test("不変条件: 全域スイープで floor<=fair / lo<=mid<=hi / NaN不発生", () => {
  const opts = {
    ppt: [150, 230, 480],
    rise: [0, 0.10, 0.16],
    land: [30, 91.44, 250],
    setback: [0, 14.04, 60],
    walk: [1, 11, 20],
    roadq: [0, -0.05, -0.10],
    dir: [0.05, 0.02, 0, -0.03],
    shape: [0, -0.05, -0.25],
    lc: [0, -0.30],
    corner: [true, false],
    mst: [true, false],
    extra: [-10, 0, 10],
    age: [0, 10, 21.9, 27, 45],
    floor: [40, 68.6, 150],
    bm: [0, -0.05],
    rebuild: [40, 70, 130],
    demo: [0, 150, 800],
    repair: [0, 400, 800],
  };
  const keys = Object.keys(opts);
  const rand = mulberry32(12345); // 再現可能なランダムサンプリング
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const s = { ...DEMO };
    for (const k of keys) s[k] = pick(opts[k]);
    const { mid, lo, hi } = appraiseRange(s, ELAPSED);
    for (const [name, a] of [["mid", mid], ["lo", lo], ["hi", hi]]) {
      assert.ok(Number.isFinite(a.fair), `${name}.fair がNaN/Inf: ${JSON.stringify(s)}`);
      assert.ok(Number.isFinite(a.floorVal), `${name}.floorVal がNaN/Inf`);
      assert.ok(a.floorVal <= a.fair + 1e-9, `floor>fair: ${name} ${JSON.stringify(s)}`);
    }
    assert.ok(lo.fair <= mid.fair + 1e-9 && mid.fair <= hi.fair + 1e-9, `lo<=mid<=hi違反: ${JSON.stringify(s)}`);
    assert.ok(lo.floorVal <= mid.floorVal + 1e-9 && mid.floorVal <= hi.floorVal + 1e-9, `floorのlo<=mid<=hi違反`);
  }
});

test("不変条件: noise込み(MC経路)でも floor<=fair", () => {
  const rand = mulberry32(999);
  for (let i = 0; i < 5000; i++) {
    const noise = {
      adj: (rand() - 0.5) * 0.2,
      resid: (rand() - 0.5) * 0.6,
      demo: (rand() - 0.5) * 0.8,
      rep: (rand() - 0.5) * 1.0,
    };
    const a = appraise(DEMO, { elapsed: ELAPSED, noise });
    assert.ok(Number.isFinite(a.fair));
    assert.ok(a.floorVal <= a.fair + 1e-9);
  }
});

test("MC: seed固定で再現可能・パーセンタイル順序が正しい", () => {
  const a = monteCarlo(DEMO, ELAPSED, { seed: 20260719 });
  const b = monteCarlo(DEMO, ELAPSED, { seed: 20260719 });
  assert.equal(a.p50, b.p50, "同一seedでP50一致");
  assert.equal(a.askPercentile, b.askPercentile);
  const c = monteCarlo(DEMO, ELAPSED, { seed: 1 });
  assert.notEqual(a.p50, c.p50, "異なるseedで結果が変わる");
  assert.ok(a.p10 <= a.p50 && a.p50 <= a.p90, "P10<=P50<=P90");
  assert.equal(a.hist.counts.reduce((x, y) => x + y, 0), a.trials, "全試行がビンに入る");
});

test("判定境界: ask<=floorで「買」、fair<0で「不能」、上限超過で「見送」", () => {
  const { mid, lo, hi } = appraiseRange(DEMO, ELAPSED);
  // R2で「買」閾値を即時処分値に、R3で取得諸費用込み(ask×(1+fee)<=floorNet)に保守化
  const buy = { ...DEMO, ask: Math.floor(mid.floorNet / 1.05) };
  assert.equal(verdict(buy, mid, lo, hi).mark, "買");
  const notBuy = { ...DEMO, ask: Math.ceil(mid.floorNet / 1.05) + 1 };
  assert.notEqual(verdict(notBuy, mid, lo, hi).mark, "買", "floorNet超は買にならない");
  assert.ok(mid.floorNet < mid.floorVal, "即時処分値は土地換算値より保守的");
  const pass = { ...DEMO, ask: Math.ceil(hi.fair) + 1 };
  assert.equal(verdict(pass, mid, lo, hi).mark, "見送");
  // 解体費が土地値を上回る極端条件 → 査定不能
  const dead = { ...DEMO, land: 20, setback: 10, demo: 3000, age: 45 };  // 築45年=残価ゼロで土地ルートのみ
  const r2 = appraiseRange(dead, ELAPSED);
  assert.ok(r2.mid.fair < 0);
  assert.equal(verdict(dead, r2.mid, r2.lo, r2.hi).mark, "不能");
});
