// engine/flood.js — 外水氾濫(荒川の破堤)で「この地点が深さd以上に浸かる」年あたりの確率のフェルミ推定。
//
// 2026-10-11 ユーザー要望「外水氾濫で3〜5mのところにスポットライトを当てて、1m / 3m / 最大5m がそれぞれ
// どれくらいの確率かフェルミ推定で出したい」(題材: 神谷2-24-11)。
//
// 確率は3つの因子の積で立てる(どれが公式データで、どれが置いた仮定かを分けて持つ):
//   P(年, 深さ≥d) = Σ_帯 P(その規模の洪水が来る) × P(破堤する | その規模) × P(破堤地点の水がこの地点に深さd以上で届く | 破堤)
//   ① 洪水の規模の帯: 荒川の計画規模(1/200)・想定最大規模(1/1000程度)は公式の定義。その下の帯(氾濫危険水位を超えるが
//      計画規模には届かない)は岩淵水門(上)の観測史(1947カスリーン A.P.+8.60 ≧ 計画高水位8.57 / 1958 7.48 / 2019 7.17 ≧ 氾濫危険7.70?)
//      から 1/50〜1/200 と置く
//   ② 破堤の条件付き確率: **仮定**。ハザードマップは破堤を前提に描くが、1947年は計画高水位を超えても下流本川は破堤しなかった。
//      帯ごとに低/中/高の3点で持ち、結果も幅で出す
//   ③ 破堤地点の寄与: **公式データ**。国交省 浸水ナビの破堤点別シミュレーション(破堤点ごとの到達深)を
//      「破堤はどの地点でも同じ確率で起きる(1洪水1破堤)」の仮定で数える。ハザードマップの「3.0〜5.0m」は全破堤点の最大包絡
//      なので、そのまま確率にはならない——これがこの推定の中心
//
// 入力の正本は market/flood-fermi-<物件>-<日付>.json(crawler/suibou-nav.mjs が浸水ナビから生成)。
// 数値はここで計算し、ページには手書きしない。**フェルミ推定=桁の目安**であり、公式の確率ではない(開示は描画側で必ず出す)。

export const THRESHOLDS_M = [0.5, 1, 2, 3, 4, 5];

// 帯の既定値。annual/breach は [低, 中, 高] の3点。depthFrom はスナップショットの破堤点グループ(l1=計画規模/l2=想定最大)。
// depthScale は「その帯の水はシミュレーションの深さの何倍か」(計画規模未満の帯は計画規模の半分と置く=仮定)
export const DEFAULT_BANDS = [
  { key: "sub_l1", label: "氾濫危険水位超〜計画規模未満(1/50〜1/200)", annual: [0.005, 0.01, 0.015], breach: [0.05, 0.1, 0.2], depthFrom: "l1", depthScale: 0.5,
    basis: "岩淵水門(上)の観測史105年で計画高水位(A.P.+8.57m)超は1947年の1回・氾濫危険水位(7.70m)級は1947/1958の2回。破堤確率は『計画高水位未満での破堤は浸透・パイピング等に限られる』として低く置く" },
  { key: "l1", label: "計画規模(1/200)〜想定最大規模未満", annual: [0.004, 0.004, 0.004], breach: [0.3, 0.5, 0.7], depthFrom: "l1", depthScale: 1,
    basis: "年確率は 1/200−1/1000=0.4%。破堤確率は『計画高水位を超える水位が続けば越水・破堤が現実味を持つが、1947年は超えても下流本川は保った』として0.3〜0.7" },
  { key: "l2", label: "想定最大規模(1/1000程度)以上", annual: [0.001, 0.001, 0.001], breach: [0.6, 0.8, 0.9], depthFrom: "l2", depthScale: 1,
    basis: "年確率は想定最大規模の定義(1/1000程度)。この規模では越水がほぼ確実で破堤確率を0.6〜0.9に置く" },
];

// スナップショットの破堤点グループ {breakpoints_total, rows:[{depth_m}]} から、
// 「全破堤点のうち、この地点に深さ t 以上の水を届ける破堤点の割合」を返す(届かない破堤点は深さ0として分母に入れる)
export function reachFraction(group, t, scale = 1) {
  if (!group || !group.breakpoints_total) return 0;
  const n = (group.rows ?? []).filter((r) => Number(r.depth_m) * scale >= t).length;
  return n / group.breakpoints_total;
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

// 深さ別の年超過確率(低/中/高)と、years年累積、気候変動で頻度が climate 倍になったときの累積
export function exceedance(snapshot, { bands = DEFAULT_BANDS, thresholds = THRESHOLDS_M, years = 30, climate = 2 } = {}) {
  const groups = snapshot?.suibou_nav?.groups ?? {};
  return thresholds.map((t) => {
    const byBand = bands.map((b) => {
      const f = reachFraction(groups[b.depthFrom], t, b.depthScale);
      return { key: b.key, label: b.label, reach: f, annual: b.annual.map((a, i) => a * b.breach[i] * f) };
    });
    const annual = [0, 1, 2].map((i) => byBand.reduce((s, b) => s + b.annual[i], 0));
    return {
      depth_m: t,
      annual: { low: annual[0], mid: annual[1], high: annual[2] },
      cum: { low: cum(annual[0], years), mid: cum(annual[1], years), high: cum(annual[2], years) },
      climateCum: { low: cum(annual[0] * climate, years), mid: cum(annual[1] * climate, years), high: cum(annual[2] * climate, years) },
      byBand,
      years, climate,
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
