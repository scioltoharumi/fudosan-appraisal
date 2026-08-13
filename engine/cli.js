// engine/cli.js — node engine/cli.js <property-id> [--json]
// 物件YAML+area-configを読み、査定サマリを表示する。--jsonで結果JSON全体をstdoutへ。
import { evaluate, fmtMan, pct } from "./appraise.js";
import { loadAreaConfig, loadProperty, listPropertyIds } from "./io.js";
import { loadHouseDeals } from "./retail.js";
import { calibrate } from "./calibrate.js";

// チェックリスト未検証項目 → 次に取るべき調査アクション(§7)
export const CHECK_ACTIONS = {
  road_type_verified: "役所調査: 接道の42条区分を確認(「通路」なら角地加算消滅・再建築に影響)",
  retaining_wall: "現地+役所: 擁壁・がけ条例・高低差を確認(赤羽台は台地縁)",
  hazard: "ハザードマップを確認",
  seismic: "耐震(2000年基準適合)を確認。未適合なら耐震診断・補強費を修繕想定へ",
};

function summary(r, property) {
  const L = [];
  L.push(`━━ ${r.id} ── 査定サマリ(基準日 ${r.asOf} / engine ${r.engineVersion})`);
  L.push(`価格の位置: ${r.position.head}`);
  L.push(`            ${r.position.body}`);
  for (const n of r.position.notes) L.push(`注記      : ${n}`);
  if (r.isNewBuild) L.push(`注意      : 新築物件。本査定は中古市場での再販価値ベース(新築プレミアム剥落込み)`);
  L.push(`主導ルート: ${r.fairFinal.route === "retail" ? "リテール比較法(戸建成約)" : r.fairFinal.route === "home" ? "原価法(家として売る)" : "土地値(更地換算)"}${r.retail ? `(加重併用: リテール${(r.fairFinal.weights.retail * 100).toFixed(0)}%)` : ""}${r.fairFinal.floorBound ? " ※土地換算値が下限発火" : ""}`);
  if (property.source_url) L.push(`掲載元    : ${property.source_url}`);
  L.push(`売出価格  : ${fmtMan(r.state.ask)}`);
  L.push(`土地換算値: ${fmtMan(r.fairFinal.floorEff.mid)}(悲観 ${fmtMan(r.fairFinal.floorEff.lo)}${r.fairFinal.floorGuard < 1 ? "・単価未検証につき×0.9適用" : ""})`);
  L.push(`即時処分値: ${fmtMan(r.fairFinal.floorEff.netMid)}(卸値90%×売却諸費用控除後。取得総額(価格×(1+諸費用))と比べて資産防衛の下限を見る)`);
  L.push(`適正レンジ: ${fmtMan(r.fairFinal.lo)} 〜 ${fmtMan(r.fairFinal.mid)} 〜 ${fmtMan(r.fairFinal.hi)}`);
  if (r.retail) L.push(`リテール比較: ${fmtMan(r.retail.lo)} 〜 ${fmtMan(r.retail.mid)} 〜 ${fmtMan(r.retail.hi)}(類似成約${r.retail.n}件・${r.retail.districtScoped ? "近接地区限定" : "全地区(参考)"}) / 原価法中央値 ${fmtMan(r.mid.fair)} / 重み リテール${(r.fairFinal.weights.retail*100).toFixed(0)}%:原価${(r.fairFinal.weights.cost*100).toFixed(0)}%`);
  else L.push(`リテール比較: 類似成約が不足のため原価法のみ`);
  L.push(`乖離      : ${r.premium >= 0 ? "+" : ""}${fmtMan(r.premium)}(売出 − 査定中央値)`);
  L.push(`即時含み損: ${fmtMan(r.instLoss)}(総取得 ${fmtMan(r.totalCost)} − 査定中央値)`);
  L.push(`MC        : P10 ${fmtMan(r.mc.p10)} / P50 ${fmtMan(r.mc.p50)} / P90 ${fmtMan(r.mc.p90)}・売出は${r.mc.askPercentile.toFixed(0)}パーセンタイル(原価法サイドのみの分布・参考。seed=${r.mc.seed})`);
  if (r.incomeVal) L.push(`収益価格  : ${fmtMan(r.incomeVal)}`);
  L.push(`個別補正計: ${pct(r.mid.adj)}(補正後 ${Math.round(r.mid.pptAdj * (1 + r.mid.adj))}万/坪 × 実効${r.mid.tsubo.toFixed(2)}坪)`);
  if (r.assumptions.length) {
    L.push(`採用した仮定(${r.assumptions.length}件):`);
    r.assumptions.forEach((a) => L.push(`  - ${a.field} = ${a.value}${a.why ? "(" + a.why + ")" : ""}`));
  }
  const checklist = property.checklist || {};
  const pending = Object.entries(CHECK_ACTIONS).filter(([k]) => !checklist[k]);
  if (pending.length) {
    L.push(`次に取るべき調査アクション(未検証 ${pending.length}件):`);
    pending.forEach(([, action]) => L.push(`  → ${action}`));
  }
  return L.join("\n");
}

const [, , id, ...flags] = process.argv;
if (!id) {
  console.error("usage: node engine/cli.js <property-id> [--json]");
  console.error("registered: " + listPropertyIds().join(", "));
  process.exit(1);
}
const property = loadProperty(id);
const result = evaluate(property, loadAreaConfig(), { houseDeals: loadHouseDeals(), cal: calibrate() });
if (flags.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(summary(result, property));
}
