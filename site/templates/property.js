// site/templates/property.js — 物件詳細ページ(simulator v1.2のUI資産をサーバサイド描画に移植)
// スケールSVG / 明細表 / MC分布 / トルネード / 算出根拠の全文開示 / 予算 / モデル外チェックリスト / 仮定一覧
import { fmtMan, pct, COEFFS } from "../../engine/appraise.js";
import { layout, esc, STATUS_LABEL, fmtDate, safeUrl } from "./layout.js";

const DIR_LABEL = { "0.05": "南", "0.02": "東・南西・南東", "0": "西", "-0.03": "北" };
const ROAD_LABEL = { "0": "幅員4m以上", "-0.05": "4m未満(2項道路)", "-0.1": "接道に疑義(通路等)" };

const CHECK_ITEMS = [
  ["road_type_verified", "接道種別の確認(42条区分。「通路」なら角地加算は消滅)"],
  ["retaining_wall", "擁壁・がけ条例・高低差(赤羽台は台地縁)"],
  ["hazard", "ハザードマップ"],
  ["seismic", "耐震(2000年基準未適合なら耐震診断・補強費を修繕想定へ)"],
];
const CHECK_STATIC = [
  "セットバックの根拠(中心後退か一方後退か。一方後退なら向かい側の崖・水路を疑う)",
  "インスペクション(観察減価はこのモデルの外)",
  "解体費の実見積(重機搬入可否で大きく変動)",
];

// ---- 価格スケールSVG(v1.2 drawScale移植) ----
function scaleSvg(s, v) {
  const cands = [v.floorLo, v.fairHi, s.ask];
  if (v.income) cands.push(v.income);
  const rawMin = Math.min(...cands), rawMax = Math.max(...cands);
  const span0 = Math.max(1, rawMax - rawMin);
  const min = rawMin - 0.08 * span0, max = rawMax + 0.06 * span0;
  const X = (val) => 30 + ((val - min) / (max - min)) * 580;
  const el = [];
  el.push(`<line x1="30" y1="100" x2="610" y2="100" stroke="#16232E" stroke-width="1"/>`);
  const step = (max - min) / 6;
  for (let i = 0; i <= 6; i++) {
    const val = min + step * i, x = X(val);
    el.push(`<line x1="${x}" y1="96" x2="${x}" y2="104" stroke="#16232E" stroke-width="1"/>`);
    el.push(`<text x="${x}" y="120" font-size="9" text-anchor="middle" fill="#43566B" font-family="monospace">${(val / 10000).toFixed(2)}億</text>`);
  }
  el.push(`<rect x="${X(v.floorLo)}" y="70" width="${Math.max(2, X(v.floorHi) - X(v.floorLo))}" height="14" fill="#2E6E8E" opacity="0.85"/>`);
  el.push(`<text x="${X(v.floorLo)}" y="64" font-size="10" fill="#16232E">下値フロア(土地−解体費)</text>`);
  el.push(`<rect x="${X(v.fairLo)}" y="86" width="${Math.max(2, X(v.fairHi) - X(v.fairLo))}" height="14" fill="#BFD7E4"/>`);
  el.push(`<text x="${X(v.fairLo)}" y="136" font-size="10" fill="#43566B">適正価格レンジ(売却ルートmax法)</text>`);
  el.push(`<line x1="${X(v.fairMid)}" y1="66" x2="${X(v.fairMid)}" y2="102" stroke="#16232E" stroke-width="1" stroke-dasharray="3,2"/>`);
  if (v.income) {
    const ix = X(v.income);
    el.push(`<line x1="${ix}" y1="70" x2="${ix}" y2="102" stroke="#6B4E9B" stroke-width="2" stroke-dasharray="5,3"/>`);
    el.push(`<text x="${ix}" y="152" font-size="10" text-anchor="middle" fill="#6B4E9B">収益価格 ${(v.income / 10000).toFixed(2)}億</text>`);
  }
  const ax = X(s.ask);
  el.push(`<line x1="${ax}" y1="26" x2="${ax}" y2="102" stroke="#C93A2B" stroke-width="2"/>`);
  el.push(`<polygon points="${ax - 5},18 ${ax + 5},18 ${ax},28" fill="#C93A2B"/>`);
  el.push(`<text x="${ax}" y="12" font-size="11" font-weight="700" text-anchor="middle" fill="#C93A2B">売出 ${(s.ask / 10000).toFixed(2)}億</text>`);
  return `<svg class="scale-svg" viewBox="0 0 640 168" role="img" aria-label="査定レンジと売出価格の位置">${el.join("")}</svg>`;
}

// ---- MC分布SVG(v1.2 runMCのcanvas描画をSVGに移植) ----
function histSvg(s, mc) {
  const W = 640, H = 200, padB = 26, padT = 10;
  const { lo, hi, counts } = mc.hist;
  const bins = counts.length;
  const span = Math.max(1, hi - lo);
  const maxC = Math.max(...counts);
  const bw = W / bins;
  const el = [];
  for (let b = 0; b < bins; b++) {
    const binMid = lo + ((b + 0.5) / bins) * span;
    const h = (counts[b] / maxC) * (H - padB - padT);
    el.push(`<rect x="${(b * bw + 1).toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${binMid < s.ask ? "#BFD7E4" : "#2E6E8E"}"/>`);
  }
  const ax = ((s.ask - lo) / span) * W;
  if (ax >= 0 && ax <= W) {
    el.push(`<line x1="${ax.toFixed(1)}" y1="${padT}" x2="${ax.toFixed(1)}" y2="${H - padB}" stroke="#C93A2B" stroke-width="2"/>`);
  }
  const t = (x, anchor, s2) => `<text x="${x}" y="${H - 8}" font-size="10" font-family="monospace" fill="#43566B" text-anchor="${anchor}">${s2}</text>`;
  el.push(t(2, "start", (lo / 10000).toFixed(2) + "億"));
  el.push(t(W - 2, "end", (hi / 10000).toFixed(2) + "億"));
  el.push(t(W / 2, "middle", "P50 " + (mc.p50 / 10000).toFixed(2) + "億"));
  return `<svg class="hist-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="適正総額のモンテカルロ分布">${el.join("")}</svg>`;
}

function pctLine(mc, p50) {
  const askPct = mc.askPercentile;
  return `売出価格は適正総額分布のおよそ <b>${askPct.toFixed(0)}パーセンタイル</b>。` +
    (askPct >= 90 ? "試行の9割以上で「割高」側 ── 指値なしで買う合理性は乏しい。"
      : askPct >= 60 ? `やや割高圏。P50(${fmtMan(p50)})を指値の錨に。`
      : askPct >= 30 ? "適正圏の中央付近。条件面(修繕・引渡し時期)での交渉が現実的。"
      : "分布の下位 ── 統計上は割安。逆に「安すぎる理由」(接道・擁壁・瑕疵)を疑うべき水準。");
}

// ---- トルネード(v1.2 drawTornado移植) ----
function tornadoHtml(rows) {
  const maxAbs = Math.max(...rows.map((r) => Math.max(Math.abs(r.dLo), Math.abs(r.dHi))), 1);
  return rows.map(({ label, dLo, dHi }) => {
    const leftPct = 50 + (Math.min(dLo, dHi, 0) / maxAbs) * 48;
    const widthPct = ((Math.max(dLo, dHi, 0) - Math.min(dLo, dHi, 0)) / maxAbs) * 48;
    const val = (dLo ? (dLo > 0 ? "+" : "") + Math.round(dLo).toLocaleString("en-US") : "") +
      (dLo && dHi ? " / " : "") +
      (dHi ? (dHi > 0 ? "+" : "") + Math.round(dHi).toLocaleString("en-US") : "");
    return `<div class="bar-row"><div class="bar-label">${esc(label)}</div><div class="bar-area"><div class="bar-fill" style="left:${leftPct}%;width:${widthPct}%"></div><div class="bar-mid" style="left:50%"></div></div><div class="bar-val">${val}万</div></div>`;
  }).join("");
}

// ---- 算出根拠の全文開示(v1.2 buildLogic移植) ----
function logicSteps(r) {
  const { state: s, mid, lo, hi, incomeVal, totalCost, instLoss, elapsed } = r;
  const eff = s.land - s.setback;
  const dirLabel = DIR_LABEL[String(s.dir)] || "—";
  const roadLabel = ROAD_LABEL[String(s.roadq)] || "—";
  let sizeWhy = "20〜45坪は分譲需要の中心帯のため補正なし。";
  if (mid.tsubo < 20) sizeWhy = "20坪を下回るほど狭小地として買い手が減るため、1坪不足あたり−0.5%(最大−5%)。";
  else if (mid.tsubo > 45) sizeWhy = "45坪を超えるほど総額が張り需要層が薄くなるため、1坪超過あたり−0.2%(最大−8%)。";
  const pptCorrected = mid.pptAdj * (1 + mid.adj);

  const steps = [
    ["基準坪単価(地域相場の起点)",
      s.ppt + "万円/坪(2025年1月時点の実勢想定)",
      "国交省の公示地価(赤羽住宅地321万・赤羽西190万・赤羽北160万/坪など)に実勢係数1.15を掛けた値を初期値としています。公示地価は鑑定士が更地として評価した「基準値」で、実際の取引は人気エリアでは公示の1.1〜1.3倍で成約するのが通例だからです。この値が査定全体の土台であり、成約事例の実測に置き換えるほど現実に近づきます。"],

    ["時点修正(相場の鮮度合わせ)",
      s.ppt + "万 × (1 + " + (s.rise * 100).toFixed(0) + "%)^" + elapsed.toFixed(1) + "年 = <b>" + Math.round(mid.pptAdj) + "万円/坪</b>",
      "公示地価の基準日は2025年1月1日。経過年数は査定基準日(" + r.asOf + ")から自動計算しています(現在" + elapsed.toFixed(1) + "年)。赤羽は直近で年+10〜14%の上昇局面にあるため、古い基準のまま査定すると安く出過ぎます。"],

    ["実効宅地面積(払う面積と使える面積は違う)",
      "登記 " + s.land + "m² − 私道負担・セットバック " + s.setback + "m² = <b>" + eff.toFixed(2) + "m²(" + mid.tsubo.toFixed(2) + "坪)</b>",
      "私道負担・セットバック部分は建築も容積算入もできないため、本モデルでは価値ゼロとして全額控除しています。税務上は更地の0〜3割で評価される場合もあるので、これは意図的に保守側(安全側)に倒した処理です。"],

    ["個別補正(この土地ならではの加点・減点)",
      "徒歩 " + pct(mid.walkAdj) + " ＋ 方位[" + dirLabel + "] " + pct(s.dir) + " ＋ 接道[" + roadLabel + "] " + pct(s.roadq) + " ＋ 形状 " + pct(s.shape) + " ＋ 角地 " + pct(mid.cornerAdj) + " ＋ 複数駅 " + pct(mid.mstAdj) + " ＋ 面積 " + pct(mid.sizeAdj) + " ＋ その他 " + pct(s.extra / 100) + " = <b>合計 " + pct(mid.adj) + "</b>",
      "徒歩は10分基準で1分±1.2%。方位は日照価値。接道は幅員4m未満で−5%、道路種別に疑義があれば−10%。旗竿地−25%。角地+3%は両方が建築基準法上の道路の場合のみ。複数駅・複数路線は再販時の訴求力で+2%。面積は" + sizeWhy + " 「その他」は容積率格差・高低差・眺望など本モデルにない要因の手動枠です。補正後坪単価は <b>" + Math.round(pptCorrected) + "万円/坪</b>。"],

    ["査定土地値(土地だけの値段)",
      Math.round(pptCorrected) + "万/坪 × " + mid.tsubo.toFixed(2) + "坪" + (s.lc !== 0 ? " × (1" + pct(s.lc) + " 法的制約)" : "") + " = <b>" + fmtMan(mid.land2) + "</b>(レンジ: " + fmtMan(lo.land2) + "〜" + fmtMan(hi.land2) + ")",
      "補正後坪単価×実効坪数。再建築不可などの法的制約はここで−30%を掛けます(住宅ローンが付かず買い手が現金投資家に限られるため)。基準坪単価に±10%の不確実性を置き、レンジで表示しています。"],

    ["下値フロア(土地値 − 解体費)",
      fmtMan(mid.land2) + " − 解体費 " + fmtMan(s.demo) + " = <b>" + fmtMan(mid.floorVal) + "</b>",
      "この物件を「最悪でも土地として売る」ときの手取り相当額です。古家付き土地の買い手は解体費を差し引いて指値するため、資産防衛の合格ラインはここに置くべきです。なお「確実な下値」と呼びたくなりますが、基準坪単価自体に±10%の幅がある以上、ここに示すのは中央値であり、悲観側の下値は " + fmtMan(lo.floorVal) + " です。売出価格がこのフロア以下なら「買」判定です。"],

    ["建物残価(市場が建物に払う残り時間)",
      s.rebuild + "万/坪 × " + (s.floor / COEFFS.TSUBO_M2).toFixed(2) + "坪 × max(0, 1 − 築" + s.age.toFixed(1) + "年 ÷ " + COEFFS.BUILDING_LIFE_Y + "年) = <b>" + fmtMan(mid.resid) + "</b>",
      "維持管理された木造戸建の市場評価はおおむね" + COEFFS.BUILDING_LIFE_Y + "年で逓減すると置いています(2026-08監査で税法22年から実勢寄りに更新。再調達単価" + s.rebuild + "万/坪も実勢建築費ベース)。" + (mid.alive ? "3階建・狭小などの市場性減価(" + pct(s.bm) + ")は建物残価のみに掛かります(以前は土地込みに掛かるバグがあり監査で修正)。" : "本件は築" + s.age.toFixed(1) + "年のため残価ゼロ。査定上は「古家付き土地」であり、実際に住めるかどうかと市場が建物代を払うかは別問題です。") + " 雨漏り・傾き等の実際の劣化(観察減価)はこの式の外で、インスペクションでしか分かりません。"],

    ["売却ルートの場合分け(原価法サイド)",
      "原価法の適正価格 = max(住まいとして売る価値, 土地として売る価値)<br>＝ max(土地値＋残価×(1" + pct(s.bm) + ") − 繰延修繕" + fmtMan(s.repair) + ", 土地値 − 解体費" + fmtMan(s.demo) + ")<br>＝ max(" + fmtMan(mid.asHome) + ", " + fmtMan(mid.asLand) + ") = <b>" + fmtMan(mid.fair) + "</b>",
      "物件には「住まいとして売る」「土地として売る」の2つの出口があり、高い方で決まります。住まいルートでは買い手が引き継ぐ繰延修繕を控除し(残価逓減は「維持された建物」前提のため、履歴不明分をここで補う)、土地ルートでは解体費を控除します。修繕実施のエビデンス(点検履歴・リフォーム記録)があれば修繕は減額してください。"],

    ...(r.retail ? [[
      "リテール比較法(第3の売却ルート: 実需に家として売る)",
      "類似の戸建成約 " + r.retail.n + "件(築±" + 6 + "年・面積帯一致)の正規化単価中央値 " + Math.round(r.retail.unitMid) + "万/坪 × 実効" + mid.tsubo.toFixed(2) + "坪 = <b>" + fmtMan(r.retail.mid) + "</b>(四分位 " + fmtMan(r.retail.lo) + "〜" + fmtMan(r.retail.hi) + ")",
      "2026-08監査で判明した通り、住宅ローン実需が「住める家」に払う価格は原価法(土地値+建物残価)を大きく上回るのが北区の実勢です(戸建付き成約は土地換算で土地成約の+30〜60%)。国交省の戸建成約データから条件の近い事例を選び、時点・徒歩・築年差を補正して算出しています。最終的な適正価格は原価法とリテール比較法の高い方(本件は" + (r.fairFinal.route === "retail" ? "リテール比較法" : "原価法") + ")を採用します。"
    ]] : [[
      "リテール比較法(第3の売却ルート)",
      "類似成約が不足(5件未満)のため原価法のみで査定",
      "土地面積・延床・築年の近い戸建成約が見つからないため、この物件ではリテール比較を適用していません。"
    ]]),

    ["適正価格レンジ(最終的な物差し)",
      fmtMan(r.fairFinal.lo) + " 〜 <b>" + fmtMan(r.fairFinal.mid) + "</b> 〜 " + fmtMan(r.fairFinal.hi),
      "原価法とリテール比較法の高い方によるレンジです。売出価格" + fmtMan(s.ask) + "との差 <b>" + (s.ask - r.fairFinal.mid >= 0 ? "+" : "") + fmtMan(s.ask - r.fairFinal.mid) + "</b> が、土地・建物・周辺成約のいずれでも説明できない上乗せ(プレミアム)です。払うこと自体は悪ではありませんが、金額を自覚して払うのと知らずに払うのは別物です。"],
  ];

  if (incomeVal) {
    steps.push(["収益価格(第3の錨)",
      "月額 " + s.rent + "万 × 12 × (1 − 経費率" + (s.expr * 100).toFixed(0) + "%) ÷ 還元利回り" + (s.yld * 100).toFixed(1) + "% = <b>" + fmtMan(incomeVal) + "</b>",
      "「貸したら投資家は幾らまで払うか」の逆算です。戸建賃貸は固定資産税・修繕・空室で賃料の15〜20%が経費に消えるため、表面でなく経費控除後(NOI)で還元します。賃料入力が仮置きなら必ず周辺実勢に差し替えてください。ここが現状最も弱い入力です。"]);
  }

  steps.push(["総取得コストと即時含み損(最後の現実)",
    "総コスト: " + fmtMan(s.ask) + " × (1+" + (s.fee * 100).toFixed(1) + "%)" + (r.fairFinal.route === "land" ? "(土地ルートのため修繕費は含めず)" : " + 修繕 " + fmtMan(s.repair)) + " = <b>" + fmtMan(totalCost) + "</b><br>即時含み損: " + fmtMan(totalCost) + " − 査定 " + fmtMan(r.fairFinal.mid) + " = <b>" + fmtMan(instLoss) + "</b>",
    "諸費用と修繕は「住むために払うが、売るとき市場は返してくれない」お金です。総取得コストから査定価値を引いた即時含み損は、引渡しの瞬間に確定する資産毀損の見積りです。持ち家は住む価値(帰属家賃)でこれを回収していく構造なので、含み損＝悪ではありませんが、「毀損しない物件」を掲げるなら直視すべき数字です。心理的上限1億円と比較すべきもこの総額です。"]);

  return steps.map((st, i) =>
    `<div class="logic-step"><div class="t"><span class="no">STEP ${i + 1}</span>${st[0]}</div><div class="formula">${st[1]}</div><div class="why">${st[2]}</div></div>`
  ).join("");
}

// ---- 明細表(v1.2 rows移植) ----
function kvTable(r) {
  const { state: s, mid, lo, hi, premium, instLoss, incomeVal, elapsed } = r;
  const rows = [
    ["実効宅地面積(登記−私道負担" + s.setback + "m²)", mid.tsubo.toFixed(2) + " 坪(" + (s.land - s.setback).toFixed(2) + "m²)"],
    ["時点修正後 基準坪単価(" + elapsed.toFixed(1) + "年分複利)", Math.round(mid.pptAdj).toLocaleString("en-US") + " 万円/坪"],
    ["個別補正計", pct(mid.adj) + "(補正後 " + Math.round(mid.pptAdj * (1 + mid.adj)).toLocaleString("en-US") + "万/坪)"],
    ["査定土地値(法的制約込)", fmtMan(lo.land2) + " 〜 " + fmtMan(hi.land2)],
    ["下値フロア(土地値−解体費" + fmtMan(s.demo) + ")", fmtMan(lo.floorVal) + " 〜 " + fmtMan(hi.floorVal)],
    ["建物残価(木造" + COEFFS.BUILDING_LIFE_Y + "年逓減)", mid.alive ? fmtMan(mid.resid) + "(市場性 " + pct(s.bm) + " は残価のみに適用)" : "0円(築" + s.age.toFixed(1) + "年・市場評価消滅)"],
    ["リテール比較(戸建成約 " + (r.retail ? r.retail.n + "件" : "—") + ")", r.retail ? fmtMan(r.retail.lo) + " 〜 " + fmtMan(r.retail.mid) + " 〜 " + fmtMan(r.retail.hi) : "類似成約不足のため適用外"],
    ["売却ルート判定", r.fairFinal.route === "retail" ? "リテール(実需に家として売る)が最も高い" : r.fairFinal.route === "land" ? "土地として売る方が高い(解体前提)" : "住まいとして売る方が高い(修繕" + fmtMan(s.repair) + "控除後)"],
    ["適正価格レンジ(原価法×リテールの高い方)", fmtMan(r.fairFinal.lo) + " 〜 " + fmtMan(r.fairFinal.hi), "em"],
    ["売出価格 − 査定中央値", (premium >= 0 ? "+" : "") + fmtMan(premium)],
    ["実質坪単価(売出÷実効坪)", Math.round(s.ask / mid.tsubo).toLocaleString("en-US") + " 万円/坪"],
  ];
  if (incomeVal) rows.push(["収益価格(月" + s.rent + "万×12×(1−経費" + (s.expr * 100) + "%)÷" + (s.yld * 100).toFixed(1) + "%)", fmtMan(incomeVal)]);
  rows.push(["即時含み損(総取得コスト − 査定中央値)", (instLoss >= 0 ? "" : "+") + fmtMan(Math.abs(instLoss)) + (instLoss >= 0 ? " の毀損スタート" : " の含み益スタート"), instLoss > 0 ? "loss em" : "em"]);
  return `<table class="kv">` + rows.map((r2) =>
    `<tr${r2[2] ? ` class="${r2[2]}"` : ""}><td>${r2[0]}</td><td>${r2[1]}</td></tr>`).join("") + `</table>`;
}

function budgetHtml(r) {
  const { state: s, totalCost } = r;
  const cap = COEFFS.BUDGET_CAP_MAN;
  const width = Math.min((totalCost / 11500) * 100, 100);
  const over = totalCost > cap;
  return `<section class="budget">
    <div style="font-size:.85rem;font-weight:700">総取得コスト vs 心理的上限 1億円</div>
    <div class="budget-bar"><div class="budget-fill${over ? " over" : ""}" style="width:${width.toFixed(1)}%"></div><div class="budget-cap" style="left:86.9%"></div></div>
    <div class="budget-line"><span>0</span><span>総取得コスト <b style="font-family:var(--mono)">${fmtMan(totalCost)}</b>(価格×(1+${(s.fee * 100).toFixed(1)}%)＋修繕${fmtMan(s.repair)})${over ? ` ── <span style="color:var(--stamp)">上限超過 ${fmtMan(totalCost - cap)}</span>` : ` ── 余裕 ${fmtMan(cap - totalCost)}`}</span><span>1.15億</span></div>
  </section>`;
}

function checklistHtml(property) {
  const cl = property.checklist || {};
  const items = CHECK_ITEMS.map(([key, label]) =>
    cl[key] ? `<span class="done">✓ ${esc(label)}</span>` : `□ ${esc(label)}`);
  CHECK_STATIC.forEach((label) => items.push(`□ ${esc(label)}`));
  return `<section class="human-check"><b>モデル外チェックリスト(現地・書面でしか確認できない)</b><br>${items.join("<br>")}
  <div class="note">チェック状態は物件YAMLの checklist で管理(✓は確認済み)</div></section>`;
}

function assumptionsHtml(r) {
  const src = r.area.source === "koji_fallback"
    ? "公示地価×1.15フォールバック(成約事例3件未満)"
    : esc(String(r.area.source));
  const items = r.assumptions.length
    ? r.assumptions.map((a) => `<li><b>${esc(a.field)}</b> = ${esc(a.value)} <span class="why">── ${esc(a.why)}</span></li>`).join("")
    : "<li>なし(全項目が実測・記載値)</li>";
  return `<section>
    <h2 class="sub">採用した仮定と出典 ── この査定が立っている足場</h2>
    <ul class="assumptions">${items}</ul>
    <div class="provenance">基準坪単価の出典: ${esc(r.area.label ?? r.area.key)} ${r.area.ppt_man ?? r.state.ppt}万円/坪 ── ${src} / 年率上昇 ${(r.state.rise * 100).toFixed(0)}% / 査定基準日 ${r.asOf} / MC seed=${r.mc.seed} / engine ${esc(r.engineVersion)}</div>
  </section>`;
}

function priceHistoryHtml(property) {
  const ph = property.price_history || [];
  if (ph.length < 2) return "";
  const rows = ph.map((p, i) => {
    const diff = i === 0 ? "" : (p.price_man - ph[i - 1].price_man >= 0 ? "+" : "") + fmtMan(p.price_man - ph[i - 1].price_man);
    return `<tr><td>${esc(fmtDate(p.date))}</td><td style="text-align:right;font-family:var(--mono)">${fmtMan(p.price_man)}</td><td style="text-align:right;font-family:var(--mono)">${diff}</td></tr>`;
  }).join("");
  return `<section><h2 class="sub">価格改定履歴</h2><table class="kv"><tr><td>日付</td><td style="text-align:right">価格</td><td style="text-align:right">改定幅</td></tr>${rows}</table></section>`;
}

// ---- リテール比較法(戸建成約)セクション ----
function retailCompsHtml(r) {
  if (!r.retail) {
    return `
    <section>
      <h2 class="sub">戸建成約比較(リテール比較法) ── 実需はいくらで買っているか</h2>
      <div class="note">土地面積・延床・築年の近い戸建成約が5件未満のため、この物件ではリテール比較を適用していません(原価法のみ)。</div>
    </section>`;
  }
  const { retail } = r;
  const shown = [...retail.comps].sort((a, b) => b.quarter.localeCompare(a.quarter)).slice(0, 10);
  const rows = shown.map((d) => `
    <tr>
      <td>${esc(d.quarter)}</td>
      <td>${esc(d.district)}</td>
      <td class="num">${fmtMan(d.price_man)}</td>
      <td class="num">${d.land_m2}m²</td>
      <td class="num">${d.floor_m2}m²</td>
      <td class="num">築${d.age_y}年</td>
      <td class="num">徒歩${d.walk_min}分</td>
      <td class="num">${Math.round(d.unitAdj)}万/坪</td>
    </tr>`).join("");
  return `
    <section>
      <h2 class="sub">戸建成約比較(リテール比較法) ── 実需はいくらで買っているか</h2>
      <div class="logic-body">
        <p class="why">「住める家」として売買された周辺の実成約(国交省 不動産取引価格情報)から、本物件と条件の近い${retail.n}件を選び、時点(年次別地価上昇率)・徒歩・築年差を補正した比較値。実需の住宅ローン買い手が実際に払っている水準であり、土地値ベースの原価法とは別の物差し。</p>
        <table class="kv" style="margin-top:8px">
          <tr class="em"><td>リテール比較の適正額(補正後単価の中央値 ${Math.round(retail.unitMid)}万/坪 × 実効${r.mid.tsubo.toFixed(2)}坪)</td><td>${fmtMan(retail.lo)} 〜 <b>${fmtMan(retail.mid)}</b> 〜 ${fmtMan(retail.hi)}</td></tr>
          <tr><td>原価法(土地+建物)の中央値</td><td>${fmtMan(r.mid.fair)}</td></tr>
          <tr><td>採用(高い方)</td><td>${r.fairFinal.route === "retail" ? "リテール比較法" : "原価法"} → 適正中央値 ${fmtMan(r.fairFinal.mid)}</td></tr>
        </table>
        <div style="overflow-x:auto;margin-top:10px">
        <table class="list">
          <tr><th>時期</th><th>地区</th><th>成約総額</th><th>土地</th><th>延床</th><th>築年</th><th>駅</th><th>補正後単価</th></tr>
          ${rows}
        </table>
        </div>
        <div class="note">直近10件を表示(選定は${retail.n}件・築±6年・土地0.6〜1.6倍・延床0.7〜1.4倍)。レンジは四分位。出典: 国交省 不動産取引価格情報の再掲(utinokati.com・北区12地区・取得2026-08-10)。原データは価格100万円単位・面積5m²単位に丸め。方位・接道・リフォーム有無は補正できないため誤差を含む。</div>
      </div>
    </section>`;
}

// ---- 成約実勢との突き合わせ(較正)セクション ----
// marketCal: {chosen, calR, dealsN} — build.jsがcalibrate結果と成約ベース再査定を渡す。なければ非表示
function marketCalHtml(r, marketCal) {
  if (!marketCal?.chosen) {
    return `
    <section>
      <h2 class="sub">成約実勢との突き合わせ ── 実際の取引価格と比べる</h2>
      <div class="note">このエリアは成約データ不足のため成約ベース査定を表示できません(市況データの整備状況は<a href="../index.html">一覧ページ</a>の較正状態を参照)。</div>
    </section>`;
  }
  const { chosen, calR, dealsN } = marketCal;
  const s = r.state;
  const gap = chosen.ppt / s.ppt - 1;
  const calPremium = s.ask - calR.mid.fair;
  return `
    <section>
      <h2 class="sub">成約実勢との突き合わせ ── 実際の取引価格と比べる</h2>
      <div class="logic-body">
        <p class="why">「公示地価ベースの査定は市場価格と無関係では?」という批判に答えるための欄。国交省の不動産取引価格情報(の再掲データ)から周辺の実際の成約を集め、標準地条件・2025年1月基準に正規化した「成約ベース坪単価」で査定をやり直し、公示ベースと並べて表示する。</p>
        <table class="kv">
          <tr><td>本査定の採用単価(公示地価×実勢係数)</td><td>${Math.round(s.ppt)}万円/坪</td></tr>
          <tr><td>成約ベース坪単価<div class="note" style="margin-top:2px">${esc(chosen.basis)} / 信頼度: ${esc(chosen.confidence)}</div></td><td>${chosen.ppt}万円/坪</td></tr>
          <tr class="em"><td>採用単価との乖離</td><td>${pct(gap)}</td></tr>
          <tr><td>成約ベースの適正レンジ(再計算)</td><td>${fmtMan(calR.lo.fair)} 〜 <b>${fmtMan(calR.mid.fair)}</b> 〜 ${fmtMan(calR.hi.fair)}</td></tr>
          <tr><td>成約ベースの下値フロア</td><td>${fmtMan(calR.mid.floorVal)}</td></tr>
          <tr class="${calPremium > 0 ? "loss" : ""}"><td>売出価格との乖離(成約ベース)</td><td>${calPremium >= 0 ? "+" : ""}${fmtMan(calPremium)}</td></tr>
          <tr><td>成約ベースでの判定</td><td>【${calR.verdict.mark}】</td></tr>
        </table>
        <p class="why" style="margin-top:8px">${gap < -0.05
          ? "成約実勢は採用単価より低く出ている。つまり公示ベースの本査定は市場実勢に対して<b>むしろ高め(買い手に甘め)</b>であり、売出価格との乖離は成約ベースで見るとさらに大きい。"
          : gap > 0.05
            ? "成約実勢は採用単価より高く出ている。公示ベースの本査定は保守的すぎる可能性があり、実勢では上の適正レンジがより現実的。"
            : "成約実勢と採用単価はおおむね整合しており、公示ベースの査定は市場実勢から大きく外れていない。"}</p>
        <div class="caveat">※ 成約データは地区・面積帯単位の匿名情報(国交省 不動産取引価格情報の再掲)。方位・接道の質・角地は補正できないため誤差を含む。地区平均ベンチマークは旗竿地等も混みの混合平均で、標準的な整形地より低めに出る傾向がある。</div>
        <a class="src-link" href="${esc(r.id)}-market.html" style="margin-top:10px">成約事例ベースの根拠を全文で見る(事例一覧・正規化・乖離の仕分け) →</a>
      </div>
    </section>`;
}

// ---- ページ全体 ----
export function renderProperty(r, property, marketCal = null) {
  const { state: s, mid, lo, hi, verdict: v, incomeVal } = r;
  const status = STATUS_LABEL[property.status] || property.status;
  const body = `
  <div style="margin-bottom:12px;font-size:.8rem"><a href="../index.html">← 物件一覧へ</a></div>
  <div class="panel">
    <h2>${esc(property.location?.address ?? r.id)} <span class="status">${esc(status)}</span></h2>
    <div class="note">ID: ${esc(r.id)} / 出典: ${esc(property.source ?? "—")} / 取得日: ${esc(fmtDate(property.captured_at))} / 駅徒歩${esc(property.station?.walk_min)}分 / 土地${esc(property.land?.registered_m2)}m² / 延床${esc(property.building?.floor_m2)}m² / 築: ${esc(fmtDate(property.building?.built))}</div>
    ${safeUrl(property.source_url) ? `<a class="src-link" href="${esc(property.source_url)}" target="_blank" rel="noopener noreferrer">元の掲載ページを見る ↗</a>` : ""}

    <div class="verdict-wrap" style="margin-top:16px">
      <div class="stamp ${v.cls}">${v.mark}</div>
      <div class="verdict-text">
        <div class="head">${v.head}</div>
        <div class="body">${v.body}</div>
      </div>
    </div>

    <section>
      <h2 class="sub">価格スケール ── 売出価格はどこに立っているか</h2>
      <div class="scale-wrap">${scaleSvg(s, { fairLo: r.fairFinal.lo, fairMid: r.fairFinal.mid, fairHi: r.fairFinal.hi, floorLo: lo.floorVal, floorHi: hi.floorVal, income: incomeVal })}</div>
      ${kvTable(r)}
    </section>

    ${retailCompsHtml(r)}

    ${marketCalHtml(r, marketCal)}

    <section>
      <h2 class="sub">モンテカルロ分布(${r.mc.trials.toLocaleString("en-US")}試行) ── 適正総額のばらつき</h2>
      ${histSvg(s, r.mc)}
      <div class="pct-line">${pctLine(r.mc, r.mc.p50)}</div>
      <div class="caveat">※ 原価法(土地+建物)側のばらつきであり、リテール比較法の値は含まない。パラメータ不確実性＋モデル構造誤差(±5%)を含むが、補正体系自体の誤りは表現できない。パーセンタイルは目安であり検定結果ではない。</div>
    </section>

    <section class="tornado">
      <h2 class="sub">感度分析 ── どの変数が査定額を動かすか</h2>
      ${tornadoHtml(r.tornado)}
    </section>

    <section>
      <h2 class="sub">算出根拠の全文開示 ── この査定額はこうやって作られている</h2>
      <div class="logic-body">${logicSteps(r)}</div>
    </section>

    ${budgetHtml(r)}
    ${priceHistoryHtml(property)}
    ${checklistHtml(property)}
    ${assumptionsHtml(r)}

    <div class="disclaimer">
      本ページは公開データに基づく簡易モデルであり、不動産鑑定評価・投資助言ではありません。補正係数(徒歩±1.2%/分、方位±2〜5%、旗竿−25%、複数駅+2%、木造残価22年逓減等)は市場慣行の近似値で、統計的に推定されたものではありません。取引事例による係数検証と、有資格者の査定・重要事項説明・解体費実見積で必ず裏取りしてください。
    </div>
  </div>`;

  return layout({
    title: "中古戸建 査定台帳",
    subtitle: esc(property.location?.address ?? r.id) + " ── 売出価格を土地値・解体費・建物残価・繰延修繕に分解する",
    docNo: `判定【${v.mark}】<br>査定基準日 ${r.asOf}<br>engine ${esc(r.engineVersion)}`,
    body,
  });
}
