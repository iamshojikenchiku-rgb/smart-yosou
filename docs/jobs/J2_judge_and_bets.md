# J2 — 判定・買い目メモ（土・日 07:30 JST・定時）

## 目的
投入されたスクショから **全頭JSON** を作り、`scripts/judge.js` で判定して、その日の買い目メモを出す。

## 入力
- `docs/jobs/README.md`（共通セットアップ・共通ルール・ファイル名規約）
- プロジェクト知識 `claude/weekly/YYYY-MM-DD_候補.md`（J1 の成果物。人の承認・差替コメントを含む）
- プロジェクトのファイルのうち、**当日の `YYYYMMDD_` で始まる png**（出馬表・血統・推定人気・オッズ）
- `docs/operation_flow_definition.md` §2 ステップ4（JSON作成ルール）と `docs/血統エンジン設計アドendum — F層`（`chichi_mei` の扱い）
- `data/ledger.json`（予算ガード）

## 手順
1. 共通セットアップ。`npm run check` が不合格なら「ツール検証NG」で終了（判定しない）。
2. 当日の png を列挙する。**1件も無ければ「入力待ち」で終了**（推測でJSONを作らない）。
3. スクショから 1 レースにつき 1 つの入力JSONを作る（`data/inputs/_example_input.json` が雛形）。
   - **全頭入力**（下位人気も省略しない）。読めない値は空文字にし、メモに「未読取: 馬番○ の est_pop」等と書く。
   - `est_pop` は SmartRc の推定人気。`pop_tan`/`odds` はスクショ時点の単勝人気・オッズ。
   - `chichi_kei` は SmartRc 表示の小系統名そのまま。種牡馬名が読めれば `chichi_mei` も入れる。
   - 複勝オッズが読めれば `odds_fuku`（下限値）。無ければ省略（G層は「率のみ」表示になる）。
   - `race.isAreru` は、候補メモで ARERU_RACES 該当と書かれている場合のみ true。それ以外は false（**判定を甘くする目的で ON にしない**）。
   - `courseType` は候補メモの想定値。
4. 判定:
   ```bash
   node scripts/judge.js <input.json> --ledger data/ledger.json --date YYYY-MM-DD --out <result.json>
   node scripts/judge.js <input.json> --ledger data/ledger.json --date YYYY-MM-DD --md
   ```
   `judge.js` がエラーなら「要確認」で終了（自分で判定を書かない）。
5. 成果物を書く（下記）。`decision` が「見送り」「予算超過のため見送り」のときは、冒頭に見送りと理由を置き、買い目は「参考表示（購入しない）」と明記する。
6. 入力JSONは成果物末尾に**全文**貼る（人がタブレットのツールに貼って同じ結果を再現できるように）。

## 出力
プロジェクト知識 `claude/weekly/YYYY-MM-DD_買い目.md`:

```
# YYYY-MM-DD 判定・買い目
## 結論
- <レース名>: **購入可 / 見送り（理由）**  合計 ○○円
## <レース名>
<judge.js --md の出力をそのまま>
### 所見（参考・買い目には反映しない）
- 血統・馬場・展開についてのClaudeの補足。買い目を変える提案はここに書かず docs/ への提案メモにする。
### 入力JSON（ツールに貼る用）
```json
{ ... }
```
## 未読取・要確認
- …
```

## 終了条件・禁止
- スクショが無い／読めない → 買い目を出さない。
- `judge.js` の出力を書き換えない（馬番の入替・金額の増減・券種の変更を含む）。
- 🛑/🚫/⚠️ の日に「それでも買うなら」と書かない。
