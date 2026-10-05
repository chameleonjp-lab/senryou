# 独立実装レビュー

状態: 作業ツリーの独立レビュー。完全受入・実機性能合格・ゲーム公開承認ではない。  
担当: 実装担当から分離した `independent_review` エージェント。レビュー中のコード変更・commit・公開操作は行っていない。  
対象時点: 2026-10-05 03:39:42 UTC。ソース候補commitは `f96e9a9e17a1486e1e6b8e9df146168613f3487f`。ブラウザ検査と証拠文書を含む最終commitは別途固定する。

## 対象と証拠の固定

[REQUIREMENTS.md](REQUIREMENTS.md) と [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) を全文読み、有限台帳、復帰、占領、供給、終端、得点、弾・当たり判定、地形とAI、設定と入力、描画分離、障害停止、検証文書を照合した。実装途中で未作成だったファイルを欠陥として数えていない。

このレビューの非commit snapshotは [review-source-manifest.sha256](evidence/review-source-manifest.sha256) の62ファイルに固定する。生成には `sha256sum` を使用した。manifest自身のSHA-256は次の値である。

```text
56d0301d00262ff6985d22153e3b05b061a1457674cab5120665fb96bef3cffb
```

manifestには`src/`、`public/`、`tests/`、`browser-tests/`、`scripts/`と、ルートの実行・ビルド設定7ファイルを含む。生成物、依存ディレクトリ、README、更新中の検証文書、証拠ディレクトリ、本レビュー自身は含めない。ソース候補commitの57ファイルがmanifestと一致し、残る5ファイルは未commitのブラウザ検査3本、Playwright設定、campaign検査scriptであることを [independent-commit-binding.txt](evidence/independent-commit-binding.txt) で検査した。最終commitとこのsnapshotとの差分、および新しい検査ログの対応付けは統合担当が追記する。snapshotの一致は `sha256sum -c docs/evidence/review-source-manifest.sha256` で検査でき、今回の一致結果は [independent-source-check.txt](evidence/independent-source-check.txt) に保存した。

## 指摘と修正

P1は実際の挙動・停止・受入証拠を壊す指摘、P2は契約の不足や正確性の指摘。下表の「コード反映」は現在のソースを読み直した結果であり、最終候補の全体受入合格を意味しない。

| ID | 優先度・契約 | 発見した問題と再現条件 | 反映された修正・確認 |
| --- | --- | --- | --- |
| RV01 | P1 · R07/R12 | A機の初期headingが`+π/2`なのに初速は`+X`。継承機体のforwardは`-X`となり、最初の操縦tickで進行方向が逆転した。 | [terrain.ts](../src/battle/terrain.ts#L354)でA=`-π/2`、B=`+π/2`へ統一。修正前のforwardとvelocityの不一致を独立したadapter呼出しで確認した。 |
| RV02 | P1 · R11/A07 | 供給切断中や中立化進行の減衰中に`stableSince`を更新せず、再接続・進行0直後から出撃できた。連続10秒の安定を満たしていなかった。 | [capture.ts](../src/battle/capture.ts#L35)で未接続・中立・進行残存中も安定時計を更新。再接続と減衰後に600tick待つ回帰ケースを追加。独立64件実行に含まれ合格した。 |
| RV03 | P1 · R07/R15/A09/A17 | 航空機の弾判定がyawだけで、pitch/bankを無視した。`(0,100,0)`、pitch=`π/2`の機首を通る`(-2,104,0)→(2,104,0)`が非命中だった。 | [projectiles.ts](../src/battle/projectiles.ts#L94)で完全なYXZ変換と固定Kaisen由来の機体判定球を使用。垂直姿勢・bankの回帰ケースを追加。 |
| RV04 | P2 · R07 | 地形事故が機体中心の半径4.6mだけで、6m半翼幅や傾いた機首の接触を落とせた。 | [projectiles.ts](../src/battle/projectiles.ts#L125)で継承機体の5判定球を移動・姿勢変化とともにsweepし、[simulation.ts](../src/battle/simulation.ts#L66)と航空AIから共有。翼端・傾いた機首の検査を追加。 |
| RV05 | P1 · R07/R12 | 新しい姿勢sweepが宙返りの`2π−0.02→0`を逆方向のほぼ一周として補間した。中心y=20、床y=15では通常姿勢は無接触なのに宙返り末尾だけ衝突時刻約0.0853で損失になった。 | [projectiles.ts](../src/battle/projectiles.ts#L125)のheading/pitch/bankをすべて最短角で補間。独立担当が同じ床fixtureを再実行し、両ケースの無接触を確認。Euler正規化の回帰検査を追加。 |
| RV06 | P1 · R21/A11 | AAが全兵科共通のstable-ID順より先にpoolを消費し、容量不足時にB-AAがA航空機等より優先された。 | [combat.ts](../src/battle/combat.ts#L160)でAA計画を発射要求に分離し、共通の順序から消費。希少poolの回帰ケースが独立64件実行で合格。 |
| RV07 | P2 · R14/A21 | AI散布がA/Bを含むIDとworld軸に依存。無標的巡回はAが北、Bが南を選び、離脱・歩兵配置もx鏡像にならなかった。地形は南北対称ではない。 | 散布を陣営を除いたIDと機体軸へ変更し、銃口の対応も反映。航空巡回/離脱、歩兵の拠点周辺x配置と経路横隊の左右を陣営鏡像へ修正。個別銃口・飛翔速度・巡回・地上個体移動の鏡像検査を追加。全campaignの鏡像合格は未判定。 |
| RV08 | P1 · R16/A14 | hashがground AIの経路/交通/閉塞、予約・波の時計、phase、結果等を落とし、同等性検査が差異を見逃せた。 | [mission.ts](../src/battle/mission.ts#L55)と[simulation.ts](../src/battle/simulation.ts#L95)で作戦・戦闘・操縦の権威状態を含め、作戦nonceだけを正規化。完全な描画条件行列のA14は別の実行証拠が必要。 |
| RV09 | P2 · A21/A23 | 無入力の自機巡航をAI-onlyと誤認する危険があった。自機IDを単に消しても復帰処理で操縦対象が戻る。 | `createBattle(..., aiOnly=true)`と作戦の`controlEnabled`を導入し、全航空機をAIにし、復帰による再操縦を抑止。campaignがこの経路を使うことと結果分布は未受入。 |
| RV10 | P2 · R14 | Easy地上標的への補助に、予測地形回避を優先する枝がなかった。 | [simulation.ts](../src/battle/simulation.ts#L50)に3秒先・40m余裕の地形検査と上昇優先を追加。地上支援の通常操作・宙返りを含む試遊は残る。 |
| RV11 | P1 · R21/A20 | GPU fenceの失敗/1秒超stallでrendererが描画を止めても、mainが状態を無視し戦況を進め続けた。WebGL lossイベントだけでは全障害を捕捉しない。 | [main.ts](../src/main.ts#L186)でtick前にqueueを検査し、失敗/stallはPause・入力解放・再読み込み導線へ。render例外も安全停止。SwiftShaderでの停止観測は障害挙動の証拠であり、性能合格ではない。 |
| RV12 | P1/P2 · R20/A19 | mainが存在しない`keyboard.isPauseEvent`を呼び、入力表示observerのdisposeを省いていた。 | `matchesPause`へ統一し、`presentation.dispose()`を接続。保持キー/指の実解放が必要な入力ゲートを確認。 |
| RV13 | P2 · R10/A06 | 経路再探索で現在地から最近傍拠点へ直結すると、川や建物を横断するconnectorを選び、永久閉塞に戻り得た。 | [ground-nav.ts](../src/battle/ground-nav.ts#L91)で通行可能connectorから実道路へ接続し、道路頂点を辿る。最新96件の実行で経路・交通・回復、および18生存歩兵の地形/供給/占領を通した敵本拠地到達fixtureが合格。 |
| RV14 | P2 · R10/R19 | 論理経路警告は収集されていたがHUDに出ず、観戦中の閉塞理由が見えなかった。 | [main.ts](../src/main.ts#L114)で自機の有無によらず件数・理由を表示。意図した交戦待機は閉塞時計へ数えない。 |
| RV15 | P2 · R09/R14 | 車両の砲身が一体meshで固定され、独立した砲塔論理方向と見た目が一致しなかった。 | 詳細車両のarmament Group、簡易車両のarmament instanceを分離し、combatの砲塔方向へ追従。rendererから論理状態への書戻しは追加していない。 |
| RV16 | P2 · R21 | 非同期prepare中のcontext loss/dispose後にも準備成功を表示できた。shader準備が完了しない場合はStartが永久に準備中のままになり得た。 | [main.ts](../src/main.ts#L211)でawait後のlost/disposedを再検査し、30秒のPromise.race timeoutとfinallyのtimer解除を追加。失敗時にviewをdisposeして再読み込み導線を出す。遅れて完了するprepareもdisposed検査から成功状態へ戻らないことを読解確認。実ブラウザの異常検査は最終ログが必要。 |
| RV17 | P2 · R02/A24 | 移植台帳の一部が、UI/テスト変更後も「全バイト一致」と旧hashを表示していた。 | 検証担当がソース・移植先blob hash・差分理由を再生成。独立担当が台帳の対象hash全28行を`git hash-object`で照合し、一致を確認。最終証拠commitとの対応付けは残る。 |
| RV18 | P1 · R06/R13 | 統合担当の追加確認: AIから操縦を引き継ぐと、既存弾の17/57tick発射待ちが自機5/15tickへ即短縮され、引継ぎ直後に攻撃を得られた。 | [weapons.ts](../src/battle/weapons.ts#L67)で前回発射時の周期を保ち、その待ちが満了してから新規自機周期を適用。Unitに周期を明示し、新規active時だけ消去する。100tickにAI射撃→105tick引継ぎ時の発射0、117/157tickでの再発射を検査する回帰ケースを読解確認。 |
| RV19 | P1 · R21/A20 | 統合担当の実ブラウザ追加確認: shader compile後の2回の準備drawがGPUに残り、開始前から通常queueの1秒stall判定へ達した。 | [battle-view.ts](../src/battle-view.ts#L260)で準備drawの後に専用fenceを置き、GPU完了後にpreparedとする。待機はRAFごとのtimeout=0のpoll。25秒/WAIT_FAILED/context loss/disposeで失敗し、finallyでfenceを削除。独立mock fixtureで成功/失敗/中断・非blocking・削除1回を検査。実ブラウザ再実行は別の証拠が必要。 |
| RV20 | P1 · A21/A24 | campaignの鏡像比較が絶対拠点IDを保持し、A/Bの初期状態から不一致になった。死亡総数は毎tick消去される`mission.deaths`を読み、最終tick以外の損失を落としていた。 | [acceptance.ts](../scripts/acceptance.ts#L154)で累積死亡IDをunitの陣営へ照合。拠点を固定順のselfHome/selfRelay/north/center/south/enemyRelay/enemyHomeへ写像し、x反射でP2/P3/P4は保つ。独立担当が実scriptの式を抽出して鏡像所有と前tickの死亡2/1を検査し合格。 |
| RV21 | P2 · A16/A19 | smoke/画面比較が、絶対配置の子だけを持つ高さ0のHUD容器へ可視判定を行い、動作している画面も失敗扱いにした。 | 両harnessの待機対象を`#timer`へ変更。Normalの容器も実ボタン`#fire`で確認。試験誤りを除いた後の本当のGPU停止は、下記の2成功/1失敗として残す。 |
| RV22 | P1 · R09/R10/A06/A23 | 地形担当の追加統合確認: 戦略・増援口の距離評価が実経路長と一致せず、減員した攻撃分隊の前進fixtureが不成立だった。 | [terrain.ts](../src/battle/terrain.ts#L94)の共有`pointRouteDistance`を戦略と出撃元の評価に使用。18生存歩兵・2分隊本拠地防衛の実地形/占領fixtureが独立96件実行で合格。全戦闘campaignの代用ではない。 |
| RV23 | P1 · R10/A06/A23 | 統合担当の72,000tick診断で、`86b8dbd`のseed 1/Easy/Aがtick 29,399後は損傷なし、本拠地到達0、終端警告208件となった。入橋予約が入口への退却・横離脱で解除されず、橋外の横位置を無視して入橋扱いとなり、待機中の方向変更も残った。車両は橋幅へ整列する前に近接waypointを飛ばした。 | `f750433`の[ground-nav.ts](../src/battle/ground-nav.ts#L181)で要求方向/最終要求時刻を更新し、放置要求を3秒で除去。入橋をalong/across両軸で判定し、退却/横離脱から占有を解除。[ground-ai.ts](../src/battle/ground-ai.ts#L267)で橋幅・個体半径に応じ到着半径を制限。独立担当が新規3回帰検査だけを再実行し合格。修正後72,000tickは損傷895件/死亡426件、最長無戦闘2867tick、P3/P4をBが占領したが、本拠地到達は0でA23は未合格。 |
| RV24 | P1 · R21/A20 | 統合担当のSwiftShader比較で固定Kaisenはportrait飛行を継続したが、候補はGPU待機約1067msで停止した。 | `86b8dbd`は[landscape.ts](../src/battle-landscape.ts#L68)の地形標本間隔だけを30m→60mへ変更。shared height、川岸/塹壕の明示頂点、橋/建物の閉じたsolid座標は維持。論理地形を変更していないことを差分読解確認。再試験のphone縦/横は成功、PCは約1085msで停止し未合格。端末持続性能と標本間の外観は受入待ち。 |
| RV25 | P1 · R09/A21/A23 | 統合担当の診断で30秒ごとに有効な前線担当を失って橋で反転する部隊を観測。`f750433`は期限を迎えた全担当を負荷数へ数えず、一斉再割当時に前線を空と評価した。独立fixtureでも各担当点の100m手前に置いた10攻撃分隊のうち6分隊が1800tickに別の中央拠点へ変更した。 | `f96e9a9`の[ground-ai.ts](../src/battle/ground-ai.ts#L115)は全ての有効な非防衛担当を事前計数し、再評価する自分の旧寄与だけを引き、新担当を一度加える。計数済みIDを追跡して負数/二重加算を防ぎ、home優先・目標無効化・1800tickでの再評価と時計更新を維持。独立担当が同fixtureを再実行し変更0/10を確認し、担当更新/新規波の追加1回帰も合格。長期診断は別の実行中証拠として残す。 |
| RV26 | P1 · A21/A24 · coverage未実装 | `createBattle(seed,mode,playerTeam,true)`のA/Bケースは、絶対座標の個体/所有/IDが同じでscore視点だけを変える。物理的な陣営入替再生を独立に構成していない。同じglobal勝敗のvictory/defeatを視点変更で比較しても、物理鏡像campaignの証拠にはならない。 | 独立fixtureで初期・1tick後の全units/pointsが同じことを確認。統合担当がhelp/`mirrorCoverage`/full完了文と検証文書をperspective-onlyへ修正し、A21未合格を明示。相対所有/死亡の集計修正は有効だが、30seed×各mode×物理鏡像の構築/実行は未実装のまま。 |

`f96e9a9`では今回特定した進軍コードの修正と独立fixtureの改善を確認した。追加の未修正P1実行コード欠陥は特定していないが、RV26の物理鏡像coverageは未実装である。橋・担当更新の単体修正だけで長期戦況の解消を判定しない。修正前A23の実失敗、最終候補の診断待ち、PC browserのGPU停止は公開受入の残課題であり、下記ゲートを免除しない。

## 実行した検査と実行待ち

| 証拠 | 結果と適用範囲 |
| --- | --- |
| 独立担当の最新全件`npm test` | ソース候補`89e7039`で96件合格、0件失敗、30.2秒。[保存ログ](evidence/independent-unit-tests.txt)。600tickの地上鏡像、18生存歩兵が実地形・ground AI・占領を通して72000tickより前に敵本拠地を占領するfixtureも含む。その後の`f96e9a9`は橋/担当更新の論理変更を含み、この96件結果を最終全件合格へ流用しない。通常操作の一戦や全AI-only campaignの代用ではない。 |
| 独立担当の`npm run build` | ソース候補`89e7039`でTypeScript検査とVite production buildが合格。[保存ログ](evidence/independent-build.txt)。生成bundleが500kBを超えるVite警告は残る。実機性能合格の根拠ではない。 |
| RV19後の独立renderer検査 | `0974b93`のrenderer/flight契約6件が合格。[保存ログ](evidence/independent-render-contracts.txt)。[warmup-review.mts](evidence/warmup-review.mts)を独立実行し、成功/WAIT_FAILED/context loss/dispose、2回の準備draw、wait timeout=0、fence削除1回を確認した。[保存ログ](evidence/independent-warmup-review.txt)。mockは実GPU画像/性能の合格を意味しない。 |
| campaign集計の独立fixture | [campaign-review.mts](evidence/campaign-review.mts)で実scriptの集計式を検査し、鏡像の固定プロパティ順と過去tickを含む死亡2/1が合格。[保存ログ](evidence/independent-campaign-review.txt)。campaignは実行していない。 |
| 最終橋差分の独立targeted検査 | `f750433`で新しい3ケースだけを実行し3/3合格、0.51秒。[保存ログ](evidence/independent-bridge-regressions.txt)。99件全体や長期戦況の独立合格ではない。 |
| 30秒担当更新の独立fixture/targeted検査 | [renewal-review.mts](evidence/renewal-review.mts)で戦略更新だけを実行。2本拠地守備分隊＋中央負荷3/3/4、各担当点100m手前の状態から1800tickに別担当へ変わる個体が、修正前6/10から`f96e9a9`の0/10へ改善。[修正前](evidence/independent-renewal-before.txt)/[修正後ログ](evidence/independent-renewal-after.txt)。追加した更新・新規波の1回帰も独立実行で合格。[保存ログ](evidence/independent-renewal-regression.txt)。全campaignではない。 |
| 陣営視点の独立fixture | [perspective-review.mts](evidence/perspective-review.mts)でA/B視点の絶対個体/拠点状態が初期と1tick後に同じことを確認。[保存ログ](evidence/independent-perspective-review.txt)。物理鏡像coverageの未実装を確認する検査であり、A21合格検査ではない。 |
| 独立担当の途中`npm test` | 64件合格、0件失敗。レビュー途中のsnapshot。最新結果とは区別する。 |
| 初期heading/forwardの独立fixture | 修正前の不一致を再現。修正後のheadingと初速の整合をソースで再確認。 |
| 垂直姿勢の機首sweep fixture | yawだけの判定で非命中を再現。完全YXZの回帰ケース追加を確認。 |
| 宙返り末尾の地形sweep fixture | 修正前の誤衝突を再現。修正後、通常姿勢と末尾seamの両方が無接触となることを独立実行で確認。 |
| 統合担当の最終全件実行 | `f96e9a9`で100/100合格・build合格の報告と[全件ログ](evidence/unit-tests.txt)・[buildログ](evidence/build.txt)を受領。独立担当の旧96件/橋3件/担当更新1件の実行と区別する。 |
| 統合担当のbrowser再実行 | `86b8dbd`で393×648と568×320の2ケース成功、1280×720はGPU完了待機1085msで安全停止し失敗。[全ログ](evidence/browser-smoke.txt)。橋の論理変更後の`f750433`でのbrowser再実行ではない。 |
| 統合担当の長期診断 | `86b8dbd`の72,000tick/seed 1/Easy/Aが時間切れ、無戦闘の継続・本拠地到達0を確認。[橋修正前](evidence/single-battle-probe-before-traffic-fix.json)。`f750433`は損傷895/死亡426、最長無戦闘2867tick（47.8秒）、P3/P4=Bまで進んだが本拠地到達0。[担当更新修正前](evidence/single-battle-probe-before-renewal-fix.json)。最終`f96e9a9`のfresh診断は実行中。単一seed診断を30seed/物理鏡像受入へ拡大しない。 |
| 実装担当の追加focused検査・TypeScript検査 | 担当から合格報告を受領したが、独立担当による最終全件実行とは区別する。 |

台帳と終端では、592の固定ID、両軍の保存則と出撃上限、pending付替え/生存機引継ぎ、歩兵限定の占領、同tick所有graphの固定、同時本拠地落ち・時限優先順位、結果snapshotの凍結、発射時の損傷帰属と死亡時の損失帰属を読解・関連回帰ケースで確認した。設定は本作3キーの隔離、失敗時の旧適用値保持と明示的な今回だけ適用、未来版保護、IME/編集/修飾キー抑止を確認した。外部ランキング・アカウント・送信経路や、今回確認したコードからの明白なDOM注入経路は見つけていない。

## 公開受入に残るゲート

| 受入 | このsnapshotでの状態 | 合格に必要なもの |
| --- | --- | --- |
| A13 | 未合格 | Normal/Easyの通常操作で開始→前線→敵本拠地の勝利、味方本拠地の敗北、観戦からの決着を一戦通して実証。人工所有変更でのResult fixtureは代用不可。 |
| A16 | 未合格 | 固定Kaisen/FF/候補の8画面×3 viewport、通常/文字200%/実ブラウザズーム200%の画像・DOM・フォーカス・到達性。CSS viewport半減は実ブラウザズーム合格ではない。 |
| A17 | 未合格 | 同姿勢・bank・宙返り位相の機体/カメラ実画像、FOV・画面占有・照準の比較。ソース一致や判定球テストだけでは外観合格にならない。 |
| A20 | 実機未検証・PC browser失敗 | 指定相当のM1とiPhone/Safariで、30秒暖機後180秒・最大284論理実体のframe/論理p95、pool不足0、20回再出撃の資源安定。Linux/SwiftShaderは2 viewport成功/PC失敗を記録し、実機合格へ代用しない。 |
| A21 | 物理鏡像coverage未実装・未合格 | 正しいAI-only制御による30固定seed×各mode×物理的な陣営入替の戦況ログを構築/実行する。現scriptは同じ絶対戦況のscore視点切替。個別の鏡像回帰や視点caseをcampaign合格にしない。 |
| A22 | 未合格 | 通常操作の制空が敵航空損失・味方歩兵生存へ、地上支援が戦車/対空排除・占領へ寄与した因果ログ。 |
| A23 | 最終診断待ち・未合格 | `86b8dbd`のseed 1診断で長時間無戦闘/本拠地到達0を確認。`f750433`は無戦闘最長47.8秒まで改善したが本拠地到達0。担当更新修正後の`f96e9a9`診断と全campaignの時間切れ過半、無戦闘60秒超、本拠地到達0を分析し、AI/地形欠陥を単なる時限終端で隠さない。 |
| A24 | 未合格 | 最終候補commit、source manifest、最新全件検査、画像、実機条件、失敗/未実施、既知制約の一貫した対応付け。 |

A14の描画LOD/camera/30・60・120Hz/DPRのtick hash全行列、A19の実ブラウザ入力・焦点・音、およびA20の障害・資源反復も、コード/単体fixtureと実行証拠を区別して [VERIFICATION.md](VERIFICATION.md) に記録する。部分実装として提出する場合はこれらを未合格のまま明示し、完全受入済み・ゲーム公開可能とは記載しない。元作品の変更、mainへの直接反映、merge、配備・ゲーム公開を本レビューから正当化しない。

## 統合担当による最終診断の追記

独立レビュー完了後、統合担当が`f96e9a9`のseed 1/Easy/A・AI-onlyを72,000tickまで再実行した。損傷1,067件、死亡502件、最大無戦闘2,295tick（38.3秒）、終端警告22件、P2/P3のB占領とP4のA奪回を確認。本拠地100m圏への歩兵到達は0で時間切れ引分。これは独立担当の再実行ではなく、[single-battle-probe.json](evidence/single-battle-probe.json)に固定した統合診断である。A21/A23と実機公開ゲートは未合格のままとする。
