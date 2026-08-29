// site/templates/property.js — 物件詳細ページ(simulator v1.2のUI資産をサーバサイド描画に移植)
// スケールSVG / 明細表 / MC分布 / トルネード / 算出根拠の全文開示 / 予算 / モデル外チェックリスト / 仮定一覧
import { fmtMan, pct, COEFFS } from "../../engine/appraise.js";
import { districtOf } from "../../engine/retail.js";
import { layout, esc, escRich, STATUS_LABEL, fmtDate, safeUrl } from "./layout.js";
import { anatomySvg, rawResidualStats } from "./anatomy.js";

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

// ---- 値段の解剖(formula.htmlの「実例」と同じ書き方を全物件で踏襲) ----
// 総額 = 土地 + 建物残価 + 売主の期待、の3層に分解して1本のバーで示し、
// 式への実数代入と残余単価の検算(市場分布との突き合わせ)を添える。
function anatomyHtml(r, property, houseDeals) {
  const { state: s, mid } = r;
  const rt = r.retail;
  const marketMid = rt ? rt.mid : r.fairFinal.mid;
  const landPartRaw = rt ? rt.landPart : mid.land2;
  const barLand = Math.min(landPartRaw, marketMid);
  const barBldg = Math.max(0, marketMid - barLand);
  const gap = s.ask - marketMid;
  const tsubo = mid.tsubo;
  const svg = anatomySvg({ landPart: barLand, bldg: barBldg, retailMid: marketMid,
    fairLo: r.fairFinal.lo, fairMid: r.fairFinal.mid, fairHi: r.fairFinal.hi, ask: s.ask });

  const formulaPre = rt
    ? `<b>市場水準</b> = 残余単価 ${Math.round(rt.unitMid)}万/坪 × 実効${tsubo.toFixed(2)}坪 × 個別補正${rt.subjectFactor.toFixed(2)}(= <span style="color:#2E6E8E">土地 ${fmtMan(Math.round(rt.landPart))}</span>) + <span style="color:#B07C10">建物残価 ${fmtMan(Math.round(rt.bldgSubj))}</span> = <b>${fmtMan(Math.round(rt.mid))}</b>
<b>売出価格</b> = 市場水準 ${fmtMan(Math.round(rt.mid))} + <span style="color:var(--stamp)"><b>売主の期待 ${gap >= 0 ? "+" : ""}${fmtMan(Math.round(gap))}</b>(市場水準比 ${gap >= 0 ? "+" : ""}${(100 * gap / marketMid).toFixed(1)}%)</span> = ${fmtMan(Math.round(s.ask))}
<b>参考(過熱感)</b> = 適正中央値 ${fmtMan(Math.round(r.fairFinal.mid))} との乖離 ${r.premium >= 0 ? "+" : ""}${fmtMan(Math.round(r.premium))} = 市場の上振れ ${r.overheat >= 0 ? "+" : ""}${fmtMan(Math.round(r.overheat))} + 売主の期待 ${gap >= 0 ? "+" : ""}${fmtMan(Math.round(gap))}`
    : `<b>市場水準(原価法)</b> = ${r.fairFinal.route === "land"
      ? `<span style="color:#2E6E8E">土地 ${fmtMan(Math.round(mid.land2))}</span> − 解体費 ${fmtMan(Math.round(s.demo))}(土地として売る方が高い)`
      : `<span style="color:#2E6E8E">土地 ${fmtMan(Math.round(mid.land2))}</span> + <span style="color:#B07C10">建物残価(市場性・修繕控除後) ${fmtMan(Math.round(Math.max(0, marketMid - mid.land2)))}</span>`} = <b>${fmtMan(Math.round(marketMid))}</b>
<b>売出価格</b> = 市場水準 ${fmtMan(Math.round(marketMid))} + <span style="color:var(--stamp)"><b>売主の期待 ${gap >= 0 ? "+" : ""}${fmtMan(Math.round(gap))}</b>(市場水準比 ${gap >= 0 ? "+" : ""}${(100 * gap / marketMid).toFixed(1)}%)</span> = ${fmtMan(Math.round(s.ask))}`;

  // 残余単価の検算(リテール成立時のみ。市場分布は隣接地区・中古実需帯の生の実績)
  let residCheck = "";
  if (rt) {
    const district = districtOf(property.location?.address);
    const raw = district ? rawResidualStats(houseDeals, district) : { n: 0 };
    const askUnitResid = Math.round((s.ask - rt.bldgSubj) / (tsubo * rt.subjectFactor));
    if (raw.n >= 8) {
      residCheck = `
      <table class="kv" style="max-width:640px;margin-top:10px">
        <tr><td>検算: 売出価格の残余単価(建物控除後・土地1坪あたりの要求水準)</td><td class="num" style="color:var(--stamp)"><b>${askUnitResid}万/坪</b></td></tr>
        <tr><td>周辺実績の生の中央値 / 上位10%(隣接地区・築3〜25年 ${raw.n}件)</td><td class="num">${raw.med}万/坪 / ${raw.p90}万/坪</td></tr>
        <tr><td>時点修正後の市場中央値(上昇継続を仮定した「今」の推計)</td><td class="num">${Math.round(rt.unitMid)}万/坪</td></tr>
      </table>`;
    } else {
      residCheck = `<div class="note" style="margin-top:8px">検算: 売出価格の残余単価は <b>${askUnitResid}万/坪</b>(建物控除後)。この地区は隣接の実需帯標本が少なく分布との突き合わせは省略。</div>`;
    }
  }

  return `
    <section>
      <h2 class="sub">値段の解剖 ── 売出価格を「土地+建物+売主の期待」に分ける</h2>
      <div class="logic-body">
        ${svg}
        <pre style="font-family:var(--mono);font-size:.78rem;line-height:1.9;background:#F7F9FA;border:1px solid var(--grid);padding:12px 14px;overflow-x:auto;margin-top:10px">${formulaPre}</pre>
        ${residCheck}
        <div class="note" style="margin-top:8px"><span style="color:#2E6E8E">■土地</span>は解体しても残る価値(下値フロアの源泉)、<span style="color:#B07C10">■建物</span>は住みながら消費する価値、<span style="color:var(--stamp)">▨売主の期待</span>は資産価値ゼロの上乗せで値下げ・交渉で削られていく部分${rt ? "。<b>市場水準は成約実勢(リテール比較)</b>で、適正レンジとの差は「市場全体の過熱感=相場調整時の下落余地」を測る参考" : "。本物件はリテール比較が不成立のため、市場水準は原価法による推計"}。この書き方の一般形・各項の意味は<a href="../formula.html">値段の解剖(算出ロジック図解)</a>、希望条件の金額換算は<a href="../tradeoff.html">妥協の値段</a>を参照。</div>
      </div>
    </section>`;
}

// ---- 価格スケールSVG(v1.2 drawScale移植) ----
function scaleSvg(s, v) {
  const cands = [v.floorLo, v.floorHi, v.fairLo, v.fairHi, s.ask];
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
  // 帯ラベルは帯の左端に置くが、右端からはみ出す位置ならアンカーを帯右端の末尾寄せに切替
  // (レンジ位置はデータ依存のため。2026-08-12 西が丘2の値下げで見切れが顕在化)
  const bandLabel = (x0, x1, y, text, estW, color) => {
    const fits = x0 + estW <= 632;
    return `<text x="${fits ? x0 : Math.min(x1, 632)}" y="${y}" font-size="10"${fits ? "" : ' text-anchor="end"'} fill="${color}">${text}</text>`;
  };
  el.push(`<rect x="${X(v.floorLo)}" y="70" width="${Math.max(2, X(v.floorHi) - X(v.floorLo))}" height="14" fill="#2E6E8E" opacity="0.85"/>`);
  el.push(bandLabel(X(v.floorLo), X(v.floorHi), 64, "下値フロア(土地−解体費)", 130, "#16232E"));
  el.push(`<rect x="${X(v.fairLo)}" y="86" width="${Math.max(2, X(v.fairHi) - X(v.fairLo))}" height="14" fill="#BFD7E4"/>`);
  el.push(bandLabel(X(v.fairLo), X(v.fairHi), 136, "適正価格レンジ(原価法×リテールの重み付き調整)", 228, "#43566B"));
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
  let sizeWhy = `${COEFFS.SIZE_SMALL_TSUBO}〜45坪は補正なし(13〜20坪は23区実勢で需要が厚いため2026-08監査でペナルティ撤廃)。`;
  if (mid.tsubo < COEFFS.SIZE_SMALL_TSUBO) sizeWhy = `${COEFFS.SIZE_SMALL_TSUBO}坪を下回るほど狭小地として買い手が減るため、1坪不足あたり−0.5%(最大−5%)。`;
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

    ["下値フロア(土地値 − 解体費" + (r.fairFinal.floorGuard < 1 ? "・未検証単価につき×0.9適用" : "") + ")",
      fmtMan(mid.land2) + " − 解体費 " + fmtMan(s.demo) + (r.fairFinal.floorGuard < 1 ? " → ×0.9" : "") + " = <b>" + fmtMan(r.fairFinal.floorEff.mid) + "</b>",
      "この物件を「最悪でも土地として売る」ときの手取り相当額です。古家付き土地の買い手は解体費を差し引いて指値するため、資産防衛の合格ラインはここに置くべきです。なお「確実な下値」と呼びたくなりますが、基準坪単価の幅に加え、実際に即時処分する場合は業者卸値(実勢の約90%)と売却諸費用(約4%)がかかります。それらを控除した<b>即時処分値 " + fmtMan(r.fairFinal.floorEff.netMid) + "</b> が取得諸費用込みの「買」判定の閾値です(2026-08第2次監査でフロア定義を保守化)。"],

    ["建物残価(市場が建物に払う残り時間)",
      s.rebuild + "万/坪 × " + (s.floor / COEFFS.TSUBO_M2).toFixed(2) + "坪 × max(0, 1 − 築" + s.age.toFixed(1) + "年 ÷ " + COEFFS.BUILDING_LIFE_Y + "年) = <b>" + fmtMan(mid.resid) + "</b>",
      "維持管理された木造戸建の市場評価はおおむね" + COEFFS.BUILDING_LIFE_Y + "年で逓減すると置いています(2026-08監査で税法22年から実勢寄りに更新。再調達単価" + s.rebuild + "万/坪も実勢建築費ベース)。" + (mid.alive ? "3階建・狭小などの市場性減価(" + pct(s.bm) + ")は建物残価のみに掛かります(以前は土地込みに掛かるバグがあり監査で修正)。" : "本件は築" + s.age.toFixed(1) + "年のため残価ゼロ。査定上は「古家付き土地」であり、実際に住めるかどうかと市場が建物代を払うかは別問題です。") + " 雨漏り・傾き等の実際の劣化(観察減価)はこの式の外で、インスペクションでしか分かりません。"],

    ["売却ルートの場合分け(原価法サイド)",
      "原価法の適正価格 = max(住まいとして売る価値, 土地として売る価値)<br>＝ max(土地値＋残価×(1" + pct(s.bm) + ") − 繰延修繕" + fmtMan(s.repair) + ", 土地値 − 解体費" + fmtMan(s.demo) + ")<br>＝ max(" + fmtMan(mid.asHome) + ", " + fmtMan(mid.asLand) + ") = <b>" + fmtMan(mid.fair) + "</b>",
      "物件には「住まいとして売る」「土地として売る」の2つの出口があり、高い方で決まります。住まいルートでは買い手が引き継ぐ繰延修繕を控除し(残価逓減は「維持された建物」前提のため、履歴不明分をここで補う)、土地ルートでは解体費を控除します。修繕実施のエビデンス(点検履歴・リフォーム記録)があれば修繕は減額してください。"],

    ...(r.retail ? [[
      "リテール比較法(第3の売却ルート: 実需に家として売る)",
      "類似の戸建成約 " + r.retail.n + "件(築±6年・面積帯一致)の土地残差単価中央値 " + Math.round(r.retail.unitMid) + "万/坪 × 実効" + mid.tsubo.toFixed(2) + "坪 + 対象建物価値 " + fmtMan(r.retail.bldgSubj) + " = <b>" + fmtMan(r.retail.mid) + "</b>(四分位 " + fmtMan(r.retail.lo) + "〜" + fmtMan(r.retail.hi) + ")",
      "住宅ローン実需が「住める家」に払う価格を、国交省の戸建成約から直接比較した値です。第2次監査を反映し、①事例は対象の近接地区に限定(" + (r.retail.districtScoped ? "本件は近接地区のみ" : "近接事例不足のため全地区・参考") + ")、②対象物件の減価・加点(形状・方位・接道・角地・法的制約・個別補正)を事例側にも伝搬(<b>形状は" + (r.retail.shapeControlled ? "満額" : "半減") + "で適用</b> ── " + esc(r.retail.shapeBasis) + ")、③新築建売は中古の査定から除外、④時点修正は土地残差に年次別の地価レートを適用しています。<br>2026-08-29に<b>前面道路の幅員</b>を追加しました ── " + esc(r.retail.breadthBasis) + "。従来は事例側の幅員を素通しにしたまま対象にだけ接道の減点を当てており、二重減価になっていました。幅員は成約データで坪単価を大きく動かします(標準条件4〜6mに対し 2.0m以下 −40.4%・2.7〜4.0m −6.3%・6m超 +14.5%。いずれも95%CIが0を跨がない)。最終的な適正価格は max採用ではなく<b>事例数に応じた重み付き調整</b>(本件: リテール" + (r.fairFinal.weights.retail * 100).toFixed(0) + "%・原価法" + (r.fairFinal.weights.cost * 100).toFixed(0) + "%)で、ただし土地換算値を下回る場合は土地値が下限になります。"
    ]] : [[
      "リテール比較法(第3の売却ルート)",
      "類似成約が不足(5件未満)のため原価法のみで査定",
      "土地面積・延床・築年の近い戸建成約が見つからないため、この物件ではリテール比較を適用していません。"
    ]]),

    ["適正価格レンジ(最終的な物差し)",
      fmtMan(r.fairFinal.lo) + " 〜 <b>" + fmtMan(r.fairFinal.mid) + "</b> 〜 " + fmtMan(r.fairFinal.hi),
      "原価法とリテール比較法の重み付き調整(土地換算値を下限保証)によるレンジです。売出価格" + fmtMan(s.ask) + "との差 <b>" + (s.ask - r.fairFinal.mid >= 0 ? "+" : "") + fmtMan(s.ask - r.fairFinal.mid) + "</b> が、土地・建物・周辺成約のいずれでも説明できない上乗せ(プレミアム)です。払うこと自体は悪ではありませんが、金額を自覚して払うのと知らずに払うのは別物です。"],
  ];

  if (incomeVal) {
    steps.push(["収益価格(第3の錨)",
      "月額 " + s.rent + "万 × 12 × (1 − 経費率" + (s.expr * 100).toFixed(0) + "%) ÷ 還元利回り" + (s.yld * 100).toFixed(1) + "% = <b>" + fmtMan(incomeVal) + "</b>",
      "「貸したら投資家は幾らまで払うか」の逆算です。戸建賃貸は固定資産税・修繕・空室で賃料の15〜20%が経費に消えるため、表面でなく経費控除後(NOI)で還元します。賃料入力が仮置きなら必ず周辺実勢に差し替えてください。ここが現状最も弱い入力です。"]);
  }

  steps.push(["総取得コストと即時含み損(最後の現実)",
    "総コスト: " + fmtMan(s.ask) + " × (1+" + (s.fee * 100).toFixed(1) + "%)" + (r.fairFinal.route === "home" ? " + 修繕 " + fmtMan(s.repair) : "(修繕費は取得コストと別枠)") + " = <b>" + fmtMan(totalCost) + "</b><br>即時含み損: " + fmtMan(totalCost) + " − 査定 " + fmtMan(r.fairFinal.mid) + " = <b>" + fmtMan(instLoss) + "</b>",
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
    ["土地換算値(土地値−解体費" + fmtMan(s.demo) + (r.fairFinal.floorGuard < 1 ? "。単価未検証につき×0.9で適用" : "") + ")", fmtMan(r.fairFinal.floorEff.lo) + " 〜 " + fmtMan(r.fairFinal.floorEff.hi)],
    ["即時処分値(卸値90%・売却諸費用4%控除後。取得総額との比較で資産防衛の下限を見る)", fmtMan(r.fairFinal.floorEff.netMid)],
    ["建物残価(木造" + COEFFS.BUILDING_LIFE_Y + "年逓減)", mid.alive ? fmtMan(mid.resid) + "(市場性 " + pct(s.bm) + " は残価のみに適用)" : "0円(築" + s.age.toFixed(1) + "年・市場評価消滅)"],
    ["リテール比較(戸建成約 " + (r.retail ? r.retail.n + "件" : "—") + ")", r.retail ? fmtMan(r.retail.lo) + " 〜 " + fmtMan(r.retail.mid) + " 〜 " + fmtMan(r.retail.hi) : (r.fairFinal.retailApplicable === false ? "商業系につき適用外(土地評価)" : "類似成約不足のため適用外")],
    ["売却ルート判定", r.fairFinal.route === "retail" ? "リテール(実需に家として売る)が優位。加重 リテール" + (r.fairFinal.weights.retail * 100).toFixed(0) + "%:原価" + (r.fairFinal.weights.cost * 100).toFixed(0) + "%" : r.fairFinal.route === "land" ? "土地として売る方が高い(解体前提)" : "住まいとして売る方が高い"],
    ["適正価格レンジ(重み付き調整・土地値下限)", fmtMan(r.fairFinal.lo) + " 〜 " + fmtMan(r.fairFinal.hi), "em"],
    ...(r.premiumMarket !== null && r.premiumMarket !== undefined
      ? [["売出価格 − 市場実勢中央値(=売主の期待)", (r.premiumMarket >= 0 ? "+" : "") + fmtMan(r.premiumMarket)]] : []),
    ["売出価格 − 適正中央値(過熱感込み)", (premium >= 0 ? "+" : "") + fmtMan(premium)],
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
    <div class="budget-line"><span>0</span><span>総取得コスト <b style="font-family:var(--mono)">${fmtMan(totalCost)}</b>(価格×(1+${(s.fee * 100).toFixed(1)}%)${r.fairFinal.route === "home" ? `＋修繕${fmtMan(s.repair)}` : "。修繕費は別枠"})${over ? ` ── <span style="color:var(--stamp)">上限超過 ${fmtMan(totalCost - cap)}</span>` : ` ── 余裕 ${fmtMan(cap - totalCost)}`}</span><span>1.15億</span></div>
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
    : escRich(String(r.area.source));
  const items = r.assumptions.length
    ? r.assumptions.map((a) => `<li><b>${esc(a.field)}</b> = ${esc(a.value)} <span class="why">── ${escRich(a.why)}</span></li>`).join("")
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

// ---- 物件スペック表(メトリクス拡充・2026-08) ----
function specTable(r, property) {
  const s = r.state;
  const legal = property.land?.legal ?? {};
  const road = property.land?.road ?? {};
  const effTsubo = r.mid.tsubo;
  const landTsubo = s.land / COEFFS.TSUBO_M2;
  const floorTsubo = s.floor / COEFFS.TSUBO_M2;
  const cells = [
    ["間取り", property.layout ?? "—"],
    ["築年数", "築" + s.age.toFixed(1) + "年(" + esc(fmtDate(property.building?.built)) + "築)" + (r.isNewBuild ? " 新築" : "")],
    // bcr/far が未記載のYAMLで "undefined%" が出力されていたため個別に判定(2026-08-12監査)
    ["用途地域 / 建ぺい・容積", legal.zoning
      ? esc(legal.zoning) + " / " + (legal.bcr != null && legal.far != null ? legal.bcr + "%・" + legal.far + "%" : "建ぺい・容積は要調査")
      : "—(要調査)"],
    ["接道", (road.direction ? esc(String(road.direction)) + "側 " : "") + (road.width_m ? "幅員" + road.width_m + "m" : "—") + (s.roadq < 0 ? "(4m未満・減点" + pct(s.roadq) + ")" : "")],
    ["土地", s.land + "m²(" + landTsubo.toFixed(2) + "坪 / 実効" + effTsubo.toFixed(2) + "坪)"],
    ["延床", s.floor + "m²(" + floorTsubo.toFixed(2) + "坪)"],
    ["売出の土地単価(総額÷実効坪)", Math.round(s.ask / effTsubo).toLocaleString("en-US") + " 万円/坪"],
    ["売出の延床単価(総額÷延床坪)", Math.round(s.ask / floorTsubo).toLocaleString("en-US") + " 万円/坪"],
    ["駅徒歩", "徒歩" + s.walk + "分" + (s.mst ? "(複数駅・複数路線)" : "")],
    ["土地形状 / 権利", (property.land?.shape ? esc(String(property.land.shape)) : "記載なし") + " / " + (legal.ownership === "shoyuken" ? "所有権" : esc(String(legal.ownership ?? "—")))],
  ];
  return `<section style="margin-top:14px">
    <h2 class="sub">物件スペック ── 査定に入っている事実データ</h2>
    <table class="kv" style="font-size:.8rem">${cells.map(([k, v]) => `<tr><td style="width:220px">${k}</td><td>${v}</td></tr>`).join("")}</table>
    <div class="note">これらの値はYAMLに記録された媒体・チラシ記載の事実で、査定の入力そのもの(検証状態は各項目の注記・チェックリスト参照)。単価2種は売出価格の割り算で、査定値ではない。</div>
  </section>`;
}

// ---- リテール比較法(戸建成約)セクション ----
function retailCompsHtml(r) {
  if (!r.retail) {
    return `
    <section>
      <h2 class="sub">戸建成約比較(リテール比較法) ── 実需はいくらで買っているか</h2>
      <div class="note">${r.fairFinal.retailApplicable === false ? "最有効使用が商業系(近商・高容積)のため、住宅戸建の成約との比較は適用していません(土地評価ベース)。" : "土地面積・延床・築年の近い戸建成約が5件未満のため、この物件ではリテール比較を適用していません(原価法のみ)。"}</div>
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
          <tr class="em"><td>リテール比較の適正額(土地残差単価中央値 ${Math.round(retail.unitMid)}万/坪 × 実効${r.mid.tsubo.toFixed(2)}坪 + 対象建物価値 ${fmtMan(retail.bldgSubj)})</td><td>${fmtMan(retail.lo)} 〜 <b>${fmtMan(retail.mid)}</b> 〜 ${fmtMan(retail.hi)}</td></tr>
          <tr><td>原価法(土地+建物)の中央値</td><td>${fmtMan(r.mid.fair)}</td></tr>
          <tr><td>調整(事例数に応じた加重)</td><td>リテール${(r.fairFinal.weights.retail * 100).toFixed(0)}% + 原価法${(r.fairFinal.weights.cost * 100).toFixed(0)}%(土地換算値下限) → 適正中央値 ${fmtMan(r.fairFinal.mid)}</td></tr>
        </table>
        <div style="overflow-x:auto;margin-top:10px">
        <table class="list">
          <tr><th>時期</th><th>地区</th><th>成約総額</th><th>土地</th><th>延床</th><th>築年</th><th>駅</th><th>補正後単価</th></tr>
          ${rows}
        </table>
        </div>
        <div class="note">直近10件を表示(選定は${retail.n}件・築±6年・土地0.6〜1.6倍・延床0.7〜1.4倍・徒歩25分以内${r.state.age >= 2 ? "・新築建売除外" : ""})。補正後単価は地区水準・時点・徒歩・築年差・対象の個別要因を反映。レンジは四分位。出典: 国交省 不動産取引価格情報の再掲(utinokati.com・北区18地区・取得2026-08-10および2026-08-13)。原データは価格100万円単位・面積5m²単位に丸め。方位・接道・リフォーム有無は補正できないため誤差を含む。</div>
      </div>
    </section>`;
}

// ---- 成約実勢との突き合わせ(較正)セクション ----
// marketCal: {chosen, rRef, dealsN} — chosenは土地成約による較正値、rRefは較正を外した公示ベースの参考査定
function marketCalHtml(r, marketCal) {
  const { chosen, rRef } = marketCal ?? {};
  const adopted = r.fairFinal.pptSource === "calibrated";
  return `
    <section>
      <h2 class="sub">成約実勢との突き合わせ ── 土地単価の較正状況</h2>
      <div class="logic-body">
        <table class="kv">
          <tr><td>公示ベースの従来単価(公示×実勢係数)</td><td>${rRef ? Math.round(rRef.state.ppt) + "万円/坪" : "—"}</td></tr>
          <tr><td>土地成約による較正値${chosen ? `<div class="note" style="margin-top:2px">${escRich(chosen.basis)} / 信頼度: ${esc(chosen.confidence)}</div>` : ""}</td><td>${chosen ? chosen.ppt + "万円/坪" : "データ不足"}</td></tr>
          <tr class="em"><td>本査定の採用単価</td><td>${Math.round(r.state.ppt)}万円/坪(${adopted && chosen ? `較正値${chosen.ppt}万と従来値${rRef ? Math.round(rRef.state.ppt) : "—"}万のブレンド` : chosen ? "較正値は信頼度不足のため従来値を採用" : "従来値"})</td></tr>
          ${rRef && Math.round(rRef.fairFinal.mid) !== Math.round(r.fairFinal.mid) ? `<tr><td>(参考)従来単価のままの場合の適正中央値</td><td>${fmtMan(rRef.fairFinal.mid)}(本査定 ${fmtMan(r.fairFinal.mid)})</td></tr>` : ""}
        </table>
        <div class="caveat">※ 較正値は国交省 不動産取引価格情報(再掲)の土地成約を標準地条件・2025年1月基準に正規化したもの。地区平均採用時は混合平均補正+10%込み。詳細は一覧ページの較正状態パネルを参照。</div>
        <a class="src-link" href="${esc(r.id)}-market.html" style="margin-top:10px">成約事例ベースの根拠を全文で見る(土地較正・戸建比較・乖離の仕分け) →</a>
      </div>
    </section>`;
}

// ---- ハザード検証状態(YAMLの hazard_check を描画) ----
// 重要事項説明は契約直前に来るため、そこで初めてハザード指定が判明すると
// サンクコストで判断が歪む。台帳側で「どこまで確認できているか」を常時可視化して、
// 検討を進める前に潰せるようにする(2026-08-12: 西が丘2でSUUMO単独確認が破綻した反省)
function hazardHtml(property) {
  const h = property.hazard_check;
  if (!h) return "";
  const LABEL = { none: "記載なし", hit: "該当", unchecked: "未確認", na: "掲載なし" };
  const o = h.official ?? null;
  const pending = h.athome === "unchecked" || h.suumo === "unchecked";
  // 公式マップで掲載条件を外れる(block)場合は最も強い警告色。次いで掲載欄の未検証
  const bad = o?.verdict === "block";
  const color = bad || pending ? "var(--stamp)" : o?.verdict === "caution" ? "#B07C10" : "#2E6E8E";
  return `
    <div style="border:1px solid ${color};background:${bad || pending ? "#FDF4F3" : o?.verdict === "caution" ? "#FDFAF2" : "#F4F8FA"};padding:9px 12px;margin-top:12px;font-size:.8rem;line-height:1.8">
      <b style="color:${color}">ハザード確認状況${bad ? " ── 公式マップで掲載条件外" : pending ? " ── 掲載欄に未検証あり" : ""}</b>
      ／ SUUMO掲載: ${esc(LABEL[h.suumo] ?? h.suumo)}
      ／ athome掲載: ${esc(LABEL[h.athome] ?? h.athome)}${h.athome_ref ? `(${esc(h.athome_ref)})` : ""}
      ／ 確認日 ${esc(fmtDate(h.checked_at))}
      <div class="note" style="margin-top:3px">${escRich(h.note ?? "")}</div>
      ${o ? `<div style="margin-top:7px;padding-top:7px;border-top:1px dashed ${color}">
        <b>公式マップ照合</b>(国土地理院タイル・${esc(fmtDate(o.checked_at))}) ／ ${esc(o.query)} の代表点 ${esc(o.point)} ／ 標高 ${esc(o.elevation_m)}m<br>
        ${Array.isArray(o.hits) && o.hits.length
          ? o.hits.map((x) => `<span style="color:${color};font-weight:700">${esc(x)}</span>`).join(" ／ ")
          : "代表点では該当なし"}${o.flood_l2 ? `<br>周辺±200mの25点サンプルでの浸水想定の被覆: ${esc(o.flood_coverage)}` : ""}
        ${o.reason ? `<div style="margin-top:3px;color:${color}"><b>${bad ? "掲載条件「台地側(荒川低地の浸水想定域外)」から外れている" : "要確認"}</b>: ${esc(o.reason)}</div>` : ""}
        <div class="note" style="margin-top:3px">${escRich(o.limit ?? "")} <a href="../map.html">エリア全体のハザードマップ対照を見る↗</a></div>
      </div>` : ""}
      ${pending ? `<div class="note" style="margin-top:3px;color:var(--stamp)"><b>掲載の制限事項欄は該当物件でも空欄のことがある</b>(実例: 西が丘2の2棟現場はSUUMOが空欄で、athomeの4業者掲載のみが土砂災害特別警戒区域を明記)。<b>内見・申込より前に</b>、重ねるハザードマップと東京都の土砂災害警戒区域等マップで自分で照合し、仲介には法令上の制限の全項目を書面で出してもらうこと。重要事項説明は契約直前のため、そこまで進めてから判明すると引き返しにくい。</div>` : ""}
    </div>`;
}

// ---- 査定が織り込めていない要確認事項(YAMLの caveats を描画) ----
// 掲載元の精査で判明したが、エンジンが変数として持たないため査定額に反映できない事実を開示する。
// 「安く出ている/高く出ている」理由が式の外にある場合、それを隠さないための欄(データ規律)
function caveatsHtml(property) {
  const cs = property.caveats;
  if (!Array.isArray(cs) || cs.length === 0) return "";
  const items = cs.map((c) => `
    <li style="margin-bottom:10px">
      <b>${escRich(c.title)}</b>${c.effect ? `<span class="status" style="margin-left:6px">${esc(c.effect)}</span>` : ""}
      <div style="font-size:.82rem;line-height:1.8;margin-top:3px">${escRich(c.detail)}</div>
      ${c.check ? `<div class="note" style="margin-top:2px">確認方法: ${escRich(c.check)}</div>` : ""}
    </li>`).join("");
  return `
    <section>
      <h2 class="sub">この査定が織り込めていない要確認事項</h2>
      <div class="logic-body">
        <p class="why">掲載元の精査で判明したが、査定エンジンが変数として持たないため金額に反映されていない事項。<b>上の各水準はこれらを織り込む前の値</b>であり、実地確認の結果しだいで評価は下振れ(または上振れ)しうる。</p>
        <ul style="margin:10px 0 0 18px;padding:0">${items}</ul>
      </div>
    </section>`;
}

// ---- ページ全体 ----
export function renderProperty(r, property, marketCal = null, houseDeals = null) {
  const { state: s, mid, lo, hi, position: pos, incomeVal } = r;
  const status = STATUS_LABEL[property.status] || property.status;
  const body = `
  <div style="margin-bottom:12px;font-size:.8rem"><a href="../index.html">← 物件一覧へ</a></div>
  <div class="panel">
    <h2>${esc(property.location?.address ?? r.id)}${property.unit_label ? `<span class="unit-tag">${esc(property.unit_label)}</span>` : ""} <span class="status">${esc(status)}</span></h2>
    <div class="note">ID: ${esc(r.id)} / 出典: ${escRich(property.source ?? "—")} / 取得日: ${esc(fmtDate(property.captured_at))} / 駅徒歩${esc(property.station?.walk_min)}分 / 土地${esc(property.land?.registered_m2)}m² / 延床${esc(property.building?.floor_m2)}m² / 築: ${esc(fmtDate(property.building?.built))}</div>
    ${safeUrl(property.source_url) ? `<a class="src-link" href="${esc(property.source_url)}" target="_blank" rel="noopener noreferrer">元の掲載ページを見る ↗</a>` : ""}

    ${specTable(r, property)}

    <div class="position-wrap" style="margin-top:16px">
      <div class="position-head">${pos.head}</div>
      <div class="position-body">${pos.body}</div>
      ${pos.notes.map((n) => `<div class="caveat" style="margin-top:6px">※ ${esc(n)}</div>`).join("")}
      ${r.isNewBuild ? `<div class="caveat" style="margin-top:6px">※ 新築物件: 本査定は「中古市場での再販価値」ベース。新築分譲価格には事業者利益・未入居プレミアムが含まれるのが通常で、乖離の一部はその剥落分と解釈すべき(査定がそのまま「ぼったくり」を意味しない)。</div>` : ""}
      ${r.fairFinal.floorBound ? `<div class="caveat" style="margin-top:6px">※ 本査定は土地換算値が下限として発火している(事例比較より土地値が高い)。土地単価が${r.fairFinal.pptSource === "calibrated" ? "成約較正済み" : "未検証(較正未成立)のため下限には×0.9のペナルティを適用済み"}。</div>` : ""}
      <div class="note" style="margin-top:8px">本台帳は<b>買う/見送るの判定を出さない</b>。上は売出価格が各参照水準のどこに立っているかという事実で、そこから先の判断(この価格を払う価値があるか)は住む本人が決めるもの。検討状況は<a href="../index.html">一覧ページ</a>で自分で設定できる。</div>
    </div>

    ${hazardHtml(property)}

    ${caveatsHtml(property)}

    ${anatomyHtml(r, property, houseDeals)}

    <section>
      <h2 class="sub">価格スケール ── 売出価格はどこに立っているか</h2>
      <div class="scale-wrap">${scaleSvg(s, { fairLo: r.fairFinal.lo, fairMid: r.fairFinal.mid, fairHi: r.fairFinal.hi, floorLo: r.fairFinal.floorEff.lo, floorHi: r.fairFinal.floorEff.hi, income: incomeVal })}</div>
      ${kvTable(r)}
    </section>

    ${retailCompsHtml(r)}

    ${marketCalHtml(r, marketCal)}

    <section>
      <h2 class="sub">モンテカルロ分布(${r.mc.trials.toLocaleString("en-US")}試行) ── 原価法サイドのばらつき(参考)</h2>
      ${histSvg(s, r.mc)}
      <div class="pct-line">${r.fairFinal.route === "retail" ? `売出は原価法分布の${r.mc.askPercentile.toFixed(0)}パーセンタイル(※最終査定はリテール比較を${(r.fairFinal.weights.retail * 100).toFixed(0)}%加重しているため、この分布だけで割高とは判断しない)` : pctLine(r.mc, r.mc.p50)}</div>
      <div class="caveat">※ 原価法(土地+建物)側のばらつきであり、リテール比較法の値は含まない。パラメータ不確実性＋モデル構造誤差(±5%)を含むが、補正体系自体の誤りは表現できない。パーセンタイルは目安であり検定結果ではない。</div>
    </section>

    <section class="tornado">
      <h2 class="sub">感度分析 ── どの変数が原価法の査定額を動かすか</h2>\n      <div class="note">※ 原価法サイドの感度。リテール比較加重後の最終査定への影響は重み(原価${(r.fairFinal.weights.cost * 100).toFixed(0)}%)分に縮小される。</div>
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
      本ページは公開データに基づく簡易モデルであり、不動産鑑定評価・投資助言ではありません。補正係数(徒歩±1.2%/分、方位±2〜5%、旗竿−25%、複数駅+2%、木造残価${COEFFS.BUILDING_LIFE_Y}年逓減等)は市場慣行の近似値で、統計的に推定されたものではありません。取引事例による係数検証と、有資格者の査定・重要事項説明・解体費実見積で必ず裏取りしてください。
    </div>
  </div>`;

  return layout({
    title: "中古戸建 査定台帳",
    subtitle: esc(property.location?.address ?? r.id) + " ── 売出価格を土地値・解体費・建物残価・繰延修繕に分解する",
    docNo: `査定基準日 ${r.asOf}<br>engine ${esc(r.engineVersion)}`,
    body,
  });
}
