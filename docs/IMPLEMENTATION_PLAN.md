# センリョウ Codex向け実装計画書

> 2026-10-05追補: ゲーム本体はPR #2でmainへ採用済みです。以下の初版文書の「未実装」「文書のみ」は初版工程の記録です。今回の速度レバー変更は [共通契約](THROTTLE_LEVER_CONTRACT.md) と [差分・検証記録](THROTTLE_LEVER_VERIFICATION.md) を優先します。Normalタッチは旧5操作から4操作（射撃・宙返り・速度レバー・爆弾）、Easy2/PC10は維持します。旧v1を保持し、新タッチv2へ明示Save時だけ保存します。
状態: 文書レビュー案。下記工程はすべて将来の実装作業であり未実施  
対象: [chameleonjp-lab/senryou](https://github.com/chameleonjp-lab/senryou)  
文書ブランチ基点: `1358d82e4572ee1b9da3992a63f0e7abffd91fe9`  
依存要件: [固定版 REQUIREMENTS.md](https://github.com/chameleonjp-lab/senryou/blob/9f69c8b40885ebe3954968c48dfb88e5ceb3827e/docs/REQUIREMENTS.md)  
固定要件commit: `9f69c8b40885ebe3954968c48dfb88e5ceb3827e`

## 最初に読む参照先

- カイセンのリポジトリ: **https://github.com/chameleonjp-lab/kaisen**
- 操作/外観の正本: [Kaisen 3d751051dc6212482a129e8da596ddd349b2f9f5](https://github.com/chameleonjp-lab/kaisen/tree/3d751051dc6212482a129e8da596ddd349b2f9f5)
- 共通部分照合先: [FightFlight c2b313d37875b93458032d98636fcf5b5d30a138](https://github.com/chameleonjp-lab/faitofuraito/tree/c2b313d37875b93458032d98636fcf5b5d30a138)

本計画は、戦闘機を操縦して両軍の地上戦へ介入し、歩兵による敵本拠地占領を支援する「センリョウ」を、厳密な状態/戦闘/画面契約から実装する順序を定める。まず有限戦力と占領の純粋ロジック、次に地形/経路と戦闘、最後に既存の外観/操作を接続して一戦を検証する。固定要件と矛盾したら要件が優先する。要件が変わったらその差分を取り込んで計画の固定参照も更新する。

この文書PRは新規文書2件だけ。既存README、元作、コード、依存、CI、公開環境を変更せず、mainへの直接反映・merge・配備をしない。要件commitを先に確定し、その版を基に本計画を追加する二段階とする。PRの採用は別途の実装開始許可とは区別する。「テストを計画した」「コードを読んだ」「画像比較を指示した」は実装完了/検証合格ではない。

## 1. 開始ゲートと構成

### P0: 固定要件・移植境界・権利を確認

依存: 文書の採用判断と、別途の実装開始承認。

1. 対象リポジトリのmain、開いているPR、README、AGENTS.md等の現時点の指示、`.agents/skills`の関連SKILL.mdを確認する。今回の基点はREADMEのみだが、将来もそうだと仮定しない
2. 固定要件U01〜U07、R01〜R22、A01〜A24を全文再読する。[D]をユーザー固定要求と取り違えず、50残機等の別作品条件を混入させない
3. Kaisen/FFの指定commitを隔離した参照コピーとして取得する。main追従や公開配信の最新版へ無断差替えしない
4. 対象ファイルの全文を取得し、path/commit/blob SHA/移植先/保持部分/変更理由/権利を台帳化する。部分読解のままファイル全部の同等性を宣言しない
5. 元作に既存のTypeScript/Vite/Three.js、単体テスト、ブラウザ試験の構成を確認し、必要部分を再利用する。独自の新CI基盤/外部監視/配備workflowを追加する計画にすり替えない
6. 初版の非対象と、機銃/機関砲/爆弾の採用案・魚雷除外・Normal5/Easy2/キー10を確認する。Kaisenに既存ロケットがあると仮定しない
7. 第三者表記を調べ、権利不明の素材を増やさない。参照リポジトリ全体のライセンスを推測せず、非公開の参考資料本文/内部制御/利用枠は公開しない

完了条件: 元版・要件版・対象基点・保存対象・移植対象が追跡可能で、権利/実装権限の不足は着手前に明示される。まだゲームの受入は合格しない。

### ファイル責務の推奨境界

最終ファイル名は既存構成と整合させてよいが、論理を描画イベントやDOMへ埋め込まない。

| 責務 | 元/新ファイル候補 | 要件 |
| --- | --- | --- |
| 共通Home/HUD/Pause/Result | Kaisen index.html / main.ts / style.css | R02/R03/R19 |
| 操作/設定/焦点 | input.ts / control-settings.ts/css / keyboard-settings.ts / dialog-focus.ts | R12/R20 |
| 飛行/機体/カメラ | aircraft.ts / aircraft-damage.ts / aircraft-tracers.ts / flight.ts / flight-view.ts / flight-assist.ts | R02/R12 |
| 作戦定義 | 新rules.ts / battle-map.ts / mission.ts | R04/R07/R17 |
| 有限兵力/予約/操縦者 | 新roster.ts / reinforcements.ts / control-owner.ts | R05/R06/R11 |
| 占領/接続 | 新capture.ts / supply-graph.ts | R08/R09 |
| 地形と通行 | 新terrain.ts / ground-nav.ts / traffic.ts / world-bounds.ts | R07/R10 |
| 地上兵種/AI | 新infantry.ts / vehicles.ts / ground-ai.ts / air-tasking.ts | R09/R13/R14 |
| 発射/弾/実損傷 | ammunition.tsの構造＋新weapons.ts / projectiles.ts / damage.ts | R13〜R15 |
| 爆弾 | ordnance.ts / ordnance-view.tsを対地アダプタ化 | R13、海戦依存除外 |
| 得点/結果 | 新scoring.ts / result-snapshot.ts | R17/R18 |
| 表示/負荷 | scene.ts / render-queue.tsを分離利用、新ground-view.ts / capture-hud.ts | R16/R19/R21 |
| 証拠 | 元作の既存tests/browser-tests構成へ本作ケース | A01〜A24 |

## 2. 先に守るシリーズの実体

### P1: 共通部分の移植設計と比較fixture

依存: P0。ロジックP2と並行可能だが、UIを独立再設計しない。

実際のファイルを出発点にし、本作変更を最小のアダプタへ分ける。以下の出典は全て固定Kaisen版。

| 継承対象 | ファイル単位の出典 | 維持/変更境界 |
| --- | --- | --- |
| 色/書体/画面骨格 | [index.html](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/index.html)、[style.css](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/style.css)、[main.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/main.ts) | 背景#071e2b、文字#eff4ed、gold#e4c88b、明朝見出し、主ボタン52px/角丸3px、円形操作、CSS適用順を維持。作品文言/占領HUD/得点行だけ変更 |
| 設定 | [control-settings.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/control-settings.ts)、[control-settings.css](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/control-settings.css)、[keyboard-settings.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/keyboard-settings.ts) | タブ/preview/draft/保存/取消/失敗/未来版保護。魚雷項目除外、専用キーへ。初期化で既存保存を書き換えない |
| 入力 | [input.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/input.ts) | 相対ドラッグ、複数pointer所有、長押しと単発、解除、互換click防止。bomb/loopはtouch正常up、keyboard初回keydownで、cancel/リピートで発動させない |
| 機体 | [aircraft.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/aircraft.ts)、[aircraft-damage.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/aircraft-damage.ts)、[aircraft-tracers.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/aircraft-tracers.ts) | 主翼12m、既存胴体/風防/三枚プロペラ/可動舵/材質/銃口を維持。汎用低ポリ機へ置換しない |
| カメラ | [flight-view.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/flight-view.ts)、[scene.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/scene.ts) | FOV64°、相対(0,11,29)、bank0.45。scene near0.5/far22000と投影用far6500を混同しない。地形だけ追加 |
| 飛行/補助 | [flight.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/flight.ts)、[flight-assist.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/flight-assist.ts) | 既存の通常運動/姿勢/宙返り/補助。地形回避/標的adapterだけ本作へ |
| 爆弾 | [ordnance.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/ordnance.ts)、[ordnance-view.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/ordnance-view.ts) | 投下入力/基本表示を利用、艦体/海面/魚雷依存は除去、R13の地形予測と爆風へ |

調査時にKaisen/FFの`aircraft.ts`と`flight-view.ts`は末尾改行以外一致を確認した。CSSは両作で色/幅上限等が異なるので「全部同じ」と扱わず、正本Kaisenから差分を記録する。実装時は使う全関数と依存を読み直す。

比較用fixtureを、Home/Normal HUD/Easy HUD/Pause/タッチ設定/PCキー設定/ルール/Resultの8状態で定義する。mode、設定、表示値、フォーカス、スクロール、音を固定し、基準commitと候補commitへ紐付ける。機体は静止姿勢/左右bank/宙返り位相を固定する。最終比較はP10で実行し、このfixture作成だけでA16/A17合格にしない。

完了条件: 移植台帳と比較状態があり、共通UIの全面変更を含まない。許容する差分は地形/兵科/占領HUD/スコア/本作保存/魚雷除外へ限定。元作の描画やカメラの変更が必要なら理由付き比較を採用判断へ回す。

## 3. 描画から独立する戦争ロジック

### P2: 作戦状態・台帳・予約

依存: P0。

最低限のデータ:

- missionId、rulesVersion、seed、tick、phase、resultFinalized、controlledAircraftId
- 両陣営の兵科別固定ID、reserve/pending/active/lost、role、HP、位置/速度/姿勢、弾倉/装填、分隊ID
- pendingのunitId/slot/sourcePoint/deadline/blockedSince、波の次tick
- 拠点owner/phase/progressTeam/progress/remainder/lastEligibleTick、contested、安定時間、接続snapshot
- 発射ID、衝突ID、実損傷/死亡/初回所有イベント、score集計、immutable結果

1. 両軍各歩兵240/戦車24/対空8/航空24を固定IDで作る。初期active72/8/4/6と残りreserve。味方航空6のうち1機を自機にする
2. active+pending上限120/12/4/6、計284をassert。分隊6人の原子予約、減員分隊、同tick全死亡を処理する
3. 20秒波の補充上限18/2/1/1、自機優先の航空予約を単一取引で処理。描画/timeoutから台帳を書き換えない
4. 有効な自機候補は保持し、無効時だけ旧予約を原子的に解除/移管して再選定する。自機5秒復帰（出撃準備期限と操縦再開可能tickを分離）、pending付替え、同一実体操縦引継ぎ、候補死亡/取消/安全回廊復旧の再評価を実装。航空総残存0だけ観戦へ。予備/予約が残る安全待ちは理由付き復帰待ちとして区別する
5. missionId更新で古い予約/入力/音/結果書込を無効化する。lost IDは再利用せず、view instanceのpool IDと別にする

必須ケース: A01/A02。上限境界、残予備0/1、歩兵空席5/6、波と撃墜と予約完了が同tick、引継ぎ機の弾倉0/装填中/低HP、controlled ID二重割当、全航空0。復帰直後の入力持越しはP8で再検査。

### P3: 占領状態機械・供給接続・終端

依存: P2。3D表示なしの小さな固定座標fixtureで先に検証する。

1. R08を純粋関数へし、区域内の生存歩兵だけを数える。中立p=0からのT設定/新規加算、0への正規化、6人上限、contested凍結、無人5秒猶予、所有側回復、逆陣営progressを削る順序を実装する
2. 所要秒をtickに変換する。進行の割算丸めで人数/周波数に有利不利が出ないよう整数分子＋剰余を保持し、閾値超過で1遷移だけを返す
3. 中継は6人で900tick中立化/900tick占領、1人で5,400/5,400。本拠地は6人1,800/1,800、1人10,800/10,800。直前tickの競合、最後の歩兵死亡、空区域、地形の上空/橋上下を検査する
4. tick開始owner graphで接続をBFS等で計算。HA–P1–{P2,P3,P4}–P5–HB、途中切断、同tick下流連鎖禁止、本拠地中立の奪回だけ接続不要とする例外を検査する
5. 全拠点更新後に当該tickの損失/撃破/支援/中継点を確定し、R17の順で終端理由→勝利点/Time→結果snapshotを一度だけ確定。両本拠地同tick落ち（人工snapshotでの防御的単体ケース）、片落ち、両軍歩兵総残存0、時限、手動中断を一括評価する
6. 一方歩兵0/両軍active歩兵0だがreserveあり/全航空0/全出撃口閉塞を自動勝利としない。無限救済を加えず時限終端と理由を保持する

完了条件: A03〜A05/A12の純粋ロジックが通る。供給先の配列順/陣営A/Bで勝者が変わらない。結果確定後に弾着/占領で結果が再計算されない。R17の死亡/弾処理が接続されるP6で同tick統合ケースを再実行する。

### P4: 陸地・経路・交通・出撃口

依存: P2/P3。

1. 9km×6km空域内にR07の7拠点と中央3経路を置く。初期地上配置はP1/P5後方の複数隊列。本拠地/中継の初期安定状態と安全条件を明示する
2. 描画と共通する地形高さ/閉じた建物collider/橋下面・側面を定義。航空機/弾のsweepと地上navを同じ地形へ接続する。上面高さだけで壁や橋を貫通させない
3. 兵科別勾配/水深/幅を検証し、すべての必要接続に最低2車両経路を保証する。検証失敗はStart不可
4. 歩兵5m/s、戦車12/8m/s、対空8/5m/sと加速/旋回制限、分隊の個体formationを実装する。分隊の一部死亡で生存者が同一点へ重ならない
5. 狭路予約と方向交替、残骸3秒で障害除外、stuck5秒→後退/代替→20秒で辺30秒禁止を実装する。戦闘待機と移動不能を区別する
6. 前線の10秒安定、安全口2組、出撃tick開始snapshotでの再検査（後半の占領変化は翌tick反映）、後方再予約、1秒再検査、60秒でreserveへ戻す経路を実装。航空回廊4候補を地上口から分離する
7. 航空境界警告/外向き成分抑制/地形衝突とAI回避を接続する。操縦/カメラそのものを陸戦向けに作り直さない

必須ケース: A06〜A08。橋上両軍/同軍すれ違い、狭路先頭の撃破、全口同時閉塞/奪回/競合、航空回廊が敵対空射程内、予約満了と所有喪失同tickのsnapshot境界。無戦闘の中央直線移動3,800m/5m/s≈760秒を再計測し、P2/P4経由4,329m/866秒・占領105秒・初期移動20〜60秒も見積もり、道の曲率/交戦を加えた時限余地を記録する。

### P5: 兵科AIと戦略役割

依存: P3/P4。

- 歩兵: 1秒ごとに本拠地防衛/奪回（無人・中立・切断でも接続不要の最優先候補）→切断奪回→接続する前線を選び、分隊数/距離/IDで分散。担当は30秒保持、無効化なら即見直し。少数分隊が地形外へ永久追撃しない
- 戦車: 前進歩兵を護衛、300m超の突出を抑え、敵戦車/対空砲を除いて進路を開く。歩兵不在なら拠点を勝手に占領せず防衛へ
- 対空砲: 前線後方配置、切断/歩兵接近時退避、同一航空機2門枠、予告/旋回/射線の条件を持つ
- 航空AI: 6機なら制空3/支援3を基本（自機はAI枠外として残AI数を割り当て）。目標なし10秒で役割切替、同一航空機2機追撃制限。支援は戦車/対空砲を優先し、弾倉と爆弾が使えなければ有効な代替/退避へ
- 全兵科: 索敵距離/遮蔽/3秒記憶、共有される拠点情報と個体の不可視座標を分ける。予備/pending/死体を標的にしない。固定seedの論理乱数と描画乱数は分離

検証: 敵地上軍が残ったまま制空だけをしても占領が進まず、爆弾で対空/戦車を排除すれば歩兵が前進することをログで示す。空戦だけ/爆撃だけの撃破数を勝利条件へ取り替えない。目標選択のタイブレークがA陣営に有利にならないよう陣営入替鏡像を比較する。

## 4. 戦闘と成果の確定

### P6: 武器・予告・地形弾道・損傷

依存: P2/P4/P5。

1. 自機のmg/cannon射撃は1入力。両弾倉と個別周期、同時2発、距離減衰、6秒再装填を固定元と照合する。AIの周期/威力と本作での弾倉適用を区別する
2. bombはZ/タッチ単発、2発、1秒間隔、空で20秒。既存ordnanceの海面/ship参照を対地colliderへ切り出し、地形への予測落下と実飛翔を同じ重力/初速で計算する
3. 弾にはowner/発射時役割と固定IDを持たせ、発射者死亡/操縦交代後も帰属を変えない。弾pool確保→弾倉減算→発射時計更新を原子的に処理
4. 歩兵小銃/戦車砲/対空砲とR13の倍率表をデータで定義。地形射線/弾道/射程/砲塔角を満たす時だけ発射。友軍貫通と敵/地形の最初の接触を区別する
5. 対空0.8秒予告、画面外方向表示、照準変更時リセット、既存弾の非追尾、枠交替で時計不正リセットなしを実装する
6. 全弾sweepを衝突時刻→地形→ID、実損傷は時刻→shotIdで安定順処理。爆風はshotId×targetIdの一度限り、中心240/半径60m/線形/遮蔽、法線外側0.05mから始点自己交差と対象自身を除外、直撃は距離0の一回だけ
7. 全死亡の後にP3占領/終端へ渡す。爆発の見た目や低FPSで爆風回数が増えない

完了条件: A09〜A12。4,096弾/64爆弾の容量根拠を寿命×最大発射率と端点同時発射から示し、通常最大負荷で論理保留が発生しない。意図的なpool不足試験では弾/HP/時計が矛盾せず、視覚poolだけ減らしても命中を維持する。

### P7: 得点・結果・一戦の統合

依存: P3/P5/P6。

R18の式をevent ledgerから導く。各unitIdの死亡は一度、拠点初回所有は一度、発射時自機の実HP減少のみSupportへ。開始時の味方所有中継（通常P1/鏡像P5）は初期既得で0点、奪回繰返し0点、本拠地点は勝利時だけ。Kill上限19,600/Support20,000/Capture9,000/Time5,000/Loss18,800を式で検査する。

具体ケース:

- HP40の歩兵へ自機20→AI30: Support20、Kill20、総HP損傷40。AI側overkill10は加点0
- HP40へ自機爆風240: Support40、Kill20。以後死体弾/同爆風再送0
- 航空機死亡時AI→自機引継ぎ済み: Loss300+200。発射時AIだった旧弾はSupport0
- P2を味方占領→敵奪回→味方再占領: Capture1,000のまま。初期P1の奪回は0
- Support0でAIだけ勝利: Kill/Captureは増えるがTime0。Easyの自動射撃命中はSupportに含める
- T=600、Support1,000で勝利: Time1,250。T=1,200のtickに敵本拠地占領なら勝利優先、Time0
- 同時本拠地落ち/引分/中断: 本拠地勝利点0、Time0。既に得た中継点は残る

最後のtickのscoreと所有/残存をsnapshotにし、resultから元ロジックを参照して変動させない。新missionIdで再出撃、Pause/非表示/結果で時計を止める。各modeで通常操作の勝利/敗北を一戦通して検証する。

完了条件: A13/A15。数学上の上下限だけでなく、実際のイベントとUI内訳が一致。負点を隠さず、丸めが複数段階で重複しない。

## 5. 操作画面・公平性・性能

### P8: シリーズ画面へ接続

依存: P1/P7。

1. 既存Home/Mode/HUD/Pause/Result/RulesのDOMとCSSを移植し、本作語彙と数値へ限定置換。新しいカード体系・フォント・ボタン形へ変更しない
2. R19の占領/兵力HUDを既存の端の情報領域へ加える。中央の機体/照準・操作ボタン・Pauseを優先し、占領詳細はルールへ分離。余白不足なら既存領域内で行/優先度を調整する案を提出する
3. Normal5/Easy2、PC10（Easyでfire/加減速を無効にして7）の設定を整合。fireはmg/cannon共通。魚雷Xを別操作へ使わず、項目や空欄を残さない
4. senryou専用3キーへ保存し、旧作と同originでも干渉しないことを試験する。失敗/破損/未来版/取消/今回だけ使うを維持
5. 入力所有と解除を元実装から保持し、復帰/観戦/対空警告/爆弾ガイドだけ新作状態へ結び付ける
6. 機体モデルとカメラを固定元のまま接続。地形/兵科/占領記号は本作新規だが、今回は文書のみなので素材の生成/追加は未実施

必須ケース: A18/A19。キー保持中のPause/設定/結果/復帰、bombのcancel/lost capture、2指ドラッグ＋射撃/投下、resize/回転、IME/フォーム入力、Tab循環、Escape、焦点復帰、音OFF/明示ONと停止。設定を閉じて勝手に再開しない。

### P9: LOD公平性と実機性能

依存: P4〜P8。

全284出撃実体の数値状態とcolliderを常に維持し、詳細96体上限/簡易instanceをviewだけで切り替える。AI戦略60tick/経路30tickは距離によらず同じ。画面外の損傷/占領を別の確率モデルへしない。

1. seed/消費入力を記録した同じ一戦で、全高/全低/通常LOD、canonical cameraとEasy論理投影を固定して検査用描画cameraのみ移動、30/60/120描画Hz/DPR違いを実行
2. 1tickごとの論理state hash、弾/死亡/占領イベント、最終結果/scoreを比較。hashから描画専用値だけを除き、HP/射線/位置/時計を除かない
3. 最大出撃284、密集射撃/爆風/多占領の180秒（暖機30秒後）を測定。PC M1相当で中央値60fps/p95≤25ms、iPhone12相当Safariで中央値30fps/p95≤45ms。論理p95 PC8ms/Phone16msも記録
4. 実端末、OS、ブラウザ、画質、解像度、DPR、温度、seed、候補commit、ログを保存。端末がなければ実機未検証で止め、ブラウザエミュレーションを代用合格にしない
5. tickを飛ばさず1frame最大8tick、遅延0.5秒超でPause/案内/入力解放。非表示復帰時の壁時計追いつきなし
6. 20回再出撃でgeometry/material/texture/audio/listener/pool countsとメモリ推移を記録。動作中のWebGL loss、復帰不能、ロード失敗、安全停止を試験

不合格時は先に描画instance/キャッシュ/空間ハッシュ/無駄な配列生成を改善。論理兵力・命中頻度・敵HP・占領速度を画質と連動させない。兵力削減/集約戦闘への変更が必要なら別設計判断とし、数字だけ調整して既存合格を流用しない。

完了条件: A14/A20。容量証明と実測の両方がある。未測定箇所は未合格。

### P10: 旧新実画面・一戦・最終受入

依存: P1〜P9。

固定Kaisen/固定FF/候補を同一ブラウザ・OS・viewport・DPR・倍率・入力方式・mode・設定・状態で起動。8画面を393×648/568×320/1280×720で撮影し、通常/文字200%/ズーム200%を区別して保存。Phone縦横を必須にする。世界/得点等の作品差分だけを除外表へ記録する。共通領域を大きく消して差分率を下げない。

機体/カメラは同姿勢と固定位相で別撮影。モデルの翼/胴体/風防/舵/プロペラ/材質、追従距離/FOV/大きさ/照準を目視と計測で比較する。DOM/CSS比較に加え実画像を確認し、読み取り/起動確認だけを同等性合格にしない。

自機ありのNormal/Easyで通常の一戦勝利・敗北・観戦からの決着を確認する。30固定seed×両modeのAIのみ戦況も行い、20分終端、陣営入替鏡像、無戦闘60秒、到達不能、時間切れ過半を分析。前半だけ動いた/最後まで時間切れで止まったことを「遊べる」証拠にしない。制空と地上支援の有用性はR22 A22のログで示す。

完了条件: A01〜A24を最終候補commitへ再対応付け。合格/失敗/未実施/採用判断待ちを分ける。最新修正で関係する検査を再実行し、古い候補のスクリーンショット/ログを使わない。

## 6. 受入の所有表と変更単位

| 工程 | 要件/受入の主責任 | 次へ進む条件 |
| --- | --- | --- |
| P0/P1 | R01〜R03、A16/A17/A24の準備 | 固定参照/台帳/権利/比較fixture。まだ外観合格ではない |
| P2 | R04〜R06、A01/A02 | 保存則/復帰/観戦が純粋ロジックで成立 |
| P3 | R08/R09/R17、A03〜A05/A12 | 占領/接続/同tick終端に順序依存なし |
| P4 | R07/R10/R11、A06〜A08 | 通行/安全口/有限予約/閉塞処理 |
| P5 | R09/R14、A21〜A23の準備 | 兵科役割/目標/戦略進行が成立 |
| P6 | R12〜R15、A09〜A12 | 弾道/予告/実損傷/死亡が占領へ接続 |
| P7 | R17/R18、A13/A15 | 一戦と得点/結果snapshotが一致 |
| P8 | R19/R20、A18/A19 | 実操作/保存/アクセシビリティ |
| P9 | R16/R21、A14/A20 | 論理同等性/実機性能/資源安定 |
| P10 | R03/R22、A01〜A24 | 全合否と未検証が最終commitに紐付く |

実装PRは上記依存に沿って小さく分ける。推奨は(1)有限台帳/占領、(2)地形/経路/増援、(3)兵科/武器/一戦/score、(4)継承UI/描画/統合検査。中間PRがmergeされても次工程/ゲーム公開まで完了したとしない。実装PRの作成・merge・配備はその時点の承認範囲に従う。

各実装PRに対象R/A、変更ファイル、元blob/移植台帳、実行した検査と未実施、画面/性能証拠、既知の制約、復元方針を含める。既存内容を失う変更や一括変更は、対象/件数/影響/復元用控えを提示して承認された範囲だけ行う。旧作への修正、全storage消去、強制削除、force pushをこの計画から正当化しない。

## 7. 今回確認した範囲と残るもの

文書策定時に対象基点/README/既存PRなしを確認し、Kaisen/FF固定版の重点28ファイルを取得して各Git blob SHAを照合した。HTML/CSS/設定/input/aircraft/flight-view/scene等の関連実装を読み、共通2ファイルの全文差分も確認した。ファイルの取得や関連部分読解は全機能の実行保証ではない。

この文書工程ではゲーム実装、build、単体/ブラウザ検査、8画面/機体の実画像比較、実機性能測定は行っていない。全P工程とA合格は後続の実装承認後に実施する。文書の独立レビューで仕様矛盾を修正しても、実装品質/ゲームバランスが検証済みになったとは扱わない。
