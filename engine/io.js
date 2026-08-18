// engine/io.js — YAML読み込み(CLI・サイトビルダー・テスト共用)
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// js-yamlは vendor/ に単一ファイル同梱(v4.1.0 MIT)。npm install不要・オフラインビルド可
import yaml from "../vendor/js-yaml.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadYaml(path) {
  return yaml.load(readFileSync(path, "utf8"));
}

export function loadAreaConfig() {
  return loadYaml(join(ROOT, "market", "area-config.yaml"));
}

export function loadProperty(id) {
  return loadYaml(join(ROOT, "properties", `${id}.yaml`));
}

export function listPropertyIds() {
  return readdirSync(join(ROOT, "properties"))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""))
    .sort();
}

// ---- 賃貸台帳(rentals/)。購入台帳(properties/)とは別ディレクトリ・別エンジン ----
export function loadRental(id) {
  return loadYaml(join(ROOT, "rentals", `${id}.yaml`));
}

export function listRentalIds() {
  try {
    return readdirSync(join(ROOT, "rentals"))
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => f.replace(/\.yaml$/, ""))
      .sort();
  } catch { return []; }        // 賃貸台帳が無いリポジトリでもビルドが通るようにする
}
