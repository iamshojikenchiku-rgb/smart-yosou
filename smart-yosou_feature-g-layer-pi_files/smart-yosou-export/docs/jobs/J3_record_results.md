# J3 — 結果記録・蓄積（人の合図で起動。定時起動しない）

## 起動条件
人が結果スクショ（`YYYYMMDD_<レース名>_結果_<連番>.png`）をプロジェクトに追加し、チャットで「結果記録」と依頼したとき。
確定着順・確定馬場・払戻は**スクショが正本**。検索や記憶で補わない（前年結果に化ける危険）。

## 入力
- `docs/jobs/README.md`
- プロジェクト知識 `claude/weekly/YYYY-MM-DD_買い目.md`（J2 の成果物。入力JSON・買い目・購入可否）
- 結果スクショ
- 人からの申告: 実際に購入した金額・払戻額（J2 の買い目どおりでない場合はその内容）

## 手順
1. 共通セットアップ。
2. 結果スクショから 1〜3着の馬番・確定馬場・主要払戻（単勝・ワイド・3連複・3連単）を読み取る。読めない値は空欄。
3. J2 の入力JSONを `data/inputs/YYYY-MM-DD_<レース名>.json` として保存する。
4. バックテスト用レコードを作る（ツールと同じ `buildBacktestRecord` を使う）:
   ```bash
   node -e '
   const {JSDOM}=require("jsdom");const fs=require("fs");
   const html=fs.readFileSync("index.html","utf8");
   const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://iamshojikenchiku-rgb.github.io/smart-yosou/"});
   setTimeout(()=>{const build=dom.window.eval("buildBacktestRecord");
     const input=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
     const saved={race:input.race,horses:input.horses,savedAt:Date.now(),
       result:{rank1:"R1",rank2:"R2",rank3:"R3",date:"YYYY-MM-DD",final_baba:"BABA",purchased:"P",returned:"R",memo:""}};
     fs.writeFileSync(process.argv[2],JSON.stringify(build(saved),null,2)+"\n");process.exit(0);},300);
   ' data/inputs/YYYY-MM-DD_<レース名>.json data/samples/YYYY-MM-DD_<レース名>.json
   ```
   （R1/R2/R3/BABA/P/R をスクショと申告の値に置き換える）
5. 台帳に追記:
   ```bash
   node scripts/ledger.js add --date YYYY-MM-DD --race "<レース名>" --purchased <実購入額> --returned <払戻> --decision "<総合判定>" --bets "<買い目要約>" --memo "<一言>"
   ```
   見送りで購入しなかった場合は `--purchased 0` で記録する（見送り判定の答え合わせに使う）。
6. `npm run backtest` を実行し、出力の先頭（読込レース数・集計可能数・採用基準の判定）を成果物に貼る。**10レース未満は結論を出さない**。
7. 連対馬の種牡馬で `SIRE_PROFILES` に無いものがあれば、**追加案**として成果物に書く（実装しない。次アドendumで検証付きで追加）。
8. コミットと push:
   ```bash
   git checkout -b data/YYYY-MM-DD-<レース名>
   git add data/ && git commit -m "データ: YYYY-MM-DD <レース名> 結果・台帳・サンプル追加"
   git push -u origin HEAD
   ```
   push が拒否されたら、`data/samples/…json`・`data/inputs/…json`・台帳の追記行をプロジェクト知識 `claude/pending/YYYY-MM-DD_<レース名>.md` に保存し、成果物に「要取り込み」と書く。

## 出力
プロジェクト知識 `claude/weekly/YYYY-MM-DD_結果.md`:

```
# YYYY-MM-DD <レース名> 結果
- 確定: 1着 ○ / 2着 ○ / 3着 ○ / 馬場 ○
- ツール判定: <総合判定> / 買い目: <要約> / 購入 ○円 → 払戻 ○円（収支 ○円）
- 的中区分: 的中 / 軸的中・相手外れ（ねじれ） / 軸外れ / 見送り正解 / 見送り失敗
- 主な払戻: 単勝○円 / ワイド○-○ ○円 / 3連複 ○円 / 3連単 ○円（スクショにあるもののみ）
## バックテスト
<npm run backtest の先頭部分>
## F層 追加案（未実装）
- <種牡馬名>（<小系統>）: <根拠となる今回の実績>
## 今月の収支
<npm run ledger -- summary>
```
