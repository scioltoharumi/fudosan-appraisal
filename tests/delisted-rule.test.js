// 掲載終了疑いの5日超ルール(2026-09-13ユーザー決定「掲載終了疑いは5日を超えたら終了判定にしてよい」)。
// delisted_observed.days が5を超えた物件は台帳から外す(YAML削除+excluded.json に記録)運用なので、
// 台帳に残っていたらこのテストが落ちる=日次クロールで見落としたことを知らせる。
// 別媒体で掲載が続いている物件は「終了」ではなく source_url の張り替えで対応する(kamijujo5-21639876 が前例)ため、
// その場合は delisted_observed 自体を外すこと(days を持ったまま残さない)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadProperty, listPropertyIds } from "../engine/io.js";

const DELIST_MAX_DAYS = 5;

test("掲載終了疑いが5日を超えた物件は台帳に残さない(5日超ルール)", () => {
  const stale = [];
  for (const id of listPropertyIds()) {
    const p = loadProperty(id);
    const d = p.delisted_observed;
    if (d && Number(d.days) > DELIST_MAX_DAYS) stale.push(`${id}(${d.days}日)`);
  }
  assert.deepEqual(stale, [], `5日超の掲載終了疑いが台帳に残っている: ${stale.join(", ")}。YAMLを削除し excluded.json に記録する`);
});

test("5日超ルールで外した物件は excluded.json に『掲載終了』の理由で記録されている", () => {
  const ex = JSON.parse(readFileSync(new URL("../market/crawl/excluded.json", import.meta.url), "utf8"));
  // 適用済み: 上十条3(2026-09-13・10日目) / 滝野川6(2026-09-14・6日目)
  for (const [nc, label] of [["nc_20530443", "上十条3"], ["nc_21587170", "滝野川6"]]) {
    const e = ex[nc];
    assert.ok(e, `${label} ${nc} の除外記録`);
    assert.match(String(e.reason), /掲載終了/);
    assert.ok(!/土砂災害|がけ条例|浸水|警戒区域|ハザード/.test(String(e.reason)), `${label}: ハザード除外の語彙を含まない(KO4扱いにしない)`);
    assert.ok(e.site_match_keys && e.site_match_keys.land_m2 > 0, `${label}: 再掲載を照合する現場キーがある`);
  }
});
