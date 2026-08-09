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

| Variable | Value | 間違えるとどうなるか |
| --- | --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | `<チーム名>.cloudflareaccess.com` | **未設定だと管理画面が503**になります |
| `CF_ACCESS_AUD` | Access applicationのApplication Audience tag | **未設定だと管理画面が503**になります |
| `ADMIN_EMAILS` | 許可メールをカンマ区切りで指定 | **未設定だと管理画面が503**になります |
| `ENVIRONMENT` | `production` | ローカル開発用の目印です。`development` のまま置いても、認証スキップは `localhost` でしか働かないため本番の保護は外れません |

例: `mother@example.com,owner@example.com`

Accessは経路自体を保護し、API側でも署名済みJWT・Audience・有効期限・許可メールを再検証します。

## 5. 再デプロイして確認する

Bindingsと環境変数は次回デプロイから有効になります。Pagesの最新デプロイをRetryするか、新しいcommitをpushします。

1. スマホで `https://tamayui.jp/admin/` を開く
2. 許可メールへ届くワンタイムコードでログイン
3. 下書き写真を1枚追加
4. 公開へ切り替え、該当ギャラリーへ表示されることを確認
5. 公開サイトから公式LINEを押し、管理画面の「アクセス」に反映されることを確認

## 6. 運用上の必須設定と注意（ダッシュボード側）

リポジトリのコードだけでは完結せず、Cloudflareダッシュボードでの設定が必要な項目です。

### 6-1. `/api/events` のレート制限（未設定なら要対応）

`/api/events` は認証なしで誰でもPOSTでき、1リクエストにつきD1へ1行INSERTします。`functions/_shared/http.js` の同一オリジン検査はOriginヘッダが無いリクエストを通すため、ブラウザ以外からは素通しできます。放置するとD1の行数と書き込み枠が第三者に消費され、管理画面の数値も汚染されます。

`Security > WAF > Rate limiting rules` に次を作成します。**設定できる値はCloudflareのプランによって異なります。**

共通の設定:

| 項目 | 値 |
| --- | --- |
| 対象 | `http.request.uri.path eq "/api/events"` |
| カウント単位 | IPアドレス |

閾値と超過時の動作は、契約プランに合わせて選びます。

| プラン | 集計期間 | 閾値 | ブロック時間 |
| --- | --- | --- | --- |
| **Free**（ルールは1本まで） | 10秒（Freeはこの値のみ） | 10 リクエスト | 10秒（Freeはこの値のみ） |
| Pro 以上 | 1分 | 60 リクエスト | 1分 |

Freeプランでは集計期間・ブロック時間ともに10秒固定で、ルールも1本しか作れません（Cloudflare公式のAvailability表による）。そのためFreeでは「10秒あたり10リクエスト」を目安にします。

閾値の根拠: 通常の閲覧では1ページにつき `page_view` が1件、LINE等のリンククリックで1件が送られる程度で、1人の訪問者が10秒間に10件を超えることはまずありません。誤ってブロックする心配は低い値です。

公式資料: https://developers.cloudflare.com/waf/rate-limiting-rules/

### 6-2. 計測データの保持期間

`analytics_events` は自動削除されません。半年ごとにD1 Consoleで古い行を削除します。

```sql
DELETE FROM analytics_events WHERE occurred_at < date('now', '-180 days');
```

### 6-3. R2の孤児オブジェクトの棚卸し

写真を削除するとD1の行を先に消し、そのあとR2の実体を消します（`functions/api/admin/items/[id].js`）。この順序は「管理画面から消したのに公開側で画像が壊れて残る」事故を防ぐためですが、R2側の削除に失敗すると参照されないファイルが残ります。年1回、R2バケットのオブジェクト一覧とD1の `storage_key` を突き合わせ、D1に無いものを削除してください。

### 6-4. リポジトリ直下に作ってはいけないディレクトリ名

配信ルートがリポジトリ直下のため、静的ファイルはFunctionsより優先されます。**`media/` と `api/` という名前のディレクトリを作らないでください。** 作った時点で `/media/*` のcatch-allが無効化され、管理画面から追加した写真が全て表示されなくなります。

### 6-5. www の統合

`_redirects` ファイルではドメイン単位の転送ができないため、この設定はダッシュボードでしか行えません。現状 `https://www.tamayui.jp/` は転送されず、`tamayui.jp` と同じ内容が2つのアドレスで見える状態です。

`Rules > Redirect Rules > Create rule` で次のように作成します。

| 項目 | 値 |
| --- | --- |
| ルール名 | `www to apex` |
| 一致条件 | **Wildcard pattern** を選び、`https://www.tamayui.jp/*` |
| 転送先 URL | `https://tamayui.jp/${1}` |
| ステータスコード | `301`（Permanent Redirect） |
| Preserve query string | **On** |

`${1}` は `*` に一致した部分（パス）を引き継ぐ指定です。これにより `www.tamayui.jp/lessons` は `tamayui.jp/lessons` へ、検索順位を引き継いだまま転送されます。

公式資料: https://developers.cloudflare.com/rules/url-forwarding/examples/redirect-www-to-root/

※ この設定と 6-1 のレート制限は、いずれもCloudflareダッシュボードでの作業です。未設定のままでもサイトは動きますが、設定するまでは「未対応の運用項目」として残ります。

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
