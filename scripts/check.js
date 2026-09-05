#!/usr/bin/env node
/**
 * scripts/check.js — index.html の検証（CLAUDE.md「検証コマンド」）
 *
 *  1. index.html 内の <script> を抽出し @babel/core でパース（構文エラーで失敗）
 *  2. jsdom で index.html を読み込み、#root に子要素が描画されることを確認
 *  3. http:// / https:// の外部スクリプト参照が 0 件であることを確認
 *
 * 要件3の運用（2026-09-05 決定・docs/実装メモ_G層π参考値_v0.1.md 参照）:
 *   変更前から存在する Tailwind CDN と Google Fonts は「既知の例外」として
 *   警告表示に留め、それ以外の外部スクリプト／外部リンク参照が増えた場合のみ失敗させる。
 *   `npm run check -- --strict` で例外なしの厳格モードになる。
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const INDEX = path.join(ROOT, "index.html");
const strict = process.argv.includes("--strict");

// 変更前（0da1226）の index.html にすでに存在していた外部参照
const KNOWN_EXTERNAL = [
  "https://cdn.tailwindcss.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

let failed = false;
const ok = (m) => console.log("  ✔ " + m);
const warn = (m) => console.log("  ⚠ " + m);
const ng = (m) => {
  failed = true;
  console.log("  ✖ " + m);
};

const html = fs.readFileSync(INDEX, "utf8");

// ---------------------------------------------------------------
// 1. 構文チェック
// ---------------------------------------------------------------
console.log("[1] Babel 構文チェック");
const scriptRe = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let m;
let idx = 0;
while ((m = scriptRe.exec(html)) !== null) {
  idx++;
  const attrs = m[1] || "";
  const body = m[2];
  if (/\ssrc\s*=/.test(attrs)) continue; // 外部参照は要件3で扱う
  if (!body.trim()) continue;
  try {
    babel.parseSync(body, {
      filename: `index.html#script${idx}`,
      babelrc: false,
      configFile: false,
      parserOpts: { sourceType: "script", allowReturnOutsideFunction: false },
    });
    ok(`script#${idx} (${body.length.toLocaleString()} 文字) パースOK`);
  } catch (e) {
    ng(`script#${idx} 構文エラー: ${e.message.split("\n")[0]}`);
  }
}
// automatic runtime の混入チェック（CLAUDE.md: classic runtime のみ）
if (/_jsxDEV\(|_jsx\(|_jsxs\(/.test(html)) {
  ng("automatic runtime (_jsx/_jsxDEV) の呼び出しが混入しています");
} else {
  ok("automatic runtime (_jsx/_jsxDEV) の混入なし");
}

// ---------------------------------------------------------------
// 3. 外部参照チェック（先に判定して jsdom のネットワーク挙動を説明しやすくする）
// ---------------------------------------------------------------
console.log("[3] 外部参照チェック");
const extRe = /<(script|link)\b[^>]*\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi;
const externals = [];
while ((m = extRe.exec(html)) !== null) externals.push({ tag: m[1].toLowerCase(), url: m[2] });
const unknown = externals.filter((e) => !KNOWN_EXTERNAL.some((k) => e.url.startsWith(k)));
const known = externals.filter((e) => KNOWN_EXTERNAL.some((k) => e.url.startsWith(k)));
if (externals.length === 0) {
  ok("外部 script/link 参照 0 件");
} else {
  for (const e of known) {
    if (strict) ng(`外部参照（strict）: <${e.tag}> ${e.url}`);
    else warn(`既知の外部参照（変更前から存在・要件3の例外扱い）: <${e.tag}> ${e.url}`);
  }
  for (const e of unknown) ng(`新規の外部参照は禁止: <${e.tag}> ${e.url}`);
}

// ---------------------------------------------------------------
// 2. jsdom 描画チェック
// ---------------------------------------------------------------
console.log("[2] jsdom 描画チェック");
(async () => {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => {
    const msg = String(e && e.message || e);
    // 外部リソース取得は resources を未設定にしているため発生しない想定だが念のため無視
    if (/Could not load/.test(msg)) return;
    errors.push(msg);
  });
  vc.on("error", (...a) => errors.push(a.map(String).join(" ")));

  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: "https://iamshojikenchiku-rgb.github.io/smart-yosou/",
    // resources 未指定 = 外部 <script src> は読み込まない（Tailwind CDN が無くても描画できることの確認にもなる）
  });
  dom.window.confirm = () => true;
  dom.window.alert = () => {};

  await new Promise((r) => setTimeout(r, 300));
  const root = dom.window.document.getElementById("root");
  if (!root) ng("#root が存在しません");
  else if (root.children.length === 0) ng("#root に子要素が描画されていません");
  else ok(`#root に ${root.children.length} 個の子要素を描画（テキスト ${root.textContent.length.toLocaleString()} 文字）`);
  for (const e of errors) ng("実行時エラー: " + e.split("\n")[0]);

  dom.window.close();
  console.log(failed ? "\nNG: check に失敗しました" : "\nOK: check 合格");
  process.exit(failed ? 1 : 0);
})();
