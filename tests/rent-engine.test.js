// tests/rent-engine.test.js — 賃貸エンジンの回帰ガードと不変条件。
// 守りたいこと:
//   ① 実質月額の定義(何を入れて何を入れないか)が黙って変わらない
//   ② 「募集賃料であって成約ではない」という限界が消えない(判定語の不在ガード込み)
//   ③ 係数の「判別可能/不能」の結論が固定される(徒歩分は判別不能=これを根拠に使わない)
import test from "node:test";
import assert from "node:assert/strict";
import {
  loadRentPool, fitRentModel, benchmarkRent, effectiveMonthly, effectiveMonthlyCurve,
  evaluateRent, rentFunnel, parseCsv, asOfString, RENT_ASSUMPTIONS, TEIKI_OK_YEARS,
} from "../engine/rent.js";
import { TEIKI_OK_YEARS as SCREEN_TEIKI_OK_YEARS } from "../crawler/rent-screen.mjs";
import { loadRental, listRentalIds } from "../engine/io.js";

const pool = loadRentPool();
const model = fitRentModel(pool);

test("募集賃料プールが読める(データ妥当性)", () => {
  assert.ok(pool.length >= 40, `プールが少なすぎる: ${pool.length}件`);
  for (const d of pool) {
    assert.ok(d.total_man > 0, `賃料が正でない: ${d.source_id}`);
    assert.ok(d.area_m2 > 0, `専有面積が正でない: ${d.source_id}`);
    assert.ok(d.walk_min >= 0 && d.walk_min <= 30, `徒歩分が範囲外: ${d.source_id}`);
    assert.ok(d.age_y >= 0 && d.age_y <= 100, `築年が範囲外: ${d.source_id}`);
    assert.ok(d.total_man >= d.rent_man, "総額が賃料を下回ることはない");
    // 空欄は false ではなく null(記載なし)であること
    assert.ok(d.toilet2 === true || d.toilet2 === null, "toilet2 は true か null のみ(false にしない)");
  }
});

test("CSVパーサが引用符を扱える", () => {
  const rows = parseCsv('a,b,c\n1,"x,y",3\n2,"he said ""hi""",4\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].b, "x,y");
  assert.equal(rows[1].b, 'he said "hi"');
});

test("モデルが推定でき、決定的である(固定シード)", () => {
  assert.ok(model.ok, model.reason);
  const again = fitRentModel(pool);
  assert.deepEqual(again.coef, model.coef, "同じ入力なら同じ係数(シードが固定されていること)");
  assert.deepEqual(again.terms.map((t) => t.ci), model.terms.map((t) => t.ci));
});

// ---- ここが本丸: どの変数が「判別可能」か を名指しで固定する ----
test("係数の判別可能性: 面積と築年は判別可能、徒歩分は判別不能", () => {
  const t = (k) => model.terms.find((x) => x.key === k);
  assert.equal(t("area").decisive, true, "面積の弾力性は1.00を含まない(賃料は面積に比例しない)");
  assert.ok(t("area").est > 0 && t("area").est < 1, `弾力性が0〜1の外: ${t("area").est}`);
  assert.equal(t("age").decisive, true, "築年の効果は0を跨がない");
  assert.ok(t("age").est_pct < 0, "築年が進むほど賃料は下がる向きであること");
  // **これが変わったら、徒歩分を根拠に割安/割高を語れるようになったということ。
  //   その時はページの開示文も同時に直すこと**
  assert.equal(t("walk").decisive, false,
    "徒歩分は判別不能のはず。判別可能になったら rent-basis.html と rent-index.js の開示文を更新すること");
});

test("ものさし賃料: 面積が増えても比例では増えない(逓減)", () => {
  const a = benchmarkRent(model, { area_m2: 60, age_y: 15, walk_min: 8 });
  const b = benchmarkRent(model, { area_m2: 120, age_y: 15, walk_min: 8 });
  assert.ok(b.mid > a.mid, "広いほうが高い");
  assert.ok(b.mid < a.mid * 2, "面積2倍で賃料2倍にはならない(弾力性<1)");
  assert.ok(a.lo < a.mid && a.mid < a.hi, "散らばりの帯が中央値を挟む");
});

test("ものさし賃料: 築年が進むと下がる", () => {
  const nw = benchmarkRent(model, { area_m2: 80, age_y: 0, walk_min: 8 });
  const old = benchmarkRent(model, { area_m2: 80, age_y: 30, walk_min: 8 });
  assert.ok(old.mid < nw.mid);
});

// ---- 実質月額の定義ガード ----
const P = { rent_man: 20, kanri_man: 1, shiki_months: 1, rei_months: 1 };

// 実質月額は**単調減少ではない**。更新料が乗る年で一度上がる(鋸歯)。
// 2026-08-18: 当初「常に下がる」とテストを書いて落ち、コードではなくテストの前提が誤りだと判明した。
// 7年目・9年目は更新料20万が新たに乗るため、一時金の希釈より更新の追加が勝つ。
// これは実装のバグではなく、契約更新という現実の反映なので、事実として固定する
test("実質月額は長期ほど下がるが、更新料が乗る年で一度上がる(鋸歯)", () => {
  const c = effectiveMonthlyCurve(P);
  assert.ok(c[0].monthlyEq > c[9].monthlyEq, "1年と10年では明確に下がる(全体の傾向)");
  // 更新が起きない年は必ず下がる
  for (let i = 1; i < c.length; i++) {
    if (c[i].renewals === c[i - 1].renewals) {
      assert.ok(c[i].monthlyEq < c[i - 1].monthlyEq,
        `更新なしの年で下がっていない: ${c[i - 1].years}→${c[i].years}年`);
    }
  }
  // 更新が起きる年は上がることがある。少なくとも1回は起きるはず(この性質が消えたら鋸歯の説明を消すこと)
  const bumps = c.filter((e, i) => i > 0 && e.monthlyEq > c[i - 1].monthlyEq);
  assert.ok(bumps.length > 0, "更新料による反転が1度も起きない=更新料が効いていない疑い");
  for (const b of bumps) {
    assert.ok(b.renewals > c[b.years - 2].renewals, `${b.years}年の反転が更新以外の理由で起きている`);
  }
});

test("実質月額は必ず表示賃料+管理費を上回る(一時金と退去費用があるため)", () => {
  for (const e of effectiveMonthlyCurve(P)) {
    assert.ok(e.premiumOverListed > 0, `${e.years}年で上乗せが消えている`);
    assert.ok(Math.abs(e.monthlyEq - (P.rent_man + P.kanri_man) - e.premiumOverListed) < 1e-9);
  }
});

test("敷金は総額に入れず、入居時現金には入れる", () => {
  const withShiki = effectiveMonthly({ ...P, shiki_months: 2 }, 2);
  const without = effectiveMonthly({ ...P, shiki_months: 0 }, 2);
  assert.equal(withShiki.total, without.total, "敷金は返還前提なので総額を動かしてはいけない");
  assert.ok(withShiki.cashAtStart > without.cashAtStart, "入居時に用意する現金は敷金ぶん増える");
});

test("更新回数: 2年契約で2年ちょうどなら0回、3年で1回、5年で2回", () => {
  assert.equal(effectiveMonthly(P, 2).renewals, 0);
  assert.equal(effectiveMonthly(P, 3).renewals, 1);
  assert.equal(effectiveMonthly(P, 5).renewals, 2);
});

test("内訳の合計は総額に一致する(取りこぼしがない)", () => {
  const e = effectiveMonthly({ ...P, misc_initial_man: 13, misc_monthly_man: 0.132, cleaning_man: 11.13 }, 4);
  const sum = Object.values(e.breakdown).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - e.total) < 1e-9, `内訳${sum} ≠ 総額${e.total}`);
});

test("備考由来の付帯費用が実質月額に効く(拾わないと過小評価になる)", () => {
  const withMisc = effectiveMonthly({ ...P, misc_initial_man: 13 }, 2);
  const without = effectiveMonthly(P, 2);
  assert.ok(withMisc.monthlyEq > without.monthlyEq);
  // 初期13万を24ヶ月で割ると約0.54万/月。丸め誤差の範囲で一致すること
  assert.ok(Math.abs((withMisc.monthlyEq - without.monthlyEq) - 13 / 24) < 1e-9);
});

test("定額クリーニングの記載があれば原状回復の想定より優先される", () => {
  const fixed = effectiveMonthly({ ...P, cleaning_man: 11.13 }, 2);
  const assumed = effectiveMonthly(P, 2);
  assert.equal(fixed.breakdown.restoration, 11.13);
  assert.equal(assumed.breakdown.restoration, RENT_ASSUMPTIONS.restoration_months * P.rent_man);
});

test("asOf は Date でも文字列でも同じ築年になる", () => {
  assert.equal(asOfString(new Date("2026-08-18T00:00:00Z")), "2026-08-18");
  assert.equal(asOfString("2026-08-18"), "2026-08-18");
  const p = loadRental(listRentalIds()[0]);
  const a = evaluateRent(p, { pool, model, asOf: new Date("2026-08-18T00:00:00Z") });
  const b = evaluateRent(p, { pool, model, asOf: "2026-08-18" });
  assert.equal(a.age_y, b.age_y);
  assert.ok(Number.isFinite(a.age_y), "築年がNaNになっていない(Date渡しの回帰)");
});

// ---- 台帳のデータ妥当性 ----
test("台帳の全物件が評価でき、掲載条件を満たしている", () => {
  const ids = listRentalIds();
  assert.ok(ids.length > 0, "賃貸台帳が空");
  for (const id of ids) {
    const p = loadRental(id);
    assert.equal(p.id, id, `ファイル名とidが不一致: ${id}`);
    const r = evaluateRent(p, { pool, model, asOf: "2026-08-18" });
    assert.ok(r.listed.total_man >= 15 && r.listed.total_man <= 25, `${id}: 賃料が条件外 ${r.listed.total_man}`);
    assert.ok(p.station.walk_min <= 10, `${id}: 徒歩が条件外`);
    assert.ok(p.building.built_year >= 1982, `${id}: 新耐震でない`);
    assert.equal(p.building.seismic, "new");
    // 定期借家は3年ちょうどだけ許容(2026-08-18ユーザー指示)。それ以外が台帳にあってはいけない
    if (p.terms.contract_type === "teiki") {
      assert.ok(TEIKI_OK_YEARS.includes(p.terms.contract_years),
        `${id}: 定期借家${p.terms.contract_years}年が台帳に入っている(許容は${TEIKI_OK_YEARS.join("・")}年のみ)`);
      // 定期借家は期間満了で終わるので契約期間中に更新料は発生しない
      assert.equal(p.terms.renewal_months, 0, `${id}: 定期借家に更新料が設定されている`);
    }
    assert.ok(Number.isFinite(r.at2y.monthlyEq), `${id}: 実質月額が算出できない`);
    assert.ok(r.at2y.monthlyEq > r.listed.total_man, `${id}: 実質月額が表示賃料以下`);
  }
});

test("ハザードは記録されているが除外条件にはなっていない", () => {
  const ids = listRentalIds();
  for (const id of ids) {
    const p = loadRental(id);
    assert.ok(p.hazard_check?.official, `${id}: ハザード照合の記録が無い`);
    assert.ok("elevation_m" in p.hazard_check.official, `${id}: 標高が記録されていない`);
  }
  // 方針(2026-08-18)の記録: ハザード該当物件が現に台帳へ載っていること。
  // これが0件になったら「ハザードもあり」の方針が実装から落ちた疑い
  const blocked = ids.filter((id) => loadRental(id).hazard_check.official.reference_verdict === "block");
  assert.ok(blocked.length > 0,
    "購入台帳基準ならblockの物件が1件も無い。賃貸台帳はハザード内も対象にする方針(2026-08-18)");
});

test("許容する定期借家の年数がエンジンとクローラで一致している", () => {
  // 定数を二重に持っているので、片方だけ変えたら落ちるようにしておく
  assert.deepEqual([...TEIKI_OK_YEARS].sort(), [...SCREEN_TEIKI_OK_YEARS].sort());
  assert.deepEqual([...TEIKI_OK_YEARS], [3], "2026-08-18ユーザー指示: 3年ちょうどのみ");
});

test("漏斗の定期借家の段は3年を通し、2年・4年以上を落とす", () => {
  const pass = { total_man: 20, area_m2: 80, age_y: 10, walk_min: 5, rooms: 3, has_ldk: true, seismic: "new" };
  const mk = (years) => ({ ...pass, contract_type: "teiki", contract_years: years });
  const f = rentFunnel([mk(2), mk(3), mk(4), { ...pass, contract_type: "futsu", contract_years: 2 }]);
  const survivors = f.survivors;
  assert.equal(survivors.length, 2, "3年の定借と普通借家だけが残る");
  assert.ok(survivors.some((d) => d.contract_type === "teiki" && d.contract_years === 3));
  assert.ok(!survivors.some((d) => d.contract_type === "teiki" && d.contract_years !== 3));
  assert.equal(f.teikiAllowed, 1);
});

test("探索の漏斗は各段の落ちた数を返す(黙って減らさない)", () => {
  const f = rentFunnel(pool);
  assert.equal(f.steps[0].n, pool.length);
  for (let i = 1; i < f.steps.length; i++) {
    assert.equal(f.steps[i].n, f.steps[i - 1].n - f.steps[i].dropped, `段${i}の件数が合わない`);
  }
  assert.ok(f.survivors.length > 0, "条件を通過する物件が1件も無い");
  // トイレ2個を条件に入れると壊滅することの記録(この数字が根拠になっている)
  assert.ok(f.withToilet2 < f.survivors.length,
    "トイレ2ヶ所の記載を必須にすると候補が減る、という前提が崩れている");
});

test("判定語を出さない(v3.0.0の思想。購入台帳と同じ regression ガード)", () => {
  const forbidden = /(買い|見送り|買うべき|借りるべき|おすすめ|割安と判定|割高と判定)/;
  for (const id of listRentalIds()) {
    const r = evaluateRent(loadRental(id), { pool, model, asOf: "2026-08-18" });
    assert.equal(r.verdict, undefined, "verdict を復活させてはいけない");
    assert.equal(r.borderline, undefined);
    assert.ok(!("mark" in r.position) && !("cls" in r.position), "position にスタンプを持たせない");
    for (const n of r.position.notes) {
      assert.ok(!forbidden.test(n), `判定語が混入: ${n}`);
    }
  }
});

test("position の basis が「成約ではない」ことを明示している", () => {
  const r = evaluateRent(loadRental(listRentalIds()[0]), { pool, model, asOf: "2026-08-18" });
  assert.match(r.position.basis, /成約ではない/,
    "母集団が募集賃料である開示が消えている(この限界は標本を増やしても解消しない)");
});
