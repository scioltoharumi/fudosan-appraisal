// site/templates/effort.js — 手間の解剖(お金では見えない持ち家の運用)
// 2026-08-17ユーザー要望「メンテナンスの手間や契約の手間、その他考慮すべき事項を洗い出したい。
// 持ち家は契約手続きが大変だったり、何かあった時に大家ではなく全部自分で解決しないといけない。
// それがどれだけのボリュームなのか図解するページを」。
// 同日追加要望「賃貸と、新築と、中古15年の3パターンで比較した図」で、タイムライン(図1)と
// 30年合計(図5)を 賃貸/新築/中古(築15年) の3レーン比較に変更。
//
// 設計方針:
//   - simulate.html が「お金の差は小さい」を示した後に残る比較軸=手間・責任・自由を図解する。
//   - 中心思想: 持ち家の手間の正体は「大家の仕事(発注者業)を自分が引き受けること」。
//     その仕事量を ①30年タイムライン(3パターン) ②取得の山 ③故障対応チェーン ④定常運用
//     ⑤30年合計(3パターン) で見せる。
//   - 新築と中古の手間差の本体は総量ではなく時期: 新築は最初の10年が保証の傘(瑕疵担保+設備保証)で
//     静かで山が後半に寄る。中古は入口に山(取得+リフォーム発注)が集中し、1年目から発注者業が現役。
//   - 判定はしない(v3.0.0の思想)。時間・金額はすべて一般的な手続きの構成要素からの積算目安で、
//     台帳の成約データのような実測ではない。この性質はページ内に明示する(黙って盛らない)。
//   - 比較の前提は「3パターンとも同じ家に30年住み続ける」に固定する(賃貸の住み替え自由を
//     使った場合の手間は別途注記)。前提を動かすと結論が動くため、前提は図の中に書く。
import { layout, esc } from "./layout.js";

// 時間見積りの一次データ(このページの数値はすべてここから描画する。散在させない)
// 実働時間の目安 [lo, hi]。根拠はいずれも「手続きの構成要素の積算」で、本文の表に内訳を開示する
const EST = {
  own: {                   // 持ち家共通
    moveIn: [10, 20],      // 引越し(1回)
    steady: [5, 10],       // 定常運用 /年(内訳は図4の表)
    incident: [3, 6],      // 故障対応 /件(発注者チェーン)
    repair: [10, 20],      // 大規模修繕(外壁・屋根等)の発注 /回
    repairN: 2,            // 30年で2回(12年目・24年目と仮定)
    sell: [30, 60],        // 売却の山(査定・媒介・内覧対応・契約・引渡し)
  },
  patterns: {              // 買い方の2パターン(手間が変わる変数だけをここに置く)
    newBuild: {
      label: "新築を買う",
      acquire: [20, 35],   // 取得の手続き(リフォーム発注なし)
      reform: [0, 0],
      incidentN: 6,        // 保証の傘(〜10年)があるため故障の発注は11年目以降に集中
      incidentYears: [13, 16, 19, 22, 25, 28],
    },
    used15: {
      label: "中古(築15年)を買う",
      acquire: [25, 45],   // 取得の手続き(現況確認・契約不適合の交渉が厚い)
      reform: [8, 20],     // 入口リフォームの相見積・発注
      incidentN: 10,       // 設備が寿命帯に入っており1年目から現役
      incidentYears: [2, 5, 8, 11, 14, 17, 20, 23, 26, 28],
    },
  },
  rent: {
    moveIn: [3, 5],        // 入居の手続き(申込・審査・契約)
    move: [10, 20],        // 引越し(1回・入居時)
    renew: [0.5, 1],       // 更新 /回(2年ごと)
    renewN: 14,
    incident: [0.5, 1],    // 故障連絡 /件(連絡と立会い)
    incidentN: 8,
  },
};
const YEARS = 30;
const mul = (a, k) => [a[0] * k, a[1] * k];
function ownTotal(pat) {
  const parts = [
    ["取得の手続き", pat.acquire],
    ["入口リフォームの発注", pat.reform],
    ["引越し(1回)", EST.own.moveIn],
    [`定常運用 ${EST.own.steady[0]}〜${EST.own.steady[1]}h/年 × ${YEARS}年`, mul(EST.own.steady, YEARS)],
    [`故障対応 ×${pat.incidentN}件`, mul(EST.own.incident, pat.incidentN)],
    [`大規模修繕の発注 ×${EST.own.repairN}回`, mul(EST.own.repair, EST.own.repairN)],
    ["売却の山", EST.own.sell],
  ];
  let lo = 0, hi = 0;
  for (const [, r] of parts) { lo += r[0]; hi += r[1]; }
  return { parts, lo, hi };
}
function rentTotal() {
  const parts = [
    ["入居の手続き", EST.rent.moveIn],
    ["引越し(1回)", EST.rent.move],
    [`更新 ×${EST.rent.renewN}回`, mul(EST.rent.renew, EST.rent.renewN)],
    [`故障連絡 ×${EST.rent.incidentN}件`, mul(EST.rent.incident, EST.rent.incidentN)],
  ];
  let lo = 0, hi = 0;
  for (const [, r] of parts) { lo += r[0]; hi += r[1]; }
  return { parts, lo, hi };
}
const mid = (r) => (r[0] + r[1]) / 2;

// ---- 図1: 30年タイムライン 3レーン(イベントの高さ=実働時間の目安) ----
function figTimeline() {
  const W = 760, H = 446, padL = 46, padR = 14;
  const X = (yr) => padL + (yr / YEARS) * (W - padL - padR);
  const el = [];
  const bar = (yr, hours, base, color, w = 7) => {
    const h = hours * 1.5;
    el.push(`<rect x="${(X(yr) - w / 2).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${w}" height="${h.toFixed(1)}" fill="${color}"/>`);
  };
  const baseline = (b) => el.push(`<line x1="${padL}" y1="${b}" x2="${W - padR}" y2="${b}" stroke="#16232E" stroke-width="1"/>`);
  const steadyBand = (b) =>
    el.push(`<rect x="${X(0.4).toFixed(1)}" y="${(b - 11).toFixed(1)}" width="${(X(29.6) - X(0.4)).toFixed(1)}" height="11" fill="#2E6E8E" opacity=".16"/>`);
  const nb = ownTotal(EST.patterns.newBuild), u15 = ownTotal(EST.patterns.used15), rn = rentTotal();

  // レーン1: 賃貸(基線 y=96)
  const bR = 96;
  el.push(`<text x="${padL}" y="22" font-size="11" font-weight="700" fill="#6B4E9B">賃貸 ── 30年合計 ${rn.lo}〜${rn.hi}h</text>`);
  baseline(bR);
  bar(0, mid(EST.rent.moveIn), bR, "#6B4E9B", 8);
  for (let y = 2; y <= 28; y += 2) bar(y, mid(EST.rent.renew), bR, "#6B4E9B", 4);
  [7, 11, 16, 21, 25, 28].forEach((y) => bar(y, mid(EST.rent.incident), bR, "#C93A2B", 4));
  el.push(`<text x="${(X(0) + 8).toFixed(1)}" y="${bR - 12}" font-size="8.5" fill="#6B4E9B">入居 ${EST.rent.moveIn[0]}〜${EST.rent.moveIn[1]}h</text>`);
  el.push(`<text x="${X(16).toFixed(1)}" y="${bR - 12}" font-size="8.5" fill="#C93A2B" text-anchor="middle">故障=管理会社へ連絡(赤)</text>`);
  el.push(`<text x="${X(4).toFixed(1)}" y="${bR + 14}" font-size="8.5" fill="#6B4E9B">更新(2年ごと・書類1通)</text>`);

  // レーン2: 新築(基線 y=252)。〜10年は保証の傘で故障の発注が少ない
  const bN = 252;
  el.push(`<text x="${padL}" y="134" font-size="11" font-weight="700" fill="#2E6E8E">新築を買う ── 30年合計 ${nb.lo}〜${nb.hi}h</text>`);
  el.push(`<rect x="${X(0).toFixed(1)}" y="158" width="${(X(10) - X(0)).toFixed(1)}" height="${bN - 158}" fill="#2C6E49" opacity=".08"/>`);
  el.push(`<text x="${(X(0.6)).toFixed(1)}" y="172" font-size="8.5" fill="#2C6E49">〜10年目: 保証の傘(法定10年は構造・雨漏りのみ+設備は寿命前)</text>`);
  baseline(bN);
  steadyBand(bN);
  bar(0, mid(EST.patterns.newBuild.acquire), bN, "#2E6E8E", 9);
  [12, 24].forEach((y) => bar(y, mid(EST.own.repair), bN, "#B07C10", 8));
  EST.patterns.newBuild.incidentYears.forEach((y) => bar(y, mid(EST.own.incident), bN, "#C93A2B", 4));
  bar(30, mid(EST.own.sell), bN, "#2C6E49", 9);
  el.push(`<text x="${(X(0) + 8).toFixed(1)}" y="${bN - 46}" font-size="8.5" fill="#2E6E8E">取得 ${EST.patterns.newBuild.acquire[0]}〜${EST.patterns.newBuild.acquire[1]}h</text>`);
  el.push(`<text x="${(X(30) - 8).toFixed(1)}" y="${bN - 74}" font-size="8.5" fill="#2C6E49" text-anchor="end">売却 ${EST.own.sell[0]}〜${EST.own.sell[1]}h</text>`);
  el.push(`<text x="${X(18).toFixed(1)}" y="${bN + 14}" font-size="8.5" fill="#43566B">山は11年目以降に寄る(修繕=橙・故障=赤)</text>`);

  // レーン3: 中古(築15年)(基線 y=408)。入口に山が集中し、1年目から発注者業が現役
  const bU = 408;
  el.push(`<text x="${padL}" y="290" font-size="11" font-weight="700" fill="#8C3A5C">中古(築15年)を買う ── 30年合計 ${u15.lo}〜${u15.hi}h</text>`);
  baseline(bU);
  steadyBand(bU);
  const uEntry = [EST.patterns.used15.acquire[0] + EST.patterns.used15.reform[0], EST.patterns.used15.acquire[1] + EST.patterns.used15.reform[1]];
  bar(0, mid(uEntry), bU, "#8C3A5C", 9);
  [12, 24].forEach((y) => bar(y, mid(EST.own.repair), bU, "#B07C10", 8));
  EST.patterns.used15.incidentYears.forEach((y) => bar(y, mid(EST.own.incident), bU, "#C93A2B", 4));
  bar(30, mid(EST.own.sell), bU, "#2C6E49", 9);
  el.push(`<text x="${(X(0) + 8).toFixed(1)}" y="${bU - 62}" font-size="8.5" fill="#8C3A5C">入口に山: 取得+リフォーム発注 ${uEntry[0]}〜${uEntry[1]}h</text>`);
  el.push(`<line x1="${X(16).toFixed(1)}" y1="330" x2="${X(16).toFixed(1)}" y2="${bU}" stroke="#5C6B7A" stroke-dasharray="3 3"/>`);
  el.push(`<text x="${(X(16) + 5).toFixed(1)}" y="340" font-size="8.5" fill="#5C6B7A">16年目に築31年(手間は変わらないが出口のお金が変わる=下注)</text>`);
  el.push(`<text x="${X(6).toFixed(1)}" y="${bU + 14}" font-size="8.5" fill="#43566B">故障の発注は1年目から現役(保証なし)</text>`);

  // 年軸(下端)
  for (let y = 0; y <= YEARS; y += 5) {
    el.push(`<text x="${X(y).toFixed(1)}" y="${H - 6}" font-size="9" fill="#43566B" text-anchor="middle">${y}年</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="賃貸・新築・中古築15年の30年の手間タイムライン比較" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図2: 取得の実働時間(引越しを除く手続きのみ)のレンジバー ----
function figAcquire() {
  const W = 640, H = 150, padL = 190, padR = 70;
  const xmax = 70;
  const X = (h) => padL + (h / xmax) * (W - padL - padR);
  const el = [];
  const u = EST.patterns.used15;
  const rows = [
    ["賃貸: 申込〜契約", EST.rent.moveIn[0], EST.rent.moveIn[1], "#6B4E9B"],
    ["新築: 買付〜引渡し", EST.patterns.newBuild.acquire[0], EST.patterns.newBuild.acquire[1], "#2E6E8E"],
    ["中古(築15年): 同+リフォーム発注", u.acquire[0] + u.reform[0], u.acquire[1] + u.reform[1], "#8C3A5C"],
  ];
  rows.forEach(([label, lo, hi, color], i) => {
    const y = 30 + i * 34;
    el.push(`<text x="${padL - 8}" y="${y + 4}" font-size="9.5" fill="#16232E" text-anchor="end">${label}</text>`);
    el.push(`<line x1="${X(0)}" y1="${y}" x2="${X(xmax)}" y2="${y}" stroke="#EDF1F4" stroke-width="1"/>`);
    el.push(`<rect x="${X(lo).toFixed(1)}" y="${y - 7}" width="${(X(hi) - X(lo)).toFixed(1)}" height="14" fill="${color}" opacity=".75"/>`);
    el.push(`<text x="${(X(hi) + 6).toFixed(1)}" y="${y + 4}" font-size="9.5" fill="#43566B">${lo}〜${hi}h</text>`);
  });
  for (const h of [0, 20, 40, 60]) {
    el.push(`<line x1="${X(h)}" y1="16" x2="${X(h)}" y2="${H - 22}" stroke="#EDF1F4"/>`);
    el.push(`<text x="${X(h)}" y="${H - 8}" font-size="9" fill="#43566B" text-anchor="middle">${h}h</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="入居・取得の実働時間の比較(引越しを除く)" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図3: 「何かあった時」の対応チェーン(賃貸2手 vs 持ち家6手) ----
function figChain() {
  const W = 760, H = 236;
  const el = [];
  const box = (x, y, w, txt1, txt2, highlight = false) => {
    if (highlight) {
      el.push(`<rect x="${x}" y="${y}" width="${w}" height="46" fill="#B07C10" opacity=".13"/>`);
      el.push(`<rect x="${x}" y="${y}" width="${w}" height="46" fill="none" stroke="#B07C10" stroke-width="1.5"/>`);
    } else {
      el.push(`<rect x="${x}" y="${y}" width="${w}" height="46" fill="#FDFDFC" stroke="#16232E" stroke-width="1.2"/>`);
    }
    el.push(`<text x="${x + w / 2}" y="${y + 20}" font-size="9" font-weight="700" text-anchor="middle" fill="#16232E">${txt1}</text>`);
    if (txt2) el.push(`<text x="${x + w / 2}" y="${y + 35}" font-size="8" text-anchor="middle" fill="#43566B">${txt2}</text>`);
  };
  const arrow = (x0, y, len = 12) => {
    el.push(`<line x1="${x0}" y1="${y}" x2="${x0 + len}" y2="${y}" stroke="#16232E" stroke-width="1.3"/>`);
    el.push(`<polygon points="${x0 + len},${y - 3.5} ${x0 + len},${y + 3.5} ${x0 + len + 5},${y}" fill="#16232E"/>`);
  };
  // 賃貸(上段): 3箱
  el.push(`<text x="10" y="22" font-size="11" font-weight="700" fill="#6B4E9B">賃貸: 電話1本の中身</text>`);
  const yR = 34, wR = 168;
  box(10, yR, wR, "気づく", "症状をメモ・写真");
  arrow(10 + wR + 2, yR + 23);
  box(10 + wR + 22, yR, wR, "管理会社へ連絡", "あとは待つ(数日〜)");
  arrow(10 + (wR + 22) * 1 + wR + 2, yR + 23);
  box(10 + (wR + 22) * 2, yR, wR, "日程調整・立会い", "費用は原則大家負担");
  el.push(`<text x="${10 + (wR + 22) * 2 + wR + 14}" y="${yR + 28}" font-size="9" fill="#43566B">実働 0.5〜1h/件</text>`);
  // 持ち家(下段): 6箱(発注者業の3箱を網掛け)
  el.push(`<text x="10" y="122" font-size="11" font-weight="700" fill="#2E6E8E">持ち家: 「発注者」の仕事が挟まる</text>`);
  const yO = 134, wO = 110, gap = 14;
  const own = [
    ["気づく", "症状をメモ・写真", false],
    ["原因の切り分け", "保険が効くか確認", true],
    ["業者を探す", "候補2〜3社", true],
    ["相見積・比較", "仕様と金額を決裁", true],
    ["日程調整・立会い", "工事の確認", false],
    ["支払い・記録", "保証書類の保管", false],
  ];
  own.forEach(([t1, t2, highlight], i) => {
    const x = 10 + i * (wO + gap);
    box(x, yO, wO, t1, t2, highlight);
    if (i < own.length - 1) arrow(x + wO + 2, yO + 23, 7);
  });
  el.push(`<text x="10" y="${yO + 70}" font-size="9" fill="#43566B">実働 3〜6h/件+業者を探す時間。橙の3箱が「大家の仕事」=賃貸との差分。代わりに<tspan font-weight="700">仕様・業者・金額の決裁権が自分にある</tspan>(大家の安普請を待たなくてよい)</text>`);
  el.push(`<text x="10" y="${yO + 88}" font-size="9" fill="#43566B">最初の一手は「火災保険が効くか」の確認 ── 風災・雪災・水濡れ等は対象のことが多く、この確認1つで手間と費用が大きく変わる</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="故障発生時の対応チェーン比較(賃貸3手・持ち家6手)" style="width:100%;height:auto">${el.join("")}</svg>`;
}

// ---- 図4: 30年合計の実働時間(3パターンの積み上げレンジ) ----
// 積み上げ区分の色(本文のHTML凡例と同期させるためモジュールスコープに置く)
const SEG_COLORS = ["#2E6E8E", "#3AA0C9", "#5C6B7A", "#B8860B", "#C93A2B", "#B07C10", "#2C6E49"];
function figTotal() {
  const nb = ownTotal(EST.patterns.newBuild), u15 = ownTotal(EST.patterns.used15), r = rentTotal();
  const W = 700, H = 208, padL = 150, padR = 96;
  const xmax = Math.ceil(u15.hi / 100) * 100;
  const X = (h) => padL + (h / xmax) * (W - padL - padR);
  const el = [];
  const lane = (label, parts, y, colorOf) => {
    el.push(`<text x="${padL - 8}" y="${y + 5}" font-size="10" font-weight="700" fill="#16232E" text-anchor="end">${label}</text>`);
    let acc = 0;
    parts.forEach(([, range], i) => {
      const m = mid(range);
      if (m <= 0) return;
      el.push(`<rect x="${X(acc).toFixed(1)}" y="${y - 9}" width="${(X(acc + m) - X(acc)).toFixed(1)}" height="18" fill="${colorOf(i)}" opacity=".82" stroke="#fff" stroke-width="1"/>`);
      acc += m;
    });
    return acc;
  };
  const rows = [
    ["新築", nb, (i) => SEG_COLORS[i % SEG_COLORS.length], 40],
    ["中古(築15年)", u15, (i) => SEG_COLORS[i % SEG_COLORS.length], 78],
    ["賃貸", r, () => "#6B4E9B", 116],
  ];
  for (const [label, tot, colorOf, y] of rows) {
    const acc = lane(label, tot.parts, y, colorOf);
    el.push(`<text x="${(X(acc) + 6).toFixed(1)}" y="${y + 5}" font-size="10" font-weight="700" fill="#16232E">${Math.round(tot.lo)}〜${Math.round(tot.hi)}h</text>`);
  }
  for (const h of [0, 100, 200, 300, 400, 500]) {
    if (h > xmax) continue;
    el.push(`<line x1="${X(h)}" y1="24" x2="${X(h)}" y2="${H - 66}" stroke="#EDF1F4"/>`);
    el.push(`<text x="${X(h)}" y="${H - 52}" font-size="9" fill="#43566B" text-anchor="middle">${h}h</text>`);
  }
  const d = (own) => [Math.round(own.lo - r.hi), Math.round(own.hi - r.lo)];
  const dn = d(nb), du = d(u15);
  el.push(`<text x="10" y="${H - 30}" font-size="9.5" fill="#16232E">賃貸との差の目安: 新築 <tspan font-weight="700">+${dn[0]}〜${dn[1]}h</tspan>(営業日換算 約${Math.round(dn[0] / 8)}〜${Math.round(dn[1] / 8)}日) / 中古(築15年) <tspan font-weight="700">+${du[0]}〜${du[1]}h</tspan>(約${Math.round(du[0] / 8)}〜${Math.round(du[1] / 8)}日)</text>`);
  el.push(`<text x="10" y="${H - 12}" font-size="9.5" fill="#43566B">新築と中古の30年合計は帯が重なる=総量では同格。違いは図1の「いつ来るか」に出る(内訳は下表)</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="30年合計の実働時間の比較(新築・中古築15年・賃貸の積み上げ)" style="width:100%;height:auto">${el.join("")}</svg>`;
}

const td = 'style="white-space:normal;font-size:.78rem"';
const r3 = ([a, b, c]) => `<tr><td ${td}><b>${a}</b></td><td ${td}>${b}</td><td ${td}>${c}</td></tr>`;
const r4 = ([a, b, c, d]) => `<tr><td ${td}><b>${a}</b></td><td ${td}>${b}</td><td ${td}>${c}</td><td ${td}>${d}</td></tr>`;
const rng = (r) => `${r[0]}〜${r[1]}h`;

export function renderEffort({ asOf }) {
  const nb = ownTotal(EST.patterns.newBuild), u15 = ownTotal(EST.patterns.used15), r = rentTotal();
  const body = `
  <section class="panel">
    <h2>これは何をするページか</h2>
    <div class="logic-body">
      <p style="font-size:.85rem"><a href="simulate.html">保有年数シミュレーター</a>は「お金の差は思ったほど大きくない」ことを示す。
      そのとき残る比較軸が<b>手間・責任・自由</b>で、これはお金の表に出てこない。
      持ち家の手間の正体は一言でいえば<b>「大家の仕事(発注者業)を自分が引き受けること」</b>。
      このページはその仕事量を<b>賃貸/新築を買う/中古(築15年)を買う の3パターン</b>で、
      ①30年のタイムライン ②入口(契約手続き)の山 ③「何かあった時」の対応 ④毎年の定常運用 ⑤30年の合計 の順に図解する。
      <b>このページは判定をしません</b>。手間を負担と感じるか、裁量と感じるかは人によって違う——
      最後の「自由との交換」まで読んで、ご自身の重みで判断すること。</p>
      <p style="font-size:.78rem;margin-top:8px" class="position-body"><b>数値の性質(必読)</b>:
      このページの時間・金額は、台帳の成約データのような実測ではなく<b>一般的な手続きの構成要素からの積算目安</b>。
      個人差(手続きに慣れているか)・物件差(保証の有無・築年)・地域差(町内会)で大きく変わるため、
      すべて幅で示し、内訳を表で開示する。比較の前提は<b>「3パターンとも同じ家に30年住み続ける」</b>に固定した
      (賃貸の「身軽さ」を使って住み替えるたびに、賃貸側には探索+契約+引越しで1回40〜60hが加算される——
      その身軽さこそ賃貸の価値なので、これは手間ではなく自由の項で扱う)。</p>
    </div>
  </section>

  <section class="panel">
    <h2>図1 ── 30年のタイムライン: 手間は「山」で来る(3パターン)</h2>
    <div class="scale-wrap">${figTimeline()}</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:.72rem;margin-top:4px">
      <span><span class="esw" style="background:#2E6E8E"></span>取得の山</span>
      <span><span class="esw" style="background:#8C3A5C"></span>取得+リフォーム(中古の入口)</span>
      <span><span class="esw" style="background:#B07C10"></span>大規模修繕の発注</span>
      <span><span class="esw" style="background:#C93A2B"></span>故障対応</span>
      <span><span class="esw" style="background:#2C6E49"></span>売却の山</span>
      <span><span class="esw" style="background:#2E6E8E;opacity:.25"></span>定常運用の帯(年5〜10h)</span>
      <span><span class="esw" style="background:#2C6E49;opacity:.18"></span>保証の傘(新築〜10年)</span>
      <span><span class="esw" style="background:#6B4E9B"></span>賃貸のイベント</span>
    </div>
    <div class="note">棒の高さ=実働時間の目安(中間値で描画。幅はレーン見出しの合計に表示)。3パターンの違いは総量より<b>時期</b>に出る:
    <b>新築</b>は最初の10年が「保証の傘」で静かで、発注者業が始まるのは11年目以降。傘の中身は3層で効き方が違う——
    ①法定10年の瑕疵担保は<b>構造と雨漏りだけ</b>(滅多に起きないが起きたら数十〜数百万の事象を無償修補。保険加入が義務なので売主が倒産しても請求できる)
    ②設備(給湯器・エアコン等)が静かなのは保証ではなく<b>寿命前の新品だから</b>
    ③メーカー保証・売主アフターサービスは<b>標準1〜2年</b>で10年ではない(10年に延ばすのは有償の延長保証)。
    傘は自動では開かない——<b>10年目直前の点検で瑕疵を期間内に指摘させる</b>のが実務で、保険付保証明書・アフター基準書・点検予定は引渡し時に揃えること。
    <b>中古(築15年)</b>は取得とリフォーム発注が入口に重なって最初の山が最も高く、設備は寿命帯なので<b>故障の発注が1年目から現役</b>。
    <b>賃貸</b>は30年を通して薄く平ら。どのパターンも平時は月1時間未満で、<b>山の年に時間の余裕があるか</b>が実際の負担感を決める
    (取得の山は自分でタイミングを選べるが、故障の山は選べない)。
    なお中古(築15年)は16年目に築31年を跨ぐ——<b>手間は変わらないが出口のお金が変わる</b>境目で、
    これは<a href="cliff.html">30年の崖の検証</a>と<a href="simulate.html">シミュレーター</a>の領分。</div>
  </section>

  <section class="panel">
    <h2>図2 ── 入口の山: 契約手続きはどれだけ重いか</h2>
    <div class="scale-wrap">${figAcquire()}</div>
    <div style="overflow-x:auto"><table class="kv" style="min-width:560px">
      <tr><th style="text-align:left">持ち家の取得ステップ(中古)</th><th style="text-align:left">実働の目安</th><th style="text-align:left">中身</th></tr>
      ${[
        ["買付証明・条件交渉", "2〜4h", "価格・引渡し条件・契約不適合責任の範囲を文書で"],
        ["ローン事前審査", "3〜5h", "源泉徴収票・本人確認等の書類集めが実体。ネット銀行は入力が長い"],
        ["売買契約+重要事項説明", "3〜4h", "重説の読み合わせ2〜3h。ここが最大の読解イベント(事前入手して読んでおくと質問できる)"],
        ["本審査・団信告知", "2〜4h", "健康状態の告知は事実をそのまま(告知義務違反は保険金不払いに直結)"],
        ["金銭消費貸借契約", "2〜3h", "金利タイプ・繰上返済条件の最終確定"],
        ["火災・地震保険の比較", "2〜4h", "水災の要否は<a href='map.html'>ハザード対照</a>で判断できる(台帳エリアは台地側=水災を外す選択肢が出る)"],
        ["決済・引渡し・登記", "2〜3h", "平日半休1回。登記は司法書士がやる(自分の実働は少ない)"],
        ["入口リフォームの相見積・発注", "8〜20h", "中古のみ。2〜3社の現地立会いと仕様決め。ここが実は取得の山の最大項目"],
        ["確定申告(控除初年)", "2〜4h", "給与所得者は初年のみ。2年目からは年末調整に書類1枚"],
      ].map(r3).join("")}
    </table></div>
    <div class="note">合計 25〜45h(+中古はリフォーム発注8〜20h)・期間6〜10週。新築は現況確認と契約不適合の交渉が薄いぶん軽い(20〜35h)が、
    賃貸の3〜5h・1〜2週に対してはどちらも<b>おおむね10倍</b>。ただし性質が違う: 賃貸の手続きは「早い者勝ちの事務処理」、
    持ち家の手続きは<b>数千万円の意思決定を分割払いで確定していく工程</b>で、
    重さの大半は書類ではなく判断(いくらで買付を入れるか・金利タイプ・保険の範囲)。判断材料を揃えるのがこの台帳の役割
    (<a href="formula.html">値段の解剖</a>・<a href="tradeoff.html">妥協の値段</a>)。</div>
  </section>

  <section class="panel">
    <h2>図3 ── 「何かあった時」: 電話1本と発注者業の差</h2>
    <div class="scale-wrap">${figChain()}</div>
    <div style="overflow-x:auto"><table class="kv" style="min-width:640px">
      <tr><th style="text-align:left">起きること(30年でだいたい遭遇する順)</th><th style="text-align:left">賃貸なら</th><th style="text-align:left">持ち家(戸建)なら</th><th style="text-align:left">持ち家の費用目安</th></tr>
      ${[
        ["給湯器が壊れる(寿命10〜15年)", "連絡のみ・費用は大家", "即日〜数日で交換手配(冬は在庫勝負)", "15〜40万"],
        ["エアコン故障(寿命10〜15年)", "備付なら大家・自設なら自分", "買替の手配", "10〜25万/台"],
        ["水栓・トイレの水漏れ", "連絡のみ(軽微な消耗品は借主負担の契約も多い)", "パッキン程度はDIY可・業者なら", "数千円〜5万"],
        ["外壁・屋根の再塗装(12〜15年ごと)", "発生しない(家賃に内包)", "相見積2〜3社・足場・近隣挨拶", "100〜180万/回"],
        ["雨漏り", "連絡のみ", "原因調査から(特定が難しい)。まず火災保険(風災)を確認", "調査5〜30万+補修"],
        ["シロアリ予防(5年ごと)/駆除", "発生しない", "点検と予防の発注", "予防10〜25万/回・駆除20〜60万"],
        ["給排水管の老朽化(30年〜)", "発生しない", "更新工事の発注", "30〜150万"],
        ["隣地との境界・越境(枝・塀)", "大家の問題", "当事者は自分(協議・測量)", "測量30〜80万(必要時)"],
        ["台風・地震のあと", "退去も選べる(資産リスクは大家)", "罹災証明・保険請求・修繕の指揮を全部自分", "保険+自己負担"],
      ].map(r4).join("")}
    </table></div>
    <div class="note">金額は木造戸建の概算レンジ(<a href="tradeoff.html">妥協の値段</a>と同じく実見積りで置き換える前提)。
    フェアに書くと: 賃貸の「電話1本」も<b>即日直るとは限らない</b>(管理会社経由の承認待ちで数日〜数週間、
    直し方も大家の予算次第)。持ち家は手間の代わりに<b>スピードと品質を自分で決められる</b>。
    また新築は最初の10年、構造・雨漏りに法定の瑕疵担保責任があり(設備のメーカー保証は標準1〜2年・有償延長で最長10年)、
    設備自体も寿命前のため、故障の発注が本格化するのは11年目以降。築15〜21年の中古は入口からこのリストが現役で回る——
    図1の3レーンの違いはこの表の「いつ始まるか」の違いでもある(台帳の物件は新築4件 vs 築14〜33年)。</div>
  </section>

  <section class="panel">
    <h2>図4 ── 平時の定常運用: 頻度で見る</h2>
    <div style="overflow-x:auto"><table class="kv" style="min-width:560px">
      <tr><th style="text-align:left">頻度</th><th style="text-align:left">持ち家(戸建)</th><th style="text-align:left">賃貸</th></tr>
      ${[
        ["毎年", "固定資産税の納付(通知確認・口座振替なら数分)/外回りの目視点検(雨樋・外壁ひび・排水桝・蟻道)2〜4h/庭・外構の手入れ(物件差大)", "なし"],
        ["2年ごと", "—", "更新書類1通+更新料(保険更新も同時)"],
        ["5年ごと", "火災・地震保険の更新と見直し2〜3h/シロアリ予防の発注", "—"],
        ["12〜15年ごと", "外壁・屋根・給湯器・エアコンなど図3の山", "—(家賃に内包)"],
        ["一度きり", "確定申告(控除初年)/(将来)相続登記=2024年から義務化。持ち家の手間は<b>次の世代に相続の形で引き継がれる</b>", "退去時の原状回復精算"],
      ].map(r3).join("")}
    </table></div>
    <div class="note">実働時間にすると持ち家でも年5〜10h(月1時間未満)で、<b>時間そのものは大きくない</b>。
    負担の本体はむしろ「<b>気に掛けるものリスト</b>が増えること」——税・保険・外壁・シロアリ・境界・町内会(地域差大)が
    自分の管轄になり、放置のツケ(雨漏りの進行・無保険期間)も自分に返る。これは時間では測れないので、
    時間の図とは別にこうして名指しで書いておく。</div>
  </section>

  <section class="panel">
    <h2>図5 ── 30年の合計: 「大家業」の総量(3パターン)</h2>
    <div class="scale-wrap">${figTotal()}</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:.72rem;margin-top:4px">
      ${u15.parts.map(([n], i) => `<span><span class="esw" style="background:${SEG_COLORS[i % SEG_COLORS.length]}"></span>${esc(n)}</span>`).join("")}
      <span><span class="esw" style="background:#6B4E9B"></span>賃貸(全区分)</span>
    </div>
    <div class="note">棒の長さは各区分の中間値の積み上げ(幅は右の合計に表示)。<b>新築と中古(築15年)の30年合計は帯が重なる=総量では同格</b>で、
    どちらの帯も半分以上は「定常運用×30年」——1回1回は軽い(年5〜10h)が、30年は長い。
    逆に言えば<b>山(取得・売却・修繕)だけ見て構えるのは過大評価</b>で、実際の総量は日常の細かい積み重ねが決める。
    新築と中古の違いは図1の「いつ来るか」と、出口の築年(新築=築30で売る/中古15年=築45で売る)に出る。</div>
    <div style="overflow-x:auto"><table class="kv" style="min-width:520px">
      <tr><th style="text-align:left">持ち家の内訳(実働・30年)</th><th style="text-align:left">新築</th><th style="text-align:left">中古(築15年)</th></tr>
      ${r3(["取得の手続き", rng(EST.patterns.newBuild.acquire), rng(EST.patterns.used15.acquire)])}
      ${r3(["入口リフォームの発注", "—(なし)", rng(EST.patterns.used15.reform)])}
      ${r3(["引越し(1回)", rng(EST.own.moveIn), rng(EST.own.moveIn)])}
      ${r3([`定常運用 ${EST.own.steady[0]}〜${EST.own.steady[1]}h/年 × ${YEARS}年`, rng(mul(EST.own.steady, YEARS)), rng(mul(EST.own.steady, YEARS))])}
      ${r3(["故障対応(保証の傘で件数が変わる)", `${rng(mul(EST.own.incident, EST.patterns.newBuild.incidentN))}(×${EST.patterns.newBuild.incidentN}件)`, `${rng(mul(EST.own.incident, EST.patterns.used15.incidentN))}(×${EST.patterns.used15.incidentN}件)`])}
      ${r3([`大規模修繕の発注 ×${EST.own.repairN}回`, rng(mul(EST.own.repair, EST.own.repairN)), rng(mul(EST.own.repair, EST.own.repairN))])}
      ${r3(["売却の山", rng(EST.own.sell), rng(EST.own.sell)])}
      <tr class="em"><td ${td}><b>合計</b></td><td ${td}><b>${nb.lo}〜${nb.hi}h</b></td><td ${td}><b>${u15.lo}〜${u15.hi}h</b></td></tr>
    </table></div>
    <div style="overflow-x:auto"><table class="kv" style="min-width:400px">
      <tr><th style="text-align:left">賃貸の内訳</th><th style="text-align:left">実働(30年)</th></tr>
      ${r.parts.map(([n, range]) => `<tr><td ${td}>${n}</td><td ${td}>${range[0]}〜${range[1]}h</td></tr>`).join("")}
      <tr class="em"><td ${td}><b>合計</b></td><td ${td}><b>${r.lo}〜${r.hi}h</b></td></tr>
    </table></div>
    <div class="note"><b>手間はお金で部分的に買い戻せる</b>: 火災保険の水回り駆けつけ特約(月数百円)・設備の延長保証・
    ハウスメーカー系の定期点検パック・ホームインスペクション(5〜6万/回)など、「大家がやっていたこと」の外注メニューは存在する。
    中古には<b>既存住宅売買瑕疵保険</b>(検査合格が条件・1〜5年・数万〜十数万円)や仲介会社の設備保証パックもあり、
    新築の「保証の傘」の入口1〜2年ぶんを後付けで買える。
    賃貸の家賃にはこの外注費が最初から内包されている——<b>持ち家は「自分の時間で払う/個別に買い戻す」を項目ごとに選べる</b>、
    というのが正確な違い。逆に丸ごとの外注(住みながらの全部委託)は存在しない。定常運用の巡回・故障一次対応まで含む
    「管理」を買う唯一の方法が、実はマンション(管理費・修繕積立金)——戸建とマンションの費目差の正体はこれ。</div>
  </section>

  <section class="panel">
    <h2>自由との交換 ── 手間と裁量は同じ取引の両面</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">
      <div style="border:1.5px solid #2E6E8E;padding:12px">
        <div style="font-weight:700;color:#2E6E8E;margin-bottom:6px">持ち家が引き受けるもの → 得るもの</div>
        <ul style="margin-left:1.2em;font-size:.78rem;line-height:1.9">
          <li>発注者業(図3) → <b>直し方・仕様・時期の決裁権</b>。壁に穴も、断熱改修も、猫も楽器も誰の許可も要らない</li>
          <li>売却の山(30〜60h) → <b>退去を強制されない</b>。立退き・更新拒絶・家賃改定と無縁</li>
          <li>災害リスクの引受け → 保険設計の裁量(この台帳がハザードで足切りしているのは、この引受けを軽くするため=<a href="map.html">ハザード対照</a>)</li>
          <li>気に掛けるリスト → 高齢期に<b>入居審査の壁がない</b>(民間賃貸は年齢で狭まる——これは金額に出ない将来リスク)</li>
        </ul>
      </div>
      <div style="border:1.5px solid #6B4E9B;padding:12px">
        <div style="font-weight:700;color:#6B4E9B;margin-bottom:6px">賃貸が手放しているもの → 得るもの</div>
        <ul style="margin-left:1.2em;font-size:.78rem;line-height:1.9">
          <li>改装・使い方の裁量(原状回復義務) → <b>電話1本の外注</b>(図3の上段)</li>
          <li>資産形成(家賃は全額費用) → <b>即時撤退の自由</b>: 転勤・隣人・収入変化に1〜2か月で対応。隣人は「リセットできる」</li>
          <li>住まいの固定 → <b>失敗の取り返しが軽い</b>。合わない家は引越しで解決(持ち家の「合わない」は売却の山+価格リスク)</li>
          <li>— → 災害・空室・金利・修繕のリスクは全部大家側。<b>身軽さは賃貸の正当な価値</b>で、住み替え1回40〜60hはその行使コスト</li>
        </ul>
      </div>
    </div>
    <div class="note" style="margin-top:10px">どちらの列を重く読むかは家族構成・転勤可能性・性格(発注が苦でないか)で決まり、
    ここに正解はない。<b>唯一言える一般則</b>: 図1の「山」は取得と売却に集中するので、
    <b>短期で出る可能性が高いほど持ち家の手間(と<a href="simulate.html">お金</a>)は割高になる</b>——
    手間の面でもお金の面でも、持ち家は「長く住むほど単価が下がる」構造をしている。</div>
  </section>

  <section class="panel">
    <h2>分かること / 分からないこと</h2>
    <div class="logic-body">
      <div class="logic-step"><div class="t"><span class="no">分</span>このページから分かること</div>
        <div class="why">手間の<b>構造</b>(山で来る・平時は軽い・正体は発注者業)と<b>規模感</b>
        (30年で新築${nb.lo}〜${nb.hi}h・中古(築15年)${u15.lo}〜${u15.hi}h vs 賃貸${r.lo}〜${r.hi}h、
        営業日換算で約${Math.round((nb.lo - r.hi) / 8)}〜${Math.round((u15.hi - r.lo) / 8)}日分の差)。
        新築と中古の違いは総量ではなく<b>時期</b>(保証の傘の10年 vs 入口の山+1年目から現役)に出ること。
        手間と自由が同じ取引の両面であること。</div></div>
      <div class="logic-step"><div class="t"><span class="no">不</span>このページでは分からないこと</div>
        <div class="why">あなたにとっての1時間の重さ(仕事の繁忙・家族の分担)。発注が苦か楽しみかという性格。
        町内会・地域慣習(物件の地区ごとに現地で確認するしかない)。実際の故障がいつ来るか(上の回数・周期は平均像)。
        時間見積りは実測データではないため、<b>この表の数字で物件間を順位づけしないこと</b>——
        物件間で確実に違うのは「新築保証の10年があるか」「入口リフォームの発注があるか」の2点だけで、
        それはこのページの2パターンの差としてすでに織り込んである。</div></div>
    </div>
  </section>

  <div class="disclaimer">本ページは個人の検討用の参考資料であり、判定・推奨ではない。時間・金額はすべて一般的な手続きの構成要素からの
  積算目安(基準日 ${esc(asOf)})。お金の比較は<a href="simulate.html">保有年数シミュレーター</a>、
  工事費の目安は<a href="tradeoff.html">妥協の値段</a>、災害リスクは<a href="map.html">ハザードマップ対照</a>を参照。</div>
  <p style="margin-top:14px"><a class="src-link" href="index.html">← 物件一覧へ戻る</a></p>
  <style>.esw{display:inline-block;width:11px;height:11px;margin-right:4px;vertical-align:-1px;border:1px solid var(--ink)}</style>`;

  return layout({
    title: "手間の解剖 ── お金では見えない持ち家の運用",
    subtitle: "賃貸・新築・中古(築15年)の手間・責任・自由の交換を図解する(判定はしない)",
    docNo: `FUDOSAN-APPRAISAL/EFFORT<br>基準日 ${esc(asOf)}<br>数値は積算目安(実測ではない)`,
    body,
  });
}
