// site/templates/tradeoff.js — 妥協の値段(希望条件のA/B/C分類とB群工事費早見表)
// 目的: 「何を妥協し、何を譲らないか」を感覚でなく金額換算で決めるための一般形リファレンス。
// A=市場が値付け済み(曲線上の選択・出口で回収) / B=工事で買える(上限=実見積り) /
// C=個人的価値(月額テスト・出口で回収されない)。分類は「変数×物件」に付き、Bは物件ごとにA昇格しうる。
// 金額はすべて木造2〜3階建・延床85〜100m2帯の概算レンジで、買付前に実見積りへ置き換える前提。
import { COEFFS } from "../../engine/appraise.js";
import { RETAIL } from "../../engine/retail.js";
import { layout } from "./layout.js";

// ---- 図: A/B/C分類の判定フロー ----
// ラベルは各ボックス内(タイトル+説明2行)と矢印脇に限定し、行間を広く取って重なりを防ぐ
function triageSvg() {
  const W = 640, H = 264;
  const qx = 24, qw = 240, rx = 320, rw = 296;
  const el = [];
  const qBox = (y, l1, l2) => {
    el.push(`<rect x="${qx}" y="${y}" width="${qw}" height="52" fill="#FDFDFC" stroke="#16232E" stroke-width="1.2"/>`);
    el.push(`<text x="${qx + qw / 2}" y="${y + 22}" font-size="10" font-weight="700" text-anchor="middle" fill="#16232E">${l1}</text>`);
    el.push(`<text x="${qx + qw / 2}" y="${y + 38}" font-size="8.5" text-anchor="middle" fill="#43566B">${l2}</text>`);
  };
  const rBox = (y, color, title, l1, l2) => {
    el.push(`<rect x="${rx}" y="${y}" width="${rw}" height="64" fill="${color}" opacity="0.09"/>`);
    el.push(`<rect x="${rx}" y="${y}" width="${rw}" height="64" fill="none" stroke="${color}" stroke-width="1.6"/>`);
    el.push(`<text x="${rx + 12}" y="${y + 20}" font-size="10.5" font-weight="700" fill="${color}">${title}</text>`);
    el.push(`<text x="${rx + 12}" y="${y + 36}" font-size="8.5" fill="#16232E">${l1}</text>`);
    el.push(`<text x="${rx + 12}" y="${y + 50}" font-size="8.5" fill="#16232E">${l2}</text>`);
  };
  const yes = (y) => {
    el.push(`<line x1="${qx + qw}" y1="${y}" x2="${rx - 8}" y2="${y}" stroke="#16232E" stroke-width="1.4"/>`);
    el.push(`<polygon points="${rx - 8},${y - 4} ${rx - 8},${y + 4} ${rx},${y}" fill="#16232E"/>`);
    el.push(`<text x="${(qx + qw + rx) / 2}" y="${y - 6}" font-size="8.5" text-anchor="middle" fill="#43566B">はい</text>`);
  };
  const no = (y0, y1) => {
    const x = qx + qw / 2;
    el.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1 - 8}" stroke="#16232E" stroke-width="1.4"/>`);
    el.push(`<polygon points="${x - 4},${y1 - 8} ${x + 4},${y1 - 8} ${x},${y1}" fill="#16232E"/>`);
    el.push(`<text x="${x + 8}" y="${(y0 + y1) / 2 + 3}" font-size="8.5" fill="#43566B">いいえ</text>`);
  };
  qBox(20, "市場のみんなも欲しがる条件か?", "駅距離・広さ・整形地・南向き・日照 など");
  rBox(14, "#2E6E8E", "A: 市場価格の変数", "価格曲線上のどの点を買うかの選択。出口で回収される。", "妥協の損得より出口の流動性(徒歩15分超・変形地)を見る");
  yes(46);
  no(72, 104);
  qBox(104, "後から工事で作れるか?", "物件ごとに図面・PS位置で判定(=分類は変数×物件)");
  rBox(98, "#B07C10", "B: 工事費上限の変数", "払ってよい上乗せの上限 = その物件での実見積り。", "不可/見積りが競合との価格差を超えたらA昇格=候補落ち");
  yes(130);
  no(156, 188);
  rBox(188, "#2C6E49", "C: 個人的価値(満足プレミアム)", "月額テスト: 上乗せ÷保有月数を家賃として払えるか。", "出口で回収されない全損の消費。上限を内見前に紙に書く");
  const cx = qx + qw / 2;
  el.push(`<line x1="${cx}" y1="188" x2="${cx}" y2="220" stroke="#16232E" stroke-width="1.4"/>`);
  el.push(`<line x1="${cx}" y1="220" x2="${rx - 8}" y2="220" stroke="#16232E" stroke-width="1.4"/>`);
  el.push(`<polygon points="${rx - 8},216 ${rx - 8},224 ${rx},220" fill="#16232E"/>`);
  el.push(`<text x="${qx}" y="${H - 6}" font-size="8.5" fill="#43566B">同じ「トイレ増設」でも配管次第でB(数十万の減点)にもA(候補落ち)にもなる ── 分類は物件ごとに再計算する</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="希望条件のA/B/C分類判定フロー" style="width:100%;height:auto">${el.join("")}</svg>`;
}

const td = 'style="white-space:normal"';
const tdS = 'style="white-space:normal;font-size:.76rem"';
const row4 = ([a, b, c, d]) => `<tr><td ${td}><b>${a}</b></td><td ${tdS}>${b}</td><td ${tdS}>${c}</td><td ${tdS}>${d}</td></tr>`;
const head4 = (t) => `<tr><th>変数</th><th>容易な場合</th><th>大掛かり/上限側</th><th>${t}</th></tr>`;

export function renderTradeoff({ asOf }) {
  const walkPct = Math.abs(COEFFS.WALK_ADJ_PER_MIN * 100).toFixed(1);
  const body = `
  <div class="panel">
    <h2>考え方 ── 希望条件は3種類に分かれ、換算方法がそれぞれ違う</h2>
    <div class="logic-body">
      <p class="why">「都心アクセス」「トイレ2個」「3LDK」…希望条件が多いほど、何を妥協して何を譲らないかで迷う。だが条件を<b>誰が値付けするか</b>で仕分けると、大半は計算で潰せて、本当に悩んでよい変数はごく少数だと分かる。</p>
      ${triageSvg()}
      <table class="list" style="margin-top:12px">
        <tr><th>分類</th><th>換算方法</th><th>出口での回収</th><th>例</th></tr>
        <tr><td><b style="color:#2E6E8E">A: 市場価格</b></td><td ${tdS}>市場の物差しそのまま。駅徒歩は土地部分の±${walkPct}%/分(この価格帯で約50〜60万/分)、広さは残価単価×坪</td><td ${tdS}>回収される(売るときも同じ理由で高い)</td><td ${tdS}>駅距離・延床・整形地・南向き</td></tr>
        <tr><td><b style="color:#B07C10">B: 工事費上限</b></td><td ${tdS}>上限=その物件での増設・変更の実見積り。概算は下の早見表</td><td ${tdS}>3〜5割しか回収されない(住むための消費)</td><td ${tdS}>トイレ増設・間仕切り・内窓</td></tr>
        <tr><td><b style="color:#2C6E49">C: 個人的価値</b></td><td ${tdS}>月額テスト: 上乗せ額÷保有月数を「追加家賃」として払えるか(例: +150万÷150ヶ月=月1万円)</td><td ${tdS}>回収されない(全損)</td><td ${tdS}>街への愛着・親との距離・学区</td></tr>
      </table>
      <div class="note" style="margin-top:8px"><b>「譲れない」を名乗ってよいのは「後から変えられない × 自分の効用が濃い」条件だけ</b>。A群は妥協より流動性(徒歩15分超・変形地・北向きは安く買えるが売るときも同じ理由で叩かれる)、B群は減点表(下)、C群だけが本物の満足プレミアムで、上限を内見前に決めておく(<a href="formula.html">値段の解剖</a>の「意思決定の二軸」参照)。</div>
    </div>
  </div>

  <div class="panel">
    <h2>B群早見表 ── 「後から買える」ものの概算工事費(木造2〜3階建・延床85〜100m²帯)</h2>
    <div class="logic-body">
      <p class="why">金額は東京圏の概算レンジ。<b>減点は概算で仮置きし、買付前に必ず実見積りへ置き換える</b>(査定エンジンが修繕費想定→実見積りで確定するのと同じ規律)。「A昇格の条件」に当たる物件では、その変数はもう工事で買えない=譲れない条件なら候補落ち。</p>
      <h3 style="font-size:.85rem;margin:14px 0 4px">水回り</h3>
      <div style="overflow-x:auto"><table class="list">
        ${head4("A昇格(その物件では買えない)の条件")}
        ${[["トイレ増設", "50〜150万(納戸転用・PS近接)", "200〜400万(配管新設・間取り改変)", "置き場所が物理的にない。図面のPS位置と各階の水回り配置で判定"],
           ["浴室交換(同サイズ)", "80〜150万", "—", "—"],
           ["浴室サイズアップ", "+50〜100万", "構造壁に当たると大幅増", "柱・階段・窓に挟まれ拡張余地なし"],
           ["キッチン交換(同位置)", "60〜150万", "—", "—"],
           ["キッチン移設・対面化", "150〜300万", "排気ダクト・床下配管次第", "排気経路が外壁まで取れない"],
           ["洗面の2ボウル化・増設", "30〜80万", "100〜150万", "洗面室の幅が足りない"]].map(row4).join("")}
      </table></div>
      <h3 style="font-size:.85rem;margin:14px 0 4px">間取り・内装</h3>
      <div style="overflow-x:auto"><table class="list">
        ${head4("A昇格の条件")}
        ${[["2LDK+S→3LDK化", "0〜20万(S(納戸)は採光基準のラベルで、窓があれば実質居室)", "20〜60万(壁・建具追加)", "Sが無窓で外壁に面していない"],
           ["間仕切り撤去(広間化)", "15〜50万/箇所", "—", "<b>耐力壁は原則不可</b>。図面の壁厚・筋交い・直下の壁の連続性で判定"],
           ["和室→洋室", "30〜80万", "—", "—"],
           ["全面内装(クロス・床90m²)", "80〜150万", "—", "—(古さ・汚れはむしろ値引き材料)"],
           ["収納造作・可動棚", "10〜30万/箇所", "—", "—"]].map(row4).join("")}
      </table></div>
      <h3 style="font-size:.85rem;margin:14px 0 4px">性能</h3>
      <div style="overflow-x:auto"><table class="list">
        ${head4("備考")}
        ${[["窓断熱(内窓を全窓)", "40〜90万", "—", "国の補助金で実費が大きく下がる年がある。都度確認"],
           ["壁・床の断熱改修", "—", "150〜400万(スケルトン級)", "全面リフォーム時以外は非現実的。築浅なら不要"],
           ["耐震補強(築古のみ)", "診断10〜40万+工事100〜250万", "—", "性能は上げられるが<b>耐震等級のラベル・保険割引は後から取得困難</b>=半分A群。築浅・等級3付きの強みはここ"],
           ["床暖房の後付け", "50〜100万/室", "—", "温水式は給湯側の工事も"],
           ["太陽光+蓄電池", "100〜300万", "—", "屋根の形状・方位が不適なら不可(方位自体はA群)"]].map(row4).join("")}
      </table></div>
      <h3 style="font-size:.85rem;margin:14px 0 4px">外構・設備</h3>
      <div style="overflow-x:auto"><table class="list">
        ${head4("A昇格の条件")}
        ${[["エアコン(1台)", "10〜20万", "—", "配管穴・室外機置場なし(稀)"],
           ["カーポート・外構", "30〜100万", "—", "<b>駐車スペース自体がない=土地形状の問題で完全にA群</b>"],
           ["食洗機・IH・宅配ボックス等", "5〜30万", "—", "—"]].map(row4).join("")}
      </table></div>
      <div class="note" style="margin-top:10px"><b>よくある取り違え</b> ── Bで済むもの: 間取りのラベル(2LDK+S問題)・設備グレード・内装の古さ。実はA群(後から買えない): 窓の位置と数(増設は外壁・構造制約で高額/不可が多い)・天井高・延床の増築(建ぺい/容積・確認申請で木造3階建は実質困難)・日照・駐車スペース・音や振動の環境(内窓で緩和はできるが源は消えない)。</div>
    </div>
  </div>

  <div class="panel">
    <h2>使い方 ── 物件ごとの減点表と3つの運用ルール</h2>
    <div class="logic-body">
      <p class="why">候補物件が来たら、早見表から該当行だけ抜いて合算する。例:</p>
      <pre style="font-family:var(--mono);font-size:.8rem;line-height:1.9;background:#F7F9FA;border:1px solid var(--grid);padding:12px 14px;overflow-x:auto">候補X(2LDK+S・トイレ1・内窓なし・築8年)
  3LDK化      ▲ 20万(Sに窓あり=ラベル差のみ)
  トイレ増設   ▲ 80万(2階PS横の納戸転用可と図面で確認)
  内窓        ▲ 60万
  ────────────────────────
  B群減点計   ▲160万 → 全条件充足の競合との価格差が160万以内なら競合を買う</pre>
      <table class="kv" style="max-width:640px;margin-top:10px">
        <tr><td>ルール1</td><td>減点は概算で仮置きし、<b>買付前に実見積りへ置き換える</b></td></tr>
        <tr><td>ルール2</td><td>A昇格(不可判定)が1つでも出て、それが譲れない条件なら、減点でなく<b>候補落ち</b></td></tr>
        <tr><td>ルール3</td><td>B群減点計が大きい物件(目安300万超)は「安く見えて高い」── 指値に載せるか降りる</td></tr>
      </table>
      <div class="note" style="margin-top:10px"><b>二重計上に注意</b>: 外壁・屋根塗装や設備の寿命交換など「年式相応の劣化」は、査定側の繰延修繕(${RETAIL.REPAIR_PER_YEAR}万/年×築年・上限${COEFFS.DEFAULT_REPAIR_MAN}万)が既に控除している(<a href="guide.html">前提知識ガイド</a> STEP6)。この減点表に載せてよいのは「直す」でなく「<b>変える・足す</b>」だけ。逆に売主側の「リフォーム済み+○○万」の主張は、中古市場が設備投資を3〜5割しか評価しない非対称を踏まえて聞くこと。</div>
      <div class="note">関連: 値段の構造は<a href="formula.html">値段の解剖</a>、査定係数の意味は<a href="guide.html">前提知識ガイド</a>、成約データ全件は<a href="data.html">成約データ台帳</a>。本ページは検討用の一般形リファレンスであり、個別工事の可否・金額は現地調査と見積りで確定する。</div>
    </div>
  </div>

  <div style="margin-bottom:20px"><a class="src-link" href="index.html">← 査定台帳一覧へ戻る</a></div>`;

  return layout({
    title: "妥協の値段 ── 希望条件のA/B/C分類とB群工事費早見表",
    subtitle: "何を妥協し、何を譲らないかを金額換算で決めるためのリファレンス",
    docNo: `希望条件の換算表<br>基準日 ${asOf}`,
    body,
  });
}
