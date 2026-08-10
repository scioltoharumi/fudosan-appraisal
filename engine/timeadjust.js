// engine/timeadjust.js — 年次別の地価上昇率による時点修正(監査反映)
// 一律10%/年は2022〜23年(実績+3〜5%)に対して過大だったため、年次別レートに置換。
// 出典: 北区住宅地の公示地価・基準地価の実績(2025基準地価+8.9%、2026公示+12.1%、赤羽+13.3%)
export const RISE_BY_YEAR = {
  2021: 0.03, 2022: 0.04, 2023: 0.05, 2024: 0.09, 2025: 0.12, 2026: 0.12,
};
const RISE_DEFAULT = 0.10; // 表にない年のフォールバック

const MS_YEAR = 31557600000; // 365.25日

function toDate(d) {
  if (d instanceof Date) return d;
  const m = String(d).match(/^(\d{4})[-Q](\d{1,2})(?:-(\d{1,2}))?/);
  if (!m) throw new Error(`日付を解釈できません: ${d}`);
  if (String(d).includes("Q")) {
    // "2024Q3" → 四半期中間月の15日
    const month = (+m[2] - 1) * 3 + 1; // Q1→2月, Q2→5月, Q3→8月, Q4→11月
    return new Date(Date.UTC(+m[1], month, 15));
  }
  return new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 15));
}

// from時点の価格をto時点の価格水準に換算する係数(from<toで1超)。年境界で区分逓増
export function growthFactor(from, to) {
  let a = toDate(from), b = toDate(to);
  if (a.getTime() === b.getTime()) return 1;
  if (a > b) return 1 / growthFactor(b, a);
  let f = 1;
  let cur = a;
  while (cur < b) {
    const y = cur.getUTCFullYear();
    const yearEnd = new Date(Date.UTC(y + 1, 0, 1));
    const seg = Math.min(yearEnd.getTime(), b.getTime()) - cur.getTime();
    const rate = RISE_BY_YEAR[y] ?? RISE_DEFAULT;
    f *= Math.pow(1 + rate, seg / MS_YEAR);
    cur = new Date(Math.min(yearEnd.getTime(), b.getTime()));
  }
  return f;
}
