// site/templates/simulate.js — 保有年数シミュレーター(何年住むと総コストがどうなるか)
// 2026-08-16ユーザー要望「何年住むとどっちが得か、シミュレーションで比較できるようにしたい」。
// 同日追加要望「他の物件も全部シミュレーションに入れて、全部一括で見れるように」で
// 2物件比較 → 台帳全物件の一括表示(チェックボックスで絞り込み)へ変更。
//
// 設計方針(エンジンv3.0.0の思想に合わせる):
//   - 判定は出さない。仮定(地価年率・出口の掛け率・維持費)は全てユーザーが動かせるスライダーにし、
//     どの仮定でどちらが安くなるかを「事実の帯」として見せるだけにする。
//   - 台帳の全物件を1つのグラフに重ねる。既定は全選択で、チェックで任意の組へ絞れる。
//     95%CIの帯は選択が少ないとき(4件以下)だけ描く——16本の帯を重ねると何も読めなくなるため。
//     この抑制は凡例に明記し、黙って消さない。
//   - 出口価値は2系統を並記する:
//       ①実測カーブ: cliff.html と同じ ageRatioBuckets の帯別中央値・95%CI をそのまま使う
//         (ものさし価格 = 土地(補正後実勢)+建物線形残価−経年修繕控除、に帯の掛け率を乗じる。
//          築31年の崖はこの掛け率の段差として自然に現れる)
//       ②エンジン式: appraise() と同じ max(土地+残価×市場性, 土地−解体) をじっくり売却の参照に
//   - 数字は全てビルド時にエンジン/実測カーブから注入し、ページ内に手書きの係数を持たない
//     (COEFFS 由来の定数は SIMC として注入し、client側にマジックナンバーを書かない)
import { COEFFS, fmtMan } from "../../engine/appraise.js";
import { RETAIL } from "../../engine/retail.js";
import { layout, esc } from "./layout.js";

// 物件ごとの線色(16色・賃貸線の紫#6B4E9Bと選択年マーカー#16232Eは避ける)。台帳順に割り当てる
export const PALETTE = [
  "#2E6E8E", "#C93A2B", "#3A8A4D", "#B8860B", "#C25596", "#1F9E9E", "#8A5A2B", "#4A6FD0",
  "#8C3A5C", "#5F7A22", "#B4471F", "#3AA0C9", "#7A4E9B", "#2F7A5F", "#A05252", "#5C6B7A",
];
const CI_MAX_SHOWN = 4;   // 95%CIの帯を描く選択数の上限(超えたら線のみ+凡例で明示)

// evaluate結果 → シミュレーターに必要な最小データ(全てエンジン算出値)
function propData({ r, property }, i) {
  return {
    id: r.id,
    label: (property.location?.address ?? r.id) + (property.unit_label ? "・" + property.unit_label : ""),
    color: PALETTE[i % PALETTE.length],
    ask: r.state.ask,                    // 売出価格(万円)
    fee: r.state.fee,                    // 購入諸費用率
    repair: r.state.repair,              // 繰延修繕(入口・万円)。新築は0
    land2: r.mid.land2,                  // 土地の補正後実勢(徒歩・方位・接道等の個別補正込み・万円)
    demo: r.state.demo,                  // 解体費(万円)
    age: +r.state.age.toFixed(2),        // 現在の築年数
    floorTsubo: +(r.state.floor / COEFFS.TSUBO_M2).toFixed(2),
    rebuild: r.state.rebuild,            // 再調達単価(万/坪)
    bm: r.state.bm,                      // 建物市場性補正
    walk: r.state.walk,
    fairMid: Math.round(r.fairFinal.mid),
    retailMid: r.retail ? Math.round(r.retail.mid) : null,
    isNew: r.isNewBuild,   // 住宅ローン控除の既定区分(新築/中古)の初期値に使う
  };
}

// ビルド時注入する定数(clientのモデル式はこの値だけを参照する)
function simConstants(curve) {
  return {
    life: COEFFS.BUILDING_LIFE_Y,             // 建物線形残価の逓減年数(30年)
    saleCost: COEFFS.SALE_COST_RATE,          // 売却諸費用率(4%)
    repairPerYear: RETAIL.REPAIR_PER_YEAR,    // ものさし価格の経年修繕控除(万/年)
    repairCap: COEFFS.DEFAULT_REPAIR_MAN,     // 同・控除上限(万円)
    ciMax: CI_MAX_SHOWN,
    rows: curve.rows.map((b) => ({ lo: b.lo, hi: b.hi === Infinity ? 999 : b.hi, label: b.label, n: b.n,
      m: +b.m.toFixed(3), lo95: +b.lo95.toFixed(3), hi95: +b.hi95.toFixed(3) })),
    total: curve.total, districts: curve.districts, cliffDiff: +curve.cliffDiff.toFixed(3),
  };
}

// curve: formula.js の ageCurveCI() の戻り値(cliff.html と同一の実測)
export function renderSimulate(results, curve, { asOf }) {
  const props = results.map(propData);
  const SIMC = simConstants(curve);
  const oldRows = SIMC.rows.filter((b) => b.lo >= 31);

  const body = `
  <section class="panel">
    <h2>これは何をするページか</h2>
    <div class="logic-body">
      <p style="font-size:.85rem">台帳の全${props.length}物件について、<b>「取得にかかったお金 + 保有中の維持費 − 売ったときの手取り」=総コストを
      保有年数ごとに計算して一括で比べます</b>。買値が高くても土地の比率が高い物件は出口で回収でき、買値が近くても建物の比率が高い物件は
      築年数とともに回収額が減ります。この違いは「何年住むか」で逆転が起きるため、1つの数字ではなく<b>年数のカーブ</b>で見る必要があります。
      左のチェックで任意の組に絞れます(<b>${SIMC.ciMax}件以下に絞ると95%CIの帯まで表示</b>されます)。</p>
      <p style="font-size:.8rem;margin-top:8px" class="position-body">出口(売却額)の見立てには台帳の成約実測(<a href="cliff.html">30年の崖の検証</a>と同じ${SIMC.total}件・${SIMC.districts}地区)を使い、
      帯別の95%信頼区間をそのまま<b>帯(レンジ)として描きます</b>。築31年を跨ぐと成約価格がものさし価格(土地+建物残価)の
      中央値${oldRows.map((b) => `${b.m.toFixed(2)}倍(${esc(b.label)})`).join("・")}へ落ちる「崖」も、この実測がそのまま反映されます。
      <b>このページは判定をしません</b>。仮定は全部下のスライダーで動かせるので、ご自身の前提でどれが安くなるかを確かめてください。</p>
    </div>
  </section>

  <div class="simlayout">
  <section class="panel simside">
    <h2>物件と仮定</h2>
    <div class="simctl">
      <span class="simlab">表示する物件 <b id="vSel"></b>
        <button type="button" id="btnAll" class="simbtn">全選択</button><button type="button" id="btnNone" class="simbtn">全解除</button></span>
      <div id="proplist" class="proplist">${props.map((p) => `<label class="simchk"><input type="checkbox" data-id="${esc(p.id)}" checked><span class="swatch" style="background:${p.color}"></span><span class="chklab">${esc(p.label)}<span class="chkask">(売出${fmtMan(p.ask)}${p.isNew ? "・新築" : "・築" + Math.round(p.age) + "年"})</span></span></label>`).join("")}</div>
    </div>
    <div class="simgrid2" style="margin-top:10px">
      <div class="simctl"><label class="simlab" for="inG">地価の年率 <b id="vG">0.0%</b></label>
        <input type="range" id="inG" min="-2" max="5" step="0.5" value="0"></div>
      <div class="simctl"><label class="simlab" for="inRent">賃貸の家賃 <b id="vRent">20万/月</b></label>
        <input type="range" id="inRent" min="10" max="40" step="1" value="20"></div>
      <div class="simctl"><label class="simlab" for="inAnn">年間経費 <b id="vAnn">25万/年</b></label>
        <input type="range" id="inAnn" min="0" max="60" step="5" value="25"></div>
      <div class="simctl"><label class="simlab" for="inCyc">定期修繕の周期 <b id="vCyc">15年ごと</b></label>
        <input type="range" id="inCyc" min="10" max="20" step="1" value="15"></div>
      <div class="simctl"><label class="simlab" for="inPer">定期修繕1回分 <b id="vPer">150万</b></label>
        <input type="range" id="inPer" min="50" max="400" step="25" value="150"></div>
      <div class="simctl"><label class="simlab" for="inRate">ローン金利 <b id="vRate">0.8%</b></label>
        <input type="range" id="inRate" min="0" max="3" step="0.1" value="0.8"></div>
    </div>
    <div style="margin-top:10px;border-top:1px dashed var(--grid);padding-top:8px">
      <label style="font-size:.78rem;font-weight:700"><input type="checkbox" id="ckLoan" checked> ローン金利と住宅ローン控除を織り込む</label>
      <details class="dnote" style="margin-top:6px"><summary>住宅ローン控除(年末残高×0.7%)の区分を物件ごとに直す</summary>
        <div class="note" style="margin:4px 0">既定: 中古(その他)=2,000万・10年 / 新築(省エネ適合)=3,000万・13年。<b>区分・限度額は入居年の税制で変わるため要確認</b></div>
        <table class="dedtbl">${props.map((p) => `<tr><td><span class="swatch" style="background:${p.color}"></span>${esc(p.label)}</td><td>上限<input type="number" class="simnum" data-ded-cap="${esc(p.id)}" step="500" min="0" max="5000" value="${p.isNew ? 3000 : 2000}">万</td><td><select class="stsel" data-ded-yrs="${esc(p.id)}"><option${p.isNew ? "" : " selected"}>10</option><option${p.isNew ? " selected" : ""}>13</option></select>年</td></tr>`).join("")}</table>
      </details>
    </div>
    <details class="dnote"><summary>各仮定の前提と注意(必読)</summary>
      <ul style="margin:6px 0 0 1.1em;font-size:.7rem;color:var(--ink-soft);line-height:1.7">
        <li><b>地価の年率</b>: 既定0%=横ばい。台帳の時点修正は直近実勢+10%/年だが、10年先まで外挿する根拠はないため保守側を既定にする</li>
        <li><b>賃貸の家賃</b>: 「買わずに賃貸で月この額を払い続けたら」の累計線をグラフに重ねる。家賃のみ(更新料・引越・住み替えの摩擦は含まない)</li>
        <li><b>年間経費</b>(固都税・保険等): 全物件に同額を適用(差がある場合は読み替え)。ローン金利は含まない</li>
        <li><b>定期修繕</b>: 建物の築年数が周期の倍数を跨ぐたびに1回分を計上(外壁・屋根・給湯器等の一式)。木造3階の外壁+屋根塗装は足場込100〜180万が相場。水回り更新まで見るなら増額</li>
        <li><b>ローン</b>: 借入=売出価格の全額(諸費用は現金)・35年元利均等・金利は全期間一定と仮定。途中売却時は残債一括返済(違約金なし)</li>
        <li><b>住宅ローン控除</b>: 区分ごとの借入限度額・期間は入居年の税制で変わるため必ず最新の制度で確認し、上の表を直すこと。
        新築は2024年1月以降の建築確認だと<b>省エネ基準適合が控除の必須要件</b>(非適合は控除0)。ただし2025年4月からは
        省エネ基準適合そのものが建築確認の審査要件(建築物省エネ法の全面義務化)になったため、義務化後に建築確認を受けた
        新築(ESPACER西が丘2=建築確認2026年が該当)は適合が制度上の前提。<b>残る実務は確定申告用の証明書類
        (建設住宅性能評価書または住宅省エネルギー性能証明書)が売主側から出るかの確認</b>で、書類が無いと適合していても
        控除を申請できない。控除は「納税額(所得税+住民税の控除枠)が控除額を上回る」前提で満額計上する</li>
      </ul>
    </details>
  </section>

  <section class="panel simmain">
    <h2>総コスト(取得+保有 − 売却手取り)(保有年数 1〜30年)</h2>
    <div class="scale-wrap"><svg id="simchart" class="scale-svg" viewBox="0 0 760 340" role="img" aria-label="保有年数別の総コスト"></svg></div>
    <div class="simlegend">
      <span><span class="swatch swR"></span><b id="lgR"></b></span>
      <span class="note" style="margin:0" id="lgNote"></span>
    </div>
    <div id="simcross" class="pct-line"></div>
    <div class="note">総コスト = 取得総額(売出+諸費用+入口の繰延修繕) + 保有中の修繕・経費 + ローン利息(織り込み時)
    − 住宅ローン控除(同) − その年に売った場合の手取り。「その年数住むのに結局いくら払ったことになるか」を表す。下ほど安い。
    縦の点線は各物件が<b>築31年(崖の開始)</b>を跨ぐ年で、実測カーブの段差(崖)がそのまま総コストのジャンプとして現れる。月額換算は下の内訳表に出る。</div>
  </section>
  </div>

  <section class="panel">
    <h2>選んだ年数での内訳(表示中の全物件)</h2>
    <div class="simctl" style="max-width:420px"><label class="simlab" for="inT">保有年数 <b id="vT">10年</b></label>
      <input type="range" id="inT" min="1" max="30" step="1" value="10"></div>
    <div style="overflow-x:auto"><table class="kv" id="simtable" style="min-width:560px"></table></div>
    <div class="note">「実測どおり売れた場合」は、出口時点の築年帯の成約実測(中央値と95%CI)をものさし価格に乗じた値。
    「エンジン式(じっくり売却)」は appraise() と同じ max(土地+建物残価×市場性, 土地−解体費)で、
    売り急がず土地値を取り切れた場合の参照。いずれも売却諸費用${(SIMC.saleCost * 100).toFixed(0)}%控除後。</div>
  </section>

  <section class="panel">
    <h2>モデルの中身と限界(読んでから使うこと)</h2>
    <div class="logic-body">
      <div class="logic-step"><div class="t"><span class="no">式</span>総コスト(t年) = 売出×(1+諸費用${(COEFFS.DEFAULT_FEE_RATE * 100).toFixed(0)}%) + 入口の繰延修繕 + 定期修繕 + 年間経費×t + ローン利息(t) − 住宅ローン控除(t) − 売却手取り(t)</div>
        <div class="formula">売却手取り(t) = ものさし価格(t) × 実測掛け率(出口の築年帯) × (1−売却諸費用${(SIMC.saleCost * 100).toFixed(0)}%)</div>
        <div class="formula">ものさし価格(t) = 土地(補正後実勢×(1+地価年率)^t) + max(0, 再調達${COEFFS.DEFAULT_REBUILD_PPT}万/坪×延床坪×(1−築年/${SIMC.life}) − min(${SIMC.repairCap}, ${SIMC.repairPerYear}×築年))</div>
        <div class="why">土地の「補正後実勢」は各物件の査定と同じ値(徒歩・方位・接道・形状等の個別補正込み)。
        実測掛け率は<a href="cliff.html">30年の崖の検証</a>の帯別中央値で、崖(差${SIMC.cliffDiff.toFixed(2)})は築31年の帯の段差として入る。</div></div>
      <div class="logic-step"><div class="t"><span class="no">帯</span>実測掛け率(成約/ものさし・${SIMC.total}件${SIMC.districts}地区)</div>
        <div class="why">${SIMC.rows.map((b) => `${esc(b.label)}: ${b.m.toFixed(2)}(CI ${b.lo95.toFixed(2)}〜${b.hi95.toFixed(2)}・n=${b.n})`).join(" / ")}。
        築7〜31年の帯はいずれもCIが1.00を含み「ものさしどおり」と区別できない(判別できるのは新築の山なしと築31年の崖だけ)。
        帯ごとの上下は標本ノイズも含むため、<b>中央値の線より帯(CI)の重なりで読むこと</b>。多数の物件を重ねる表示では
        帯を省略しているが省略しても誤差が消えるわけではない——中央値の線の差が帯の幅(±10%超)より小さいものは同格として読む。</div></div>
      <div class="logic-step"><div class="t"><span class="no">外</span>織り込めるもの・いないもの</div>
        <div class="why">ローン金利と住宅ローン控除(年末残高×0.7%)は上のトグルで織り込める(既定オン)。
        前提は<b>借入=売出価格の全額・35年元利均等・全期間同一金利・控除は納税額が十分ある前提で満額</b>。
        含まれていないもの: 団信の上乗せ金利・繰上返済 / 登録免許税・不動産取得税の細目や新築の固定資産税減額(年間経費のスライダーで読み替え)/
        引越・仲介以外の取引付帯費 / インフレ(全て名目・今日の円)。賃貸の比較線も<b>家賃のみ</b>で、
        更新料(2年ごと1か月分が通例)・引越や広さ・立地の質の差は載っていない。</div></div>
      <div class="logic-step"><div class="t"><span class="no">注</span>この試算が苦手なこと</div>
        <div class="why">出口の実測掛け率は<b>地区の平均像</b>で、個別物件の駅距離・整形度は
        ものさし価格側にしか入っていない。売り方(仲介でじっくり/業者へ即売り)で崖の深さは大きく変わる
        ——崖の実測0.55〜0.74倍には即売りチャネルの卸値(手取り86%)が混ざっている。
        じっくり売れる前提ならエンジン式(内訳表に記載)寄り、売り急ぐなら実測帯の下側で読む。</div></div>
    </div>
  </section>

  <div class="disclaimer">本ページは個人の検討用の試算であり、判定・推奨ではない。数値は全てビルド時にエンジンと成約実測から自動計算(基準日 ${esc(asOf)})。
  出口の実測カーブの作られ方は<a href="cliff.html">30年の崖の検証</a>、価格の分解は各物件ページの「値段の解剖」を参照。</div>
  <p style="margin-top:14px"><a class="src-link" href="index.html">← 物件一覧へ戻る</a></p>

  <script type="application/json" id="simdata">${JSON.stringify({ props, SIMC })}</script>
  <style>
    /* PC幅では「仮定パネル(左)+グラフ(右)」を1画面に収める(2026-08-16ユーザー要望:
       スライダーとグラフが縦に分断されると、動かした結果が体感できない) */
    .simlayout{display:grid;grid-template-columns:minmax(300px,380px) 1fr;gap:20px;align-items:start}
    .simlayout .panel{margin-bottom:20px}
    .simlayout section+section{margin-top:0}   /* 共通CSSのsection間マージンが右カラムを20pxずらすのを打ち消す */
    @media (max-width:1080px){.simlayout{grid-template-columns:1fr}.simlayout .panel{margin-bottom:20px}}
    .simgrid2{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px}
    .simside h2{margin-bottom:10px}
    .simside .simlab{margin-bottom:1px}
    .dnote{margin-top:10px;font-size:.72rem}
    .dnote summary{cursor:pointer;color:var(--band);font-weight:700}
    .simlab{display:block;font-size:.75rem;letter-spacing:.06em;color:var(--ink-soft);margin-bottom:3px}
    .simlab b{font-family:var(--mono);color:var(--ink)}
    .simbtn{font-size:.68rem;margin-left:6px;padding:1px 7px;border:1px solid var(--ink-soft);background:none;color:var(--ink);cursor:pointer}
    .proplist{max-height:280px;overflow-y:auto;border:1px solid var(--grid);padding:4px 6px;margin-top:4px}
    .simchk{display:flex;align-items:baseline;gap:5px;font-size:.73rem;line-height:1.5;padding:1px 0;cursor:pointer}
    .simchk input{flex:none}
    .simchk .swatch{flex:none;align-self:center}
    .chkask{color:var(--ink-soft);font-size:.66rem}
    .dedtbl{font-size:.7rem;border-collapse:collapse;margin-top:2px}
    .dedtbl td{padding:1px 6px 1px 0;white-space:nowrap}
    .simctl .simnum{width:64px;font-family:var(--mono);font-size:.72rem;padding:1px 3px;border:1px solid var(--ink-soft)}
    .dedtbl .simnum{width:64px;font-family:var(--mono);font-size:.72rem;padding:1px 3px;border:1px solid var(--ink-soft)}
    .dedtbl .stsel{width:auto;font-size:.72rem}
    .simctl input[type=range]{width:100%}
    .swatch{display:inline-block;width:12px;height:12px;margin-right:5px;vertical-align:-1px;border:1px solid var(--ink)}
    .swR{background:#6B4E9B}
    .simlegend{display:flex;flex-wrap:wrap;gap:14px;font-size:.78rem;margin-top:6px;align-items:center}
    #simtable th{white-space:nowrap}
    #simtable td.gap{border-bottom:1px solid var(--ink)}
  </style>
  <script>
  (function(){
    "use strict";
    var D = JSON.parse(document.getElementById("simdata").textContent);
    var P = {}; D.props.forEach(function(p){ P[p.id] = p; });
    var C = D.SIMC;
    var ORDER = D.props.map(function(p){ return p.id; });
    var $ = function(id){ return document.getElementById(id); };
    var st = { sel: {}, g: 0, ann: 25, cyc: 15, per: 150, rent: 20, t: 10,
      loan: true, rate: 0.8, ded: {} };   // ded[id] = {cap, yrs} の上書き(未編集は既定)
    ORDER.forEach(function(id){ st.sel[id] = true; });
    // 住宅ローン控除の既定区分: 中古(その他)=2,000万・10年 / 新築(省エネ適合と仮定)=3,000万・13年
    var DED_DEFAULT = function(p){ return p.isNew ? { cap: 3000, yrs: 13 } : { cap: 2000, yrs: 10 }; };
    function selected(){ return ORDER.filter(function(id){ return st.sel[id]; }).map(function(id){ return P[id]; }); }
    function shortLabel(p){ return p.label.replace(/^北区/, ""); }

    function residEngine(p, age){ return Math.max(0, 1 - age / C.life) * p.rebuild * p.floorTsubo; }
    function residMeasure(p, age){ return Math.max(0, residEngine(p, age) - Math.min(C.repairCap, C.repairPerYear * age)); }
    function bucketAt(age){
      for (var i = 0; i < C.rows.length; i++) if (age >= C.rows[i].lo && age < C.rows[i].hi) return C.rows[i];
      return C.rows[C.rows.length - 1];
    }
    function landAt(p, t){ return p.land2 * Math.pow(1 + st.g / 100, t); }
    // 出口の売却手取り。mode: m/lo95/hi95(実測帯) or "engine"(エンジン式のじっくり売却)
    function exitNet(p, t, mode){
      var land = landAt(p, t), age = p.age + t;
      if (mode === "engine"){
        var re = residEngine(p, age);
        var v = re > 0 ? Math.max(land + re * (1 + p.bm), land - p.demo) : land - p.demo;
        return v * (1 - C.saleCost);
      }
      var M = land + residMeasure(p, age);
      return M * bucketAt(age)[mode] * (1 - C.saleCost);
    }
    // 保有中の定期修繕: 建物の築年数が周期の倍数を(入口より後・出口まで)跨ぐたび1回分
    function maint(p, t){
      var c = 0;
      for (var k = 1; k * st.cyc <= p.age + t; k++) if (k * st.cyc > p.age) c += st.per;
      return c;
    }
    // ローン(35年元利均等・借入=売出全額)の年次推移: 各年の支払利息と年末残高。
    // 途中売却は残債一括返済(元本は資金移動であってコストではないため、コストに乗るのは利息のみ)
    function loanSchedule(p){
      var L = p.ask, n = 420, rm = st.rate / 100 / 12;
      var pay = rm > 0 ? L * rm / (1 - Math.pow(1 + rm, -n)) : L / n;
      var bal = L, years = [];
      for (var y = 0; y < 35; y++){
        var interest = 0;
        for (var m = 0; m < 12; m++){
          var iv = bal * rm; interest += iv; bal = Math.max(0, bal - (pay - iv));
        }
        years.push({ interest: interest, balEnd: bal });
      }
      return years;
    }
    function dedParams(p){
      var o = st.ded[p.id] || {}, d = DED_DEFAULT(p);
      return { cap: o.cap == null ? d.cap : o.cap, yrs: o.yrs == null ? d.yrs : o.yrs };
    }
    // 保有t年での 累計支払利息 と 累計住宅ローン控除(年末残高×0.7%・上限cap・yrs年間)
    function loanCost(p, t){
      if (!st.loan) return { interest: 0, credit: 0 };
      var sch = loanSchedule(p), dp = dedParams(p), interest = 0, credit = 0;
      for (var y = 0; y < Math.min(t, 35); y++){
        interest += sch[y].interest;
        if (y < dp.yrs) credit += Math.min(sch[y].balEnd, dp.cap) * 0.007;
      }
      return { interest: interest, credit: credit };
    }
    function inCost(p, t){ return p.ask * (1 + p.fee) + p.repair + maint(p, t) + st.ann * t; }
    function totalC(p, t, mode){
      var lc = loanCost(p, t);
      return inCost(p, t) + lc.interest - lc.credit - exitNet(p, t, mode);
    }

    var fmt = function(n){ n = Math.round(n); return n.toLocaleString("en-US") + "万円"; };
    var fmt1 = function(n){ return (Math.round(n * 10) / 10).toFixed(1); };
    // y軸目盛のきざみ: 全体幅を5分割し、100/200/250/500/1000…の「きりのよい値」へ丸める
    function niceStep(span){
      var raw = span / 5, pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
      var cands = [1, 2, 2.5, 5, 10];
      for (var i = 0; i < cands.length; i++) if (cands[i] * pow >= raw) return cands[i] * pow;
      return 10 * pow;
    }

    function drawChart(){
      var sel = selected(), T = 30, showCI = sel.length > 0 && sel.length <= C.ciMax;
      var svg = $("simchart");
      var W = 760, H = 340, padL = 56, padR = 14, padT = 26, padB = 40;
      var series = sel.map(function(p){
        var med = [], lo = [], hi = [];
        for (var t = 1; t <= T; t++){
          med.push(totalC(p, t, "m")); lo.push(totalC(p, t, "hi95")); hi.push(totalC(p, t, "lo95"));
        }
        return { p: p, med: med, lo: lo, hi: hi };
      });
      var rentLine = [];
      for (var tr = 1; tr <= T; tr++) rentLine.push(st.rent * 12 * tr);
      var all = rentLine.slice();
      series.forEach(function(s){ all = all.concat(s.med); if (showCI) all = all.concat(s.lo, s.hi); });
      var yMin = Math.min.apply(null, all), yMax = Math.max.apply(null, all);
      var span = Math.max(1, yMax - yMin); yMin -= span * 0.06; yMax += span * 0.06;
      var X = function(t){ return padL + (t - 1) / (T - 1) * (W - padL - padR); };
      var Y = function(v){ return padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB); };
      var path = function(arr){
        return arr.map(function(v, i){ return (i ? "L" : "M") + X(i + 1).toFixed(1) + " " + Y(v).toFixed(1); }).join("");
      };
      var out = [];
      // 目盛(y: きりのよい万円刻み・x: 5年刻み)
      var step = niceStep(span);
      for (var v = Math.ceil(yMin / step) * step; v <= yMax; v += step){
        out.push('<line x1="' + padL + '" y1="' + Y(v).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + Y(v).toFixed(1) + '" stroke="#DCE3EA"/>');
        out.push('<text x="' + (padL - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#43566B">' + Math.round(v).toLocaleString("en-US") + '万</text>');
      }
      for (var t = 5; t <= T; t += 5){
        out.push('<line x1="' + X(t).toFixed(1) + '" y1="' + padT + '" x2="' + X(t).toFixed(1) + '" y2="' + (H - padB) + '" stroke="#EDF1F4"/>');
        out.push('<text x="' + X(t).toFixed(1) + '" y="' + (H - padB + 16) + '" text-anchor="middle" font-size="11" fill="#43566B">' + t + "年</text>");
      }
      out.push('<text x="' + ((padL + W - padR) / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" fill="#43566B">保有年数</text>');
      // 崖(築31年)を跨ぐ年の縦線。ラベルはCI表示時(=選択が少ないとき)だけ出し、左右交互にずらして重なりを防ぐ
      var labIdx = 0;
      series.forEach(function(s){
        var t31 = 31 - s.p.age;
        if (t31 > 1 && t31 < T){
          out.push('<line x1="' + X(t31).toFixed(1) + '" y1="' + padT + '" x2="' + X(t31).toFixed(1) + '" y2="' + (H - padB) + '" stroke="' + s.p.color + '" stroke-dasharray="2 3" opacity=".55"/>');
          if (showCI){
            var side = labIdx % 2;
            out.push('<text x="' + (X(t31) + (side ? 4 : -4)).toFixed(1) + '" y="' + (padT - 8) + '" text-anchor="' + (side ? "start" : "end") + '" font-size="10" fill="' + s.p.color + '">築31年</text>');
            labIdx++;
          }
        }
      });
      // 賃貸の累計線(家賃のみ)。物件の帯より先に描いて背面に置く
      out.push('<path d="' + path(rentLine) + '" fill="none" stroke="#6B4E9B" stroke-width="1.8" stroke-dasharray="8 3" opacity=".8"/>');
      // 帯(95%CI)→中央値(実線)の順に描く。帯は選択が少ないときだけ(多数表示では読めなくなるため。凡例に明示)。
      // エンジン式(じっくり売却)の線は「点線が多くて読みにくい」(2026-08-16ユーザー指摘)ためグラフには描かず、内訳表だけに出す
      if (showCI) series.forEach(function(s){
        var band = path(s.lo);
        for (var i = s.hi.length - 1; i >= 0; i--) band += "L" + X(i + 1).toFixed(1) + " " + Y(s.hi[i]).toFixed(1);
        out.push('<path d="' + band + 'Z" fill="' + s.p.color + '" opacity=".12"/>');
      });
      series.forEach(function(s){
        out.push('<path d="' + path(s.med) + '" fill="none" stroke="' + s.p.color + '" stroke-width="2"/>');
      });
      // 選択年マーカー
      out.push('<line x1="' + X(st.t).toFixed(1) + '" y1="' + padT + '" x2="' + X(st.t).toFixed(1) + '" y2="' + (H - padB) + '" stroke="#16232E" stroke-dasharray="1 3"/>');
      svg.innerHTML = out.join("");
      $("vSel").textContent = sel.length + "/" + ORDER.length + "件";
      $("lgR").textContent = "賃貸 " + st.rent + "万/月の累計(破線)";
      $("lgNote").textContent = showCI
        ? "実線=実測カーブ中央値 / 帯=同95%CI。エンジン式(じっくり売却)の値は下の内訳表に出す"
        : "実線=実測カーブ中央値。95%CIの帯は" + C.ciMax + "件以下に絞ると表示(誤差が消えたわけではない——差が±10%程度のものは同格として読むこと)";
      // 選択年での順位: 総コスト(実測中央値)の昇順。95%CIの帯が重なる隣どうしは「≈(誤差の範囲)」で繋ぐ
      if (!sel.length){ $("simcross").innerHTML = "物件が選ばれていません(左のチェックで選択)"; return; }
      var ranked = sel.map(function(p){
        return { p: p, m: totalC(p, st.t, "m"), best: totalC(p, st.t, "hi95"), worst: totalC(p, st.t, "lo95") };
      }).sort(function(a, b){ return a.m - b.m; });
      var parts = [];
      ranked.forEach(function(r, i){
        if (i) parts.push(ranked[i - 1].worst >= r.best ? ' <span style="color:var(--ink-soft)">≈</span> ' : " &lt; ");
        parts.push('<span style="white-space:nowrap"><span class="swatch" style="background:' + r.p.color + '"></span>' +
          shortLabel(r.p) + ' <b>' + fmt(r.m) + "</b></span>");
      });
      $("simcross").innerHTML = "保有" + st.t + "年の総コスト(実測中央値・安い順): " + parts.join("") +
        " ・ 賃貸" + st.rent + "万/月なら累計 <b>" + fmt(st.rent * 12 * st.t) + "</b>" +
        '。<span style="color:var(--ink-soft)">≈ は95%CIの帯が重なる=誤差の範囲で読む組</span>';
    }

    function drawTable(){
      var sel = selected(), t = st.t;
      if (!sel.length){ $("simtable").innerHTML = '<tr><td class="note">物件が選ばれていません(左のチェックで選択)</td></tr>'; return; }
      var f = function(p){ var lc = loanCost(p, t), dp = dedParams(p); return {
        acq: p.ask * (1 + p.fee), mnt: maint(p, t),
        ageX: p.age + t, land: landAt(p, t), lc: lc, dp: dp,
        bk: bucketAt(p.age + t), inC: inCost(p, t) + lc.interest,
        exM: exitNet(p, t, "m") + lc.credit, exLo: exitNet(p, t, "hi95") + lc.credit,
        exHi: exitNet(p, t, "lo95") + lc.credit, exE: exitNet(p, t, "engine") + lc.credit }; };
      var d = sel.map(f);
      var td = function(html){ return '<td style="text-align:right;font-family:var(--mono)">' + html + "</td>"; };
      var row = function(name, cells, cls){
        return "<tr" + (cls ? ' class="' + cls + '"' : "") + "><td>" + name + "</td>" + cells.join("") + "</tr>";
      };
      var rows = ['<tr><th style="text-align:left;font-size:.72rem;color:var(--ink-soft)">保有' + t + "年の内訳</th>" +
        sel.map(function(p){ return '<th style="text-align:right;color:' + p.color + '">' + shortLabel(p) + "</th>"; }).join("") + "</tr>"];
      rows.push(row("売出価格 + 諸費用", d.map(function(x){ return td(fmt(x.acq)); })));
      rows.push(row("入口の繰延修繕(査定の想定)", sel.map(function(p){ return td(fmt(p.repair)); })));
      rows.push(row("定期修繕(保有中・" + st.cyc + "年周期)", d.map(function(x){ return td(fmt(x.mnt)); })));
      rows.push(row("年間経費 " + st.ann + "万 × " + t + "年", d.map(function(){ return td(fmt(st.ann * t)); })));
      if (st.loan) rows.push(row("ローン利息(金利" + st.rate.toFixed(1) + "%・35年元利均等)", d.map(function(x){ return td(fmt(x.lc.interest)); })));
      rows.push(row("<b>払うお金の合計</b>", d.map(function(x){ return td("<b>" + fmt(x.inC) + "</b>"); }), "em"));
      if (st.loan) rows.push(row("住宅ローン控除(残高0.7%・上限/年数は物件別)", d.map(function(x){ return td("−" + fmt(x.lc.credit) + '<div class="note" style="margin:0">' + x.dp.cap + "万・" + x.dp.yrs + "年</div>"); })));
      rows.push(row("出口の築年数", d.map(function(x){ return td("築" + fmt1(x.ageX) + "年(" + x.bk.label + "帯)"); })));
      rows.push(row("土地(補正後実勢・地価" + (st.g >= 0 ? "+" : "") + st.g + "%/年)", d.map(function(x){ return td(fmt(x.land)); })));
      rows.push(row("実測掛け率(中央値・CI)", d.map(function(x){ return td(x.bk.m.toFixed(2) + "(" + x.bk.lo95.toFixed(2) + "〜" + x.bk.hi95.toFixed(2) + ")"); })));
      rows.push(row("売却手取り(実測どおり・CI)" + (st.loan ? "+控除" : ""), d.map(function(x){ return td(fmt(x.exM) + '<div class="note" style="margin:0">' + fmt(x.exLo) + "〜" + fmt(x.exHi) + "</div>"); })));
      rows.push(row("同・エンジン式(じっくり売却)" + (st.loan ? "+控除" : ""), d.map(function(x){ return td(fmt(x.exE)); })));
      rows.push(row("<b>総コスト(実測中央値)</b>", d.map(function(x){ return td("<b>" + fmt(x.inC - x.exM) + "</b>"); }), "em"));
      rows.push(row("<b>月額換算(実測中央値)</b>", d.map(function(x){ return td("<b>" + fmt1((x.inC - x.exM) / t / 12) + "万/月</b>"); }), "em"));
      rows.push(row("月額換算(エンジン式じっくり売却)", d.map(function(x){ return td(fmt1((x.inC - x.exE) / t / 12) + "万/月"); })));
      rows.push(row("参考: 価格に占める土地の割合", sel.map(function(p){ return td(Math.round(p.land2 / p.ask * 100) + "%"); })));
      rows.push(row("参考: 賃貸" + st.rent + "万/月なら累計(家賃のみ)", [td(fmt(st.rent * 12 * t))].concat(sel.slice(1).map(function(){ return td('<span class="note">(左と同じ)</span>'); }))));
      $("simtable").innerHTML = rows.join("");
    }

    function redraw(){ drawChart(); drawTable(); }
    // 物件チェックボックス(委譲): 変更で即再描画
    $("proplist").addEventListener("change", function(e){
      var id = e.target.getAttribute("data-id");
      if (id){ st.sel[id] = e.target.checked; redraw(); }
    });
    var setAll = function(on){
      ORDER.forEach(function(id){ st.sel[id] = on; });
      Array.prototype.forEach.call(document.querySelectorAll('#proplist input[type=checkbox]'), function(el){ el.checked = on; });
      redraw();
    };
    $("btnAll").addEventListener("click", function(){ setAll(true); });
    $("btnNone").addEventListener("click", function(){ setAll(false); });
    var bind = function(id, key, lab, fmtV){
      $(id).addEventListener("input", function(){ st[key] = +this.value; $(lab).textContent = fmtV(+this.value); redraw(); });
    };
    bind("inG", "g", "vG", function(v){ return v.toFixed(1) + "%"; });
    bind("inAnn", "ann", "vAnn", function(v){ return v + "万/年"; });
    bind("inCyc", "cyc", "vCyc", function(v){ return v + "年ごと"; });
    bind("inPer", "per", "vPer", function(v){ return v + "万"; });
    bind("inRent", "rent", "vRent", function(v){ return v + "万/月"; });
    bind("inT", "t", "vT", function(v){ return v + "年"; });
    bind("inRate", "rate", "vRate", function(v){ return v.toFixed(1) + "%"; });
    $("ckLoan").addEventListener("change", function(){ st.loan = this.checked; redraw(); });
    // 控除の物件別上書き(委譲)。空欄・不正値は既定へ戻す
    var dedSet = function(id, key, v){
      if (!st.ded[id]) st.ded[id] = {};
      st.ded[id][key] = v;
      redraw();
    };
    Array.prototype.forEach.call(document.querySelectorAll("[data-ded-cap]"), function(el){
      el.addEventListener("input", function(){
        var v = +this.value;
        dedSet(this.getAttribute("data-ded-cap"), "cap", Number.isFinite(v) && v >= 0 && this.value !== "" ? v : null);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-ded-yrs]"), function(el){
      el.addEventListener("change", function(){ dedSet(this.getAttribute("data-ded-yrs"), "yrs", +this.value); });
    });
    redraw();
  })();
  </script>`;

  return layout({
    title: "保有年数シミュレーター ── 何年住むと総コストはどうなるか",
    subtitle: "台帳の全物件を一括比較(判定はしない・仮定は全部動かせる)",
    docNo: `FUDOSAN-APPRAISAL/SIMULATE<br>基準日 ${esc(asOf)}<br>出口実測 ${curve.total}件${curve.districts}地区`,
    body,
  });
}
