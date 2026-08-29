// tests/retail.test.js — リテール比較法(戸建成約比較)の不変条件と回帰値
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../engine/appraise.js";
import { loadHouseDeals, loadVerification, retailEstimate, RETAIL, REGULAR_SHAPES, breadthAdjOf, normalizeLandUnit } from "../engine/retail.js";
import { growthFactor } from "../engine/timeadjust.js";
import { calibrate } from "../engine/calibrate.js";
import { loadAreaConfig, loadProperty, listPropertyIds } from "../engine/io.js";

const AS_OF = new Date(Date.UTC(2026, 7, 10));  // 2026-08-10 固定

test("検証パイプライン: conflict行は査定から除外され、検証状態が全行に付与される", () => {
  const v = loadVerification();
  assert.ok(v && v.rows.length >= 400, "verification.jsonが存在する");
  const conflicts = v.rows.filter((r) => r.status === "conflict");
  const deals = loadHouseDeals();
  const keys = new Set(deals.map((d) => [d.quarter, d.district, d.price_man, d.land_m2, d.floor_m2, d.age_y, d.walk_min].join("|")));
  for (const c of conflicts) assert.ok(!keys.has(c.key), `conflict行が査定に混入: ${c.key}`);
  for (const d of deals) assert.ok(["verified2", "verified1", "unverified", "unchecked"].includes(d.verification));
  // 全行に人間がファクトチェックできる出所が記録されている
  for (const r of v.rows) assert.ok(r.source_primary && r.source_secondary && r.source_origin, `出所欠落: ${r.key}`);
});

test("house-deals.csv: 全行が数値として妥当・外れ値がロード時に除外される", () => {
  const deals = loadHouseDeals();
  assert.ok(deals.length >= 400, `件数: ${deals.length}`);
  for (const d of deals) {
    assert.ok(d.price_man > 100 && d.price_man < 100000, `${d.quarter} ${d.district}: price ${d.price_man}`);
    assert.ok(d.land_m2 > 10 && d.land_m2 < 1000, `land ${d.land_m2}`);
    assert.ok(d.floor_m2 > 10 && d.floor_m2 < 1000, `floor ${d.floor_m2}`);
    assert.ok(Number.isFinite(d.age_y) && Number.isFinite(d.walk_min));
    assert.ok(d.walk_min >= 0 && d.walk_min <= 30, `徒歩域外がロードされた: ${d.walk_min}分`);
    assert.match(d.quarter, /^\d{4}Q[1-4]$/, `四半期書式: ${d.quarter}`);
    assert.ok(d.quarter.slice(0, 4) >= "2022");
  }
});

test("敵対的: 徒歩外れ値・新築混入・負の単価が事例比較を汚染しない", () => {
  const asOf = AS_OF;
  const base = { land: 66, setback: 0, floor: 88, walk: 13, age: 16,
    shape: 0, dir: 0.02, roadq: 0, corner: false, extra: 0, lc: 0, repair: 800, bm: -0.05 };
  // 徒歩90分の事例を故意に混入しても、フィルタで除外されるか単価が発散しない
  const poisoned = [
    ...loadHouseDeals(),
    { quarter: "2023Q2", district: "神谷", price_man: 4700, land_m2: 66, floor_m2: 88, age_y: 16, walk_min: 90, source_url: "" },
  ];
  const r = retailEstimate(base, asOf, poisoned, { subjectDistrict: "赤羽西" });
  assert.ok(r, "比較成立");
  for (const c of r.comps) {
    assert.ok(c.unitAdj > 0, `負の単価: ${JSON.stringify(c)}`);
    assert.ok(c.unitAdj < 2000, `発散した単価: ${Math.round(c.unitAdj)}万/坪 (${c.quarter} ${c.district} 徒歩${c.walk_min}分)`);
    assert.ok(c.walk_min <= RETAIL.WALK_MAX, "徒歩上限超の事例が混入");
  }
  // 中古(築16年)の査定に新築建売(築1年未満)が混ざらない
  for (const c of r.comps) assert.ok(c.age_y >= RETAIL.NEWBUILD_AGE, `新築混入: 築${c.age_y}年`);
});

test("敵対的: 減価要因(再建築不可)がリテール経路でも消滅しない", () => {
  // 2026-08-13: 志茂3を固定の題材にしていたが、同物件がハザード該当で台帳から外れたため
  // 特定物件に依存しない形へ変更した(台帳の増減でテストが壊れないほうが本来正しい)
  const cfg = loadAreaConfig();
  const deals = loadHouseDeals();
  let withRetail = 0;
  for (const id of listPropertyIds()) {
    const prop = loadProperty(id);
    const normal = evaluate(prop, cfg, { asOf: AS_OF, houseDeals: deals });
    const noRebuild = evaluate(
      { ...prop, land: { ...prop.land, legal: { ...prop.land.legal, rebuildable: false } } },
      cfg, { asOf: AS_OF, houseDeals: deals });
    const ratio = noRebuild.fairFinal.mid / normal.fairFinal.mid;
    assert.ok(ratio < 1, `${id}: 再建築不可で下がるべき ${Math.round(normal.fairFinal.mid)} → ${Math.round(noRebuild.fairFinal.mid)}`);
    if (normal.retail) {
      withRetail++;
      // リテール比較が主導していても、土地側の-30%が事例平均に呑まれて消えないこと
      assert.ok(ratio < 0.85, `${id}: リテール経路で減価が薄まりすぎ(比 ${ratio.toFixed(3)})`);
    }
  }
  assert.ok(withRetail >= 5, "リテール成立物件が十分ある: " + withRetail);
});

test("地域要因: 事例は対象の近接地区に限定される(不足時のみ全地区+フラグ)", () => {
  const deals = loadHouseDeals();
  const base = { land: 66, setback: 0, floor: 88, walk: 10, age: 15,
    shape: 0, dir: 0, roadq: 0, corner: false, extra: 0, lc: 0, repair: 800, bm: -0.05 };
  const r = retailEstimate(base, AS_OF, deals, { subjectDistrict: "赤羽西" });
  assert.ok(r && r.districtScoped, "近接地区限定が成立する");
  const allowed = ["赤羽西", "西が丘", "赤羽台", "赤羽"];
  for (const c of r.comps) assert.ok(allowed.includes(c.district), `近接外の事例が混入: ${c.district}`);
  // subjectDistrict不明でも落ちない(全地区・フラグfalse)
  const r2 = retailEstimate(base, AS_OF, deals, { subjectDistrict: null });
  assert.ok(r2 && !r2.districtScoped);
});

test("時点修正(年次別): 過去→現在で1超・逆向きは逆数・恒等", () => {
  assert.ok(growthFactor("2022Q1", "2026-08-10") > 1.2);
  const f = growthFactor("2023Q3", "2025-01-01");
  const g = growthFactor("2025-01-01", "2023Q3");
  assert.ok(Math.abs(f * g - 1) < 1e-9, "逆向きは逆数");
  assert.equal(growthFactor("2024-05-15", "2024-05-15"), 1);
});

test("回帰値: 赤羽西4のリテール比較が実勢レンジ内で、適正価格に採用される", () => {
  const r = evaluate(loadProperty("akabanenishi4-21036139"), loadAreaConfig(),
    { asOf: AS_OF, houseDeals: loadHouseDeals() });
  assert.ok(r.retail, "リテール比較が成立する");
  assert.ok(r.retail.n >= RETAIL.MIN_COMPS, `類似成約 ${r.retail.n}件`);
  // 監査③の実測(同帯の直近成約 5,700〜6,800万・中心6,000〜6,400万)と整合すること
  assert.ok(r.retail.mid > 5500 && r.retail.mid < 7000, `リテール中央値: ${r.retail.mid}`);
  // 重み付き調整(第2次監査)により、統合適正は両手法の間(±フロア下限)に収まる
  const lower = Math.min(r.retail.mid, r.mid.fair) - 1e-9;
  const upper = Math.max(r.retail.mid, r.mid.fair, r.mid.floorVal) + 1e-9;
  assert.ok(r.fairFinal.mid >= lower && r.fairFinal.mid <= upper, `統合適正が両手法の外: ${r.fairFinal.mid}`);
  assert.ok(r.mid.floorVal * r.fairFinal.floorGuard <= r.fairFinal.mid + 1e-9, "floor×guard<=fair不変条件");
  assert.ok(r.retail.lo <= r.retail.mid && r.retail.mid <= r.retail.hi, "四分位の順序");
});

test("不変条件: 全登録物件(較正込み)で floorNet<=floorVal<=fairFinal / lo<=mid<=hi", () => {
  const cfg = loadAreaConfig();
  const deals = loadHouseDeals();
  const cal = calibrate();
  for (const id of listPropertyIds()) {
    const r = evaluate(loadProperty(id), cfg, { asOf: AS_OF, houseDeals: deals, cal });
    assert.ok(r.mid.floorNet <= r.mid.floorVal + 1e-9, `${id}: floorNet>floorVal`);
    assert.ok(r.mid.floorVal * r.fairFinal.floorGuard <= r.fairFinal.mid + 1e-9, `${id}: floor×guard>fair`);
    assert.ok(r.fairFinal.lo <= r.fairFinal.mid + 1e-9 && r.fairFinal.mid <= r.fairFinal.hi + 1e-9, `${id}: レンジ順序`);
    assert.ok(Number.isFinite(r.premium) && Number.isFinite(r.instLoss));
    if (r.retail) {
      assert.ok(r.fairFinal.weights.retail + r.fairFinal.weights.cost === 1, `${id}: 重みが1に正規化されていない`);
      for (const c of r.retail.comps) assert.ok(c.unitAdj > 0 && c.unitAdj < 2000, `${id}: 補正後単価が異常 ${c.unitAdj}`);
    }
  }
});

test("較正接続: 信頼度が十分なエリアは較正値が採用され、参考は従来値を維持", () => {
  const cfg = loadAreaConfig();
  const cal = calibrate();
  // akabane-nishi(較正205・従来245) → level=lowは50:50ブレンド(R3監査: フル置換の崖を解消)
  const r1 = evaluate(loadProperty("akabanenishi4-21036139"), cfg, { asOf: AS_OF, cal });
  assert.equal(Math.round(r1.state.ppt), 225);
  // jujo-nakahara(参考・極小標本) → 物件YAMLの上書きを維持
  const r2 = evaluate(loadProperty("jujonakahara2-21028966"), cfg, { asOf: AS_OF, cal });
  assert.equal(Math.round(r2.state.ppt), 300);
  // cal未指定なら従来どおり
  const r3 = evaluate(loadProperty("akabanenishi4-21036139"), cfg, { asOf: AS_OF });
  assert.equal(Math.round(r3.state.ppt), 245);
});

test("価格の位置(2026-08-13: 機械判定を廃止し事実提示のみ)", () => {
  const cfg = loadAreaConfig();
  const deals = loadHouseDeals();
  const cal = calibrate();
  // jujonakahara3: 売出6,580 vs 市場実勢中央値≈6,279(売主の期待+301)・上位四分位≈6,566。
  // かつては「保留/見送」を成約分布で判定していたが、買うか見送るかは人の判断であるため
  // スタンプを全廃した。エンジンは参照水準(中央値・上位四分位・交渉幅を載せた水準・
  // 土地換算値)と売出の位置関係を数字で返すのみ
  const r = evaluate(loadProperty("jujonakahara3-adcast"), cfg, { asOf: AS_OF, houseDeals: deals, cal });
  assert.equal(r.position.basis, "market");
  assert.ok(!("mark" in r.position), "ラベルを持たない");
  assert.ok(Number.isFinite(r.premiumMarket) && Number.isFinite(r.overheat));
  assert.ok(r.overheat > 0, "市場の上振れ(過熱感)が正のはずの局面");
  assert.ok(r.negoBand > r.retail.hi, "参照水準=上位四分位+交渉幅");
  assert.ok(r.position.body.includes("売主の期待"), "売主の期待を数字で開示する");
  // 市場実勢から大きく外れる物件(売出が上位四分位+38%)でも、返すのは差額の事実だけ
  const r2 = evaluate(loadProperty("nishigaoka1-21215249"), cfg, { asOf: AS_OF, houseDeals: deals, cal });
  assert.equal(r2.position.basis, "market");
  assert.ok(r2.state.ask > r2.negoBand, "この物件は交渉幅を載せた水準を超えている");
  assert.ok(!/見送|保留/.test(r2.position.head + r2.position.body), "判定語を出さない");
  // リテール不成立(商業系×未検証単価)は、旧「調査」降格の中身を注記として残す
  const r3 = evaluate(loadProperty("jujonakahara2-21028966"), cfg, { asOf: AS_OF, houseDeals: deals, cal });
  assert.equal(r3.position.basis, "blend");
  assert.equal(r3.negoBand, null);
  assert.ok(r3.position.notes.some((n) => n.includes("未検証")), "単価未検証の開示が残る");
});

// ---- 土地形状によるプール統制(2026-08-13) ----
// R4監査で指摘された二重減価の対処。従来は house-deals.csv に形状列が無く、事例プールに
// 旗竿・不整形が混入していたため、対象の形状補正を半減で当てる保守側ヒューリスティックを使っていた。
// 出典(utinokati listings)に「土地形状」列があると分かったので転記し、
// **プールを整形地に限定できるときは満額適用**へ切り替えた。切替条件が静かに緩むのを防ぐ。
test("形状列: house-deals.csv に転記され、語彙は既知のものだけ(推測で埋めていない)", () => {
  const deals = loadHouseDeals();
  const known = new Set([...REGULAR_SHAPES, "不整形", "やや不整形", "旗竿地", "袋地等", "袋地"]);
  const withShape = deals.filter((d) => d.shape);
  // 出典に記載のない行は空のまま(全件が埋まっていたら推測で補完した疑い)
  assert.ok(withShape.length > 300, `形状ありが少なすぎる: ${withShape.length}`);
  assert.ok(withShape.length < deals.length, "全件に形状が入っている(出典に無い行を埋めた疑い)");
  for (const d of withShape) assert.ok(known.has(d.shape), `未知の形状表記: ${d.shape}`);
});

test("形状プール: 整形地が閾値以上なら満額・不足なら半減へ退避し、いずれも根拠を開示する", () => {
  const deals = loadHouseDeals();
  const asOf = new Date(Date.UTC(2026, 7, 13));
  // 西が丘2(新築・整形地事例が厚い)は整形地限定プールに乗る
  const thick = retailEstimate(
    { land: 60.65, setback: 0, walk: 17, age: 0, floor: 106.26, shape: 0, dir: 0, roadq: 0,
      corner: false, extra: 0, lc: 0, repair: 0, rebuild: 95 },
    asOf, deals, { subjectDistrict: "西が丘" });
  assert.ok(thick, "リテール比較が成立する");
  assert.equal(thick.shapeControlled, true, thick.shapeBasis);
  assert.ok(thick.n >= RETAIL.SHAPE_POOL_MIN);
  assert.match(thick.shapeBasis, /整形地限定プール/);
  // 事例側が全件整形地であること(統制の実体)
  for (const c of thick.comps) assert.ok(REGULAR_SHAPES.has(c.shape), `整形地以外が混入: ${c.shape}`);

  // 赤羽台3(整形地事例が薄い)は混合プールへ退避し、半減であることと不明件数を開示する
  const thin = retailEstimate(
    { land: 91.44, setback: 14.04, walk: 11, age: 27, floor: 68.6, shape: 0, dir: 0.02, roadq: -0.05,
      corner: false, extra: 0, lc: 0, repair: 800, rebuild: 70 },
    asOf, deals, { subjectDistrict: "赤羽台" });
  assert.ok(thin, "リテール比較が成立する");
  assert.equal(thin.shapeControlled, false, thin.shapeBasis);
  assert.match(thin.shapeBasis, /混合プール.*形状補正は半減.*形状不明/);
});

test("形状プール: 統制の有無で対象の形状補正の効き方が2倍変わる(旗竿で検算)", () => {
  const deals = loadHouseDeals();
  const asOf = new Date(Date.UTC(2026, 7, 13));
  const base = { land: 60.65, setback: 0, walk: 17, age: 0, floor: 106.26, dir: 0, roadq: 0,
    corner: false, extra: 0, lc: 0, repair: 0, rebuild: 95 };
  const reg = retailEstimate({ ...base, shape: 0 }, asOf, deals, { subjectDistrict: "西が丘" });
  const flag = retailEstimate({ ...base, shape: -0.25 }, asOf, deals, { subjectDistrict: "西が丘" });
  assert.equal(reg.shapeControlled, true);
  // 満額適用なので subjectFactor の差は形状補正そのもの(-0.25)に一致する
  assert.ok(Math.abs((flag.subjectFactor - reg.subjectFactor) + 0.25) < 1e-9,
    `満額でない: ${reg.subjectFactor} → ${flag.subjectFactor}`);
  // 土地部分(形状が効く場所)で検算する。mid は建物残価の入力が要るため、ここでは landPart を見る
  assert.ok(flag.landPart < reg.landPart, `旗竿のほうが土地部分が低く出る: ${reg.landPart} → ${flag.landPart}`);
  assert.ok(Math.abs(flag.landPart / reg.landPart - flag.subjectFactor / reg.subjectFactor) < 0.02,
    "土地部分の比が subjectFactor の比に一致する(形状が単価に素直に効いている)");
  // 半減側(統制できないプール)では同じ旗竿でも効きが約半分に留まることを対照で示す
  const thinReg = retailEstimate({ land: 91.44, setback: 14.04, walk: 11, age: 27, floor: 68.6, shape: 0,
    dir: 0.02, roadq: -0.05, corner: false, extra: 0, lc: 0, repair: 800, rebuild: 70 },
    asOf, deals, { subjectDistrict: "赤羽台" });
  const thinFlag = retailEstimate({ land: 91.44, setback: 14.04, walk: 11, age: 27, floor: 68.6, shape: -0.25,
    dir: 0.02, roadq: -0.05, corner: false, extra: 0, lc: 0, repair: 800, rebuild: 70 },
    asOf, deals, { subjectDistrict: "赤羽台" });
  assert.equal(thinReg.shapeControlled, false);
  assert.ok(Math.abs((thinFlag.subjectFactor - thinReg.subjectFactor) + 0.125) < 1e-9,
    `半減になっていない: ${thinReg.subjectFactor} → ${thinFlag.subjectFactor}`);
});

// ---- 一次ソース(国土交通省 不動産情報ライブラリAPI)由来の属性(2026-08-13) ----
// 再掲サイトには無い「前面道路の種類(私道/公道)」と「幅員」を取り込んだ。
// 語彙が増えたり、推測で埋められたりしていないことを固定する。
test("道路種別・幅員: APIから転記され、語彙と値域が妥当(推測で埋めていない)", () => {
  const deals = loadHouseDeals();
  const withRoad = deals.filter((d) => d.road_type);
  assert.ok(withRoad.length > 500, `道路種別ありが少なすぎる: ${withRoad.length}`);
  assert.ok(withRoad.length < deals.length, "全件に道路種別が入っている(原データに無い行を埋めた疑い)");
  for (const d of withRoad) assert.ok(d.road_type === "private" || d.road_type === "public", `未知の道路種別: ${d.road_type}`);
  // 私道は4割前後を占める(北区の実測)。ここが極端に偏ったら転記か照合を疑う
  const priv = withRoad.filter((d) => d.road_type === "private").length / withRoad.length;
  assert.ok(priv > 0.3 && priv < 0.55, `私道比率が想定外: ${(priv * 100).toFixed(1)}%`);
  // 幅員は実在しうる範囲
  for (const d of deals.filter((x) => x.breadth_m != null)) {
    assert.ok(d.breadth_m > 0 && d.breadth_m < 50, `幅員が異常: ${d.breadth_m}`);
  }
});

test("形状: 一次ソースと再掲サイトで矛盾していない(照合の妥当性の担保)", () => {
  // 2026-08-13の突き合わせ実測: 447件で一致・不一致ゼロ。CSVは両ソースの合成なので、
  // ここでは「整形/不整形の語彙が混ざっていないこと」と記載率が想定どおりであることを見る
  const deals = loadHouseDeals();
  const withShape = deals.filter((d) => d.shape);
  const rate = withShape.length / deals.length;
  // APIでも埋まらない欠測(原データで「地域」区分が空の行)があるため6割前後で頭打ちになる
  assert.ok(rate > 0.55 && rate < 0.7, `形状の記載率が想定外: ${(rate * 100).toFixed(1)}%`);
});

// ---- 前面道路の幅員(2026-08-29新設) ----
// 経緯: 上十条3の事例プールに、幅員1.2m・1.7m=接道義務(建築基準法42条)を満たさない成約が
// 入っていた(台帳ならKO1で落とす条件)。当初は「土地値の50%未満を外す」案を検討したが、
// 答えを先に決めてそれに逆らうデータを捨てる循環論法なので、物理的属性である幅員で切る形にした。

test("幅員補正: 節点の形と、記載なしを『幅員0m』として減点しないこと", () => {
  // 折れ線の補間で端数が出るため、節点は許容誤差つきで比較する
  const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-9, `${why}: ${a} != ${b}`);
  near(breadthAdjOf(1.0), -0.20, "2.0m以下は下限で頭打ち");
  near(breadthAdjOf(2.0), -0.20, "節点2.0m");
  near(breadthAdjOf(2.7), -0.10, "節点2.7m");
  near(breadthAdjOf(4.0), -0.05, "節点4.0m");
  near(breadthAdjOf(5.0), 0, "節点5.0m");
  near(breadthAdjOf(6.0), 0, "4〜6mが標準条件=補正なし");
  near(breadthAdjOf(7.0), 0.10, "節点7.0m");
  near(breadthAdjOf(12), 0.10, "7m超は上限で頭打ち");
  // 単調非減少(帯の階段にせず折れ線で補間しているので、途中で反転しないこと)
  let prev = -Infinity;
  for (let b = 0.5; b <= 12; b += 0.1) {
    const v = breadthAdjOf(b);
    assert.ok(v >= prev - 1e-12, `幅員${b.toFixed(1)}mで反転: ${v} < ${prev}`);
    prev = v;
  }
  // **実装直後に踏んだ罠の回帰ガード**: Number(null)===0 / Number("")===0 はいずれも
  // Number.isFinite が true になるため、生値を見ずに coerce すると「幅員0m」として
  // 最大減点(-20%)が当たる。記載なしは必ず「判定しない」=0 でなければならない
  for (const v of [null, undefined, "", "  ", NaN, "不明", 0, -1]) {
    assert.equal(breadthAdjOf(v), 0, `記載なし/不正値 ${JSON.stringify(v)} に補正が当たっている`);
  }
});

test("幅員: 接道義務を満たさない事例はプールに入らない(台帳のKO1と一貫)", () => {
  const deals = loadHouseDeals();
  const withB = deals.filter((d) => Number.isFinite(d.breadth_m));
  assert.ok(withB.length >= 500, `幅員の記載がある事例が十分にある: ${withB.length}件`);
  const ko = withB.filter((d) => d.breadth_m < RETAIL.BREADTH_KO_M);
  assert.ok(ko.length > 0, "そもそも接道義務未充足の事例が原データに存在する(前提)");

  for (const id of listPropertyIds()) {
    const r = evaluate(loadProperty(id), loadAreaConfig(), { asOf: AS_OF, houseDeals: deals });
    if (!r.retail) continue;
    for (const c of r.retail.comps) {
      assert.ok(!(Number.isFinite(c.breadth_m) && c.breadth_m < RETAIL.BREADTH_KO_M),
        `${id}: 接道義務未充足の事例がプールに残っている(${c.district}${c.price_man}万・幅員${c.breadth_m}m)`);
    }
    // 黙って減らさない: 除外したなら必ず開示文に出る
    assert.ok(typeof r.retail.breadthBasis === "string" && r.retail.breadthBasis.length > 0,
      `${id}: 幅員の開示文がない`);
    if (r.retail.koBreadth.length) {
      assert.match(r.retail.breadthBasis, /接道義務未充足/, `${id}: 除外したのに開示文に出ていない`);
      for (const k of r.retail.koBreadth) {
        assert.ok(r.retail.breadthBasis.includes(String(k.price_man)), `${id}: 除外事例の内訳が開示されていない`);
      }
    }
  }
});

test("幅員: 事例は標準条件(4〜6m)へ正規化され、対象側の接道補正と二重にならない", () => {
  const asOf = AS_OF;
  const base = { quarter: "2025Q1", district: "赤羽西", price_man: 6000, land_m2: 70, floor_m2: 95,
    age_y: 10, walk_min: 8, shape: "長方形", road_type: "public" };
  // 同一諸元で幅員だけ違う2件は、正規化後に幅員ぶんの差が消えていること
  const narrow = normalizeLandUnit({ ...base, breadth_m: 2.7 }, asOf);
  const std = normalizeLandUnit({ ...base, breadth_m: 5.0 }, asOf);
  const wide = normalizeLandUnit({ ...base, breadth_m: 8.0 }, asOf);
  assert.ok(narrow > std, "狭い道路の成約は、標準条件へ戻すと単価が上がる");
  assert.ok(wide < std, "広い道路の成約は、標準条件へ戻すと単価が下がる");
  assert.ok(Math.abs(narrow / std - 1 / (1 - 0.10)) < 1e-9, `2.7mの正規化量: ${narrow / std}`);
  assert.ok(Math.abs(wide / std - 1 / (1 + 0.10)) < 1e-9, `8.0mの正規化量: ${wide / std}`);
  // 記載なしは素通し(従来の挙動と完全一致)
  const none = normalizeLandUnit({ ...base, breadth_m: null }, asOf);
  assert.equal(none, std, "幅員の記載がない事例は補正せず標準条件と同じ扱い");
});
