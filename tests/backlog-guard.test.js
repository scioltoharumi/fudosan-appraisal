// 棚卸しガード(2026-09-19)。
// 事故の型: 2026-08-29の土地クロールで機械審査(KO1〜KO6・丁目ハザード)を全通過した13掲載が、土地を自動登録対象に変えた
// 9/1〜9/2の方針変更後も**誰にも登録されず3週間放置**されていた(seen.json には ko_screened=true が付いているだけで、
// 「審査済み・登録待ち」と「審査済み・登録済み」を区別する印が無かった)。9/19の棚卸しで9件を登録・4件は既に404。
// このテストは「審査を通った掲載は、台帳(source_url/crawl_ids)か除外台帳か、圏外/KO/消失/重複疑いの印のどこかに必ず落ちている」
// ことを固定する。落ちたら『登録漏れ』か『印の付け忘れ』のどちらかなので、日次クロールで拾って処理すること。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("棚卸しガード: 審査通過(ko_screened)の既見掲載は台帳・除外台帳・判定印のどこかに必ず落ちている", () => {
  const seen = JSON.parse(read("market/crawl/seen.json"));
  const excluded = JSON.parse(read("market/crawl/excluded.json"));
  const excludedText = JSON.stringify(excluded);   // 別媒体IDは reason/note の本文に書かれる(nc_21587170 の記録に at_1195752621)
  const ledger = readdirSync(new URL("properties/", root)).filter((f) => f.endsWith(".yaml")).map((f) => read(`properties/${f}`)).join("\n");
  const unaccounted = [];
  for (const [id, v] of Object.entries(seen)) {
    if (!v?.ko_screened) continue;                         // 未審査・詳細未取得は needsRescreen の担当
    if (v.ko_blocked || v.out_of_scope || v.ko_suspect) continue;   // 判定済み(人の判断待ちの suspect を含む)
    if (v.gone_404 || v.duplicate_suspect) continue;      // 登録前に消えた / 同一区画の疑いで登録しない(印で理由を残す)
    const num = id.replace(/^(nc|at)_/, "");
    if (ledger.includes(num) || excluded[id] || excludedText.includes(id)) continue;
    unaccounted.push(`${id}(${v.address ?? "?"}・${v.price_man ?? "?"}万・${v.kind ?? "?"})`);
  }
  assert.deepEqual(unaccounted, [],
    `審査を通ったのに台帳にも除外台帳にも印にも無い掲載: ${unaccounted.join(", ")}。登録するか、圏外/KO/gone_404/duplicate_suspect の印を理由つきで付ける`);
});
