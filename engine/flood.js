// engine/flood.js — 外水氾濫(荒川の破堤)で「この地点が深さd以上に浸かる」年あたりの確率のフェルミ推定。
//
// 2026-10-11 ユーザー要望「外水氾濫で3〜5mのところにスポットライトを当てて、1m / 3m / 最大5m がそれぞれ
// どれくらいの確率かフェルミ推定で出したい」(題材: 神谷2-24-11)。同日、別コンテキストの敵対的検算を受けて改訂
// (改訂点は各所のコメント。検算の要旨は CLAUDE.md「神谷2-24-11 の浸水を『深さ別の確率』に分解した」節)。
//
// 確率は3つの因子の積で立てる(どれが公式データで、どれが置いた仮定かを分けて持つ):
//   P(年, 深さ≥d) = Σ_帯 P(その規模の洪水が来る) × P(破堤する | その規模) × P(破堤地点の水がこの地点に深さd以上で届く | 破堤)
//   ① 洪水の規模の帯: 荒川の計画規模(1/200)・想定最大規模(「想定し得る最大」=確率の定義ではないが1/1000程度と呼ばれる)は公式。
//      その下の帯(氾濫危険水位を超えるが計画規模には届かない)は現行の川(第一調節池あり)の実績で置く:
//      2019年台風19号は流域3日雨量が観測史上1位(446mm)でも岩淵 A.P.+7.17m=氾濫危険水位7.70m未満に収まった
//   ② 破堤の条件付き確率: **仮定**。ハザードマップは破堤を前提に描く(本川は計画高水位到達で破堤を仮定)が、
//      実際の破堤率は別。2019年の全国142決壊のうち越水起因が86%・浸透2%で、越水しない帯の破堤は稀
//   ③ 破堤地点の寄与: **公式データ**。国交省 浸水ナビの破堤点別シミュレーション(破堤点ごとの到達深)を
//      「破堤はどの地点でも同じ確率で起きる(1洪水1破堤)」の仮定で数える。ハザードマップの「3.0〜5.0m」は全破堤点の最大包絡
//      なので、そのまま確率にはならない——これがこの推定の中心
//
// 検算で直した構造(2026-10-11):
//   - 帯の深さを帯の下端の図で代表させる階段近似は3m以上を系統的に低く出す(L1図 516mm→L2図 632mm で中央値2.19→3.09m)。
//     計画規模〜想定最大の帯は **L1図とL2図の届く割合の平均**(帯の中央の深さの近似)で置く
//   - 計画規模未満の帯は破堤確率を 0.05〜0.2 → 0.01〜0.05 に下げ、年確率も 1/100〜1/300 の桁に下げた(ダム以前の1947年を根拠にしない)
//   - 「1洪水1破堤」は確率を下げる側の単純化。複数破堤(ポアソン)の場合も計算して開示する(multiBreach)
//   - 気候変動は「2℃上昇で頻度約2倍」を初年から30年全部に当てると上限。線形に上がるランプの平均 ×1.3 も併記する
//
// 入力の正本は market/flood-fermi-<物件>-<日付>.json(crawler/suibou-nav.mjs が浸水ナビから生成)。
// 数値はここで計算し、ページには手書きしない。**フェルミ推定=桁の目安**であり、公式の確率ではない(開示は描画側で必ず出す)。

export const THRESHOLDS_M = [0.5, 1, 2, 3, 4, 5];

// 帯の既定値。annual/breach は [低, 中, 高] の3点。
// depthFrom はスナップショットの破堤点グループ(l1=計画規模/l2=想定最大)を [{group, weight}] で混ぜる。
// depthScale は「その帯の水はシミュレーションの深さの何倍か」(計画規模未満の帯は計画規模の半分と置く=仮定)
export const DEFAULT_BANDS = [
  { key: "sub_l1", label: "氾濫危険水位超〜計画規模未満(1/100〜1/300)", annual: [0.003, 0.006, 0.01], breach: [0.01, 0.03, 0.05],
    depthFrom: [{ group: "l1", weight: 1 }], depthScale: 0.5,
    basis: "現行の川(第一調節池あり)の実績: 2019年台風19号は流域3日雨量が観測史上1位(446mm)でも岩淵 A.P.+7.17m=氾濫危険水位7.70m未満。計画高水位(8.57m)超は1947年カスリーン台風(8.60m・調節池の無い川・下流本川は破堤せず)の1回。越水しない水位での破堤は浸透・侵食に限られ、2019年の全国142決壊でも浸透起因は2%" },
  { key: "l1", label: "計画規模(1/200)〜想定最大規模未満", annual: [0.004, 0.004, 0.004], breach: [0.3, 0.5, 0.7],
    depthFrom: [{ group: "l1", weight: 0.5 }, { group: "l2", weight: 0.5 }], depthScale: 1,
    basis: "年確率は 1/200−1/1000=0.4%。深さは帯の下端(計画規模図・516mm)と上端(想定最大図・632mm)の届く割合の平均=帯の中央の近似(下端だけで代表させると3m以上が系統的に低く出る)。破堤確率は『計画高水位を超える水位が続けば越水・破堤が現実味を持つ(2019年の国管理河川は越水72か所のうち決壊14=約2割。水位超過が長引く荒川はそれより高い)』として0.3〜0.7" },
  { key: "l2", label: "想定最大規模(1/1000程度)以上", annual: [0.001, 0.001, 0.001], breach: [0.6, 0.8, 0.9],
    depthFrom: [{ group: "l2", weight: 1 }], depthScale: 1,
    basis: "年確率は想定最大規模を1/1000程度と読んだ値(国の定義は確率ではなく『想定し得る最大規模の降雨』)。この規模では越水がほぼ確実で破堤確率を0.6〜0.9に置く。632mmを超える雨は公式計算の外(深さの上限は未計算)" },
];

// スナップショットの破堤点グループ {breakpoints_total, rows:[{depth_m}]} から、
// 「全破堤点のうち、この地点に深さ t 以上の水を届ける破堤点の割合」を返す(届かない破堤点は深さ0として分母に入れる)
export function reachFraction(group, t, scale = 1) {
  if (!group || !group.breakpoints_total) return 0;
  const n = (group.rows ?? []).filter((r) => Number(r.depth_m) * scale >= t).length;
  return n / group.breakpoints_total;
}

// 帯の届く割合(depthFrom の重み付き平均)
export function bandReachFraction(groups, band, t) {
  const from = typeof band.depthFrom === "string" ? [{ group: band.depthFrom, weight: 1 }] : band.depthFrom;
  const w = from.reduce((s, f) => s + f.weight, 0) || 1;
  return from.reduce((s, f) => s + f.weight * reachFraction(groups[f.group], t, band.depthScale ?? 1), 0) / w;
}

export function groupStats(group) {
  const ds = (group?.rows ?? []).map((r) => Number(r.depth_m)).filter(Number.isFinite).sort((a, b) => a - b);
  const ge = (t) => ds.filter((d) => d >= t).length;
  return {
    total: group?.breakpoints_total ?? 0,
    reaching: ds.length,
    median: ds.length ? ds[Math.floor(ds.length / 2)] : null,
    max: ds.length ? ds[ds.length - 1] : null,
    ge: Object.fromEntries(THRESHOLDS_M.map((t) => [t, ge(t)])),
  };
}

const cum = (p, years) => 1 - (1 - p) ** years;

// 破堤の条件付き確率 b と届く割合 f から、その帯で「この地点に届く破堤が1つ以上ある」確率。
//   single: 1洪水1破堤 → b × f
//   multi : 破堤箇所数をポアソン(平均λ=−ln(1−b)、P(≥1破堤)=b を保つ)・各破堤が独立に届く → 1−exp(−λf)
export function breachReach(b, f, multiBreach = false) {
  if (!multiBreach) return b * f;
  if (b >= 1) return 1 - Math.exp(-50 * f);
  const lambda = -Math.log(1 - b);
  return 1 - Math.exp(-lambda * f);
}

// 深さ別の年超過確率(低/中/高)と、years年累積、気候変動の累積(climateRamp=線形に上がるランプの平均 / climate=初年から上限)
export function exceedance(snapshot, { bands = DEFAULT_BANDS, thresholds = THRESHOLDS_M, years = 30, climate = 2, climateRamp = 1.3, multiBreach = false } = {}) {
  const groups = snapshot?.suibou_nav?.groups ?? {};
  return thresholds.map((t) => {
    const byBand = bands.map((b) => {
      const f = bandReachFraction(groups, b, t);
      return { key: b.key, label: b.label, reach: f, annual: b.annual.map((a, i) => a * breachReach(b.breach[i], f, multiBreach)) };
    });
    const annual = [0, 1, 2].map((i) => byBand.reduce((s, b) => s + b.annual[i], 0));
    const tri = (fn) => ({ low: fn(annual[0]), mid: fn(annual[1]), high: fn(annual[2]) });
    return {
      depth_m: t,
      annual: tri((p) => p),
      cum: tri((p) => cum(p, years)),
      rampCum: tri((p) => cum(p * climateRamp, years)),
      climateCum: tri((p) => cum(p * climate, years)),
      byBand,
      years, climate, climateRamp, multiBreach,
    };
  });
}

// 「1/N年」表記(0なら null)
export function oneInN(p) {
  if (!(p > 0)) return null;
  const n = 1 / p;
  const r = n >= 1000 ? Math.round(n / 100) * 100 : n >= 100 ? Math.round(n / 10) * 10 : Math.round(n);
  return r;
}
