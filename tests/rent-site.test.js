// tests/rent-site.test.js — 賃貸台帳ページの開示ガード。
// このページの数字は「募集賃料」と「仮定を含む実質月額」なので、検査するのは
// ①限界の開示が消えていないこと ②判定を出さないこと ③個人情報を書き出さないこと の3点。
import test from "node:test";
import assert from "node:assert/strict";
import { renderRentIndex } from "../site/templates/rent-index.js";
import { renderRentProperty } from "../site/templates/rent-property.js";
import { renderRentBasis } from "../site/templates/rent-basis.js";
import { loadRentPool, fitRentModel, evaluateRent, rentFunnel } from "../engine/rent.js";
import { loadRental, listRentalIds } from "../engine/io.js";

const asOf = "2026-08-18";
const pool = loadRentPool();
const model = fitRentModel(pool);
const funnel = rentFunnel(pool);
const results = listRentalIds().map((id) => {
  const rental = loadRental(id);
  return { rental, res: evaluateRent(rental, { pool, model, asOf }) };
});
const indexHtml = renderRentIndex(results, { asOf, funnel, model, poolCapturedAt: pool[0].captured_at });
const basisHtml = renderRentBasis({ pool, model, funnel, asOf });
const propHtml = results.map(({ res, rental }) => renderRentProperty(res, rental, { asOf, model }));

test("rent: 判定を出さない宣言があり、判定スタンプのUIを持たない", () => {
  assert.ok(indexHtml.includes("判定を出しません"), "判定しない宣言がある");
  for (const h of [indexHtml, basisHtml, ...propHtml]) {
    assert.ok(!/class="stamp"/.test(h), "判定スタンプのUI部品を持たない");
  }
});

test("rent: 母集団が『成約ではなく募集』であることを全ページで開示している", () => {
  assert.ok(indexHtml.includes("成約ではなく募集"), "一覧に開示がある");
  assert.ok(basisHtml.includes("成約ではなく募集"), "根拠ページに開示がある");
  assert.ok(basisHtml.includes("成約賃料は公開されていません") || basisHtml.includes("成約賃料は公開されていない"),
    "成約賃料が非公開である旨の説明がある");
});

test("rent: 徒歩分が判別不能である開示が消えていない", () => {
  // モデル側の結論(tests/rent-engine.test.js でも固定)とページの文言が一致していること。
  // 判別可能になった場合はこのガードが落ちるので、両方を同時に直すことになる
  const walk = model.terms.find((t) => t.key === "walk");
  assert.equal(walk.decisive, false);
  assert.ok(indexHtml.includes("徒歩分は判別できません"), "一覧に開示がある");
  assert.ok(basisHtml.includes("判別できない"), "根拠ページに開示がある");
  assert.ok(indexHtml.includes("駅から遠いから割安") || indexHtml.includes("駅から遠いから割安"),
    "誤読を明示的に禁じる注意書きがある");
});

test("rent: 残差の幅(この標本で言えない差の大きさ)を開示している", () => {
  assert.ok(indexHtml.includes("散ります"), "散らばりの開示がある");
  assert.ok(basisHtml.includes("残差"), "残差の説明がある");
  assert.ok(indexHtml.includes(model.spreadPct.toFixed(0)), "残差の実数が出ている(手書きでなくビルド時計算)");
});

test("rent: トイレ2個を条件にしていない理由が書かれている", () => {
  assert.ok(indexHtml.includes("トイレが1つとは限りません"), "記載なし≠無し の注意がある");
  assert.ok(indexHtml.includes(String(funnel.toilet2Documented)), "記載件数の実数が出ている");
  for (const h of propHtml) {
    assert.ok(h.includes("トイレ2個"), "物件ページにトイレ2個の欄がある");
  }
});

test("rent: 探索の漏斗が各段の落ちた数つきで出ている(黙って減らさない)", () => {
  assert.ok(indexHtml.includes("探索の漏斗"));
  for (const s of funnel.steps.slice(1)) {
    assert.ok(indexHtml.includes(`−${s.dropped}`), `段「${s.label}」の落ちた数が出ていない`);
  }
  assert.ok(indexHtml.includes(`${funnel.poolN}件`), "母集団の件数が出ている");
});

test("rent: 定期借家は3年のみ可という条件と、その理由・母集団比率が開示されている", () => {
  const teiki = pool.filter((d) => d.contract_type === "teiki").length;
  assert.ok(basisHtml.includes(`${teiki}件`), "定期借家の実数が出ている");
  assert.ok(basisHtml.includes("例外ではない"), "定期借家が例外でない旨の開示がある");
  assert.ok(indexHtml.includes("定期借家3年ちょうど"), "掲載条件に許容年数が明記されている");
  assert.ok(indexHtml.includes("2年・4年以上はKO"), "上下どちらに外れても落ちることが書かれている");
  // 「短いからKO」ではなく「長さの要件」という理由が消えると、条件が理不尽に見える
  assert.ok(basisHtml.includes("長さの要件"), "根拠ページに理由がある");
  assert.ok(indexHtml.includes("小学校入学前") || basisHtml.includes("小学校入学前"), "許容の理由が書かれている");
});

test("rent: 定期借家の物件は満了で終わることと、期間超の値が参考値である旨が出ている", () => {
  const teikiRows = results.filter(({ rental }) => rental.terms?.contract_type === "teiki");
  assert.ok(teikiRows.length > 0, "台帳に定期借家の物件がある(この条件が効いている証拠)");
  assert.ok(indexHtml.includes("満了で終了"), "一覧に満了で終わる旨がある");
  assert.ok(indexHtml.includes("再契約前提の参考値"), "期間超が参考値である旨がある");
  for (const { res, rental } of teikiRows) {
    const h = renderRentProperty(res, rental, { asOf, model });
    assert.ok(h.includes("更新の権利はない"), `${rental.id}: 普通借家との違いが書かれていない`);
    assert.ok(h.includes("年より先の行は参考値"), `${rental.id}: カーブの期間超の注意がない`);
    // 定期借家に更新料を計上していないこと(カーブの更新回数が全て0)
    assert.ok(res.curve.every((c) => c.breakdown.renewal === 0), `${rental.id}: 定期借家に更新料が乗っている`);
  }
});

test("rent: ハザードは記録するが除外しない方針が明示されている", () => {
  assert.ok(indexHtml.includes("ハザードマップ内も対象に含める"), "方針の明記がある");
  const blocked = results.filter(({ rental }) => rental.hazard_check.official.reference_verdict === "block");
  assert.ok(blocked.length > 0);
  // 家屋倒壊等氾濫想定区域は浸水と別区分であることを、該当物件のページで区別している
  const flow = results.find(({ rental }) => (rental.hazard_check.official.hits ?? []).some((h) => /家屋倒壊/.test(h)));
  if (flow) {
    const h = renderRentProperty(flow.res, flow.rental, { asOf, model });
    assert.ok(h.includes("浸水とは別の区分"), "家屋倒壊等氾濫想定を浸水と同列に並べていない");
  }
});

test("rent: 実質月額の仮定が名指しで開示されている", () => {
  assert.ok(indexHtml.includes("実質月額に使った仮定"));
  for (const { res, rental } of results) {
    if (!res.assumed.length) continue;
    const h = renderRentProperty(res, rental, { asOf, model });
    for (const a of res.assumed) {
      assert.ok(h.includes(a), `${rental.id}: 仮定「${a}」が物件ページに出ていない`);
    }
  }
});

test("rent: 更新料による鋸歯(実質月額が一度上がる年がある)を説明している", () => {
  assert.ok(indexHtml.includes("上向きに折れている"), "曲線が単調でない理由の説明がある");
});

test("rent: メモ・検討状況をHTMLへ焼き込まない(localStorageのみ)", () => {
  // 運用ルール3の賃貸版。台帳YAMLにmemoが無いこと、HTMLに初期値として入らないこと
  for (const id of listRentalIds()) {
    const p = loadRental(id);
    assert.ok(!("memo" in p), `${id}: YAMLにmemoを持たせてはいけない`);
  }
  const memos = indexHtml.match(/<textarea class="memota"[^>]*>([^<]*)<\/textarea>/g) ?? [];
  assert.equal(memos.length, results.length, "メモ欄が全行にある");
  for (const m of memos) {
    assert.match(m, /><\/textarea>$/, "メモ欄に初期値が焼き込まれている");
  }
  assert.ok(indexHtml.includes("公開リポジトリには書き込みません"), "保存先の明示がある");
});

test("rent: SVGにrole/aria-labelがある", () => {
  for (const [name, h] of [["一覧", indexHtml], ["根拠", basisHtml]]) {
    const svgs = h.match(/<svg [^>]*>/g) ?? [];
    assert.ok(svgs.length > 0, `${name}ページにSVGがある`);
    for (const s of svgs) {
      assert.ok(s.includes('role="img"'), `${name}: role=img がある`);
      assert.ok(s.includes("aria-label"), `${name}: aria-label がある`);
    }
  }
  // 回転させたテキストは見切れ検査(tests/ui/cliff.svg.mjs)に落ちるため使わない
  assert.ok(!/rotate\(-90/.test(indexHtml + basisHtml), "縦軸ラベルに rotate(-90) を使わない(運用ルール5)");
});

test("rent: 購入台帳と相互にリンクしている", () => {
  assert.ok(indexHtml.includes('href="index.html"'), "一覧から購入台帳へ");
  assert.ok(indexHtml.includes('href="rent-basis.html"'), "一覧から根拠ページへ");
  assert.ok(basisHtml.includes('href="rent.html"'), "根拠ページから一覧へ");
  for (const h of propHtml) assert.ok(h.includes('href="../rent.html"'), "物件ページから一覧へ");
});
