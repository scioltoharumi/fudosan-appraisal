// engine/timeadjust.js — 年次別の地価上昇率による時点修正(監査反映)
// 一律10%/年は2022〜23年(実績+3〜5%)に対して過大だったため、年次別レートに置換。
// 出典: 北区住宅地の公示地価・基準地価の実績(2025基準地価+8.9%、2026公示+12.1%、赤羽+13.3%)
export const RISE_BY_YEAR = {
  // 2025までは公示・基準地価の観測値。2026は公示+12.1%(2026-01時点の後方観測)だが、
  // 基準日以降の「将来分」を+12%で外挿すると市況鈍化時に全査定が過大になるため半減の+6%で保守化(R3監査)
  2021: 0.03, 2022: 0.04, 2023: 0.05, 2024: 0.09, 2025: 0.12, 2026: 0.06,
};
const RISE_DEFAULT = 0.10; // 表にない年のフォールバック

const MS_YEAR = 31557600000; // 365.25日

function toDate(d) {
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) throw new Error("Invalid Date が渡されました");
    return d;
  }
  const str = String(d);
  if (str.includes("Q")) {
    // "2024Q3" → 四半期中間月の15日。Q1〜Q4以外は不正(Dateの月オーバーフローで静かにずれるのを防ぐ)
    const m = str.match(/^(\d{4})Q([1-4])$/);
    if (!m) throw new Error(`四半期表記が不正です(YYYYQ1〜Q4): ${d}`);
    const month = (+m[2] - 1) * 3 + 1; // Q1→2月, Q2→5月, Q3→8月, Q4→11月
    return new Date(Date.UTC(+m[1], month, 15));
  }
  const m = str.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (!m || +m[2] < 1 || +m[2] > 12) throw new Error(`日付を解釈できません: ${d}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 15));
}

function growthWith(table, fallback, from, to) {
  let a = toDate(from), b = toDate(to);
  if (a.getTime() === b.getTime()) return 1;
  if (a > b) return 1 / growthWith(table, fallback, b, a);
  let f = 1;
  let cur = a;
  while (cur < b) {
    const y = cur.getUTCFullYear();
    const yearEnd = new Date(Date.UTC(y + 1, 0, 1));
    const seg = Math.min(yearEnd.getTime(), b.getTime()) - cur.getTime();
    const rate = table[y] ?? fallback;
    f *= Math.pow(1 + rate, seg / MS_YEAR);
    cur = new Date(Math.min(yearEnd.getTime(), b.getTime()));
  }
  return f;
}

// from時点の【土地】価格をto時点の水準に換算する係数(from<toで1超)。年境界で区分逓増
export function growthFactor(from, to) {
  return growthWith(RISE_BY_YEAR, RISE_DEFAULT, from, to);
}

