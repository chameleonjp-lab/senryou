# PR #21 UI-only captureと表示修正

PR #21のUI-only captureは22ケースを実行して37枚のPNGを記録した。artifact `11842111597`（ZIP SHA-256 `f9a2c0027a863512de7b77994634456d3706fd7ccc8e57d3ce0e43395f540583`）のreportはbatch `58db1239-f8f2-4fe8-bde0-b65103ce3e82` を示し、source hashはcapture中も安定し、report errorsは0件だった。ただし `P-easy`、`L-normal`、`T-normal` の3ケースは失敗し、残り19ケースも `captured-needs-visual-review` であるため、全体合格とは扱わない。

`P-easy`（320×568）では `flight-data` の最終行と `flight-tip` の文字矩形が約0.3px重なった。`L-normal`（568×320）では実際のレーダー距離が1.2kmなのに、必須ラベル検査が古い `2.4km` を要求していたため、captureの期待値だけを `1.2km` に合わせる。距離ラベル自体は引き続き必須とする。`T-normal`（393×852、DOM文字倍率2）では敵軍残存数の末尾行と `flight-tip` が重なり、機銃・機関砲の文字がviewport下端を越えた。こちらも古い `2.4km` 期待値で失敗している。

その後のhead `3de4545354e95ffb16232167d2df0cbb6017fee4` の[CI run 38456579687](https://github.com/chameleonjp-lab/senryou/actions/runs/38456579687)では、単体テスト242件成功、candidate browser checks 35件成功・10件skip・失敗0件、baseline 3件成功・失敗0件、UI-only capture 37枚成功だった。throttle artifact `11842317576`（ZIP SHA-256 `ab91ee0afaa2b6d6c9239c268d4b1ca5810a925da5e8dc9608b54e614e6b42f3`）とUI artifact `11843376511`（ZIP SHA-256 `186d8e0a8767bfd76692ee52fadee75e4d077fbe4bbee262e459bfcbbe526a8b`、batch `4eac6ba2-d8b1-4ad8-8b5f-acd99021a9ec`）を保存した。独立照合では40 source hashesと37 PNG hashesが一致し、22 capture caseのgeometry issueは空だった。37枚の独立した目視レビューは完了し、blocking visual issueは確認されなかった。この成功は次の `bottom:72px` 調整より前のheadに対する結果である。

head `3de4545` では、`T-normal` の計器レイアウトが26px縮み、機銃・機関砲の最終行はy=844.75px、飛行案内の文字下端はy=848.5pxだった（viewport高852px）。`P-easy` の `bottom:78px` は元のbottom80px位置から2pxしか下がらず、ammo文字下端y=460.609pxと飛行案内glyph上端y=462.3125pxの隙間は1.703125pxだった。Sol MAXのgeometry案に従いEasy案内を `bottom:72px` に変更した。計算上の位置はglyph y=468.3125〜481.3125、ammoとの隙間7.703125pxであるが、この72px変更後の実測はまだない。新headで再度UI-only captureと全必須検査を行う。

`src/style.css` の変更は表示配置に限定する。390〜700px縦画面の飛行中HUDでは、計器領域を左列と中央列まで広げて二列にし、高さを節約するため計器と僚機情報を同じ行へ置き、スコアと弾薬は下の行へ保つ。飛行案内は右下へ移し、余白と行高を明示する。359px以下の縦画面ではEasyの飛行案内を8px下げる。HUD情報、reticle、文字倍率、フォントサイズ、44px以上の操作領域、照準・レーダー位置と通知予約、captureの検査条件は維持する。全22ケース・37画像・geometry/source-hash/pixel検査と失敗条件を維持し、skip・retry・timeout延長・条件緩和は行わない。

同PRの先行headの必須browser checksではcandidateが34件成功・PC 1件失敗、旧baselineが2件成功・PC 1件失敗だった。artifact `11842540607`（ZIP SHA-256 `607e599ed621974833079df5fcf2074682f4aeb0f19a84a87bdd8349dcf92c87`）には比較画像と結果を保存した。candidateのPC PNGとaccessibility treeには「描画処理が停止しました。再読み込みしてください」というpause表示がある。この表示は既存CIでも見られた描画停止の表示と一致するが、停止原因の内訳は未確定であり、そのheadの必須失敗は成功扱いしない。後の3de headで成功したbrowser checksの結果は上記のとおりである。

公開workflowは固定source `fe2bbaecc28f5d26c433f1cd602192cf418b2818` からの変更が厳密に次の8 pathであることを検査する: `.github/workflows/series-publication-20261010.yml`、`.github/workflows/throttle-lever.yml`、`browser-tests/ui-only/capture.mjs`、`browser-tests/ui-only/samples.ts`、`docs/ZERO_SERIES_PUBLICATION_20261010.md`、`src/style.css`、`tests/ui-only-extraction.test.ts`、`tsconfig.ui-only.json`。製品ロジック・設定、依存関係、lockfile、抽出契約は変更しない。

# 2026-10-14 先行ESM修正時点の公開失敗と修正（履歴）

PR #20をユーザーがmainへマージした後の公開run [38372859765](https://github.com/chameleonjp-lab/senryou/actions/runs/38372859765) は、job [115213886754](https://github.com/chameleonjp-lab/senryou/actions/runs/38372859765/job/115213886754) の「Current bounded UI-only checks; no gameplay」で失敗した。エラーは `ERR_MODULE_NOT_FOUND` で、Node.js 24.19.0が `browser-tests/ui-only/samples.ts` から `src/battle/rules` を解決できなかった。`capture.mjs` はNode.js上で動き、npm testのtsx loaderはこの実行経路には適用されない。失敗は `node --input-type=module -e "await import('./browser-tests/ui-only/samples.ts')"` で再現する。失敗したbuildはdeployへ進まず、現在公開中のページは20分版のままである。

当時の修正は公開失敗を直すための6ファイルに限定した。`samples.ts` の実行時importを `.ts` 付きにし、その拡張子を許可する設定は `tsconfig.ui-only.json` だけへ追加した。回帰テストはtsx loaderを使わない独立したNode.js子プロセスから全fixture sampleを構築した。pull requestでは、この同じリポジトリのブランチとmain宛ての場合だけUI-only capture jobを実行する条件を追加し、既存のlegacy verify条件と37件のcapture、既存35件のbrowser checksを維持した。先行時点の公開workflowは承認済み製品sourceを `fe2bbaecc28f5d26c433f1cd602192cf418b2818` に固定し、そのsourceからの差分が厳密に6 pathであることを検査した。現在の8 path scopeは上記のとおりである。

先行ESM修正時点の対象pathは `.github/workflows/series-publication-20261010.yml`、`.github/workflows/throttle-lever.yml`、`browser-tests/ui-only/samples.ts`、`docs/ZERO_SERIES_PUBLICATION_20261010.md`、`tests/ui-only-extraction.test.ts`、`tsconfig.ui-only.json` の6ファイルである。その段階では製品ロジック・設定、依存関係、lockfile、抽出契約を変更していない。後続の表示上の問題は、製品ロジックを変えず `src/style.css` のCSS-only調整で対応する。修正後のPRでUI-only captureと通常の必須検査を完了する。再公開はmain採用後のworkflowが全検査に成功してからとなる。

このUI-only確認は固定した画面状態の検査であり、ゲームプレイ、本編の正式受け入れ、物理iPhone/Safariの操作・性能・VoiceOverを保証しない。

# 2026-10-13 10分版の公開準備

この記録は、本人の作業再開依頼に基づく10分版の検証ビルド公開準備である。今回の公開元は、[PR #19](https://github.com/chameleonjp-lab/senryou/pull/19)でmainへ採用された `3782f0834a96445fe97c883801f479a97210b1d1`（tree `3c7967ffbbfa5e28adee53697897828d906a5b05`）。製品変更は10分の戦闘時間、拠点間距離とレーダー範囲の半減、戦闘に参加できなくなった部隊の補助データなどを作戦時計30秒ごとに整理する処理である。前回の公開head `43b1073fd9d9ee2285032787ca691e6a506fa647` は20分タイマーのまま配信されており、今回の10分版はまだ公開されていない。

PR #19の候補head `564ba5d8d8834091e7f7e12ccb71f0c8ca112c77` と同じ製品treeについて、[CI run 38340523374](https://github.com/chameleonjp-lab/senryou/actions/runs/38340523374)で241単体テストと35件の必須browser checksが成功した。固定旧版の参考smokeは2件成功・1件失敗であり、候補の必須検査の成功とは区別する。

同runのartifact `11786739592`（ZIP SHA-256 `6ba0a054dbfc091b6480d44aafe346dd3f52504cce71947e0376d5e5f8c1306e`）から、候補側36PNGを元解像度で独立確認した。内訳は4画面サイズのafter-home/normal/settings計12枚、Chromium/WebKitの設定プレビュー8枚、文字/表示200%の設定4枚、縦/横/PCのhome/HUD/pause/result計12枚。旧before/baseline画像は比較用であり、この候補36枚の受け入れへ含めない。残り時間09:57〜09:59とレーダー1.2kmの表示、通常設定の保存・破棄・閉じると各プレビューが画面内であることを確認した。

表示全体を視覚合格とはしない。393px縦のHUDではタイマーと拠点状態文字、852px横のNormalでは敵兵力とレーダーが重なる。568px横のhomeは題名が折り返されて説明の一部が画像下に入らず、結果画面の一部も下部操作まで写っていない。200% WebKit設定はスクロール後の画像なので、上端の題名の欠けを初期表示の不具合とは断定せず、画面の回復とスクロールを画像だけで受け入れ済みとはしない。PR #19はCSSやHUD位置を変更していないが、直前のPR #18との同条件画像がないため、これらの既存性を画像で実証したとは記録しない。今回の2ファイルの公開準備で、これらの製品表示を修正したとは扱わない。

物理iPhone/Safariの操作・速度・VoiceOver、本編全体の受け入れは未確認。この検証ビルドで正式受け入れ完了を主張しない。

このフォローアップは `.github/workflows/series-publication-20261010.yml` と `docs/ZERO_SERIES_PUBLICATION_20261010.md` の2ファイルだけを変更する。既存のmain push限定、source commit・第一親・clean tree・固定sourceとの差分が厳密にこの2 pathであることの検査、単体/build/bounded UI-only（ゲームプレイなし）検査、配布ファイルallowlist、Pages権限と設定を維持する。承認sourceを上記のPR #19採用commitに固定する。公開処理はこのフォローアップがユーザーによってmainへマージされた後にのみ実行される。CI成功だけを公開成功とは扱わず、公開run・deployと公開manifestおよび全配布ファイルを別途確認して記録する。

# 前回公開の記録（2026-10-11）

本人のゼロシリーズ公開・共通UI反映と「作業再開」の依頼に基づき、PR16で採用したmain `28ec72df4b59f25e024e9668147134abc2df184b`（tree `931eb3212f46d7377388fc2798c758948316b4c0`）を基準に再公開する。製品変更は小さい縦横画面の世界文字・レーダー距離の配置と、縦画面境界警告の同じ全文・字体での二行表示である。武器・シミュレーション・投影点・入力・音・得点・保存・依存関係は維持する。

固定製品と同じtreeのhead `82e87e71d23bfbe79eb0a2d8ad2a471cfed20a36` / [run38101300049](https://github.com/chameleonjp-lab/senryou/actions/runs/38101300049) は215単体、通常build、厳密13UI関数/8Canvas method抽出、型、Vite変換と元37画像の全検査が成功した。artifact11688280930のZIP SHA256は`b704760e266c0dd5d527c7268db4befc303332438176ab13c75bdefc8e588dd2`。40sourceを製品・fixtureの実bytesへ、全37PNGを元reportのhashとbatchへ照合した。変更した10元PNGは担当が実見し、残る27枚は前回確認batchと完全同一bytes。警告・競合・敵距離・HP文字・落下目安・レーダー距離を保ち、検査したHUD/操作/照準/レーダー/文字同士の重複と画面外は解消した。固定Mission再描画前後のJSONが一致し、UI5.52秒・全体7.63秒、errorと外部requestは0。

このPRは公開workflowと本文書の2pathだけを変更する。公開commitの第一親が上記固定mainに一致し、固定mainとの全差分がこの2pathに厳密一致することを確認する。checkout深度3で通常の単一親とGitHub mergeの複数親を明示的に検査し、他の製品差分があれば停止する。公開はmain pushだけに限定し、実際のmain ref・clean tree・単体・build・bounded UI-only・配布ファイル検査へ成功したdistだけを既存github-pages環境へ配備する。Pages設定の有効化や環境条件の変更、mainへの直接push、force pushは行わない。

検査用HTMLや画像、文書は製品配布へ混ぜない。配布manifestのcommit/sourceTree/workflowCommitを採用mainへ結び、許可日を2026-10-11として記録する。CIだけで公開成功とせず、公開runとdeploy job、公式入口HTTP200、manifestと全製品ファイルのTLS GET・SHA256・現在main buildのbytes一致を確認した後に一覧の証拠を更新する。

これは固定した表示状態のUI-only確認で、Canvas文字200%、実機iPhone/Safari、本編、操作感、音、GPU性能や任意の高密度戦況の正式受入は未検証。空き領域がない場合も文字を消さず元の位置で描く。既存legacy run38019700364の失敗を合格化しない。ゲーム開始・戦闘・得点送信・ランキング再開・Codex Cloud environmentsは使用しない。復元は通常のrevertと再配備で行う。

## 前回公開の記録（2026-10-10）

本人がゼロシリーズの未公開ページの公開と、カイセン・ファイトフライトに操作とUIを合わせるよう指示したため、今回レビュー済みのゲームsource `470d94e81730b6b3090842838e45fadd01ec3fe7` を基準に公開する。既存のmain限定公開ルールに従い、PRで採用したmainのcommitを固定して組み立てる。このmain commitの親は基準sourceと厳密に一致し、差分は今回のworkflowと本文書の2ファイルだけでなければ停止する。単体・build・UI-only検査に成功した配布ファイルだけを公開する。mainへの直接pushは行わず、別担当の未採用差分を混ぜない。

ゲームプレイ、得点送信、ランキング再開、Codex Cloud environmentsの操作は行わない。物理iPhoneの操作感と本編の正式受入は未検証のまま記録する。既存の正式受入で未検証の項目を、この公開だけで合格扱いにしない。今回の確認用公開は、以前の全面完成・品質承認を得たという意味ではない。

配布manifestのcommitとworkflowCommitは今回採用したmainを示す。ゲームの実装bytesは、固定した基準sourceから変更されていないことを最初に確認する。公開成功と現在の配信bytesは別途確認し、CIが成功しただけでは公開成功としない。公開するのはdistの製品HTML・スクリプト・CSS・NOTICEと配布manifestだけで、検査や文書を公開フォルダへ混ぜない。

復元は前の公開成果物を別の承認済み配備で再公開する。初回公開で不具合が見つかった場合は公開停止または修正版配備で対応する。履歴の書換え・force push・データ削除は行わない。
