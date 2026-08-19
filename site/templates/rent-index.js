// site/templates/rent-index.js — 戸建賃貸台帳の一覧ページ。
// 購入台帳(index.html)と同じ思想で作る:
//   ① 判定(借りる/見送り)は出さない。出すのは「表示賃料がいくらで、実質いくらになるか」まで
//   ② 落とした件数と理由を必ず開示する(探索の漏斗)
//   ③ 掲載から読めなかった項目は仮定であることを名指しで書く
//
// **本文の数字はビルド時計算で埋める**。2026-08-19の監査で、母集団66件・徒歩21件・間取り10件・
// 24.5万といった実測値が本文に手書きで残っており、プールを作り直すと同じページの中で
// 矛盾した数字が並ぶことが分かった。以後、実数は funnel / model / results から生成すること。
import { layout, esc, safeUrl, fmtDate, PALETTE } from "./layout.js";

// 検討状況(判断)と内見(事実)。YAMLのキーと画面の表示を1対1に対応させる
export const RENT_STATUS_LABEL = { new: "新規", considering: "検討中", applying: "申込検討", declined: "見送り" };
export const RENT_VIEW_LABEL = { none: "未", wanted: "内見希望", done: "内見済" };
const RENT_STATUS_CHOICES = Object.values(RENT_STATUS_LABEL);
const RENT_VIEW_CHOICES = Object.values(RENT_VIEW_LABEL);
const LS_KEY = "fudosan-rent-ledger-v1";

const yen = (man) => (Number.isFinite(man) ? `${(Math.round(man * 100) / 100).toLocaleString("ja-JP")}万` : "—");
const m1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "—");
const intOf = (v) => (Number.isFinite(v) ? v : null);

// ---- 実質月額カーブ(居住年数1〜10年) ----
// 縦軸は「実質月額(万円/月)」。一時金は住む年数で薄まるので**右肩下がりの曲線**になる。
// 表示賃料は水平線として重ね、両者の隙間が「掲載に出ていない負担」の大きさになる
function curveSvg(rows) {
  // 縦軸ラベルは rotate(-90) で置かない。回転前の bbox が枠外へ出るため
  // tests/ui/cliff.svg.mjs の見切れ検査に落ちる(運用ルール5)。軸名はグラフ上部へ水平に置く
  const W = 900, ML = 62, MR = 208, MT = 36, MB = 46;
  // 凡例は1物件40pxを使う。行数で高さを可変にしないと台帳が増えたとき凡例が枠外へ出る
  const ph = Math.max(318, rows.length * 40 + 24);
  const H = MT + MB + ph;
  const pw = W - ML - MR;
  // 賃料が読めない物件は線を描かない(null を 0 に潰すと y軸に負の目盛が出る)
  const vals = rows.flatMap((r) => [r.res.listed.total_man, ...r.res.curve.map((c) => c.monthlyEq)])
    .filter(Number.isFinite);
  const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
  const span = hi - lo || 1;
  const x = (y) => ML + ((y - 1) / 9) * pw;
  const y = (v) => MT + ph - ((v - lo) / span) * ph;

  const ticks = [];
  for (let v = Math.ceil(lo); v <= hi; v++) {
    if (span > 12 && v % 2 !== 0) continue;
    ticks.push(`<line x1="${ML}" y1="${y(v).toFixed(1)}" x2="${ML + pw}" y2="${y(v).toFixed(1)}" stroke="#DCE3EA"/>
      <text x="${ML - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#43566B">${v}</text>`);
  }
  const xticks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((yy) =>
    `<text x="${x(yy).toFixed(1)}" y="${MT + ph + 18}" text-anchor="middle" font-size="10" fill="#43566B">${yy}</text>`).join("");

  const lines = rows.map((r, i) => {
    const c = PALETTE[i % PALETTE.length];
    const pts = r.res.curve.filter((p) => Number.isFinite(p.monthlyEq));
    if (!pts.length) return "";
    const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.years).toFixed(1)},${y(p.monthlyEq).toFixed(1)}`).join("");
    const listed = r.res.listed.total_man;
    const base = Number.isFinite(listed)
      ? `<line x1="${ML}" y1="${y(listed).toFixed(1)}" x2="${ML + pw}" y2="${y(listed).toFixed(1)}" stroke="${c}" stroke-width="1" stroke-dasharray="2 4" opacity=".55"/>` : "";
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="2"/>${base}`;
  }).join("");

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
    <td class="num fn-n">${s.n}件</td>
    <td class="num">${i === 0 ? "—" : `−${s.dropped}`}</td>
  </tr>`).join("");
  return `<table class="list" id="rentfunnel">
    <tr><th>段</th><th>条件</th><th>残り</th><th>落ちた数</th></tr>${rows}
  </table>`;
}

export function renderRentIndex(results, { asOf, funnel, model, poolCapturedAt, hasBasisPage = true }) {
  const rows = results.map(({ res, rental }, i) => ({
    res, rental, i,
    short: `${rental.location?.district ?? ""}${rental.location?.chome ?? ""} ${rental.layout ?? ""}`,
  }));
  // 本文で使う実数はここで1回だけ計算する(手書きしない)
  const ratios = rows.map((r) => r.res.ratio).filter(Number.isFinite);
  const ratioLo = ratios.length ? Math.round(Math.min(...ratios) * 100) : null;
  const ratioHi = ratios.length ? Math.round(Math.max(...ratios) * 100) : null;
  const walkStep = funnel.steps.findIndex((s) => /徒歩/.test(s.label));
  const roomStep = funnel.steps.findIndex((s) => /居室/.test(s.label));
  const ldkStep = funnel.steps.findIndex((s) => /LDK/.test(s.label));
  const walkN = walkStep >= 0 ? funnel.steps[walkStep].n : null;
  const roomDropped = roomStep >= 0 ? funnel.steps[roomStep].dropped : null;
  const ldkDropped = ldkStep >= 0 ? funnel.steps[ldkStep].dropped : null;
  // **どの条件が一番落とすかは母集団が変わると入れ替わる**。2026-08-19の名寄せで
  // 「間取りが最多」から「賃料が最多」へ実際に反転したので、本文に手書きせず毎回ここで決める
  const condSteps = funnel.steps.filter((s, i) => i > 0 && !/読み取り不能/.test(s.label));
  const topStep = condSteps.reduce((a2, b2) => (b2.dropped > a2.dropped ? b2 : a2), condSteps[0] ?? { dropped: 0, label: "" });
  const topName = /賃料/.test(topStep.label) ? "賃料の帯" : /徒歩/.test(topStep.label) ? "駅からの距離"
    : /居室|LDK/.test(topStep.label) ? "間取り" : /耐震/.test(topStep.label) ? "新耐震" : "契約種別";
  const lastStep = funnel.steps[funnel.steps.length - 1];
  const teikiStep = funnel.steps.find((s) => /定期借家/.test(s.label));

  const tableRows = rows.map(({ res, rental, i }) => {
    const url = safeUrl(rental.source_url);
    const c = PALETTE[i % PALETTE.length];
    const hz = rental.hazard_check?.official ?? {};
    const hits = hz.hits ?? [];
    const hazardCell = hits.length
      ? `<span class="hz">浸水${esc(hz.flood_l2 ?? "該当")}</span><div class="note" style="margin-top:2px">標高${esc(hz.elevation_m ?? "—")}m${hits.some((h) => /家屋倒壊/.test(h)) ? "・<b>家屋倒壊等氾濫想定(氾濫流)</b>" : ""}</div>`
      : `<span class="hz ok">該当なし</span><div class="note" style="margin-top:2px">標高${esc(hz.elevation_m ?? "—")}m</div>`;
    const ct = rental.terms?.contract_type;
    // 契約年数は YAML 由来なので数値とは限らない。非数値ならクラッシュさせず「要確認」に落とす
    const cy = intOf(Number(rental.terms?.contract_years));
    const contractCell = ct === "futsu" ? `<span class="nw">普通借家${cy ?? ""}年</span>`
      : ct === "teiki" ? `<span class="nw">定期借家${cy ?? "?"}年</span><div class="note" style="margin-top:2px">満了で終了</div>`
      : `<b class="nw" style="color:var(--warn)">記載なし</b><div class="note" style="margin-top:2px">要確認</div>`;
    const t2 = rental.facilities?.toilet2 === true
      ? `<span class="hz ok">記載あり</span>` : `<span class="hz">記載なし</span>`;
    // ペット(2026-08-19ユーザー要望「猫を飼っている」)。掲載の記載を4値でそのまま出す。
    // **「記載なし」を「不可」と読ませない**——SUUMOの入居条件欄・設備欄は任意記載で、
    // 相談可の明記があるのは台帳7件のうち2件しかない。絞り込みチップで人が切り替える
    const petSt = rental.facilities?.pet ?? null;
    const petFee = rental.terms?.pet_monthly_man ?? null;
    const petShiki = rental.terms?.pet_shiki_months ?? null;
    const petExtra = [petFee ? `+${m1(petFee)}万/月` : null, petShiki ? `敷金+${petShiki}ヶ月` : null]
      .filter(Boolean).join("・");
    const petCell = petSt === "ok" ? `<span class="hz ok">相談可</span>${petExtra ? `<div class="note" style="margin-top:2px">${esc(petExtra)}</div>` : ""}`
      : petSt === "cond" ? `<span class="hz warnhz">条件付き</span><div class="note" style="margin-top:2px">${esc(petExtra || "要確認")}</div>`
      : petSt === "ng" ? `<b class="nw" style="color:var(--warn)">不可</b>`
      : `<span class="hz">記載なし</span><div class="note" style="margin-top:2px">要確認</div>`;
    const ratio = Number.isFinite(res.ratio) ? `${(res.ratio * 100).toFixed(0)}%` : "—";
    const label = `${rental.location?.district ?? ""}${rental.location?.chome ? rental.location.chome + "丁目" : ""}` || res.id;
    const st = RENT_STATUS_LABEL[rental.status] ?? RENT_STATUS_LABEL.new;
    const vw = RENT_VIEW_LABEL[rental.viewing] ?? RENT_VIEW_LABEL.none;
    const opt = (choices, cur) => choices.map((s) => `<option${s === cur ? " selected" : ""}>${esc(s)}</option>`).join("");
    return `<tr class="prow" data-id="${esc(res.id)}" data-yaml-status="${esc(st)}" data-yaml-viewing="${esc(vw)}" data-status="${esc(st)}" data-viewing="${esc(vw)}" data-pet="${esc(petSt ?? "none")}">
      <td><span class="swatch" style="background:${c}"></span>
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label)}
        <span class="unsync">未同期</span>
        <div class="note" style="margin-top:2px">${esc(rental.layout ?? "")} ${esc(rental.building?.floor_m2 ?? "—")}m² / ${esc(rental.building?.structure ?? "")} / 台帳登録${esc(fmtDate(rental.captured_at))}</div>
        <div class="note"><a href="rent/${esc(res.id)}.html">この物件の内訳 →</a></div></td>
      <td class="num">${yen(res.listed.total_man)}${res.listed.kanri_man > 0 ? `<div class="note">賃料${yen(res.listed.rent_man)}+管理${yen(res.listed.kanri_man)}</div>` : ""}</td>
      <td class="num"><b>${m1(res.at2y.monthlyEq)}万</b><div class="note">+${m1(res.at2y.premiumOverListed)}万/月</div></td>
      <td class="num">${m1(res.at4y.monthlyEq)}万<div class="note">+${m1(res.at4y.premiumOverListed)}万/月${
        // 定期借家は契約期間で終わるので4年の列は再契約前提。実際の想定である満了時点を必ず添える
        ct === "teiki" && cy && res.curve[cy - 1] ? `<br><b>${cy}年満了時 ${m1(res.curve[cy - 1].monthlyEq)}万</b>` : ""}</div></td>
      <td class="num">${m1(res.at2y.cashAtStart)}万</td>
      <td class="num">${ratio}<div class="note">基準${res.benchmark ? m1(res.benchmark.mid) + "万" : "—"}</div></td>
      <td class="num">築${esc(rental.building?.built_year ?? "—")}<div class="note">${res.age_y != null ? res.age_y + "年" : ""}</div></td>
      <td class="num">${esc(rental.station?.walk_min ?? "—")}分<div class="note">京浜${esc(rental.station?.keihin_walk_min ?? "—")}分</div></td>
      <td>${contractCell}</td>
      <td>${t2}</td>
      <td>${petCell}</td>
      <td>${hazardCell}</td>
      <td><select class="stsel">${opt(RENT_STATUS_CHOICES, st)}</select></td>
      <td><select class="vwsel">${opt(RENT_VIEW_CHOICES, vw)}</select></td>
      <td class="memocell"><textarea class="memota" placeholder="メモ(この端末のブラウザにのみ保存)"></textarea></td>
    </tr>`;
  }).join("");

  const walkTerm = model?.terms?.find((t) => t.key === "walk");
  const ageTerm = model?.terms?.find((t) => t.key === "age");
  const areaTerm = model?.terms?.find((t) => t.key === "area");
  const ci = (t) => (t?.ci ? `${t.ci.lo.toFixed(2)}〜${t.ci.hi.toFixed(2)}` : "—");
  const ciPct = (t) => (t?.ci_pct ? `${t.ci_pct.lo.toFixed(2)}〜${t.ci_pct.hi.toFixed(2)}%` : "—");
  const basisLink = hasBasisPage ? ` モデルの作り方・係数の信頼区間・散布図は <a href="rent-basis.html">募集賃料モデルの根拠</a> に分けて書いてあります。` : "";

  const body = `
  <div class="panel">
    <div class="cond-banner"><b>台帳掲載の条件</b>: 賃料+管理費 ${funnel.cfg?.total_min_man ?? 15}〜${funnel.cfg?.total_max_man ?? 25}万円 / 最寄り駅 徒歩${funnel.cfg?.walk_max ?? 10}分以内(路線は問わない) / ${funnel.cfg?.rooms_min ?? 3}LDK以上(納戸Sは1室として数える) / 新耐震(1982年以降竣工) / 一戸建て(テラス・タウンハウスは対象外) / <b>普通借家、または定期借家${(funnel.teikiOkYears ?? [3]).join("・")}年ちょうど</b>(定期借家の2年・4年以上はKO) ── 東京都北区の戸建賃貸をSUUMOから日次クロールして収集。<b>ハザードマップ内も対象に含める</b>(2026-08-18の方針。ただし該当内容は必ず事実として記録する)。駐車場・トイレ2個は条件にしない(下記)。</div>
    <div class="cond-banner" style="border-color:var(--ink-soft);background:#FBFAF8"><b>この台帳は「借りる/見送り」の判定を出しません</b>: 出すのは①表示賃料に対して実際にいくら払うことになるか(実質月額)②募集賃料の分布の中でどこに立つか、という事実までです。判断は人が行います(購入台帳 v3.0.0 と同じ思想)。</div>
    <div class="note" style="margin:0 0 10px">購入台帳は <a href="index.html">中古戸建の査定台帳</a>。持ち家と賃貸で「お金では見えない手間」がどう違うかは <a href="effort.html">手間の解剖</a>、何年住むと総コストがどうなるかは <a href="simulate.html">保有年数シミュレーター</a> が扱っています。${basisLink}</div>
  </div>

  <div class="panel">
    <h2>実質月額 ── 表示賃料は「払う額」ではない</h2>
    <div class="logic-body">
      <p class="why">賃貸で実際に出ていくのは毎月の賃料だけではありません。礼金・仲介手数料・保証料・火災保険・鍵交換といった<b>一時金</b>と、2年ごとの<b>更新料</b>、退去時の<b>原状回復</b>が乗ります。これらを住む年数で割って月額に均したのが下の曲線です。一時金は年数で薄まるので<b>右肩下がり</b>になり、点線(表示賃料+管理費)との隙間が「掲載の賃料欄に出ていない負担」です。</p>
      <div style="overflow-x:auto">${curveSvg(rows)}</div>
      <div class="note" style="margin-top:8px"><b>定期借家の物件は契約期間を超えた部分が再契約前提の参考値です</b>(この台帳では定期借家${(funnel.teikiOkYears ?? [3]).join("・")}年を許容しているので、該当物件はその年で満了します)。一覧の実質月額(4年)欄に満了時点の値を併記しました。</div>
      <div class="note">実線=実質月額 / 点線=表示賃料+管理費(同じ色が同じ物件)。<b>敷金は総額に入れていません</b>(原則返還されるため)。ただし入居時に用意する現金には含めています(一覧の「入居時現金」欄)。退去時の原状回復と、敷金のうち返らない敷引・償却は借主負担なので総額に入れています。</div>
      <div class="note"><b>曲線がところどころで上向きに折れているのは誤りではありません。</b>2年ごとの更新料が新たに乗る年(7年目・9年目など)は、一時金が薄まる効果よりも更新料の追加が勝つため、実質月額が一度上がります。<b>「あと1年住むと得か」は年によって答えが違う</b>ということで、更新の直前に出るか直後に出るかで負担が変わります。</div>
    </div>
  </div>

  <div class="panel">
    <h2>台帳 ── ${rows.length}件</h2>
    <div class="syncbar">
      <button type="button" class="syncbtn" id="rent-export">検討状況を書き出す(JSON)</button>
      <button type="button" class="syncbtn" id="rent-import">読み込む</button>
      <button type="button" class="syncbtn" id="rent-reset">この端末の保存を消す</button>
      <span class="note" style="margin:0" id="ls-info"></span>
    </div>
    <div class="syncpanel" id="rent-panel" style="display:none">
      <div id="rent-panel-msg"></div>
      <textarea id="rent-json" spellcheck="false"></textarea>
    </div>
    <div style="overflow-x:auto">
    <div class="rentchips" id="petchips">
      <span class="note" style="margin:0">ペットで絞る:</span>
      <button type="button" class="chip on" data-pet="all">すべて</button>
      <button type="button" class="chip" data-pet="ok">相談可の明記のみ</button>
      <button type="button" class="chip" data-pet="okcond">相談可+条件付き</button>
      <span class="note" style="margin:0" id="petinfo"></span>
    </div>
    <table class="list" id="rentlist">
      <tr>
        <th>物件</th><th class="wrapth">表示<br>賃料+管理費</th><th class="wrapth">実質月額<br>(2年)</th><th class="wrapth">実質月額<br>(4年)</th>
        <th class="wrapth">入居時<br>現金</th><th class="wrapth">ものさし比</th><th>築年</th><th class="wrapth">徒歩</th>
        <th>契約</th><th class="wrapth">トイレ2個</th><th class="wrapth">ペット</th><th>ハザード</th><th>検討状況</th><th>内見</th><th class="memocol">メモ</th>
      </tr>
      ${tableRows}
    </table>
    </div>
    <div class="note" style="margin-top:10px"><b>「トイレ2個」の欄が「記載なし」でも、トイレが1つとは限りません。</b> SUUMOの設備欄は任意記載で、母集団のうち「トイレ2ヶ所」の記載があるのは${funnel.toilet2Documented}件しかありません。条件に加えると候補が${funnel.withToilet2}件まで落ちるため、<b>掲載条件には入れず事実欄として持ち</b>、内見・問い合わせで確認する運用にしています。</div>
    <div class="note" style="margin-top:10px"><b>ペットは「不可の明記」だけを掲載条件で落としています</b>(母集団${funnel.poolN}物件のうち${funnel.pet.inPool.ng}物件)。<b>「記載なし」は落としていません</b> ── 入居条件欄も設備欄も任意記載で、書いていないことは不可を意味しないためです。実測すると母集団で相談可の明記があるのは${funnel.pet.inPool.ok}物件・記載なしが${funnel.pet.inPool.none}物件で、<b>台帳${rows.length}件のうち相談可の明記があるのは${funnel.pet.inSurvivors.ok}件、条件付きが${funnel.pet.inSurvivors.cond}件、残る${funnel.pet.inSurvivors.none}件は記載なし</b>です。記載なしまで掲載条件にすると台帳は${funnel.pet.inSurvivors.ok + funnel.pet.inSurvivors.cond}件まで落ちるので、<b>条件にはせず上の絞り込みで切り替える</b>形にしました。<b>「ペット相談」＝猫可とは限りません</b>(小型犬のみを指す掲載があります)。母集団で猫が明記されているのは${funnel.pet.catDocumented}物件だけなので、<b>種別と頭数は必ず問い合わせで確認してください</b>。</div>
    <div class="note"><b>検討状況・内見・メモはこの端末のブラウザ(localStorage)にのみ保存されます。</b>公開リポジトリには書き込みません。台帳YAMLの値が初期値で、この端末の値と食い違う行には「未同期」印が出ます。<b>YAMLへ反映してよいのは検討状況と内見だけで、メモは反映しません。</b></div>
  </div>

  <div class="panel">
    <h2>探索の漏斗 ── 何件を、どの条件で落としたか</h2>
    <div class="logic-body">
      <p class="why">母集団はSUUMOに出ている東京都北区の戸建賃貸${funnel.poolN}件(取得 ${esc(poolCapturedAt ?? asOf)})です。<b>同一物件が複数の店舗から掲載されるため、掲載ではなく物件の数に名寄せしてあります</b>。条件を1つずつ掛けると次のように減ります。<b>黙って減らさない</b>ため、各段で落ちた数を出しています。</p>
      ${funnelTable(funnel)}
      ${roomDropped != null && walkN != null ? `<div class="note" style="margin-top:10px">最も多く落とすのは<b>${topName}</b>で、この段だけで${topStep.dropped}物件が外れます。次が間取りで、賃料と徒歩を通った${walkN}物件のうち${roomDropped + (ldkDropped ?? 0)}物件が${funnel.cfg?.rooms_min ?? 3}LDK以上に届きません(${roomDropped}物件が居室${funnel.cfg?.rooms_min ?? 3}室未満・${ldkDropped ?? 0}物件がDK/Kのみ)。北区の戸建賃貸は築古の狭い2K〜2DKが厚く、${funnel.cfg?.rooms_min ?? 3}LDK以上で新耐震という帯は薄いという構造になっています。</div>` : ""}
      <div class="note"><b>定期借家は「${(funnel.teikiOkYears ?? [3]).join("・")}年ちょうど」だけ許容しています</b>(子供の小学校入学前に区切りをつけるため)。短いからKOではなく<b>長さの要件</b>なので、2年も4年以上も同じように外れます。母集団${funnel.poolN}件のうち定期借家は${funnel.teikiInPool}件あり例外ではありませんが、ここまで残った物件のうち定期借家は${funnel.teikiAllowed}件で、<b>いずれもちょうど${(funnel.teikiOkYears ?? [3]).join("・")}年</b>でした——この条件で落ちた物件は${teikiStep ? teikiStep.dropped : 0}件です。</div>
      <div class="note">漏斗の最終段は<b>${lastStep.n}物件</b>で、台帳は<b>${rows.length}件</b>です。${lastStep.n === rows.length ? "差はありません。" : `差の${lastStep.n - rows.length}件は、掲載を物件へ名寄せした後もなお登録していないもので、物件ページの「同一物件の別掲載」欄で内訳を確認できます。`}</div>
    </div>
  </div>

  <div class="panel">
    <h2>相場のものさし ── 何が言えて、何が言えないか</h2>
    <div class="logic-body">
      ${model ? `<p class="why">「ものさし比」は、北区の戸建賃貸${model.n}件から作った<b>募集賃料モデル</b>に対する比です。100%なら分布のまん中と同じ水準です。ただしこのモデルには重い前提があります。</p>
      <ul class="notes">
        <li><b>母集団は成約ではなく募集です。</b>賃貸の成約賃料は公開されていません。「その値段で決まった」ことは示せず、示せるのは「貸主の希望の分布の中での位置」だけです。購入台帳が成約データを使えているのとは決定的に違います。</li>
        <li><b>母集団はSUUMO単独です。</b>2026-08-19の実測で、athomeにのみ出ている北区の賃貸一戸建てが8〜10件あり、一戸建ての和集合に対するSUUMOの被覆は約85%でした。逆にSUUMOにしか無い掲載もあるため、どちらも他方の上位集合ではありません。</li>
        <li><b>同じ条件でも±${model.spreadPct.toFixed(0)}%散ります</b>(残差)。この幅の中に収まる差は、この標本では水準の違いとして読めません。一覧の「ものさし比」が${ratioLo ?? "—"}%と${ratioHi ?? "—"}%でも、その差は誤差の内側です。</li>
        ${areaTerm ? `<li><b>面積は比例しません。</b>弾力性は${areaTerm.est.toFixed(2)}(95%CI ${ci(areaTerm)})で、1.00を含みません。広い家ほどm²単価は安くなります。</li>` : ""}
        ${ageTerm ? `<li><b>築年は効きます。</b>1年あたり${ageTerm.est_pct.toFixed(2)}%(95%CI ${ciPct(ageTerm)})で、区間が0を跨ぎません。</li>` : ""}
        ${walkTerm ? `<li><b>徒歩分は判別できません。</b>推定は${walkTerm.est_pct.toFixed(2)}%/分(95%CI ${ciPct(walkTerm)})で、<b>符号すら定まらず、点推定は「遠いほど高い」という向き</b>になっています。駅から遠い戸建ほど広い・新しいという交絡が疑われます。<b>この係数を根拠に「駅から遠いから割安」と読まないでください。</b></li>` : ""}
      </ul>` : `<p class="why">募集賃料モデルを推定できていないため、ものさし比は出していません(標本が足りないか、プールのデータが読めていません)。</p>`}
      <div class="note" style="margin-top:8px">${hasBasisPage ? `モデルの作り方・係数の信頼区間・散布図は <a href="rent-basis.html">募集賃料モデルの根拠</a> に分けて書いてあります。` : "モデルが立たないため根拠ページは生成していません。"}</div>
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
        <tr><td>火災保険</td><td class="num">2万円/2年</td><td>掲載が「要」だけで金額が無い場合。更新周期は物件ごとの記載に従う</td></tr>
        <tr><td>鍵交換</td><td class="num">2.2万円</td><td>掲載の「ほか初期費用」に実額があればそちらを使う</td></tr>
        <tr><td>更新料</td><td class="num">賃料1ヶ月/2年</td><td>2年ちょうどで退去すれば更新は起きない。定期借家は0</td></tr>
        <tr><td>退去時の原状回復</td><td class="num">賃料1ヶ月</td><td>定額クリーニングの記載があればそちらを優先</td></tr>
      </table>
      <div class="note" style="margin-top:8px"><b>掲載の「ほか初期費用」「ほか諸費用」や備考に埋まっている付帯費用は人が書き写します。</b>原文は機械で拾いますが、万円への換算は人が行います(自由文なので誤読の害が大きい)。実例: 西ケ原4は消火剤7.1万・消毒3.7万・入居者サポート2.2万で初期13万円、赤羽3は鍵交換3.08万を含む初期9.09万に加えて月額サポート費が乗ります。</div>
    </div>
  </div>

  <script>
  (function(){
    var KEY=${JSON.stringify(LS_KEY)};
    function load(){ try { return JSON.parse(localStorage.getItem(KEY)||"{}"); } catch(e){ return {}; } }
    function save(d){ try { localStorage.setItem(KEY, JSON.stringify(d)); } catch(e){} }
    var data=load();
    var rows=document.querySelectorAll("#rentlist tr.prow");
    function sync(tr){
      var st=tr.querySelector(".stsel"), vw=tr.querySelector(".vwsel");
      tr.setAttribute("data-status", st.value);
      tr.setAttribute("data-viewing", vw.value);
      var dirty = st.value !== tr.getAttribute("data-yaml-status") || vw.value !== tr.getAttribute("data-yaml-viewing");
      tr.classList.toggle("dirty", dirty);
    }
    rows.forEach(function(tr){
      var id=tr.getAttribute("data-id");
      var st=tr.querySelector(".stsel"), vw=tr.querySelector(".vwsel"), me=tr.querySelector(".memota");
      var rec=data[id]||{};
      if(rec.status) st.value=rec.status;
      if(rec.viewing) vw.value=rec.viewing;
      if(rec.memo) me.value=rec.memo;
      sync(tr);
      function persist(){
        data[id]={status:st.value, viewing:vw.value, memo:me.value};
        sync(tr); save(data);
      }
      st.addEventListener("change",persist);
      vw.addEventListener("change",persist);
      me.addEventListener("input",persist);
    });
    var info=document.getElementById("ls-info");
    function refreshInfo(){
      var dirty=document.querySelectorAll("#rentlist tr.prow.dirty").length;
      info.textContent="この端末に保存中("+rows.length+"件"+(dirty?" / 台帳YAMLと未同期 "+dirty+"件":"")+")";
    }
    refreshInfo();
    document.addEventListener("change", refreshInfo);
    document.addEventListener("input", refreshInfo);
    var panel=document.getElementById("rent-panel"), ta=document.getElementById("rent-json"), msg=document.getElementById("rent-panel-msg");
    document.getElementById("rent-export").addEventListener("click", function(){
      // **メモは書き出さない**。公開リポジトリへ貼られる経路を作らないため(運用ルール3)
      var out={};
      rows.forEach(function(tr){
        var id=tr.getAttribute("data-id");
        out[id]={status:tr.querySelector(".stsel").value, viewing:tr.querySelector(".vwsel").value};
      });
      panel.style.display="block";
      msg.innerHTML="<b>検討状況と内見のみ</b>を書き出しました(メモは含みません)。この内容をYAMLへ反映できます。";
      ta.value=JSON.stringify(out,null,1);
      ta.select();
    });
    document.getElementById("rent-import").addEventListener("click", function(){
      if(panel.style.display==="none"){ panel.style.display="block"; msg.textContent="書き出したJSONを貼って、もう一度このボタンを押してください。"; ta.value=""; return; }
      var obj; try { obj=JSON.parse(ta.value); } catch(e){ msg.textContent="JSONとして読めませんでした。"; return; }
      var n=0;
      rows.forEach(function(tr){
        var id=tr.getAttribute("data-id"), rec=obj[id];
        if(!rec) return;
        if(rec.status) tr.querySelector(".stsel").value=rec.status;
        if(rec.viewing) tr.querySelector(".vwsel").value=rec.viewing;
        data[id]=Object.assign({}, data[id], {status:tr.querySelector(".stsel").value, viewing:tr.querySelector(".vwsel").value});
        sync(tr); n++;
      });
      save(data); refreshInfo();
      msg.textContent=n+"件を読み込みました(メモは変更していません)。";
    });
    // ペットの絞り込み。**既定は「すべて」**——掲載の記載は任意で、「記載なし=不可」ではないため
    // 既定で隠すと、問い合わせれば飼える物件が最初から見えなくなる(2026-08-19)
    var petchips=document.getElementById("petchips"), petinfo=document.getElementById("petinfo");
    function applyPet(mode){
      var shown=0, hidden=0;
      rows.forEach(function(tr){
        var v=tr.getAttribute("data-pet");
        var keep = mode==="all" ? true : mode==="ok" ? v==="ok" : (v==="ok"||v==="cond");
        tr.style.display = keep ? "" : "none";
        if(keep) shown++; else hidden++;
      });
      petinfo.textContent = mode==="all" ? "" : shown+"件を表示(記載なし・不可の"+hidden+"件を非表示)";
      refreshInfo();
    }
    petchips.addEventListener("click", function(e){
      var b=e.target.closest(".chip"); if(!b) return;
      petchips.querySelectorAll(".chip").forEach(function(x){ x.classList.toggle("on", x===b); });
      applyPet(b.getAttribute("data-pet"));
    });
    document.getElementById("rent-reset").addEventListener("click", function(){
      if(!confirm("この端末に保存した検討状況・内見・メモを消します。よろしいですか。")) return;
      try { localStorage.removeItem(KEY); } catch(e){}
      location.reload();
    });
  })();
  </script>
  `;

  return layout({
    title: "戸建賃貸台帳 ── 北区(赤羽〜田端)",
    subtitle: `RENTAL LEDGER / ${rows.length} PROPERTIES`,
    docNo: `RENT-LEDGER<br>${asOf}<br>母集団 ${funnel.poolN}物件`,
    body,
  });
}
