# センリョウ 手動操縦・照準修正の検証（2026-11-07）

[承認済み計画](https://github.com/chameleonjp-lab/zero-series/blob/main/docs/ZERO_SERIES_AIM_ASSIST_REMOVAL_PLAN_20261107.md) のR1、確認①〜④とセンリョウ固有条件に対応する候補です。main開始点は `5dc32d0e57bff6b7c77ef7f8b38d4b4672f01157`、作業branchは `fix/manual-camera-aim-20261107`。公開・マージはしていません。

## 変更と数値検査

- 空と地上の敵から自機への操縦補正、残留補正、敵配置による応答倍率を除去。倍率は1。Easyは確定した最新姿勢・画面比、既存の地形LOS、円内・1200mの条件で引き金だけを自動操作する。Normalは長押し射撃。左右MG・cannonの4発は自機正面へ発射する。
- 中央入力でも操縦指／キーが残ればpitchを保持し、解放後は既存の水平復帰へ戻る。高さだけのresizeは402×874→402×380の縦横比反転も含め、操作量・指・射撃の所有・保留中loop/bombを引き継ぎ、次の移動で座標を合わせる。回転・離脱・停止と指ごとのcancelは従来の解除を保つ。
- 60Hzの前後のposition、heading、pitch、bankを表示専用の`BattlePresentation`でつなぎ、自機・camera・対象・照準を同じmission sampleで描く。補間した弾も表示専用。戦闘・時計・結果には書き戻さない。開始・停止再開・結果・homeで明示resetし、復活／死亡／pilot交代には古い姿勢を混ぜない。
- Easyの地形回避は別系統で保持。予測は正確に3秒先・半径40m、危険時の絶対climbは0.85。下降・旋回・宙返り中断でも維持し、安全な高度／Normalでは介入しない。地形回避状態の表示も維持した。

| 実際の回帰検査 | Easy | Normal |
| --- | --- | --- |
| seed73・高度1500、敵なし／正面／円縁／画面端／背後／交差消失、空・地上敵、4入力×12tickの自機・camera | 完全一致、倍率1 | 同左 |
| 約20度、中央保持0.2秒、その後解放 | 保持中0度、解放後は水平復帰 | 同左 |
| 左右MG・cannonの初速と機体正面 | 差1e-12未満 | 同左、射撃解放時0発 |
| 最新aspect・射程・味方／死亡・実建物LOSの発射判定 | 合格 | 手動射撃を維持 |
| 120Hz相当、上昇0.45、48表示の同じ視線 | 0/48 | 0/48 |
| 30/60/120Hz表示時の確定飛行・弾・時計・結果 | 一致 | 一致 |
| 実MG/cannon発射→命中→敵撃破→kill/support得点→実時間切れ結果、120固定呼出し | 全authoritative field一致 | 同左 |
| reticleの円内出入・ID切替、alpha0/.5/1 | 表示対象と一致 | 同左 |
| 停止再開間にrenderなし、出生・死亡・pilot交代 | 古い姿勢なし | 同左 |
| 地形回避3秒／40m境界、下降とloop中断 | 既存絶対上昇・状態切替を維持 | 地形回避なし |

短い表示頻度比較では実行ごとに付くmissionIdだけを弾の比較から除き、全physics値とbattle hashを比較する。追加の`battle-presentation-combat.test.ts`は両モード×30/60/120Hzで実発射・命中・撃破・kill/support・実時計の期限によるdraw結果を実行する。各120固定呼出しで全authoritative field（Map/Set、undefined、aliasを含む）をstructuredClone＋v8 serializationで比較し、正規化は毎回固有のmission nonceだけ。各表示でsample、projectile sample、camera、gun sight前後の全状態不変も確認する。結果後30呼出しの凍結も一致した。CPU表示検査はGPU実測や実機touchではない。実際の`main.ts`の停止・再開・画面変更関数を取り出したVM検査は、resetを除くmutationで古い姿勢を再現し、修正版で現在状態を表示する。

## RED→GREENと実行結果

修正前のfocused検査は12件中7失敗で、追尾・中央保持・弾の向き・高さresize・古い標的の保持を再現した。従来の実`BattleView.render` CPU再生では、両モードとも120Hz相当で24/48の視線が直前と同じだった。修正後は0/48。新しい表示専用sampleはauthoritative hashを変更しない。追加レビューで実mainのresize callbackと幅不変の縦横比反転による入力解除を各REDで確認し、height-onlyを保持、幅変更／実orientationchangeは解除する修正後に合格した。実main callbackを取り込むEventTarget検査で保留操作の保持も確認した。旧追尾を要求する期待値だけを更新し、既存の手動感度・throttle・AI・戦闘・地形・score・storage・workflowは保持した。

| コマンド／対象 | この候補での結果 |
| --- | --- |
| `npm test` | 261/261合格、0 skip |
| `npm run build` | 合格。既存の500kB chunk警告のみ |
| `node browser-tests/ui-only/check-fixture.mjs` | 合格。実setScreenの追加resetをstubへ接続し、実ソースbody/hashを再固定 |
| `npx tsc --noEmit -p tsconfig.ui-only.json` | 合格 |
| `node browser-tests/ui-only/validate-vite.mjs` | 16変換合格 |
| 既存publication workflowの静的artifact検証 | 合格。symlink・許可外file・sourcemap・devhookなし、相対asset参照・notice一致、全file SHA-256を記録 |
| pinned throttle baseline `71b0e5bc9ffbe2cbd1f295160b9e8e3c40ad6650` 比較 | baseline checkoutと依存を準備。1tickの実simulationで新しい独立oracleのpitch/bank/speed/camera角を確認。baseline応答1.0416666666666667、候補1、他のcontroller値は一致 |
| 既存throttle／smoke／UI-only capture browser gates | 待機中。共有4CPU環境のbrowser slot解放後または候補と同treeのCIで実行 |
| 通常出撃、両モード、縦402×874／横874×402／短い縦402×700 | 自動browser受入は未実行 |
| iPhone 17 Pro Safari・ブラウザバー・回転・停止再開 | 実機未確認 |

throttleの独立比較oracleは候補の敵由来倍率だけを1へ更新し、baselineの旧倍率、速度目標110.3、pitch/bank/heading・実速度・変位・資源・全ての他controller値の厳密検査を保持した。browser gateのskip条件・timeout・workflowは変更していない。端末の表示間隔中央値／p95は未測定。

候補buildのJSは `index-CXVdiGu5.js`、SHA-256 `c2b33704dbec1c7cee092a4a2067210e6ca17fcdf2a5ba43ae736fff178cf649`。CSSは公開版と同じ。

## 開始公開版と公開後の欄

開始時の実ページ `https://senryou.chameleonjp.chatgpt.site/` のHTML・JS・CSSをTLS検証付きで取得し、開始mainから同設定で作ったファイルと全バイト一致を確認した。deployment識別値は `129ea7f04ac72c236f267c8e8be1dc78c397794a`（開始mainとの差はREADMEのみ）、release.jsonは404。実配信JSは `index-CuWH0-8v.js`、SHA-256 `b929f7763b9b90f22e8c946619b448337f12b9c28f6fa48030ed21b5b11f24a4`。

当該開始版の数値再現では、右105・前500と背後500でEasy約2.5452度、Normal約0.50917度のcamera差、中央保持0.2秒で両モード約9.38618度のpitch復帰があった。別作品の測定値ではない。

本人のマージ・公開後の新しい配信ファイル照合は未実施。新規タブと古いタブのreloadでHTML／JS／CSSを候補版から作った全バイトと比較し、実機受入とは別に追記する。
