# senryou
センリョウ

戦闘機で両軍の地上戦へ介入し、歩兵による拠点占領を支援する一戦完結型のブラウザゲームです。

```sh
npm ci
npm run dev
```

開発サーバーは `http://127.0.0.1:4176`。検証は `npm test`、`npm run build`、`npm run test:browser`。ブラウザ試験には `npx playwright install chromium webkit` が必要です。 速度レバー変更の検証は `npm run test:browser -- --config=playwright.throttle.config.ts`（比較用に新基点のcheckoutを `THROTTLE_BASELINE_DIR` で指定）。標準configは固定参照3リポジトリの比較用として保持しています。

Normal は矢印キーで操縦、Space で機銃・機関砲、W/S で加減速、L で宙返り、Z で爆弾、Esc で停止。Easy は操縦・照準補助と自動射撃が入り、爆弾は手動です。Normalのタッチ加減速は「速度レバー」1本です。上で加速、下で減速し、離すと中央へ戻って調整した目標速度を保持します。タッチ操作とキー割当は「操作設定」で変更できます。

速度レバーの共通仕様と保存互換性は [共通契約](docs/THROTTLE_LEVER_CONTRACT.md)、今回の差分と検証状況は [速度レバー検証記録](docs/THROTTLE_LEVER_VERIFICATION.md) を参照してください。

元作の固定版と要件は [要件書](docs/REQUIREMENTS.md)、工程は [実装計画](docs/IMPLEMENTATION_PLAN.md)、実施した検証と未検証項目は [検証記録](docs/VERIFICATION.md) を参照してください。実機性能とすべての受入項目が完了したことを、単体試験やビルド成功だけでは示しません。

データはブラウザ内の操作設定だけに保存します。オンライン送信、アカウント、課金、ランキングはありません。依存の表記は [third-party-notices.txt](public/third-party-notices.txt) にあります。
