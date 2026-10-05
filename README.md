# senryou
センリョウ

戦闘機で両軍の地上戦へ介入し、歩兵による拠点占領を支援する一戦完結型のブラウザゲームです。

```sh
npm ci
npm run dev
```

開発サーバーは `http://127.0.0.1:4176`。検証は `npm test`、`npm run build`、`npm run test:browser`。ブラウザ試験には `npx playwright install chromium webkit` が必要です。

Normal は矢印キーで操縦、Space で機銃・機関砲、W/S で加減速、L で宙返り、Z で爆弾、Esc で停止。Easy は操縦・照準補助と自動射撃が入り、爆弾は手動です。タッチ操作とキー割当は「操作設定」で変更できます。

元作の固定版と要件は [要件書](docs/REQUIREMENTS.md)、工程は [実装計画](docs/IMPLEMENTATION_PLAN.md)、実施した検証と未検証項目は [検証記録](docs/VERIFICATION.md) を参照してください。実機性能とすべての受入項目が完了したことを、単体試験やビルド成功だけでは示しません。

データはブラウザ内の操作設定だけに保存します。オンライン送信、アカウント、課金、ランキングはありません。依存の表記は [third-party-notices.txt](public/third-party-notices.txt) にあります。
