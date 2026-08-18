// site/templates/rent-index.js — 戸建賃貸台帳の一覧ページ。
// 購入台帳(index.html)と同じ思想で作る:
//   ① 判定(借りる/見送り)は出さない。出すのは「表示賃料がいくらで、実質いくらになるか」まで
//   ② 落とした件数と理由を必ず開示する(探索の漏斗)
//   ③ 掲載から読めなかった項目は仮定であることを名指しで書く
import { layout, esc, safeUrl, fmtDate } from "./layout.js";

const RENT_STATUS_CHOICES = ["新規", "検討中", "申込検討", "見送り"];
const RENT_VIEW_CHOICES = ["未", "内見希望", "内見済"];
const LS_KEY = "fudosan-rent-ledger-v1";

// 物件ごとに固定の線色(台帳順)。simulate.html と同じ考え方で、色が動くと読めなくなる
const PALETTE = ["#2E6E8E", "#B03A2E", "#6B4E9B", "#2C6E49", "#B07C10", "#1F6F78", "#8E44AD", "#C0392B"];

const yen = (man) => (man == null ? "—" : `${(Math.round(man * 100) / 100).toLocaleString("ja-JP")}万`);
const m1 = (v) => (v == null ? "—" : v.toFixed(1));

// ---- 実質月額カーブ(居住年数1〜10年) ----
// 縦軸は「実質月額(万円/月)」。一時金は住む年数で薄まるので**右肩下がりの曲線**になる。
// 表示賃料は水平線として重ね、両者の隙間が「掲載に出ていない負担」の大きさになる
function curveSvg(rows) {
  // 縦軸ラベルは rotate(-90) で置かない。回転前の bbox が枠外へ出るため
  // tests/ui/cliff.svg.mjs の見切れ検査に落ちる(運用ルール5)。軸名はグラフ上部へ水平に置く
  const W = 900, H = 400, ML = 62, MR = 208, MT = 36, MB = 46;
  const pw = W - ML - MR, ph = H - MT - MB;
  const maxY = Math.max(10, ...rows.flatMap((r) => r.res.curve.map((c) => c.monthlyEq)));
  const minY = Math.min(...rows.flatMap((r) => [r.res.listed.total_man, ...r.res.curve.map((c) => c.monthlyEq)]));
  const lo = Math.floor(minY - 1), hi = Math.ceil(maxY + 1);
  const x = (y) => ML + ((y - 1) / 9) * pw;
  const y = (v) => MT + ph - ((v - lo) / (hi - lo)) * ph;

  const ticks = [];
  for (let v = Math.ceil(lo); v <= hi; v++) {
    if ((hi - lo) > 12 && v % 2 !== 0) continue;
    ticks.push(`<line x1="${ML}" y1="${y(v).toFixed(1)}" x2="${ML + pw}" y2="${y(v).toFixed(1)}" stroke="#DCE3EA"/>
      <text x="${ML - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#43566B">${v}</text>`);
  }
  const xticks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((yy) =>
    `<text x="${x(yy).toFixed(1)}" y="${MT + ph + 18}" text-anchor="middle" font-size="10" fill="#43566B">${yy}</text>`).join("");

  const lines = rows.map((r, i) => {
    const c = PALETTE[i % PALETTE.length];
    const d = r.res.curve.map((p, k) => `${k ? "L" : "M"}${x(p.years).toFixed(1)},${y(p.monthlyEq).toFixed(1)}`).join("");
    const listed = r.res.listed.total_man;
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="2"/>
      <line x1="${ML}" y1="${y(listed).toFixed(1)}" x2="${ML + pw}" y2="${y(listed).toFixed(1)}" stroke="${c}" stroke-width="1" stroke-dasharray="2 4" opacity=".55"/>`;
  }).join("");

  // 凡例は右の余白へ。SVG内テキストの見切れを避けるため MR を広く取ってある(運用ルール5)
  const legend = rows.map((r, i) => {
    const c = PALETTE[i % PALETTE.length];
    const ly = MT + 12 + i * 40;
    return `<line x1="${ML + pw + 12}" y1="${ly}" x2="${ML + pw + 30}" y2="${ly}" stroke="${c}" stroke-width="2"/>
      <text x="${ML + pw + 36}" y="${ly + 4}" font-size="10.5" fill="#16232E">${esc(r.short)}</text>
      <text x="${ML + pw + 36}" y="${ly + 17}" font-size="9.5" fill="#43566B">表示${m1(r.res.listed.total_man)} → 2年${m1(r.res.at2y.monthlyEq)}</text>
      <text x="${ML + pw + 36}" y="${ly + 29}" font-size="9.5" fill="#43566B">4年${m1(r.res.at4y.monthlyEq)}万/月</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" role="img" aria-label="実質月額カーブ">
    <rect x="${ML}" y="${MT}" width="${pw}" height="${ph}" fill="#fff" stroke="#16232E"/>
    ${ticks.join("")}${xticks}
    <text x="${ML + pw / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#16232E">住む年数(年)</text>
    <text x="4" y="${MT - 12}" font-size="11" fill="#16232E">縦軸: 実質月額(万円/月)</text>
    ${lines}${legend}
  </svg>`;
}

function funnelTable(funnel) {
  const rows = funnel.steps.map((s, i) => `<tr>
    <td>${i === 0 ? "母集団" : `絞り込み${i}`}</td>
    <td>${esc(s.label)}</td>
    <td class="num">${s.n}件</td>
    <td class="num">${i === 0 ? "—" : `−${s.dropped}`}</td>
  </tr>`).join("");
  return `<table class="list">
    <tr><th>段</th><th>条件</th><th>残り</th><th>落ちた数</th></tr>${rows}
  </table>`;
}

export function renderRentIndex(results, { asOf, funnel, model, poolCapturedAt }) {
  const rows = results.map(({ res, rental }, i) => ({
    res, rental, i,
    short: `${rental.location?.district ?? ""}${rental.location?.chome ?? ""} ${rental.layout ?? ""}`,
  }));

  const tableRows = rows.map(({ res, rental, i }) => {
    const url = safeUrl(rental.source_url);
    const c = PALETTE[i % PALETTE.length];
    const hz = rental.hazard_check?.official ?? {};
    const hazardCell = (hz.hits ?? []).length
      ? `<span class="hz">浸水${esc(hz.flood_l2 ?? "該当")}</span><div class="note" style="margin-top:2px">標高${hz.elevation_m}m${(hz.hits ?? []).some((h) => /家屋倒壊/.test(h)) ? "・<b>家屋倒壊等氾濫想定(氾濫流)</b>" : ""}</div>`
      : `<span class="hz ok">該当なし</span><div class="note" style="margin-top:2px">標高${hz.elevation_m ?? "—"}m</div>`;
    const ct = rental.terms?.contract_type;
    const cy = rental.terms?.contract_years;
    // 定期借家3年は掲載条件として許容している(2026-08-18ユーザー指示)。ただし普通借家と同じには扱わない
    // ——満了で確実に終わる契約なので、年数を必ず添えて出す
    // 列が狭いので**ラベルは折り返さない**(1文字ずつ折れて行が異様に高くなる。2026-08-18の実測)。
    // 詳しい説明は物件ページに置き、ここは最小限の注記にとどめる
    const contractCell = ct === "futsu" ? `<span class="nw">普通借家${cy ?? ""}年</span>`
      : ct === "teiki" ? `<span class="nw">定期借家${cy}年</span><div class="note" style="margin-top:2px">満了で終了</div>`
      : `<b class="nw" style="color:var(--warn)">記載なし</b><div class="note" style="margin-top:2px">要確認</div>`;
    const t2 = rental.facilities?.toilet2 === true
      ? `<span class="hz ok">記載あり</span>`
      : `<span class="hz">記載なし</span>`;
    const ratio = res.ratio ? `${(res.ratio * 100).toFixed(0)}%` : "—";
    return `<tr class="prow" data-id="${esc(res.id)}">
      <td><span class="swatch" style="background:${c}"></span>
        ${(() => {
          // 「東京都北区赤羽３」を丸ごと出すと狭い列で1文字ずつ折り返す(2026-08-18の実測)。
          // 区までは全物件共通なので地区+丁目に詰める
          const label = `${rental.location?.district ?? ""}${rental.location?.chome ? rental.location.chome + "丁目" : ""}` || res.id;
          return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label);
        })()}
        <div class="note" style="margin-top:2px">${esc(rental.layout ?? "")} ${rental.building?.floor_m2 ?? "—"}m² / ${esc(rental.building?.structure ?? "")} / 台帳登録${fmtDate(rental.captured_at)}</div>
        <div class="note"><a href="rent/${esc(res.id)}.html">この物件の内訳 →</a></div></td>
      <td class="num">${yen(res.listed.total_man)}${
        // 管理費0の物件で「+管理0万」を出しても情報が増えず、狭い列で3行に折り返して
        // 右端のメモ欄を押し出す(2026-08-18の実測)。内訳は管理費があるときだけ出す
        res.listed.kanri_man > 0 ? `<div class="note">賃料${yen(res.listed.rent_man)}+管理${yen(res.listed.kanri_man)}</div>` : ""}</td>
      <td class="num"><b>${m1(res.at2y.monthlyEq)}万</b><div class="note">+${m1(res.at2y.premiumOverListed)}万/月</div></td>
      <td class="num">${m1(res.at4y.monthlyEq)}万<div class="note">+${m1(res.at4y.premiumOverListed)}万/月${
        // 定期借家は契約期間で終わるので、4年の列は再契約前提の参考値になる。
        // 実際の想定である「満了時点」の実質月額を必ず添える
        ct === "teiki" && cy ? `<br><b>${cy}年満了時 ${m1(res.curve[cy - 1].monthlyEq)}万</b>` : ""}</div></td>
      <td class="num">${m1(res.at2y.cashAtStart)}万</td>
      <td class="num">${ratio}<div class="note">基準${res.benchmark ? m1(res.benchmark.mid) + "万" : "—"}</div></td>
      <td class="num">築${rental.building?.built_year ?? "—"}<div class="note">${res.age_y != null ? res.age_y + "年" : ""}</div></td>
      <td class="num">${rental.station?.walk_min ?? "—"}分<div class="note">京浜${rental.station?.keihin_walk_min ?? "—"}分</div></td>
      <td>${contractCell}</td>
      <td>${t2}</td>
      <td>${hazardCell}</td>
      <td><select class="stsel">${RENT_STATUS_CHOICES.map((s) => `<option>${s}</option>`).join("")}</select></td>
      <td><select class="vwsel">${RENT_VIEW_CHOICES.map((s) => `<option>${s}</option>`).join("")}</select></td>
      <td class="memocell"><textarea class="memota" placeholder="メモ(この端末のブラウザにのみ保存)"></textarea></td>
    </tr>`;
  }).join("");

  const walkTerm = model?.terms?.find((t) => t.key === "walk");
  const ageTerm = model?.terms?.find((t) => t.key === "age");
  const areaTerm = model?.terms?.find((t) => t.key === "area");

  const body = `
  <div class="panel">
    <div class="cond-banner"><b>台帳掲載の条件</b>: 賃料+管理費 15〜25万円 / 最寄り駅 徒歩10分以内(路線は問わない) / 3LDK以上(納戸Sは1室として数える) / 新耐震(1982年以降竣工) / 一戸建て(テラス・タウンハウスは対象外) / <b>普通借家、または定期借家3年ちょうど</b>(定期借家の2年・4年以上はKO) ── 東京都北区の戸建賃貸をSUUMOから日次クロールして収集。<b>ハザードマップ内も対象に含める</b>(2026-08-18の方針。ただし該当内容は必ず事実として記録する)。駐車場・トイレ2個は条件にしない(下記)。</div>
    <div class="cond-banner" style="border-color:var(--ink-soft);background:#FBFAF8"><b>この台帳は「借りる/見送り」の判定を出しません</b>: 出すのは①表示賃料に対して実際にいくら払うことになるか(実質月額)②募集賃料の分布の中でどこに立つか、という事実までです。判断は人が行います(購入台帳 v3.0.0 と同じ思想)。</div>
    <div class="note" style="margin:0 0 10px">購入台帳は <a href="index.html">中古戸建の査定台帳</a>。持ち家と賃貸で「お金では見えない手間」がどう違うかは <a href="effort.html">手間の解剖</a>、何年住むと総コストがどうなるかは <a href="simulate.html">保有年数シミュレーター</a> が扱っています。この賃貸台帳の相場モデルの作り方と限界は <a href="rent-basis.html">募集賃料モデルの根拠</a> に分けて書きました。</div>
  </div>

  <div class="panel">
    <h2>実質月額 ── 表示賃料は「払う額」ではない</h2>
    <div class="logic-body">
      <p class="why">賃貸で実際に出ていくのは毎月の賃料だけではありません。礼金・仲介手数料・保証料・火災保険・鍵交換といった<b>一時金</b>と、2年ごとの<b>更新料</b>、退去時の<b>原状回復</b>が乗ります。これらを住む年数で割って月額に均したのが下の曲線です。一時金は年数で薄まるので<b>右肩下がり</b>になり、点線(表示賃料+管理費)との隙間が「掲載の賃料欄に出ていない負担」です。</p>
      <div style="overflow-x:auto">${curveSvg(rows)}</div>
      <div class="note" style="margin-top:8px"><b>定期借家の物件は契約期間を超えた部分が再契約前提の参考値です</b>(この台帳では定期借家3年を許容しているので、該当物件は3年で満了します)。一覧の実質月額(4年)欄に満了時点の値を併記しました。</div>
      <div class="note">実線=実質月額 / 点線=表示賃料+管理費(同じ色が同じ物件)。<b>敷金は総額に入れていません</b>(原則返還されるため)。ただし入居時に用意する現金には含めています(一覧の「入居時現金」欄)。退去時の原状回復は借主負担なので総額に入れています。</div>
      <div class="note"><b>曲線がところどころで上向きに折れているのは誤りではありません。</b>2年ごとの更新料が新たに乗る年(7年目・9年目など)は、一時金が薄まる効果よりも更新料の追加が勝つため、実質月額が一度上がります。<b>「あと1年住むと得か」は年によって答えが違う</b>ということで、更新の直前に出るか直後に出るかで負担が変わります。</div>
    </div>
  </div>

  <div class="panel">
    <h2>台帳 ── ${rows.length}件</h2>
    <div id="ls-info" class="note" style="margin:0 0 8px"></div>
    <div style="overflow-x:auto">
    <table class="list" id="rentlist">
      <tr>
        <th>物件</th><th class="wrapth">表示<br>賃料+管理費</th><th class="wrapth">実質月額<br>(2年)</th><th class="wrapth">実質月額<br>(4年)</th>
        <th class="wrapth">入居時<br>現金</th><th class="wrapth">ものさし比</th><th>築年</th><th class="wrapth">徒歩</th>
        <th>契約</th><th class="wrapth">トイレ2個</th><th>ハザード</th><th>検討状況</th><th>内見</th><th class="memocol">メモ</th>
      </tr>
      ${tableRows}
    </table>
    </div>
    <div class="note" style="margin-top:10px"><b>「トイレ2個」の欄が「記載なし」でも、トイレが1つとは限りません。</b> SUUMOの設備欄は任意記載で、北区の戸建賃貸66件のうち「トイレ2ヶ所」の記載があるのは${funnel.toilet2Documented}件しかありません。条件に加えると候補が${funnel.withToilet2}件まで落ちるため、<b>掲載条件には入れず事実欄として持ち</b>、内見・問い合わせで確認する運用にしています。</div>
    <div class="note"><b>検討状況・内見・メモはこの端末のブラウザ(localStorage)にのみ保存されます。</b>公開リポジトリには書き込みません。</div>
  </div>

  <div class="panel">
    <h2>探索の漏斗 ── 何件を、どの条件で落としたか</h2>
    <div class="logic-body">
      <p class="why">母集団はSUUMOに出ている東京都北区の戸建賃貸${funnel.poolN}件(取得 ${esc(poolCapturedAt ?? asOf)})です。条件を1つずつ掛けると次のように減ります。<b>黙って減らさない</b>ため、各段で落ちた数を出しています。</p>
      ${funnelTable(funnel)}
      <div class="note" style="margin-top:10px">最も多く落とすのは<b>賃料の下限</b>ではなく<b>間取り</b>です(徒歩10分以内の21件のうち10件が3LDKに届かない)。北区の戸建賃貸は築古の2K〜2LDKが厚く、3LDK以上で新耐震という帯は薄いという構造になっています。</div>
      <div class="note"><b>定期借家は「3年ちょうど」だけ許容しています</b>(子供の小学校入学前に区切りをつけるため)。短いからKOではなく<b>長さの要件</b>なので、2年も4年以上も同じように外れます。母集団${funnel.poolN}件のうち定期借家は${funnel.teikiInPool}件あり例外ではありませんが、ここまで残った掲載のうち定期借家は${funnel.teikiAllowed}件で、<b>いずれもちょうど3年</b>でした——この条件で今回落ちた掲載は0件です。</div>
    </div>
  </div>

  <div class="panel">
    <h2>相場のものさし ── 何が言えて、何が言えないか</h2>
    <div class="logic-body">
      <p class="why">「ものさし比」は、北区の戸建賃貸${model?.n ?? "—"}件から作った<b>募集賃料モデル</b>に対する比です。100%なら分布のまん中と同じ水準です。ただしこのモデルには重い前提があります。</p>
      <ul class="notes">
        <li><b>母集団は成約ではなく募集です。</b>賃貸の成約賃料は公開されていません。「その値段で決まった」ことは示せず、示せるのは「貸主の希望の分布の中での位置」だけです。購入台帳が成約データを使えているのとは決定的に違います。</li>
        <li><b>同じ条件でも±${model ? model.spreadPct.toFixed(0) : "—"}%散ります</b>(残差)。この幅の中に収まる差は、この標本では水準の違いとして読めません。一覧の「ものさし比」が95%と107%でも、その差は誤差の内側です。</li>
        ${areaTerm ? `<li><b>面積は比例しません。</b>弾力性は${areaTerm.est.toFixed(2)}(95%CI ${areaTerm.ci.lo.toFixed(2)}〜${areaTerm.ci.hi.toFixed(2)})で、1.00を含みません。広い家ほどm²単価は安くなります。</li>` : ""}
        ${ageTerm ? `<li><b>築年は効きます。</b>1年あたり${ageTerm.est_pct.toFixed(2)}%(95%CI ${ageTerm.ci_pct.lo.toFixed(2)}〜${ageTerm.ci_pct.hi.toFixed(2)}%)で、区間が0を跨ぎません。</li>` : ""}
        ${walkTerm ? `<li><b>徒歩分は判別できません。</b>推定は${walkTerm.est_pct.toFixed(2)}%/分(95%CI ${walkTerm.ci_pct.lo.toFixed(2)}〜${walkTerm.ci_pct.hi.toFixed(2)}%)で、<b>符号すら定まらず、点推定は「遠いほど高い」という向き</b>になっています。駅から遠い戸建ほど広い・新しいという交絡が疑われます。<b>この係数を根拠に「駅から遠いから割安」と読まないでください。</b></li>` : ""}
      </ul>
      <div class="note" style="margin-top:8px">モデルの作り方・係数の信頼区間・散布図は <a href="rent-basis.html">募集賃料モデルの根拠</a> に分けて書いてあります。</div>
    </div>
  </div>

  <div class="panel">
    <h2>実質月額に使った仮定</h2>
    <div class="logic-body">
      <p class="why">掲載に金額が書かれていない費目は既定値を当てています。<b>どの物件でどれを仮定したかは物件ページに名指しで出ます</b>。申込時の見積りが出たらYAMLの実額に置き換えてください。</p>
      <table class="list">
        <tr><th>費目</th><th>既定値</th><th>備考</th></tr>
        <tr><td>仲介手数料</td><td class="num">賃料1.1ヶ月</td><td>宅建業法の上限(消費税込)</td></tr>
        <tr><td>保証会社(初回)</td><td class="num">賃料0.5ヶ月</td><td>掲載に率があればそれを使う</td></tr>
        <tr><td>保証会社(月額)</td><td class="num">賃料の1.0%</td><td>同上。定額表記(集送金手数料等)は実額で入れる</td></tr>
        <tr><td>火災保険</td><td class="num">2万円/2年</td><td>掲載が「要」だけで金額が無い場合</td></tr>
        <tr><td>鍵交換</td><td class="num">2.2万円</td><td>掲載にはほぼ出ない</td></tr>
        <tr><td>更新料</td><td class="num">賃料1ヶ月/2年</td><td>2年ちょうどで退去すれば更新は起きない</td></tr>
        <tr><td>退去時の原状回復</td><td class="num">賃料1ヶ月</td><td>定額クリーニングの記載があればそちらを優先</td></tr>
      </table>
      <div class="note" style="margin-top:8px"><b>掲載の「備考」に埋まっている付帯費用は人が書き写します。</b>機械抽出はしません(自由文なので誤読の害が大きい)。実例: 西ケ原4は消火剤7.1万・消毒3.7万・入居者サポート2.2万で<b>初期13万円</b>が敷礼欄の外にあり、志茂4は退去時クリーニングが1,540円×平米の定額です。</div>
    </div>
  </div>

  <script>
  (function(){
    var KEY=${JSON.stringify(LS_KEY)};
    function load(){ try { return JSON.parse(localStorage.getItem(KEY)||"{}"); } catch(e){ return {}; } }
    function save(d){ try { localStorage.setItem(KEY, JSON.stringify(d)); } catch(e){} }
    var data=load();
    var rows=document.querySelectorAll("#rentlist tr.prow");
    rows.forEach(function(tr){
      var id=tr.getAttribute("data-id");
      var st=tr.querySelector(".stsel"), vw=tr.querySelector(".vwsel"), me=tr.querySelector(".memota");
      var rec=data[id]||{};
      if(rec.status) st.value=rec.status;
      if(rec.viewing) vw.value=rec.viewing;
      if(rec.memo) me.value=rec.memo;
      tr.setAttribute("data-viewing", vw.value);
      function persist(){
        data[id]={status:st.value, viewing:vw.value, memo:me.value};
        tr.setAttribute("data-viewing", vw.value);
        save(data);
      }
      st.addEventListener("change",persist);
      vw.addEventListener("change",persist);
      me.addEventListener("input",persist);
    });
    var info=document.getElementById("ls-info");
    if(info) info.textContent="検討状況・内見・メモはこの端末に保存中(キー "+KEY+")。"+rows.length+"件を表示しています。";
  })();
  </script>
  `;

  return layout({
    title: "戸建賃貸台帳 ── 北区(赤羽〜田端)",
    subtitle: `RENTAL LEDGER / ${rows.length} PROPERTIES`,
    docNo: `RENT-LEDGER<br>${asOf}<br>母集団 ${funnel.poolN}件`,
    body,
  });
}
