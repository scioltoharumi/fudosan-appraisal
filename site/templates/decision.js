// site/templates/decision.js — 意思決定の地図(中古→新築→賃貸→新築、一周の記録)
// 2026-08-29ユーザー要望「最初は中古→新築もあり→シミュレーションしたら賃貸かも→ぐるぐる回って
// 結局どういう意思決定になっていたのかを改めて整理したい。ロジックを可視化したい。
// なるべく文字量は減らして、パッと見て一目でわかるように。パートナーにも見せたい」。
//
// 設計方針:
//   - 主役は図2(検討の一周ループ)。各選択肢で「求めたもの」と「つまずき」を1〜2行に絞る。
//   - 図3は一周の途中で得た最大の学び「戸建てを選んだ時点で資産性はある程度捨てる」の導出を
//     2分岐(駅近/駅遠)で図解する。どちらの枝も資産性が立たないことが循環の原因なので、
//     ここだけは省略しない。
//   - 判定はしない(v3.0.0の思想)。表の◯△✕は検討の中で本人が置いた評価の**記録**であって、
//     エンジンの判定ではない——この性質はページ内に明示する。
//   - 文字量を減らす代わりに、数字の裏取りは既存ページ(simulate/focus/effort/rent/cliff)への
//     導線に寄せる。金額はすべて台帳の実測ページに正本がある参照値。
//   - SVGの縦軸ラベルに rotate(-90) は使わない(運用ルール5)。
import { layout, esc } from "./layout.js";

const C = {
  ink: "#16232E", soft: "#43566B", band: "#2E6E8E", rent: "#6B4E9B",
  used: "#8A5A2B", newb: "#2C6E49", stop: "#C93A2B", warn: "#B07C10",
};

// 小箱+複数行テキスト(SVG部品)
function box(el, x, y, w, h, lines, { stroke = C.ink, fill = "#fff", sw = 1.2, dash = "" } = {}) {
  el.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
  lines.forEach((ln, i) => {
    const [t, opt = {}] = Array.isArray(ln) ? ln : [ln];
    el.push(`<text x="${x + w / 2}" y="${y + (opt.y ?? 18 + i * 15)}" font-size="${opt.fs ?? 9.5}" fill="${opt.color ?? C.ink}"${opt.bold ? ' font-weight="700"' : ""} text-anchor="middle">${esc(t)}</text>`);
  });
}
const ARROW_DEFS = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#43566B"/></marker></defs>`;
const arrow = (el, x1, y1, x2, y2, { dash = "" } = {}) =>
  el.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#43566B" stroke-width="1.6" marker-end="url(#ah)"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);

// ---- 図2: 検討の一周(中古→新築→賃貸→新築・二周目) ----
function figLoop() {
  const W = 760, H = 440, el = [ARROW_DEFS];
  const NW = 252, NH = 100, T1 = 54, T2 = 296;   // ノード幅・高さ・上段/下段のy
  const LX = 48, RX = 460;                        // 左列・右列のx

  // ① 中古戸建(左上)
  box(el, LX, T1, NW, NH, [
    ["① 中古戸建からスタート", { fs: 11, bold: true, y: 22, color: C.used }],
    ["求めたもの: 資産性", { fs: 9.5, bold: true, y: 43, color: C.used }],
    ["建物代≈0円 = ほぼ土地を買う", { fs: 8.5, y: 61, color: C.soft }],
    ["状況が変わってもいつでも売れる", { fs: 8.5, y: 77, color: C.soft }],
  ], { stroke: C.used, sw: 1.5 });
  // ② 新築(右上)
  box(el, RX, T1, NW, NH, [
    ["② 新築もありでは?", { fs: 11, bold: true, y: 22, color: C.newb }],
    ["求めたもの: 住みよさ", { fs: 9.5, bold: true, y: 43, color: C.newb }],
    ["家の中だけなら理想的", { fs: 8.5, y: 61, color: C.soft }],
    ["修繕は保証の傘で〜10年静か", { fs: 8.5, y: 77, color: C.soft }],
  ], { stroke: C.newb, sw: 1.5 });
  // ③ 賃貸(右下)
  box(el, RX, T2, NW, NH, [
    ["③ いっそ賃貸では?", { fs: 11, bold: true, y: 22, color: C.rent }],
    ["求めたもの: 身軽さ", { fs: 9.5, bold: true, y: 43, color: C.rent }],
    ["ずっと住むか未定でも動ける", { fs: 8.5, y: 61, color: C.soft }],
    ["修繕・災害リスクは大家側", { fs: 8.5, y: 77, color: C.soft }],
  ], { stroke: C.rent, sw: 1.5 });
  // ④ 新築・二周目(左下)=今ここ
  box(el, LX, T2, NW, NH, [
    ["④ 新築(二周目)", { fs: 11, bold: true, y: 26, color: C.ink }],
    ["変えたこと: 許容範囲を1段拡げた", { fs: 9.5, bold: true, y: 47 }],
    ["規制ありも個別に検討(ハザード照合は維持)", { fs: 8.2, y: 65, color: C.soft }],
    ["予算帯 7,100〜7,700万の本命3件へ", { fs: 8.5, y: 81, color: C.soft }],
  ], { stroke: C.stop, sw: 2.2, fill: "#FDF6F4" });
  el.push(`<rect x="${LX}" y="${T2 - 12}" width="52" height="22" fill="${C.stop}"/>`);
  el.push(`<text x="${LX + 26}" y="${T2 + 3}" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">今ここ</text>`);

  // ①→② つまずき: 修繕費・住みよさ
  arrow(el, LX + NW + 6, T1 + NH / 2 + 12, RX - 6, T1 + NH / 2 + 12);
  el.push(`<text x="${(LX + NW + RX) / 2}" y="${T1 + 26}" font-size="8.5" fill="${C.stop}" text-anchor="middle">でも 修繕費がかさむ</text>`);
  el.push(`<text x="${(LX + NW + RX) / 2}" y="${T1 + 41}" font-size="8.5" fill="${C.stop}" text-anchor="middle">住みよさも物足りない</text>`);
  // ②→③ つまずき: 駅遠・資産性の学び
  arrow(el, RX + NW / 2, T1 + NH + 6, RX + NW / 2, T2 - 26);
  el.push(`<rect x="${RX + 10}" y="${T1 + NH + 26}" width="${NW - 20}" height="52" fill="#fff" opacity=".92"/>`);
  el.push(`<text x="${RX + NW / 2}" y="${T1 + NH + 44}" font-size="8.5" fill="${C.stop}" text-anchor="middle">でも 駅から遠い(例: 徒歩22分)</text>`);
  el.push(`<text x="${RX + NW / 2}" y="${T1 + NH + 60}" font-size="8.5" fill="${C.stop}" text-anchor="middle">資産性はどのみち立たないと判明(図3)</text>`);
  el.push(`<text x="${RX + NW / 2}" y="${T1 + NH + 76}" font-size="8.5" fill="${C.soft}" text-anchor="middle">→ ならば買わない選択も?</text>`);
  // ③→④ つまずき: 掛け捨て
  arrow(el, RX - 6, T2 + NH / 2 + 12, LX + NW + 6, T2 + NH / 2 + 12);
  el.push(`<text x="${(LX + NW + RX) / 2}" y="${T2 + 26}" font-size="8.5" fill="${C.stop}" text-anchor="middle">でも 実質は月25〜29万の掛け捨て</text>`);
  el.push(`<text x="${(LX + NW + RX) / 2}" y="${T2 + 41}" font-size="8.5" fill="${C.stop}" text-anchor="middle">2年ごと更新料・資産は残らない</text>`);
  // ④は②(新築)へ戻る周回だが、探す条件が一周前と違う(対角の点線で「戻り」を示す)
  arrow(el, LX + NW - 20, T2 - 6, RX + 30, T1 + NH + 8, { dash: "4 4" });
  el.push(`<rect x="${W / 2 - 88}" y="196" width="176" height="42" fill="#fff" opacity=".92"/>`);
  el.push(`<text x="${W / 2}" y="211" font-size="8.5" fill="${C.soft}" text-anchor="middle">同じ「新築」に戻ったが</text>`);
  el.push(`<text x="${W / 2}" y="227" font-size="8.5" fill="${C.soft}" text-anchor="middle">探す条件が一周前と違う</text>`);
  // 下部注記
  el.push(`<text x="${W / 2}" y="${H - 14}" font-size="9" fill="${C.soft}" text-anchor="middle">堂々巡りではなく、1周して「何を捨てるか」が決まった(資産性)。残る迷いは ④新築 vs ③賃貸 の2択</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="検討の一周: 中古から新築、賃貸を経て条件を変えた新築へ戻るループ図" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図3: 学び「戸建ての資産性は、どの道を選んでも立たない」 ----
function figAsset() {
  const W = 760, H = 360, el = [ARROW_DEFS];
  box(el, 230, 14, 300, 34, [["戸建てで「資産性」は立つか?", { fs: 11, bold: true, y: 22 }]], { sw: 1.5 });
  arrow(el, 310, 48, 216, 88);
  arrow(el, 450, 48, 544, 88);
  const chain = (x, lines1, lines2, lines3) => {
    box(el, x, 92, 250, 34, lines1);
    arrow(el, x + 125, 126, x + 125, 148);
    box(el, x, 152, 250, 34, lines2);
    arrow(el, x + 125, 186, x + 125, 208);
    box(el, x, 212, 250, 48, lines3, { stroke: C.stop, sw: 1.5 });
  };
  chain(90,
    [["駅の近くに買う", { fs: 10, bold: true, y: 22 }]],
    [["価格は1億円前後になる", { fs: 9.5, y: 22 }]],
    [["買い手は実需のみ=ごく少数", { fs: 9, y: 19, color: C.soft }], ["→ 売りにくい(資産性 ✕)", { fs: 10, bold: true, y: 37, color: C.stop }]]);
  chain(420,
    [["駅から遠くに買う", { fs: 10, bold: true, y: 22 }]],
    [["土地の値段から割り引かれる", { fs: 9.5, y: 22 }]],
    [["出口の価格も同じだけ低い", { fs: 9, y: 19, color: C.soft }], ["→ 上がらない(資産性 ✕)", { fs: 10, bold: true, y: 37, color: C.stop }]]);
  arrow(el, 215, 260, 300, 288);
  arrow(el, 545, 260, 460, 288);
  box(el, 120, 292, 520, 36, [["⇒ 戸建てを選んだ時点で、資産性はある程度捨てる(=住みよさを買う選択)", { fs: 10.5, bold: true, y: 23, color: "#fff" }]], { stroke: C.band, fill: C.band });
  el.push(`<text x="${W / 2}" y="350" font-size="8.5" fill="${C.soft}" text-anchor="middle">(マンションは高額帯ほど投資の買い手が現れる=別の市場。ただし住みよさで除外済み→土台)</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="戸建ての資産性が駅近・駅遠のどちらの道でも立たないことを示す2分岐図" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 本体 ----
const td = 'style="white-space:normal;font-size:.78rem;text-align:left;font-family:inherit;font-weight:400"';
const mark = (m) => ({ "○": `<b style="color:${C.newb}">○</b>`, "△": `<b style="color:${C.warn}">△</b>`, "✕": `<b style="color:${C.stop}">✕</b>` })[m];
const cell = (m, t) => `<td ${td}>${mark(m)} <span style="font-size:.72rem;color:var(--ink-soft)">${t}</span></td>`;

export function renderDecision({ asOf }) {
  const body = `
  <section class="panel">
    <h2>これは何のページか</h2>
    <div class="logic-body">
      <p style="font-size:.85rem">中古 → 新築 → 賃貸 → また新築と、住まいの検討が<b>一周した経緯</b>を1枚に固定する。
      <b>このページは判定をしません</b>——どこで何を求め、何につまずき、何を学んで次へ移ったかの<b>記録</b>。
      金額の正本は各リンク先(実測ページ)にある。</p>
    </div>
  </section>

  <section class="panel">
    <h2>土台 ── 最初に決まって、いまも動いていないこと</h2>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:stretch;font-size:.76rem">
      <div style="border:1px solid var(--grid);padding:8px 10px;background:#F8FAFB;flex:1;min-width:150px">
        <b>きっかけ</b><div style="color:var(--ink-soft);font-size:.72rem;line-height:1.7">家賃は掛け捨て/高齢になると借りにくい・ローンを組みにくい/周りも買い始めた</div>
      </div>
      <div style="align-self:center;font-weight:700;color:var(--ink-soft)">→</div>
      <div style="border:1.5px solid ${C.stop};padding:8px 10px;flex:1;min-width:150px">
        <b style="color:${C.stop}">マンション ✕(譲れない)</b><div style="color:var(--ink-soft);font-size:.72rem;line-height:1.7">子供を家の中で走らせられない/隣人の音(過去の経験から)</div>
      </div>
      <div style="align-self:center;font-weight:700;color:var(--ink-soft)">→</div>
      <div style="border:1.5px solid ${C.band};padding:8px 10px;flex:1;min-width:150px">
        <b style="color:${C.band}">戸建て一択(確定)</b><div style="color:var(--ink-soft);font-size:.72rem;line-height:1.7">「住みよさ」から出発した分岐。以降の迷いはすべて戸建ての中(買う/借りる)</div>
      </div>
    </div>
  </section>

  <section class="panel">
    <h2>図1 ── 検討の一周: どこで何を求め、なぜ次へ移ったか</h2>
    <div class="scale-wrap">${figLoop()}</div>
    <div class="note">「でも…」の赤字が移った理由。④は②と同じ「新築」だが、
    <b>資産性を求める一周目</b>と<b>資産性を捨てた二周目</b>で探す条件が違う(堂々巡りに見えて、実は前提が1つ確定している)。
    ④の本命3件は<a href="focus.html">本命比較</a>、賃貸の実質月額は<a href="rent.html">戸建賃貸台帳</a>が正本。</div>
  </section>

  <section class="panel">
    <h2>図2 ── 一周の最大の学び: なぜ資産性を捨てたのか</h2>
    <div class="scale-wrap">${figAsset()}</div>
    <div class="note">出口の実測(築年カーブと築31年の崖)は<a href="cliff.html">30年の崖の検証</a>、
    「駅から遠いほど安い」の実測幅は<a href="formula.html">値段の解剖</a>にある。
    この学びが確定したので、いま比べているのは「資産としてどちらが得か」ではなく<b>「住みよさをいくらで・どの負担で買うか」</b>。</div>
  </section>

  <section class="panel">
    <h2>図3 ── 3つの選択肢はいま、こう見えている</h2>
    <div style="overflow-x:auto"><table class="kv" style="min-width:680px">
      <tr>
        <th style="text-align:left"></th>
        <th style="text-align:left">住みよさ</th>
        <th style="text-align:left">月々・総コスト<br><a href="simulate.html" style="font-weight:400;font-size:.68rem">→シミュレーター</a></th>
        <th style="text-align:left">資産に残るか<br><a href="cliff.html" style="font-weight:400;font-size:.68rem">→崖の検証</a></th>
        <th style="text-align:left">身軽さ・手間<br><a href="effort.html" style="font-weight:400;font-size:.68rem">→手間の解剖</a></th>
      </tr>
      <tr><td ${td}><b style="color:${C.used}">中古戸建(一周目)</b></td>
        ${cell("△", "古さ・広さに妥協が要る")}
        ${cell("△", "修繕費が上乗せ・読みにくい")}
        ${cell("△", "土地は残る(建物は築31年の崖)")}
        ${cell("✕", "故障の発注が1年目から現役")}</tr>
      <tr><td ${td}><b style="color:${C.newb}">新築(二周目)= 今ここ</b></td>
        ${cell("○", "家の中は理想どおり")}
        ${cell("△", "賃貸と意外に大差なし(要シミュレーション)")}
        ${cell("△", "駅遠・規制の分は最初から割引")}
        ${cell("△", "保証の傘で〜10年は静か・以後は自分")}</tr>
      <tr><td ${td}><b style="color:${C.rent}">賃貸(戸建)</b></td>
        ${cell("△", "供給が薄い(北区で条件合致7件)")}
        ${cell("△", "実質25〜29万/月(表示賃料+4万前後)")}
        ${cell("✕", "残らない(掛け捨て)")}
        ${cell("○", "1〜2ヶ月で動ける・修繕は電話1本")}</tr>
    </table></div>
    <div class="note">この◯△✕は<b>検討の中で本人が置いた評価の記録</b>で、エンジンの判定ではない
    (台帳は判定を出さない方針)。賃貸の実質月額・件数は<a href="rent.html">戸建賃貸台帳</a>の実測(基準日時点)。</div>
  </section>

  <section class="panel">
    <h2>決まったこと / まだ決まっていないこと</h2>
    <div class="logic-body">
      <div class="logic-step"><div class="t"><span class="no">済</span>もう戻らない分岐(確定)</div>
        <div class="why">マンションは買わない(住みよさ・譲れない条件)/ 住むなら戸建て /
        戸建てを選ぶ以上、<b>資産性はある程度捨てる</b>(図2の学び)/ エリアは北区 /
        災害リスクは物件ごとに公式マップと照合してから判断する</div></div>
      <div class="logic-step"><div class="t"><span class="no">未</span>いま迷っていること(=次に決めること)</div>
        <div class="why"><b>買う(新築・二周目)か、借り続ける(賃貸)かの2択</b>。
        比べる土俵は資産性ではなく「住みよさ × 月々の負担 × 手間・身軽さ」——
        数字は<a href="focus.html">本命比較</a>(本命3件+賃貸線)と<a href="simulate.html">シミュレーター</a>、
        お金以外は<a href="effort.html">手間の解剖</a>で確認できる状態になっている</div></div>
    </div>
  </section>

  <div class="disclaimer">本ページは個人の検討経緯の記録であり、判定・推奨ではない(基準日 ${esc(asOf)})。
  記載の金額(予算帯・賃貸の実質月額)は台帳の実測ページに正本があり、そちらが更新されたらこのページの文言も見直すこと。</div>
  <p style="margin-top:14px"><a class="src-link" href="index.html">← 物件一覧へ戻る</a></p>`;

  return layout({
    title: "意思決定の地図 ── 中古→新築→賃貸→新築、一周の記録",
    subtitle: "どこで何を求め、なぜ次へ移ったか。文字を絞った共有用の図解(判定はしない)",
    docNo: `FUDOSAN-APPRAISAL/DECISION<br>基準日 ${esc(asOf)}`,
    body,
  });
}
