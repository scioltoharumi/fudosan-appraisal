// site/templates/rent-basis.js — 募集賃料モデルの根拠ページ。
// 目的は「このものさしを信じてよい範囲」を先に示すこと。購入台帳の cliff.html と同じ役割で、
// **何が言えて何が言えないか**を係数ごとに名指しする。数値はすべてビルド時計算(手書きしない)。
import { layout, esc } from "./layout.js";

const m1 = (v) => (v == null ? "—" : v.toFixed(1));
const p2 = (v) => (v == null ? "—" : v.toFixed(2));

// 散布図: 横=専有面積(対数目盛) 縦=賃料+管理費。点は築年で塗り分ける
function scatterSvg(pool, model) {
  // 縦軸ラベルは回転させない(回転前bboxが枠外へ出て見切れ検査に落ちる。運用ルール5)
  const W = 880, H = 400, ML = 62, MR = 150, MT = 36, MB = 48;
  const pw = W - ML - MR, ph = H - MT - MB;
  const xs = pool.map((d) => Math.log(d.area_m2)), ys = pool.map((d) => d.total_man);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = 0, y1 = Math.ceil(Math.max(...ys) / 10) * 10;
  const X = (v) => ML + ((Math.log(v) - x0) / (x1 - x0)) * pw;
  const Y = (v) => MT + ph - ((v - y0) / (y1 - y0)) * ph;
  const ageColor = (a) => (a <= 5 ? "#2C6E49" : a <= 20 ? "#2E6E8E" : a <= 40 ? "#B07C10" : "#B03A2E");

  const pts = pool.map((d) =>
    `<circle cx="${X(d.area_m2).toFixed(1)}" cy="${Y(d.total_man).toFixed(1)}" r="3.2" fill="${ageColor(d.age_y)}" opacity=".78"/>`).join("");

  // モデル線: 築15年・徒歩8分での予測(面積を動かす)。1本だけ引いて形(逓減)を見せる
  const refAge = 15, refWalk = 8;
  const line = [];
  for (let i = 0; i <= 40; i++) {
    const a = Math.exp(x0 + ((x1 - x0) * i) / 40);
    const lg = model.coef[0] + model.coef[1] * Math.log(a) + model.coef[2] * refAge + model.coef[3] * refWalk;
    line.push(`${i ? "L" : "M"}${X(a).toFixed(1)},${Y(Math.exp(lg)).toFixed(1)}`);
  }

  const yticks = [];
  for (let v = 0; v <= y1; v += 10) {
    yticks.push(`<line x1="${ML}" y1="${Y(v).toFixed(1)}" x2="${ML + pw}" y2="${Y(v).toFixed(1)}" stroke="#DCE3EA"/>
      <text x="${ML - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#43566B">${v}</text>`);
  }
  const xticks = [30, 50, 70, 90, 120].filter((v) => Math.log(v) >= x0 && Math.log(v) <= x1).map((v) =>
    `<line x1="${X(v).toFixed(1)}" y1="${MT}" x2="${X(v).toFixed(1)}" y2="${MT + ph}" stroke="#DCE3EA"/>
     <text x="${X(v).toFixed(1)}" y="${MT + ph + 18}" text-anchor="middle" font-size="10" fill="#43566B">${v}</text>`).join("");

  const legend = [["築0〜5年", "#2C6E49"], ["築6〜20年", "#2E6E8E"], ["築21〜40年", "#B07C10"], ["築41年〜", "#B03A2E"]]
    .map(([l, c], i) => `<circle cx="${ML + pw + 20}" cy="${MT + 16 + i * 20}" r="4" fill="${c}"/>
      <text x="${ML + pw + 32}" y="${MT + 20 + i * 20}" font-size="10.5" fill="#16232E">${l}</text>`).join("");

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" role="img" aria-label="専有面積と賃料の散布図">
    <rect x="${ML}" y="${MT}" width="${pw}" height="${ph}" fill="#fff" stroke="#16232E"/>
    ${yticks.join("")}${xticks}
    ${pts}
    <path d="${line.join("")}" fill="none" stroke="#16232E" stroke-width="2" stroke-dasharray="6 3"/>
    <text x="${ML + pw + 20}" y="${MT + 112}" font-size="10" fill="#16232E">— — モデル線</text>
    <text x="${ML + pw + 20}" y="${MT + 126}" font-size="9.5" fill="#43566B">築${refAge}年・徒歩${refWalk}分</text>
    <text x="${ML + pw / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#16232E">専有面積(m²・対数目盛)</text>
    <text x="4" y="${MT - 12}" font-size="11" fill="#16232E">縦軸: 賃料+管理費(万円/月)</text>
  </svg>`;
}

// 係数の95%信頼区間を横棒で。0(または面積は1.00)を跨ぐかが読みどころ
function ciSvg(model) {
  const terms = model.terms.filter((t) => t.key !== "intercept");
  const W = 820, rowH = 62, H = 56 + terms.length * rowH;
  const ML = 190, MR = 40, pw = W - ML - MR;
  // 横軸は「%/単位」に揃える。面積だけは弾力性なので別扱いにして基準線を1.00にする
  const blocks = terms.map((t, i) => {
    const yy = 50 + i * rowH;   // 見出し行(y=16)と区間ラベル(yy-10)が重ならない位置
    const isElast = t.key === "area";
    const lo = isElast ? t.ci.lo : t.ci_pct.lo, hi = isElast ? t.ci.hi : t.ci_pct.hi;
    const est = isElast ? t.est : t.est_pct;
    const ref = isElast ? 1 : 0;              // 効果なしの基準
    const span = Math.max(Math.abs(hi - ref), Math.abs(lo - ref), Math.abs(est - ref)) * 1.5 || 1;
    const X = (v) => ML + pw / 2 + ((v - ref) / span) * (pw / 2);
    const decisive = t.decisive;
    const col = decisive ? "#2C6E49" : "#B07C10";
    return `<text x="10" y="${yy + 4}" font-size="11.5" fill="#16232E">${esc(t.label)}</text>
      <line x1="${X(ref).toFixed(1)}" y1="${yy - 16}" x2="${X(ref).toFixed(1)}" y2="${yy + 16}" stroke="#16232E" stroke-dasharray="3 3"/>
      <text x="${X(ref).toFixed(1)}" y="${yy + 30}" text-anchor="middle" font-size="9.5" fill="#43566B">${isElast ? "1.00 = 面積に比例" : "0 = 効果なし"}</text>
      <line x1="${X(lo).toFixed(1)}" y1="${yy}" x2="${X(hi).toFixed(1)}" y2="${yy}" stroke="${col}" stroke-width="3"/>
      <circle cx="${X(est).toFixed(1)}" cy="${yy}" r="4.5" fill="${col}"/>
      <text x="${X(lo).toFixed(1)}" y="${yy - 10}" text-anchor="middle" font-size="9.5" fill="#43566B">${p2(lo)}</text>
      <text x="${X(hi).toFixed(1)}" y="${yy - 10}" text-anchor="middle" font-size="9.5" fill="#43566B">${p2(hi)}</text>
      <text x="10" y="${yy + 20}" font-size="9.5" fill="${col}">${decisive ? "判別可能(区間が基準を跨がない)" : "判別不能(区間が基準を跨ぐ)"}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" role="img" aria-label="係数の95%信頼区間">
    <text x="10" y="16" font-size="11" fill="#16232E">推定値と95%信頼区間(固定シードのブートストラップ ${model.bootN ?? 4000}回)</text>
    ${blocks}
  </svg>`;
}

export function renderRentBasis({ pool, model, funnel, asOf }) {
  const ageT = model.terms.find((t) => t.key === "age");
  const walkT = model.terms.find((t) => t.key === "walk");
  const areaT = model.terms.find((t) => t.key === "area");
  const teiki = pool.filter((d) => d.contract_type === "teiki").length;
  const futsu = pool.filter((d) => d.contract_type === "futsu").length;
  const noContract = pool.length - teiki - futsu;

  const body = `
  <div class="panel">
    <h2>このページは何のためにあるか</h2>
    <div class="logic-body">
      <p class="why">賃貸台帳の一覧に出ている「ものさし比」が、<b>どこまで信じてよい数字なのか</b>を示すためのページです。結論を先に書きます。</p>
      <ul class="notes">
        <li><b>言えること①</b>: 賃料は専有面積に<b>比例しない</b>。弾力性は ${p2(areaT.est)}(95%CI ${p2(areaT.ci.lo)}〜${p2(areaT.ci.hi)})で1.00を含まない。広い家ほどm²単価は下がる。</li>
        <li><b>言えること②</b>: 築年は効く。1年あたり ${p2(ageT.est_pct)}%(95%CI ${p2(ageT.ci_pct.lo)}〜${p2(ageT.ci_pct.hi)}%)で区間が0を跨がない。</li>
        <li><b>言えないこと</b>: 駅からの徒歩分の効果は<b>判別できない</b>。推定は ${p2(walkT.est_pct)}%/分(95%CI ${p2(walkT.ci_pct.lo)}〜${p2(walkT.ci_pct.hi)}%)で、区間が0を跨ぐどころか<b>点推定の符号が「遠いほど高い」</b>という向きになっている。駅から遠い戸建ほど広い・新しいという交絡が疑われるが、この標本では切り分けられない。</li>
        <li><b>最大の限界</b>: 母集団は<b>成約ではなく募集</b>賃料である。賃貸の成約賃料は公開されていない。購入台帳が国交省の成約データを使えているのとは決定的に違い、ここで測れるのは「貸主の希望の分布」でしかない。</li>
      </ul>
    </div>
  </div>

  <div class="panel">
    <h2>データの出所 ── ${pool.length}件がどこから来たか</h2>
    <div class="logic-body">
      <p class="why">SUUMOの「東京都北区・賃貸一戸建て」一覧を全ページ走査し、各物件の詳細ページから実値を取りました(取得 ${esc(pool[0]?.captured_at ?? asOf)})。<b>一覧カードの値は使っていません</b>——一覧の切り出しは隣接カードや広告枠を巻き込むことがあり、購入台帳でも同じ事故が起きています。詳細ページでも、ページ下部の「この物件を見た人はこんな物件も見ています」に同じ形の賃料ブロックがあるため、抽出は物件ヘッダに限定しています。</p>
      <table class="list">
        <tr><th>項目</th><th>件数</th><th>備考</th></tr>
        <tr><td>プール総数(一戸建てのみ)</td><td class="num">${pool.length}件</td><td>テラス・タウンハウス(連棟)は除外</td></tr>
        <tr><td>普通借家</td><td class="num">${futsu}件</td><td>更新の拒絶に正当事由が要る</td></tr>
        <tr><td>定期借家</td><td class="num">${teiki}件</td><td><b>母集団の${(teiki / pool.length * 100).toFixed(0)}%</b>。例外ではない</td></tr>
        <tr><td>　うち契約${(funnel.teikiOkYears ?? [3]).join("・")}年(掲載条件で許容)</td><td class="num">${pool.filter((d) => d.contract_type === "teiki" && (funnel.teikiOkYears ?? [3]).includes(d.contract_years)).length}件</td><td>子供の小学校入学前の区切りに長さが合うため許容している</td></tr>
        <tr><td>契約期間の記載なし</td><td class="num">${noContract}件</td><td>問い合わせないと判別できない</td></tr>
        <tr><td>「トイレ2ヶ所」の記載あり</td><td class="num">${funnel.toilet2Documented}件</td><td>設備欄は任意記載。記載が無い=無い、ではない</td></tr>
      </table>
      <div class="note" style="margin-top:8px"><b>定期借家が${(teiki / pool.length * 100).toFixed(0)}%を占める点は、この市場の構造として重要です。</b>戸建賃貸は「持ち家を転勤等で一時的に貸す」供給が混ざるため、期間を区切った契約が普通のマンション賃貸より厚くなります。定期借家を一律にKOにすると候補が大きく減りますが、それは条件が厳しいのではなく市場がそうなっている、ということです。</div>
      <div class="note"><b>この台帳は定期借家を「${(funnel.teikiOkYears ?? [3]).join("・")}年ちょうど」だけ許容しています。</b>短いほど悪いという判断ではなく<b>長さの要件</b>です——子供の小学校入学前に区切りをつけたいという前提に3年という長さが合うため、2年(短くて区切りに足りない)も4年以上(満了が入学後に来る)も同じように外れます。定期借家は期間満了で確実に終わるので、この用途では普通借家より予定が立てやすいという面もあります。</div>
    </div>
  </div>

  <div class="panel">
    <h2>散布図 ── 面積と賃料の関係</h2>
    <div class="logic-body">
      <p class="why">横軸は専有面積(対数目盛)、縦軸は賃料+管理費。点の色は築年帯です。破線は「築15年・徒歩8分」でのモデル線で、<b>右上がりだが直線より寝ている</b>のが面積の逓減(弾力性 ${p2(areaT.est)})です。</p>
      <div style="overflow-x:auto">${scatterSvg(pool, model)}</div>
      <div class="note" style="margin-top:8px">対数目盛なので、横軸が2倍(例: 60→120m²)進むと賃料は約 ${p2(Math.pow(2, areaT.est))} 倍にしかなりません。「広さ2倍なら家賃2倍」という直感は、この市場では成り立ちません。</div>
    </div>
  </div>

  <div class="panel">
    <h2>係数の信頼区間 ── どれが判別可能か</h2>
    <div class="logic-body">
      <p class="why">モデルは log(賃料+管理費) = a + b·log(専有面積) + c·築年 + d·徒歩分 です。各係数の95%信頼区間を固定シードのブートストラップ(${model.n}件から復元抽出)で出しました。<b>区間が「効果なし」の基準を跨いでいたら、その変数については何も言えません。</b></p>
      <div style="overflow-x:auto">${ciSvg(model)}</div>
      <table class="list" style="margin-top:12px">
        <tr><th>変数</th><th>推定値</th><th>95%信頼区間</th><th>判別</th></tr>
        <tr><td>面積の弾力性</td><td class="num">${p2(areaT.est)}</td><td class="num">${p2(areaT.ci.lo)} 〜 ${p2(areaT.ci.hi)}</td><td>${areaT.decisive ? "可能(1.00を含まない)" : "不能"}</td></tr>
        <tr><td>築年</td><td class="num">${p2(ageT.est_pct)}%/年</td><td class="num">${p2(ageT.ci_pct.lo)} 〜 ${p2(ageT.ci_pct.hi)}%</td><td>${ageT.decisive ? "可能(0を跨がない)" : "不能"}</td></tr>
        <tr><td>徒歩分</td><td class="num">${p2(walkT.est_pct)}%/分</td><td class="num">${p2(walkT.ci_pct.lo)} 〜 ${p2(walkT.ci_pct.hi)}%</td><td>${walkT.decisive ? "可能" : "<b>不能(0を跨ぐ)</b>"}</td></tr>
      </table>
      <div class="note" style="margin-top:8px">モデル全体の説明力は R² = ${model.r2.toFixed(3)}、残差は <b>±${model.spreadPct.toFixed(0)}%</b> です。つまり同じ面積・築年・徒歩分でも、募集賃料はこのくらい散っています。<b>ものさし比が95%と107%の物件の差(12ポイント)は、この散らばりの内側です</b>——差があるとは読めません。</div>
    </div>
  </div>

  <div class="panel">
    <h2>購入台帳との違い(なぜ同じやり方ができないか)</h2>
    <div class="logic-body">
      <table class="list">
        <tr><th></th><th>購入台帳</th><th>賃貸台帳(このページ)</th></tr>
        <tr><td>母集団</td><td>成約価格(国交省 不動産情報ライブラリ / 再掲サイト)</td><td><b>募集賃料のみ</b>(成約賃料は非公開)</td></tr>
        <tr><td>件数</td><td>戸建成約 551件11地区</td><td>${pool.length}件(北区全域)</td></tr>
        <tr><td>外部での検算</td><td>公示地価と突き合わせできる</td><td><b>できない</b>(公的な賃料指標が地区単位で存在しない)</td></tr>
        <tr><td>出せるもの</td><td>適正中央値・市場実勢中央値などの参照水準</td><td>分布の中での位置と、実質月額の内訳</td></tr>
      </table>
      <div class="note" style="margin-top:8px">この非対称は標本を増やしても解消しません(募集は募集のままです)。したがって賃貸台帳の主役は<b>相場判定ではなく実質月額の可視化</b>に置いています。「表示21万が2年住むと24.5万/月になる」という事実は、相場観がなくても効く情報です。</div>
    </div>
  </div>

  <div class="note"><a href="rent.html">← 戸建賃貸台帳の一覧へ</a> / <a href="index.html">中古戸建の査定台帳(購入)</a></div>
  `;

  return layout({
    title: "募集賃料モデルの根拠 ── 何が言えて、何が言えないか",
    subtitle: "RENTAL MARKET BASIS",
    docNo: `RENT-BASIS<br>${asOf}<br>n=${model.n}`,
    body,
  });
}
