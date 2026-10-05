# 速度レバー変更の検証記録

対象基点: `71b0e5bc9ffbe2cbd1f295160b9e8e3c40ad6650`（ゲーム実装の追加修正・検証PR #3採用後）。対象は速度入力、操作UI、配置設定、保存互換性とその検証だけです。ゲーム全体の受入完了や公開を意味しません。

## 変更と継承

- Normalの加速/減速タッチ2ボタンを、上で加速・下で減速する中央復帰レバー1本に置換。操作数はNormal4（射撃・宙返り・速度レバー・爆弾）、Easy2。PC10キーとEasyの自動巡航は継承
- 実際の `FlightControls.sample(false)` → 固定tickの `sampleThrottle()` → `stepBattle` → `advanceThrottle` へ接続。入力0で調整済み目標速度を保持。18 m/s毎秒、65..141 m/s、既存の空力・機体・カメラは変更なし
- 共通helpersのスナップショットを使用。Senryouだけの差分は魚雷なし、保存キーnamespace、従来の操縦交代後の押下ブロック、Senryouには存在しなかった旧Kaisen兵装既定位置移行を行わないこと
- 旧 `senryou-controls-v1` / `senryou-controls-easy-v1` rawは書換えも削除もしない。明示保存時だけ新v2キーへ書く。キーバインドは `senryou-keyboard-v1` を継承。全件preflight、復元用raw控え、失敗時rollback、未完了復元のread-onlyロードと警告、未来形式/別タブ競合保護
- 機体・カメラ・陸上戦・兵装・勝敗・得点・公開設定に変更なし。復元はこの変更commitの通常revertで可能。旧v1の生データは引き続き復元元として残る

## 検証範囲

ローカル単体検査は共通fixture、非有限/境界、実入力所有/解除、フォーカス短押し、0tick frame、catchupでの一度消費、実際のstepBattleでの速度推移、Easy、保存/復元/未来形式、既存の操縦交代ガードを含みます。最終結果はPRのheadごとのログに記載します。

GitHub ActionsはPR head SHAをcheckoutし、unit/type/build、専用の `playwright.throttle.config.ts` でChromium/WebKitを実行します。標準の `playwright.config.ts` と基点追加の3本のbrowser specは原文を保持します。専用configはレバーspecをChromium/WebKitで、既存 `smoke.spec.ts` の3ケースをChromiumで実行します。既存 `reference-comparison.spec.ts` と `reference-render-baseline.spec.ts` は固定Kaisen/FightFlightの別checkoutを使うゲーム全体比較なので、標準configの範囲に残し、本PRのレバーCIでは実行しません。既存smokeの旧証拠はCIの一時保存先へ退避し、今回の実行で新しく作られた画像/JSONだけを最終headのartifactへ含めます。320×568 / 393×852 / 568×320 / 852×393でレバー/previewの矩形、最小44px、Cancel、Easy、保存→再読込、未来形式、今回だけ使う、ネイティブpointer/キー/停止、文字200%とCSS zoom200%を確認します。CSS zoomはOS/ブラウザUIによるnative zoomの代替合格とは扱いません。

同一OS・ブラウザ・DPR1・viewport・音OFF・seed1・1tick・停止したmissionで、この基点と候補のHome/Normal/設定を撮影し、条件JSONとPNGをartifactに残します。Normalでは論理hashが一致することも検査します。画像の生成と目視レビューは別ゲートであり、生成前/未確認の画像を合格としません。

## 制約と既存の未完了

- ローカルChromiumの実行は環境のOS socket許可で停止し、クラウドブラウザからlocalhostへのアクセスも制限されています。ホスト/ポート変更で迂回せず、許可されたCIを検証経路にします
- 最終headのChromium/WebKit結果と画像目視はCI実行後に確定。現時点で検査コードの追加をブラウザ合格とは扱いません
- 実iPhone、VoiceOver/TalkBack等の実タッチ支援技術、操作感、実機性能、native browser zoomは未検証
- 新基点の `docs/VERIFICATION.md` と独立レビュー・既存画像/JSON等の証拠を保持します。これらは以前のゲーム実装候補に対する結果であり、本レバー候補で再実行した証拠ではありません。記録されている既存smokeの2成功/1失敗、A13/A14/A16/A17/A19〜A24等の未完了ゲートは本変更で完了とはしません。出典コメントの `docs/PROVENANCE.md` は引き続き存在しません
- main直接更新、merge、自動merge、配備、外部ランキング/アクセス設定変更は対象外

## 最終独立レビュー

実装とは別担当のレビューで、保存readback、HUD utility位置、focused PCキーの解除、zoom時のレール端点を点検し、4作へ共通修正しました。新規8回帰を追加。共通helperの最終hashはmanifestに記録しています。WebKitは設定/preview/DOM入力を検証し、WebGL本編9件とCDP専用multi-touch1件は理由付きskipです。レバーspecはChromium21件・WebKit実行対象11件（別にskip10件）、継承smokeはChromium3件です。実ブラウザ・比較画像目視は最終head CI後に別途判定し、skipをpassへ含めません。

2026-10-05に新基点へ適合した候補で、`npm test` は121/121成功、`npx tsc --noEmit` と `npm run build` は成功。専用configの `--list` は45件/2 spec、原文保持した標準configの `--list` は34件/4 specで成功しました。buildの既存500kB chunk警告は残ります。一覧取得はブラウザ実行ではありません。実ブラウザは上記の未実行区分を維持し、単体成功を画面合格とは扱いません。

通常のgit fetchで基点コミットを取得し、実在する `71b0e5bc9ffbe2cbd1f295160b9e8e3c40ad6650` をローカルHEADとして検査しました。新基点の地形描画・地上AI・地上navigation・4回帰を含む55変更ファイルは原文維持。標準configは変更せず、レバー用configのみを別名追加しています。専用CIの候補port 4178は継承smokeの固定URLに合わせた設定であり、ローカルブラウザ制限の迂回ではありません。

## CIで検出した設定ズーム不具合への対応

センリョウの実Chromium/WebKitで200%CSS zoom時に設定の保存ボタンが画面外になることを検出。同じ4作共通のviewport値を、拡大後の画面ピクセルからlayout CSS pxへ幅・高さとも変換し、rootの寸法変化にも追随する修正を追加しました。全4作へ同じhelperと倍率.5/1/2の回帰を適用。実browser gateは保存ボタン全体の可視と左右境界を確認します。

この実行関連候補の全単体は122/122、型/build成功。browser一覧は成功ですが本実行は最終headのCIを別判定します。中間CIの失敗は隠さず、PRに新headの結果を記録します。画像artifactは生成/保存と目視を区別し、現時点の取得・目視は未確認です。

FFの次CIではレバーとpauseが非重複のまま、拡大された宙返りラベルがボタン外へ張り出してpause中心の入力を取得することを座標ログから特定。文字サイズと既存配置を保ち、装飾子のpointer-eventsを無効化してボタン本体を入力域の正本にしました。設定の拡大・多指解除・utility中心の検査は維持します。

## 追加smoke診断

専用CIの200% zoom検査は両engineで成功し、4寸法の同seed/tick1比較も成功。多指テストの二重cleanupを修正し、GPU遅延で停止した既存PC smokeは、同じrunner/Chromium設定/既存3ケース/固定main checkoutで再実行して比較します。baselineとcandidateのsmoke JSONとレポートは別々に保存し、保護停止・失敗を成功扱いに変えません。renderer・地形・既存smoke期待値は変更していません。
