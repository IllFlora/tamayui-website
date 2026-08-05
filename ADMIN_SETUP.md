# たま結 管理室 - Cloudflareセットアップ

管理画面は `https://tamayui.jp/admin/` で利用します。公開サイトは従来どおり静的に表示され、Cloudflareの設定が未完了でも既存写真は消えません。

## 構成

- Cloudflare Pages Functions: 管理APIと匿名イベント計測
- Cloudflare R2 (`MEDIA`): 管理画面から追加した写真
- Cloudflare D1 (`DB`): 写真の順番・公開状態・匿名イベント
- Cloudflare Access: 管理画面と管理APIのメール認証

公開されるのは `/api/gallery`、`/api/events`、`/media/*` です。`/admin/*` と `/api/admin/*` はCloudflare Accessで保護します。

## 1. R2を作る

Cloudflare Dashboardで `R2 object storage` を開き、非公開バケット `tamayui-media` を作成します。

Pagesプロジェクト `tamayui-website` の `Settings > Bindings` から、次のR2 bindingをProductionとPreviewへ追加します。

| Variable name | R2 bucket |
| --- | --- |
| `MEDIA` | `tamayui-media` |

公式資料: https://developers.cloudflare.com/pages/functions/bindings/#r2-buckets

## 2. D1を作る

`D1 SQL database` で `tamayui-cms` を作成します。D1 Consoleを開き、`migrations/0001_cms.sql` の内容を実行します。

Pagesプロジェクトの `Settings > Bindings` から、次のD1 bindingをProductionとPreviewへ追加します。

| Variable name | D1 database |
| --- | --- |
| `DB` | `tamayui-cms` |

公式資料: https://developers.cloudflare.com/pages/functions/bindings/#d1-databases

## 3. 管理画面をメール認証で保護する

Cloudflare Zero Trustの `Access controls > Applications` でSelf-hosted applicationを1つ作成します。同じアプリケーションに次の2つのpublic hostname/pathを登録します。

- `tamayui.jp/admin/*`
- `tamayui.jp/api/admin/*`

ログイン方式はOne-time PINを有効にし、Allow policyには管理を許可するメールアドレスを個別指定します。`Everyone` や「有効なメールすべて」は使いません。

公式資料:

- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- https://developers.cloudflare.com/cloudflare-one/identity/one-time-pin/

## 4. Pagesの環境変数を設定する

PagesプロジェクトのProductionとPreviewに以下を追加します。

| Variable | Value |
| --- | --- |
| `ENVIRONMENT` | `production` |
| `CF_ACCESS_TEAM_DOMAIN` | `<チーム名>.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Access applicationのApplication Audience tag |
| `ADMIN_EMAILS` | 許可メールをカンマ区切りで指定 |

例: `mother@example.com,owner@example.com`

Accessは経路自体を保護し、API側でも署名済みJWT・Audience・有効期限・許可メールを再検証します。

## 5. 再デプロイして確認する

Bindingsと環境変数は次回デプロイから有効になります。Pagesの最新デプロイをRetryするか、新しいcommitをpushします。

1. スマホで `https://tamayui.jp/admin/` を開く
2. 許可メールへ届くワンタイムコードでログイン
3. 下書き写真を1枚追加
4. 公開へ切り替え、該当ギャラリーへ表示されることを確認
5. 公開サイトから公式LINEを押し、管理画面の「アクセス」に反映されることを確認

## 指標の定義

- 計測セッション: 匿名IDでまとめた30分単位の閲覧
- ページ表示: ページが開かれた回数
- LINEクリック: 公式LINEリンクが押された回数
- LINE遷移率: LINEを押した匿名セッション ÷ 計測セッション

LINE内の友だち追加・相談送信・申込完了は、この管理画面だけでは判定できません。申込完了率まで出す場合はLINE Messaging API、LIFF、または申込時の計測ルールを別途接続します。

## ローカル確認

```powershell
npm install
npm run dev
```

WranglerがローカルD1/R2を `.wrangler/` 内に作成します。ローカルの `http://127.0.0.1:4173/admin/` ではCloudflare Accessを省略できます。本番では省略されません。
