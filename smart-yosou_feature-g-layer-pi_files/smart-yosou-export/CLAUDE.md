# CLAUDE.md — smart-yosou（Smart予想ツール）

## プロジェクト概要
- 日本中央競馬の血統ベース予想ツール。`index.html` 1ファイルで完結（React 18.2.0 UMD・Tailwind・変換済みJSをすべてインライン）。
- GitHub Pages で公開: https://iamshojikenchiku-rgb.github.io/smart-yosou/
- 主端末は Android タブレット。**外部CDN参照はゼロを維持**（過去にunpkg障害で黒画面）。
- 設計の正本は `docs/` 配下。実装前に必ず該当アドendumを読む。

## 絶対に変更しないもの
- 荒れスコア・軸信頼度・🛑/🚫/⚠️の閾値・予算ティア・買い目ロジック
- 既存JSONスキーマ（16キー）。追加は「任意キー」としてのみ許可し、後方互換を保つ
- 単一ファイル自己完結の構造

## コード変更の作法
- JSXは**classic runtime**で `React.createElement` へ事前変換されている。automatic runtime（`_jsxDEV`）は使わない。
- 関数をリネーム・追加したら**定義と呼び出し側を同一コミットで**更新する（名称不一致による黒画面歴あり）。
- 変更ごとに `npm run check`（Babel構文チェック → jsdomで `#root` 描画確認）を通す。通らない変更はコミットしない。
- 設計書にない仕様変更を思いついたら、実装せず `docs/` にメモとして提案する。

## 検証コマンド
```json
// package.json scripts（無ければ作る）
"scripts": {
  "check": "node scripts/check.js"
}
```
`scripts/check.js` の要件：
1. `index.html` 内の `<script>` を抽出し `@babel/core` でパース（構文エラーで失敗）
2. jsdom で `index.html` を読み込み、`#root` に子要素が描画されることを確認
3. `http://` / `https://` の外部スクリプト参照が0件であることを確認

## ドメイン用語
- 血統エンジン A〜F層（A:父系×条件 / B:母系 / C:産駒世代 / D:騎手 / E:母実績 / F:種牡馬個別）
- 新設予定 G層 = π参考値（**表示のみ**、判定に不使用）
- `KEITOU_TYPE`: 小系統→内部タイプ（sunday_stamina, france_eu, sunday_dirt 等）
- `ARERU_RACES`: 荒れやすいレース一覧
- `SIRE_PROFILES`: 種牡馬別の買い・消し
- 「推定人気」= `est_pop`（SmartRc由来）。「推奨人気」ではない

## コミット
- 日本語メッセージ。1モジュール1コミット。`feature/*` ブランチで作業し、`main` へのマージは人が確認してから。
