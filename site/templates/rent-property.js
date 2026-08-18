// site/templates/rent-property.js — 賃貸物件の個別ページ。
// 主役は「表示賃料 → 実質月額」の解剖。購入台帳の anatomy.js と同じ書き方(式に実数を代入して見せる)。
import { layout, esc, safeUrl, fmtDate } from "./layout.js";

const m1 = (v) => (v == null ? "—" : v.toFixed(1));
const m2 = (v) => (v == null ? "—" : v.toFixed(2));

// 実質月額の内訳バー。何が効いているかを面積で見せる
function breakdownBar(e) {
  const b = e.breakdown;
  const parts = [
    { label: "賃料+管理費", v: b.rentAndKanri, c: "#2E6E8E" },
    { label: "礼金", v: b.reikin, c: "#B03A2E" },
    { label: "仲介手数料", v: b.brokerage, c: "#C0703A" },
    { label: "保証料(初回)", v: b.guaranteeInit, c: "#B07C10" },
    { label: "保証料(月額)", v: b.guaranteeMonthly, c: "#8E7B2A" },
    { label: "火災保険", v: b.insurance, c: "#6B4E9B" },
    { label: "鍵交換", v: b.keyExchange, c: "#7C6BA0" },
    { label: "初期付帯費用", v: b.miscInitial, c: "#A0432E" },
    { label: "月額付帯費用", v: b.miscMonthly, c: "#8E5A3A" },
    { label: "更新料", v: b.renewal, c: "#2C6E49" },
    { label: "退去時費用", v: b.restoration, c: "#4A7C59" },
  ].filter((p) => p.v > 0.0001);
  const total = parts.reduce((s, p) => s + p.v, 0);
  const segs = parts.map((p) => `<div style="width:${(p.v / total * 100).toFixed(2)}%;background:${p.c}" title="${esc(p.label)} ${m1(p.v)}万"></div>`).join("");
  const legend = parts.map((p) => `<tr>
    <td><span class="swatch" style="background:${p.c}"></span>${esc(p.label)}</td>
    <td class="num">${m1(p.v)}万</td>
    <td class="num">${(p.v / total * 100).toFixed(1)}%</td>
    <td class="num">${m2(p.v / e.months)}万/月</td>
  </tr>`).join("");
  return `<div style="display:flex;height:26px;border:1px solid var(--ink);margin:8px 0">${segs}</div>
    <table class="list"><tr><th>費目</th><th>${e.years}年の合計</th><th>構成比</th><th>月額換算</th></tr>${legend}
    <tr><td><b>合計</b></td><td class="num"><b>${m1(total)}万</b></td><td class="num">100%</td><td class="num"><b>${m2(e.monthlyEq)}万/月</b></td></tr></table>`;
}

function curveTable(curve) {
  return `<table class="list">
    <tr><th>住む年数</th><th>実質月額</th><th>表示賃料との差</th><th>更新回数</th><th>総支払(敷金を除く)</th></tr>
    ${curve.map((c) => `<tr><td>${c.years}年</td><td class="num"><b>${m2(c.monthlyEq)}万/月</b></td>
      <td class="num">+${m2(c.premiumOverListed)}万/月</td><td class="num">${c.renewals}回</td><td class="num">${m1(c.total)}万</td></tr>`).join("")}
  </table>`;
}

export function renderRentProperty(res, rental, { asOf, model }) {
  const url = safeUrl(rental.source_url);
  const hz = rental.hazard_check?.official ?? {};
  const e2 = res.at2y;
  const b = res.benchmark;

  const hazardBlock = (hz.hits ?? []).length ? `
    <div class="panel">
      <h2>ハザード ── 事実の記録(掲載条件では除外していない)</h2>
      <div class="logic-body">
        <p class="why">2026-08-18の方針で、賃貸台帳は<b>ハザードマップ内も対象に含めます</b>。除外はしませんが、該当内容は必ず記録します。判定はしません。</p>
        <table class="list">
          <tr><th>項目</th><th>値</th></tr>
          <tr><td>照合した点</td><td>${esc(hz.query ?? "—")}(${esc(hz.point ?? "—")})</td></tr>
          <tr><td>標高</td><td class="num">${hz.elevation_m ?? "—"} m</td></tr>
          <tr><td>洪水浸水想定(想定最大規模)</td><td>${esc(hz.flood_l2 ?? "該当なし")}</td></tr>
          <tr><td>周辺の被覆</td><td>${esc(hz.flood_coverage ?? "—")}</td></tr>
          <tr><td>該当した区域</td><td>${(hz.hits ?? []).map((h) => `<div>${/家屋倒壊/.test(h) ? `<b style="color:var(--stamp)">${esc(h)}</b>` : esc(h)}</div>`).join("")}</td></tr>
          <tr><td>購入台帳の基準なら</td><td>${hz.reference_verdict === "block" ? "掲載条件外(=買う台帳には載せない水準)" : esc(hz.reference_verdict ?? "—")}</td></tr>
        </table>
        ${(hz.hits ?? []).some((h) => /家屋倒壊/.test(h)) ? `<div class="note" style="margin-top:8px"><b>「家屋倒壊等氾濫想定区域(氾濫流)」は浸水とは別の区分です。</b>水に浸かるだけでなく、流れの力で建物自体が倒壊しうるとされる範囲を指します。台帳の他の物件には出ていない区分なので、同じ「浸水想定内」として並べずに区別してください。</div>` : ""}
        <div class="note">${esc(hz.limit ?? "")}</div>
      </div>
    </div>` : `
    <div class="panel">
      <h2>ハザード</h2>
      <div class="logic-body"><p class="why">公式マップ(国土地理院タイル)の丁目代表点では該当なし。標高${hz.elevation_m ?? "—"}m。${esc(hz.limit ?? "")}</p></div>
    </div>`;

  const finePrint = (rental.fine_print ?? []).length ? `
    <div class="panel">
      <h2>掲載の自由文に埋まっていた条件</h2>
      <div class="logic-body">
        <p class="why">敷金・礼金の欄には出ないが、備考やアピールポイントにだけ書かれている条件です。<b>金額が読めるものは実質月額に入れてあります</b>。</p>
        <ul class="notes">${rental.fine_print.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      </div>
    </div>` : "";

  const contractBlock = rental.terms?.contract_type === "futsu"
    ? `<tr><td>契約種別</td><td>普通借家 ${rental.terms.contract_years ?? ""}年<div class="note">更新の拒絶には貸主側の正当事由が要る=住み続ける前提が立つ</div></td></tr>`
    : rental.terms?.contract_type === "teiki"
    ? `<tr><td>契約種別</td><td><b style="color:var(--stamp)">定期借家</b><div class="note">期間満了で終了。KO条件に該当する</div></td></tr>`
    : `<tr><td>契約種別</td><td><b style="color:var(--warn)">掲載に記載なし</b><div class="note">普通借家か定期借家か判別できない。<b>定期借家ならKO</b>なので、問い合わせで確定させるまでこの物件の評価は仮のもの</div></td></tr>`;

  const body = `
  <div class="panel">
    <h2>${esc(rental.location?.address ?? res.id)} ${esc(rental.layout ?? "")}</h2>
    <div class="logic-body">
      <table class="list">
        <tr><th>項目</th><th>内容</th></tr>
        <tr><td>表示 賃料+管理費</td><td class="num"><b>${m1(res.listed.total_man)}万</b>(賃料${m1(res.listed.rent_man)}万 + 管理費${m1(res.listed.kanri_man)}万)</td></tr>
        <tr><td><b>実質月額(2年住む場合)</b></td><td class="num"><b>${m2(e2.monthlyEq)}万/月</b> ── 表示より <b>+${m2(e2.premiumOverListed)}万/月</b></td></tr>
        <tr><td>実質月額(4年住む場合)</td><td class="num">${m2(res.at4y.monthlyEq)}万/月(+${m2(res.at4y.premiumOverListed)})</td></tr>
        <tr><td>入居時に用意する現金</td><td class="num">${m1(e2.cashAtStart)}万<div class="note">敷金・礼金・仲介手数料・保証料・保険・鍵交換・初期付帯・前家賃の合計</div></td></tr>
        <tr><td>専有面積 / 間取り</td><td>${rental.building?.floor_m2 ?? "—"}m² / ${esc(rental.layout ?? "—")}${rental.madori_detail ? `<div class="note">${esc(rental.madori_detail)}</div>` : ""}</td></tr>
        <tr><td>築年月 / 構造</td><td>${rental.building?.built_year ?? "—"}年${rental.building?.built_month ?? ""}月(築${res.age_y ?? "—"}年) / ${esc(rental.building?.structure ?? "—")}<div class="note">新耐震(1982年以降竣工)</div></td></tr>
        <tr><td>駅徒歩</td><td>${(rental.station?.lines ?? []).map((l) => `<div>${esc(l.line)} ${esc(l.station)} 徒歩${l.walk_min}分</div>`).join("")}</td></tr>
        ${contractBlock}
        <tr><td>トイレ2個</td><td>${rental.facilities?.toilet2 === true
          ? `<span class="hz ok">掲載の設備欄に「トイレ2ヶ所」の記載あり</span>`
          : `<span class="hz">掲載に記載なし</span><div class="note">SUUMOの設備欄は任意記載。<b>記載が無いだけで、2個でないとは限りません</b>。内見で確認してください</div>`}</td></tr>
        <tr><td>駐車場</td><td>${esc(rental.facilities?.parking ?? rental.facilities?.parking_raw ?? "掲載に記載なし")}${rental.facilities?.parking_raw ? `<div class="note">掲載の原文をそのまま保持(距離と金額の切れ目が掲載側で潰れており読めないため)</div>` : ""}</td></tr>
        <tr><td>出典</td><td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(rental.source ?? url)}</a>` : esc(rental.source ?? "—")}<div class="note">取得 ${fmtDate(rental.captured_at)}</div></td></tr>
        ${(rental.duplicate_of ?? []).length ? `<tr><td>同一物件の別掲載</td><td>${rental.duplicate_of.map((d) => esc(d)).join(" / ")}<div class="note">賃料・専有面積・築年月・間取り詳細が完全一致するため同一物件として名寄せ済み</div></td></tr>` : ""}
      </table>
    </div>
  </div>

  <div class="panel">
    <h2>実質月額の解剖 ── ${e2.years}年住む場合</h2>
    <div class="logic-body">
      <p class="why">表示賃料 ${m1(res.listed.total_man)}万が、なぜ実質 ${m2(e2.monthlyEq)}万/月 になるのか。${e2.years}年(${e2.months}ヶ月)の総支払を費目別に分解したのが下の帯です。</p>
      ${breakdownBar(e2)}
      <div class="note" style="margin-top:8px"><b>敷金${rental.terms?.shiki_months ?? 0}ヶ月はこの合計に入れていません</b>(原則として退去時に返還されるため)。ただし入居時には現金が要るので「入居時に用意する現金」には含めています。退去時の原状回復は借主負担なので合計に入れています。</div>
    </div>
  </div>

  <div class="panel">
    <h2>住む年数で実質月額はどう動くか</h2>
    <div class="logic-body">
      <p class="why">一時金は住む年数で割るので、長く住むほど月額は下がります。逆に短期で出ると跳ね上がります。更新料は${rental.terms?.contract_years ?? 2}年ごとに乗ります。</p>
      ${curveTable(res.curve)}
    </div>
  </div>

  <div class="panel">
    <h2>募集賃料の分布の中での位置</h2>
    <div class="logic-body">
      ${b ? `<p class="why">北区の戸建賃貸${model?.n ?? "—"}件から作った募集賃料モデルでは、この条件(専有${rental.building?.floor_m2}m²・築${res.age_y}年・徒歩${rental.station?.walk_min}分)のものさしは <b>${m1(b.mid)}万</b>、同じ条件の物件が現に散っている幅は <b>${m1(b.lo)}〜${m1(b.hi)}万</b> です。実測は ${m1(res.listed.total_man)}万で、ものさし比 <b>${(res.ratio * 100).toFixed(0)}%</b>。</p>
      <ul class="notes">
        ${res.listed.total_man >= b.lo && res.listed.total_man <= b.hi ? `<li>この値は<b>散らばりの幅の中</b>にあります。つまりこの標本では「割安・割高」を言えません。</li>` : `<li>この値は同条件の散らばりの幅(${m1(b.lo)}〜${m1(b.hi)}万)の<b>外</b>にあります。ただし標本は${model?.n ?? "—"}件と小さく、母集団は成約ではなく募集です。</li>`}
        <li><b>母集団は募集賃料であって成約ではありません。</b>「その額で決まった」ことは示せません。</li>
      </ul>
      <div class="note" style="margin-top:8px">モデルの作り方と限界は <a href="../rent-basis.html">募集賃料モデルの根拠</a> を参照。</div>`
      : `<p class="why">専有面積が取れないためものさしを出していません。</p>`}
    </div>
  </div>

  ${hazardBlock}
  ${finePrint}

  <div class="panel">
    <h2>この評価で使った仮定</h2>
    <div class="logic-body">
      ${res.assumed.length
        ? `<p class="why">掲載に金額が書かれておらず、既定値を当てた費目です。申込時の見積りが出たらYAMLの実額に置き換えてください。</p>
           <ul class="notes">${res.assumed.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`
        : `<p class="why">主要な費目はすべて掲載の実額を使っています。</p>`}
      <div class="note" style="margin-top:8px">確認待ちの項目: ${Object.entries(rental.checklist ?? {}).filter(([, v]) => !v).map(([k]) => esc(k)).join(" / ") || "なし"}</div>
    </div>
  </div>

  <div class="note"><a href="../rent.html">← 戸建賃貸台帳の一覧へ</a></div>
  `;

  return layout({
    title: `${rental.location?.address ?? res.id} ${rental.layout ?? ""} ── 戸建賃貸`,
    subtitle: "RENTAL / EFFECTIVE MONTHLY COST",
    docNo: `${esc(res.id)}<br>${asOf}`,
    body,
  });
}
