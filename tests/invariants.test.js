// tests/invariants.test.js — 不変条件スイープ + 回帰値(F4-3)
// 回帰基準日は受入基準(§8-1)の照合日 2026-07-19 に固定する(時点修正が実行日依存のため)。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appraise, appraiseRange, evaluate, position,
  elapsedYears, monteCarlo, mulberry32, walkAdjOf,
} from "../engine/appraise.js";
import { loadAreaConfig, loadProperty, listPropertyIds } from "../engine/io.js";

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
  // 2026-08-13(2): 徒歩補正を線形(-1.2%/分)から帯別テーブルへ置換。本物件は徒歩11分で、
  // 旧式の-1.2%から新式の-4.0%へ下がったため適正中央値も下がった(5952→5777 / 6562→6370)。
  // v1.2受入基準からの乖離はこの1点の理由に帰着する
  assert.equal(Math.round(mid.fair), 5777, "適正中央値");
  assert.equal(Math.round(hi.fair), 6370, "楽観上限");
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
  // 2026-08-13(2): 徒歩補正の帯別化により 5938→5764 / 6547→6356(徒歩11分の補正が-1.2%→-4.0%)
  assert.equal(Math.round(r.mid.fair), 5764);
  assert.equal(Math.round(r.hi.fair), 6356);
  // 2026-08-11: 売出6560→6260の値下げを掲載元で確認しprice_historyへ追記(査定値自体は不変)
  assert.equal(Math.round(r.state.ask), 6260);
  // 2026-08-13: 機械判定(買/保留/見送)は廃止。エンジンは位置の事実のみ返す
  assert.equal(r.verdict, undefined, "判定スタンプは返さない");
  assert.ok(r.position && typeof r.position.head === "string" && !("mark" in r.position),
    "positionはラベルを持たない: " + JSON.stringify(Object.keys(r.position ?? {})));
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

test("価格の位置: ラベルを一切返さず、参照水準に対する事実だけを返す(2026-08-13の判定廃止)", () => {
  const { mid, lo, hi } = appraiseRange(DEMO, ELAPSED);
  const ref = (o) => ({ fairLo: lo.fair, fairMid: mid.fair, fairHi: hi.fair,
    floorVal: mid.floorVal, floorLo: lo.floorVal, floorNet: mid.floorNet,
    route: mid.route, retail: null, negoBand: null, ...o });
  // 判定に使われていた語がどの経路でも出力に現れないこと(スタンプ復活の回帰ガード)
  const WORDS = ["買", "保留", "見送", "不能", "調査"];
  const forbidden = (p) => WORDS.filter((w) =>
    new RegExp("【" + w + "】").test(p.head + p.body + p.notes.join("")) || "mark" in p || "cls" in p);
  // 取得総額が即時処分値以下 = 旧「買」の条件。事実の注記として現れ、ラベルは付かない
  const buy = { ...DEMO, ask: Math.floor(mid.floorNet / 1.05) };
  const pBuy = position(buy, ref());
  assert.deepEqual(forbidden(pBuy), []);
  assert.ok(pBuy.notes.some((n) => n.includes("即時処分値")), "即時処分値との関係が注記される");
  const notBuy = { ...DEMO, ask: Math.ceil(mid.floorNet / 1.05) + 1 };
  assert.ok(!position(notBuy, ref()).notes.some((n) => n.includes("即時処分値")));
  assert.ok(mid.floorNet < mid.floorVal, "即時処分値は土地換算値より保守的");
  // 上限超過でも「見送」等のラベルは出ず、差額が数字で示されるだけ
  const over = position({ ...DEMO, ask: Math.ceil(hi.fair) + 1 }, ref());
  assert.deepEqual(forbidden(over), []);
  assert.ok(over.head.includes("適正中央値"), over.head);
  // 解体費が土地値を上回る極端条件 → ラベルでなくデータ警告の注記
  const dead = { ...DEMO, land: 20, setback: 10, demo: 3000, age: 45 };  // 築45年=残価ゼロで土地ルートのみ
  const r2 = appraiseRange(dead, ELAPSED);
  assert.ok(r2.mid.fair < 0);
  const pDead = position(dead, ref({ fairMid: r2.mid.fair, fairLo: r2.lo.fair, fairHi: r2.hi.fair,
    floorVal: r2.mid.floorVal, floorLo: r2.lo.floorVal, floorNet: r2.mid.floorNet, route: r2.mid.route }));
  assert.deepEqual(forbidden(pDead), []);
  assert.ok(pDead.notes.some((n) => n.includes("解体費が土地価値を上回")));
});

test("判定廃止の回帰ガード: 台帳の全物件でスタンプ由来のフィールドが復活していない", () => {
  const area = loadAreaConfig();
  for (const id of listPropertyIds()) {
    const r = evaluate(loadProperty(id), area, { asOf: AS_OF });
    assert.equal(r.verdict, undefined, id + ": verdictが復活している");
    assert.equal(r.verdictBasis, undefined, id + ": verdictBasisが復活している");
    assert.equal(r.borderline, undefined, id + ": borderlineが復活している");
    assert.ok(!("mark" in r.position) && !("cls" in r.position), id + ": positionにラベルが付いている");
    assert.ok(["market", "blend"].includes(r.position.basis), id + ": basis=" + r.position.basis);
  }
});

test("price_history: 日付ソートが時刻値ベースであること(String(Date)の曜日名辞書順バグの回帰)", () => {
  // 2026-08-09(日)→08-10(月)は String(Date) 辞書順だと "Mon..."<"Sun..." で逆転する。
  // 実データ(nishigaoka2の値下げ)で顕在化したため、最新価格の採用を回帰テストで固定する
  const r = evaluate(loadProperty("nishigaoka2-adcast-a"), loadAreaConfig(), { asOf: AS_OF });
  assert.equal(r.state.ask, 6580);
});

test("データ規律: 全物件YAMLに必須フィールドが揃っている(編集時の欠落検出)", () => {
  // 2026-08-12: YAMLの一括編集で source_url / price_history / layout を誤って削除した事故を受けて追加。
  // 欠落しても保守側デフォルトで査定は通ってしまう項目があるため、機械的に検査する
  const KEYS = ["id", "status", "source", "source_url", "captured_at", "price_history",
    "location", "layout", "station", "land", "building", "costs", "income", "checklist"];
  const SUB = { land: ["registered_m2", "road", "shape", "legal"], building: ["built", "floor_m2", "type", "repair"], location: ["area", "address"] };
  for (const id of listPropertyIds()) {
    const p = loadProperty(id);
    for (const k of KEYS) assert.ok(p[k] !== undefined, `${id}: ${k} が欠落`);
    assert.ok(Array.isArray(p.price_history) && p.price_history.length > 0, `${id}: price_history が空`);
    for (const [k, subs] of Object.entries(SUB)) {
      for (const x of subs) assert.ok(p[k][x] !== undefined, `${id}: ${k}.${x} が欠落`);
    }
  }
});

test("データ規律: 全物件に hazard_check があり、該当(hit)物件が台帳に残っていない", () => {
  // 2026-08-12: 重要事項説明は契約直前に来るため、ハザードは検討の早期に潰す必要がある。
  // 掲載の制限事項欄は該当物件でも空欄のことがあり(西が丘2の実例)、媒体単独の確認では不十分。
  const OK = ["none", "hit", "unchecked", "na"];
  for (const id of listPropertyIds()) {
    const h = loadProperty(id).hazard_check;
    assert.ok(h, `${id}: hazard_check が無い(ハザード確認状況の記録は必須)`);
    for (const k of ["suumo", "athome"]) assert.ok(OK.includes(h[k]), `${id}: hazard_check.${k} が不正 (${h[k]})`);
    assert.ok(h.checked_at, `${id}: hazard_check.checked_at が無い`);
    assert.notEqual(h.suumo, "hit", `${id}: ハザード該当物件は台帳に載せない(excluded.jsonへ)`);
    assert.notEqual(h.athome, "hit", `${id}: ハザード該当物件は台帳に載せない(excluded.jsonへ)`);
  }
});

// ---- 徒歩補正の帯別テーブル(2026-08-13に線形から置換) ----
// 旧実装 -1.2%/分 は台帳479件の実測(11〜15分帯の実勢-12%)に対し約1/3しか引いておらず、
// 徒歩の長い物件が不自然に割安に見えていた。置換が静かに元へ戻らないよう形を固定する。
test("徒歩補正: 帯別テーブルの節点と単調性(線形式への逆戻りを防ぐ)", () => {
  // 10分以内は横ばい(駅近を減点しない)
  for (const w of [1, 3, 5, 8, 10]) assert.equal(walkAdjOf(w), 0, `${w}分`);
  // 節点: 13分=-12% / 18分以降=-25%(実測の帯 11-15分=-12% / 16分以上=-25% の代表点)
  assert.ok(Math.abs(walkAdjOf(13) + 0.12) < 1e-9, "13分=-12%");
  assert.ok(Math.abs(walkAdjOf(18) + 0.25) < 1e-9, "18分=-25%");
  for (const w of [20, 25, 40]) assert.ok(Math.abs(walkAdjOf(w) + 0.25) < 1e-9, `${w}分は-25%で頭打ち`);
  // 節点の間は折れ線(階段にしない=10分と11分で12%跳ばない)
  assert.ok(walkAdjOf(11) > -0.06 && walkAdjOf(11) < -0.02, `11分は緩やかに効く: ${walkAdjOf(11)}`);
  // 単調非増加
  let prev = 1;
  for (let w = 1; w <= 40; w++) { const v = walkAdjOf(w); assert.ok(v <= prev + 1e-12, `${w}分で反転`); prev = v; }
  // 旧線形式との差: 13分で3倍以上引くようになっている(この改善が置換の目的)
  assert.ok(walkAdjOf(13) < -0.012 * 3 * 3, "13分の補正が旧式(-3.6%)の3倍以上");
  // 不正入力は0(査定を壊さない)
  for (const v of [null, undefined, NaN, "abc"]) assert.equal(walkAdjOf(v), 0);
});
