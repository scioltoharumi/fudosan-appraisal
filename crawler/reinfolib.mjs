// crawler/reinfolib.mjs — 国土交通省「不動産情報ライブラリ」API クライアント。
//
// **APIキーは絶対にリポジトリへ書かない**(このリポジトリは公開)。環境変数 REINFOLIB_API_KEY から読む。
//   実行例: REINFOLIB_API_KEY=xxxx node crawler/reinfolib.mjs 13117 2022 2026
//
// なぜ使うのか(2026-08-13にAPI承認):
// これまで成約データは再掲サイト(utinokati)から取っていたが、再掲側は項目が落ちている。
// 一次ソースであるこのAPIには、再掲サイトに無い/欠けている属性が揃っている:
//   - LandShape(土地の形状)      … 再掲経由の記載率59%に対し、APIは住宅地の戸建で**ほぼ100%**
//   - Classification(前面道路の種類) … 区道/私道の別。**再掲サイトには無い**。
//                                    北区2025の住宅地戸建179件で 区道95 / 私道77 = 私道が43%
//   - Breadth(前面道路の幅員) / Frontage(間口) / Direction(方位)
// 逆に**APIには最寄駅・徒歩分が無い**(再掲サイトは独自に付けている)。徒歩分は査定の主要変数なので、
// house-deals.csv の walk_min は再掲サイト由来のまま維持し、APIからは上記の属性だけを突き合わせて足す。
//
// 突き合わせの注意: 再掲サイトは価格を100万円単位・面積を5m2単位に丸めている(house-deals.csvの
// コメント参照)。APIは生値なので、**同じ丸めを掛けてから**照合すること(matchKey)。
//
// 出典表記: 「国土交通省 不動産情報ライブラリ」(https://www.reinfolib.mlit.go.jp/)

import { execFileSync } from "node:child_process";

const BASE = "https://www.reinfolib.mlit.go.jp/ex-api/external";

export function apiKey() {
  const k = process.env.REINFOLIB_API_KEY;
  if (!k) throw new Error("環境変数 REINFOLIB_API_KEY が未設定です(キーはリポジトリに置かないこと)");
  return k;
}

// レスポンスはgzipで返るため --compressed が必須(付けないとバイナリのまま壊れる)
export function fetchJson(path, params = {}, { key = apiKey() } = {}) {
  const qs = new URLSearchParams(params).toString();
  const out = execFileSync("curl", [
    "-sS", "--compressed", "--max-time", "60",
    "-H", `Ocp-Apim-Subscription-Key: ${key}`,
    `${BASE}/${path}?${qs}`,
  ], { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
  return JSON.parse(out);
}

// XIT001: 不動産価格(取引価格)情報。year は必須、city は市区町村コード(北区=13117)
export function tradePrices({ year, area = "13", city, quarter } = {}) {
  const p = { year: String(year), area };
  if (city) p.city = city;
  if (quarter) p.quarter = String(quarter);
  const j = fetchJson("XIT001", p);
  if (j.status !== "OK") throw new Error(`XIT001 が status=${j.status} を返しました`);
  return j.data ?? [];
}

// ---- 再掲サイト(house-deals.csv)との突き合わせキー ----
// 再掲側の丸め: 価格100万円単位 / 面積5m2単位。APIの生値に同じ丸めを掛けて比較する。
export const roundTo = (v, unit) => (v == null || !Number.isFinite(v) ? null : Math.round(v / unit) * unit);
export const quarterOf = (period) => {
  const m = String(period ?? "").match(/(\d{4})年第(\d)四半期/);
  return m ? `${m[1]}Q${m[2]}` : null;
};
export function matchKey(rec) {
  const price = Number(rec.TradePrice), area = Number(rec.Area), floor = Number(rec.TotalFloorArea);
  const q = quarterOf(rec.Period);
  if (!q || !Number.isFinite(price)) return null;
  return [q, rec.DistrictName, roundTo(price / 1e4, 100), roundTo(area, 5), roundTo(floor, 5)].join("|");
}

// 戸建(宅地=土地と建物)の住宅地レコードだけを残す。マンション・土地のみ・工業系は対象外
export const isHouse = (r) => r.Type === "宅地(土地と建物)" && r.Region === "住宅地";

// ---- CLI: REINFOLIB_API_KEY=xxx node crawler/reinfolib.mjs [city] [fromYear] [toYear] ----
if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  const [city = "13117", from = "2022", to = String(new Date().getUTCFullYear())] = process.argv.slice(2);
  const all = [];
  for (let y = Number(from); y <= Number(to); y++) {
    const rows = tradePrices({ year: y, city });
    all.push(...rows);
    console.error(`${y}年: ${rows.length}件(うち住宅地の戸建 ${rows.filter(isHouse).length}件)`);
  }
  const houses = all.filter(isHouse);
  const pct = (n) => `${((n / houses.length) * 100).toFixed(1)}%`;
  console.error(`\n合計 ${all.length}件 / 住宅地の戸建 ${houses.length}件`);
  console.error(`  形状の記載率: ${pct(houses.filter((r) => r.LandShape).length)}`);
  console.error(`  前面道路の種類: ${pct(houses.filter((r) => r.Classification).length)}`);
  console.error(`  間口: ${pct(houses.filter((r) => r.Frontage).length)}`);
  process.stdout.write(JSON.stringify(all));
}
