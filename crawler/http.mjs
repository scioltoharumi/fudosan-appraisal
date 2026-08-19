// crawler/http.mjs — クローラ共通のHTTP部品。
//
// 2026-08-19の監査で、UA・リクエスト間隔・タイムアウト・予算つき fetch が
// daily.mjs / rent-daily.mjs / rent-pool.mjs の3ファイルに重複していることが分かった。
// **相手サイトへの礼儀に関わる設定(間隔2秒以上)が散っていると、片方だけ直したときに静かに破れる**
// ため、ここに1つだけ置く。ドメイン知識(査定ロジック・市場データ)は含まないので、
// 「賃貸は購入エンジンと独立」という設計方針には抵触しない。
import { execFileSync } from "node:child_process";

export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
export const SLEEP_MS = 2200;        // 運用ルール: リクエスト間隔は2秒以上
export const TIMEOUT_S = 30;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1回取得する。HTTPステータスも返す(誤URLでも1ページ目を返すサイトがあるため、
// ステータスだけで「最終ページ」を判定してはいけない)
export function curlOnce(url) {
  try {
    const out = execFileSync("curl", ["-sS", "-L", "--max-time", String(TIMEOUT_S), "-A", UA,
      "-H", "Accept-Language: ja,en;q=0.8",
      "-w", "\n@@HTTP_CODE@@%{http_code}", url], { maxBuffer: 16 * 1024 * 1024, encoding: "utf8" });
    const m = out.match(/@@HTTP_CODE@@(\d+)\s*$/);
    return { html: out.replace(/\n@@HTTP_CODE@@\d+\s*$/, ""), status: m ? Number(m[1]) : 0 };
  } catch (e) {
    return { html: "", status: 0, error: String(e.message ?? e).slice(0, 200) };
  }
}

// 取得予算つきのフェッチャを作る。
// **上限到達は例外にしない**——投げるとレポートが1行も出ずに異常終了し、無人運用で沈黙する
// (2026-08-12の購入版の監査で実際に起きた)。exhausted フラグで返し errors[] に開示する。
export function makeFetcher({ maxPages, errors = [], sleepMs = SLEEP_MS } = {}) {
  let count = 0;
  const fetchPage = async (url, reserve = 0) => {
    if (maxPages != null && count >= maxPages - reserve) {
      errors.push({ where: "fetchPage", detail: `ページ上限${maxPages}(取り置き${reserve})到達につき取得を打ち切り: ${url}` });
      return { html: "", status: 0, exhausted: true };
    }
    if (count > 0) await sleep(sleepMs);
    count++;
    return curlOnce(url);
  };
  return { fetchPage, count: () => count, errors };
}
