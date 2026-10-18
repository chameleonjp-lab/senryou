# ゼロシリーズ 操作・標的・照準の検証記録

対象 `senryou`、開始main `43b1073fd9d9ee2285032787ca691e6a506fa647`、作業branch `codex/zero-series-aim-camera-20261012`。ユーザーの2026-10-11修正依頼と「8件ともPRまで」の再開指示に基づく。mainへの変更・merge・Ready化・公開は行わずDraft PRまで。

## 差分と回帰

実Battle controllerへ保持ID/slewを接続。既存terrainLineOfSightを実建物で検査。3秒先/半径40m/最低climb0.85の地形保護を維持し、既存control-statusと説明に介入表示を追加。

共通A/B円内優先・候補順・20cm距離逆転・保持余裕境界0.015±誤差・微小操縦所有・逆方向入力・死亡/画面外/消失・再生成世代・slew解除・同tick射撃再検証を追加した。具体的な適用範囲とHUD役割差は[共通契約](ZERO_SERIES_AIM_CONTRACT.md)参照。0.015は新設計でユーザー指定の測定値ではない。

赤は1500m円内敵接触で、保持ID/1200m射撃可能ではない。UI-only extraction manifestは許可された製品deltaへ再固定し、他のdrift拒否を保持。

## 実行結果

| 層 | コマンド/証拠 | 結果・限界 |
| --- | --- | --- |
| 単体 | `npm test` | **234 pass / 0 fail / 0 skip、終了0**。描画停止回帰6件を含む最新の製品sourceとtestを検査。 |
| 型/製品build | `npm run build` | 終了0。TypeScript noEmitとVite製品bundle。既存chunk-size警告あり。 |
| 関連browser（前回head） | `PLAYWRIGHT_BROWSERS_PATH=<browser-cache> npx playwright test --config=playwright.throttle.config.ts --project=chromium --project=chromium-smoke --workers=1` | 20 pass / 4既存skip（合格件数へskipを含めない）。前回headの記録で、今回の描画修正後の全suite合格を意味しない。 |
| 今回の実DOM smoke | `PLAYWRIGHT_BROWSERS_PATH=<browser-cache> npm run test:browser -- --config=playwright.throttle.config.ts --project=chromium-smoke` | **3 pass / 0 fail / 0 skip、終了0**。393×648、568×320、1280×720で設定・ルール・Easy開始・停止/再開・終了/result・Normal再開始。page/console errorと外部通信違反0。 |
| 旧版Normal比較 | `PLAYWRIGHT_BROWSERS_PATH=<browser-cache> THROTTLE_BASELINE_DIR=<pinned-71b0e5-checkout> npm run test:browser -- --config=playwright.throttle.config.ts --project=chromium --grep 'same-condition before-after'` | **4 pass / 0 fail / 0 skip、終了0**。4viewport、同seed・1tick・paused。旧schema全fieldのpayload一致＋新targetLock厳密中立性。製品raw hashは保持。 |
| Normal実進行 | `node --import tsx docs/evidence/aim-camera/verify-normal-fire.mts` | 同seed20261011、3操縦条件×12tickのfire on/off、位置/姿勢/速度/名目camera一致。自機発射8対0、36tick組。製品公開simulation APIを実行。 |
| 製品画面 | 5viewport×DPR1/2×Normal/Easy=20画像 | Chromium 153.0.8010.0 / SwiftShader、実buildと通常DOM操作。fixture注入なし。日本語fontあり、page error 0。回転/負荷で保護停止のlast frameが含まれ、20枚すべての連続飛行は主張しない。 |
| 入力所有 | 追加EventTarget検査＋上記関連browser | 模擬EventTargetと実DOM経路を実iPhoneから区別。 |
| WebKit/iPhone | 未実行 | 公式browser取得が不正archiveで失敗し、WebKit binary/実端末なし。申告症状は未確認・未解決。 |
| 描画FPS/実機 | 未実行 | 固定60Hz論理を維持。実描画30/60/120Hzの比較合格やhardware性能を主張しない。 |

実行したsource/test/scriptのSHA256・log hash・記録日時、20viewportのDOM測定/画像hashは[evidence.json](evidence/aim-camera/evidence.json)。Normal対照の実行scriptと[result](evidence/aim-camera/normal-fire-result.json)も保存した。PR本文に接続先から返った最終head SHAと、ローカルindex treeとの一致を記す。自己参照を避け、evidence.json自体のhashは同JSONへ入れない。公式Playwright 1.61.1想定Chromiumとは異なるfallback binaryであるため、標準browser取得の成功とは扱わない。repositoryの依存・CI・fontを追加変更していない。

## 失敗・画像確認・残件

初回head `9888039e1753faa6712f8528eab61571cc86feb8` のActions run `38157524049` は30 pass / 10既存skip / 5 fail。4件のbefore-afterは追加したcontroller.targetLockだけでraw hashが変わるため失敗した。製品battleHashを変更せず、検査側でその1fieldだけを分け、旧controllerの11field一覧とmode/core/combat/controllerの全payload一致、旧raw hashと新旧schema hash一致を検査する。新targetLockは余分fieldも許さず `{key:null,manual:false,changed:false}` を要求し、地形保護も非介入を確認。raw hashと両版の比較payloadはassert前に保存する。変更後4viewportとも合格、実測payload・hashは[比較記録](evidence/aim-camera/ci-comparison-followup.json)に保存した。元の勝利/停止・入力・保存検査をskip化せず、時間制限も変更していない。

前回head `56b5eb3db9ce0ae954df2651324c885ea195d03a` のrun `38159359366` は34 pass / 10既存skip / 1 fail。PC smokeの再開ボタンが描画保護後に隠れ、120000msで失敗した。初回CIではcandidate・pinned baselineの両方が保護停止になったが、旧版の失敗は免除にしない。

今回、pausedでtickが変わらない同一3D画面の再送信と、graphics failure後も次のrAF/描画を続ける実経路を修正した。最後の必要なpausedフレームは描き、tick/mode/HUD/resize/LOD/guide/camera/mission変更は失効させる。保持フレームの前にもGLをpollし、pending中に変更を消費しない。runningとresultの描画、固定60Hz論理、1000ms watchdog、モデル・画質・解像度を変更しない。UI抽出manifestはwhole-file SHA2件だけを再固定し、13 UI function / 8 Canvas methodのdigestと拒否検査を維持した。

実ブラウザーの観測では、変更前はpaused tick84固定のままsubmitted3→14、ready=true→false。変更後はtick79固定でsubmitted4→5（最後の変更フレーム）→完了、ready=trueを維持した。同じ描画内容は258666 triangles / 199 calls。これはLinux SwiftShaderの限定観測で、実機FPSやあらゆる負荷の保証ではない。変更前PC smoke自体はローカル1件合格だったため、元CIの失敗を同一条件で完全再現したとは扱わない。修正後の3 smokeは合格。21件予定の追加Chromium throttle実行は10件の成功までのlogしか残らず、最終summary未取得のためsuite合格として数えない。最新headの必須CIは別途確認してPR本文に記す。

今回のPC画像：[Easy HUD](evidence/aim-camera/ci-resume-pc-hud.png)、[停止と有効な再開ボタン](evidence/aim-camera/ci-resume-pc-pause.png)。既存のsmoke証拠は上書きせず、今回のhash・観測値・logは[evidence.json](evidence/aim-camera/evidence.json)のci_followupへ分離した。独立読取reviewで追加差分に必須修正指摘なし。実iPhone/WebKitの受入は未実施のまま。

最初のbrowser取得/実行には環境起因の不正archive・SwiftShader準備timeoutがあった。ウチオトセの初回はasset接続resetで1失敗し、同sourceの再実行で合格。ファンタジアの旧font横protected 200%配置は変更前mainでも失敗し、実測fixtureを追加して製品layoutを修正。日本語fontの縦respawnで追加失敗を見つけ、旧fontも守る15000回probe＋残予算fallbackで修正し、最新469単体と指定8browserを再検査。失敗をskipやbudget縮小/寸法縮小で隠していない。これらは各作品へ同じ失敗を帰属させる説明ではなく、シリーズ共通の検証環境と個別是正の記録。

実画像を開いて確認した：[Normal/Easy縦画面](evidence/aim-camera/portrait-comparison.jpg)、[5viewport DPR1](evidence/aim-camera/viewport-contact.jpg)、[DPR2](evidence/aim-camera/viewport-dpr2.jpg)、[停止/設定](evidence/aim-camera/pause-settings.jpg)。画像は実製品PNGから内容を変えず縮小/並置した閲覧用JPG。セーフエリア/200%文字拡大は各指定UI suiteの検査範囲に限り、通常製品20画像がその全受入を代用しない。画像では狭い画面の戦況/距離labelが密で、地形色とのcontrastにも余地がある。R1全面HUD刷新は範囲外で、全表示の可読性合格とは扱わない。地形回避のactive表示は論理検査/UI寸法を確認したが、実戦危険接近時の実機視認は残件。

独立した読取reviewで同ID実経路、実遮蔽、Normal camera/照準、入力所有、guardの許可差分を確認。ゲキチンは実scene.renderをGPUだけ省いた独立camera投影で5viewport/沈没0・2・4.9秒を検査し、誤差1e-8 CSS px未満。論理/自動検査の成立と人間の実機受入は分ける。

射撃時の上下ずれは次のように切り分ける。ボタンfireだけではこの短いNormal対照でpitch/camera差を再現しない。1指持替えは操縦release→climb=0→既存水平復帰が起きるのでfire起因と断定しない。Easy標的補助の不一致とゲキチンNormal固定照準/衝突cameraは別の確認済み経路として修正。センリョウの危険時自動上昇は射撃とは別の保護。実iPhone特有のpointer capture/イベント順序は引き続き未確認。

マージ前iPhone手順：(1)Normalで操縦指の微上下を維持し別指で射撃、射撃指のみ離す/移動。(2)操縦指を離して同じ指で射撃し、release時の水平復帰と比較。(3)Easyの円内A/画面端B・遮蔽・微入力で標的/発射を確認。(4)ゲキチン母艦近傍・bank/上昇、センリョウ安全高度/危険接近で照準/回避表示を見る。(5)回転→停止→設定Save/Cancel→明示再開、速度目標とfresh inputを確認。上下ずれが残れば作品/mode/iPhone・iOS/指操作/場面を記録。実機受入とmergeは利用者が行う。

## 2026-10-18 Easy追尾開始時の上下反転対策

確認日時：2026-10-18 12:31 JST。比較元mainは `c3cba7f89d9628e4d0231aab7c420dcd2ac1fafa`。本節より前の検査・画像は各記載時点の記録で、今回の実機確認を意味しない。

Easyの両軸無入力時だけ、追尾pitchの平滑化をゼロではなく現在姿勢から開始する。新規捕捉・対象切替・再捕捉・ゼロ通過を区別し、微小手動入力へ戻るときは絶対姿勢の履歴を相対角速度へ持ち越さない。turnだけの入力でも、任意の `steeringActive` が省略されても手動経路へ戻る。既存の対象選択、yaw、地形回避の優先順位、Normal制御は変更しない。

今回の変更は既存5ファイルに限定：`src/flight-target.ts`、`src/battle/simulation.ts`、`tests/flight-target-regression.test.ts`、`tests/battle-integration.test.ts`、本書。

- 変更前sourceで新規helper回帰と実battle捕捉回帰が失敗することを確認。実battle回帰は画面内の上下標的・現在pitch正負・安全高度を使い、terrainAvoidanceActive=falseで逆向きの初動を検出する。
- 変更後 `npm test`：251件合格、失敗0、skip0。捕捉後turn-onlyの任意flag省略ケースも含む。
- `npm run build`：TypeScriptとVite成功。既存の500kB超bundle警告あり。
- 独立読取レビューでsourceと回帰検査を確認。旧helperとの相対入力比較も一致。
- 今回はローカル論理・build検査まで。CIの最新head結果はPRへ記録する。ブラウザー描画・iPhone実機での体感改善、マージ、本番反映は未実施。

旧版は上記固定main commitに保持。復元はこの差分のrevertで可能。公開先は同じ公開リポジトリのDraft PRで、追加素材・依存・workflowの変更は含まない。

### 同日12:39 JST：初回CIのcontroller構造差分を修正

初回head `e1322196216f3a6388e324713d9620ff0ac2035b` の[CI run 39094036295](https://github.com/chameleonjp-lab/senryou/actions/runs/39094036295)で、単体/buildは成功、必須browserは31合格・10既存skip・4失敗。4失敗はNormalのcontrollerキー比較に `assistClimbMode: undefined` が現れる同一原因だった。製品smoke3件は合格したが、CI全体は失敗として保持する。

inactive・clear・対象変更時には不要になった任意modeキー自体を取り除き、既存Normal controllerの形を維持する。active状態ではmodeを保持し、ゼロ通過時の再初期化はしない。browser側の期待値・skip・時間制限は変更していない。既存承認済みファイル内で、初期inactive、activeから対象喪失・manual release・clearのキー一致回帰を追加した。修正後ローカル `npm test` は252/252合格、build成功、最終helper回帰16/16合格。再提出headのCIは別途照合する。
