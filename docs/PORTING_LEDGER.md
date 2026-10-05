# 移植台帳

移植元は固定Kaisen `3d751051dc6212482a129e8da596ddd349b2f9f5`、シリーズ照合元はFightFlight `c2b313d37875b93458032d98636fcf5b5d30a138`。作業開始時に各参照HEADと指定SHAが一致し、追跡対象の変更がないことを確認した。以下の元blob SHAは固定commitのGit blob ID、対象blob SHAはセンリョウ候補 `f96e9a9` のファイル内容から得たGit blob IDである。同じIDの行は全バイト一致を示す。

| 固定元パス | 固定元blob SHA | 移植先パス | 候補blob SHA | 状態・保持したもの・変更理由 |
| --- | --- | --- | --- | --- |
| `.gitignore` | `cb2f231f2468a28920fca8712fd28b25819db4ea` | `.gitignore` | `cb2f231f2468a28920fca8712fd28b25819db4ea` | 完全一致。生成物と依存ディレクトリを除外。 |
| `index.html` | `de945a10417a2f883b3cfd3d79fadbfe3c7a4afc` | `index.html` | `8ef10a7aceaaa0f5ab42908813d644b7e4a5fd82` | Kaisenの画面骨格とIDを基に、本作名、陸戦説明、兵力/占領/得点、対地操作へ適応。 |
| `playwright.config.ts` | `a69ce668122b8eaca0c5a4ef785332ecf94e30fd` | `playwright.config.ts` | `58c80578685a9d93b1650726b5e69066091e6ff8` | Kaisenの既存Playwright設定を基に3つの固定ローカル参照/候補サーバーを追加。新しいCI workflowは追加しない。 |
| `public/third-party-notices.txt` | `805bf99e222a8c6433f78eb06f407224accb120c` | `public/third-party-notices.txt` | `805bf99e222a8c6433f78eb06f407224accb120c` | 完全一致。既存の依存ライブラリ帰属表示を維持。 |
| `src/aircraft-batch.ts` | `6aed47adeb8d22f976b99f0630bb2e841bb054b9` | `src/aircraft-batch.ts` | `6aed47adeb8d22f976b99f0630bb2e841bb054b9` | 完全一致。同型機の共有描画と資源上限を維持。 |
| `src/aircraft-damage.ts` | `fe0c48ff296a31db70c7f93a0cdab64244ba939b` | `src/aircraft-damage.ts` | `fe0c48ff296a31db70c7f93a0cdab64244ba939b` | 完全一致。共通機体の耐久/被弾/破壊表現を維持。 |
| `src/aircraft-tracers.ts` | `ba741ce4953f286342079effe2d9ce0fa0c4e4be` | `src/aircraft-tracers.ts` | `ba741ce4953f286342079effe2d9ce0fa0c4e4be` | 完全一致。機銃/機関砲の曳光表示を維持。 |
| `src/aircraft.ts` | `e4e3009464bb8c4ae473b7cfc46d010198c27149` | `src/aircraft.ts` | `e4e3009464bb8c4ae473b7cfc46d010198c27149` | 完全一致。既存の機体形状、材料、可動舵、プロペラを維持。 |
| `src/control-settings.css` | `1235392f369ac27ef3056852512319fe6994300b` | `src/control-settings.css` | `1235392f369ac27ef3056852512319fe6994300b` | 完全一致。シリーズ共通の設定画面スタイルを維持。 |
| `src/control-settings.ts` | `5208c4da8ebe014552cae855d84c2574ab152292` | `src/control-settings.ts` | `2402e529d485b6d275dfebae926405188e1299a9` | 設定ダイアログ、編集、保存/取消を継承。魚雷操作を除外し、センリョウ専用保存キーと対地操作を使う。 |
| `src/dialog-focus.ts` | `5d10d15cb0b9d3de31871af98a7801d638a5055b` | `src/dialog-focus.ts` | `5d10d15cb0b9d3de31871af98a7801d638a5055b` | 完全一致。モーダルの初期/復帰フォーカスとTab巡回を維持。 |
| `src/flight-assist.ts` | `799efdfb97c3b9ba435e8eaf4080f65b74326773` | `src/flight-assist.ts` | `3f9caee648f4deb358b2a1c3d05c90421b8ecbd4` | 操縦補助のシリーズ契約を維持し、陸上標的/地形の判定接続へ適応。 |
| `src/flight-view.ts` | `87f83928a00092338391442ec2d7e87e3b4e33da` | `src/flight-view.ts` | `87f83928a00092338391442ec2d7e87e3b4e33da` | 完全一致。飛行カメラ幾何と投影を維持。 |
| `src/flight.ts` | `3019be9650863c11cc1c57f7bb7e09ab815c9c07` | `src/flight.ts` | `3019be9650863c11cc1c57f7bb7e09ab815c9c07` | 完全一致。速度、旋回、姿勢、加減速、宙返りの操縦モデルを維持。 |
| `src/gun-sight.ts` | `1cdbd4bb3cf49d963c78f87a1cb00a42fb3b222b` | `src/gun-sight.ts` | `1cdbd4bb3cf49d963c78f87a1cb00a42fb3b222b` | 完全一致。射線と画面投影の共通計算を維持。 |
| `src/input.ts` | `0edbd1c5f9f07a2d1088539e188bab0329ab53f0` | `src/input.ts` | `9c8ee626b27e8a78720285484054f3c3be5c5c5e` | 相対ドラッグ/キー/ポインター所有/解放の契約を継承し、魚雷入力を外して対地入力に接続。 |
| `src/keyboard-settings.ts` | `eb143ac27b3f65b66912d10b89ec17d0efc581b2` | `src/keyboard-settings.ts` | `ecd58640e7e566cf0507205ca3aa066925a01469` | キー編集、重複/予約キー防止を維持。魚雷割当と不要な説明を除外。 |
| `src/main.ts` | `af73f3ae5b0bdcecb1b8e10d86b9342e2663d983` | `src/main.ts` | `9aa09ec30da09bfb0a9f6174a0f980647a0a0032` | Home/HUD/Pause/Result画面切替、設定、操作開始点を基に本作の戦闘/占領/得点へ接続。海戦専用機能を除外。 |
| `src/mission.ts` | `02a34856587ed8b237cdca930fa7feae66c063ec` | `src/mission.ts` | `61f27fb2795dfbe3f9418a6285db0987563b9719` | 一戦進行/終端の共通概念を基に陸戦のmission state、占領、結果snapshotへ適応。 |
| `src/render-queue.ts` | `2540d37e7cb098515979c39eb461b2ab64ee112e` | `src/render-queue.ts` | `2540d37e7cb098515979c39eb461b2ab64ee112e` | 完全一致。レンダーキューの明示状態/完了追跡を維持。 |
| `src/rules-guide.ts` | `8aa776fb9c0cebf3145d8d507a96fea3233edc87` | `src/rules-guide.ts` | `23aeaa52b8e0822d6fae9e11b18a963a44607852` | 共通ルールモーダルと操作説明の枠を維持。本作の陸戦ルール/対地操作文へ差し替え。 |
| `src/style.css` | `66f33fdd090157f27d8c4661d0f6d42a486c6ed7` | `src/style.css` | `7061599642124c20347fecfdcd8c690c5d61ee9a` | Kaisenの色/書体/ボタン/余白/画面レイアウトを基に、本作の兵力HUD/地上情報を配置。 |
| `src/types.ts` | `54b740b9895be8d02e37054aa7a8aeab48610b53` | `src/types.ts` | `db94442d7ceb84446bf930f30b4660d6b058b472` | 共通飛行/入力型を継承し、陸戦ミッション/兵科情報を追加し、魚雷状態を除外。 |
| `tests/control-settings.test.ts` | `727b01547f2ff19ed47ad6e3a3374ebc512b2e27` | `tests/control-settings.test.ts` | `a438dece154bcdbb0511bf40f4ef67ee17fe8d2d` | 設定の保存/編集テストを維持し、対地操作と本作の保存キーに追従。 |
| `tests/keyboard-settings.test.ts` | `c9147849eeaff964026792894b9f5bfaf7bb71f3` | `tests/keyboard-settings.test.ts` | `a4a9951bac5968277db5112c020e51ae7bf99532` | キー編集テストを維持し、本作で有効な操作割当に更新。 |
| `tests/rules-guide.test.ts` | `b9a5e6291498451cfc13fcfb80634a9949b2c3a2` | `tests/rules-guide.test.ts` | `bc8c4247f47c1cf5abc7092df761c46b0fb8fdc8` | 共通ルールダイアログの検査を基に本作説明文へ追従。 |
| `tsconfig.json` | `ecfd004822be0b872cc956a0c61d79c3a88ef8a8` | `tsconfig.json` | `ecfd004822be0b872cc956a0c61d79c3a88ef8a8` | 完全一致。TypeScriptの厳密設定を維持。 |
| `vite.config.ts` | `5224ee77f3455141c99f5d6464d36bf745face15` | `vite.config.ts` | `5224ee77f3455141c99f5d6464d36bf745face15` | 完全一致。既存Vite build設定を維持。 |

表にない `src/battle/**`、`src/battle-*` の陸上地形/兵科/戦闘/占領/得点と、新規統合テストは本作向けに作成した。依存マニフェストとPlaywrightの比較/受入testは本作用の開発設定であり、第三者ゲーム実行コードではない。旧作の海面/艦隊/魚雷/オンライン送信/ランキングを持ち込まない。
