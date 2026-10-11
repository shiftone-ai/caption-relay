# 開発手順

設定確認日：2026-10-10

リポジトリのルートで以下のコマンドを実行する。Codex Cloud と SSH 接続の固有手順は[リモート開発](remote-development.md)を参照する。

## 前提

| ツール | 基準・確認先 |
|---|---|
| Node.js | [.node-version](../.node-version) の 22.22.3 を推奨。利用可能な範囲は [frontend/package.json](../frontend/package.json) の `engines` |
| Python | [.python-version](../.python-version) の 3.12 |
| uv | [CI](../.github/workflows/ci.yml) と同じ 0.12.17 を基準とする |
| npm | フロントエンドの依存関係をロックファイルから導入する |

手動訂正と独立配信の起動に外部APIキー、データベース、コンテナは不要。AI校正は使う提供元のAPIキー、編集参加は有効なUDトークの編集用リンクが必要。マイク入力は[専用の準備手順](microphone-input.md)を参照する。

## セットアップと起動

```bash
bash scripts/setup.sh
bash scripts/dev.sh
```

[setup.sh](../scripts/setup.sh) は Node.js の要件を確認し、`backend/uv.lock` と `frontend/package-lock.json` から依存関係を導入して画面をビルドする。対応MacではmacOS 26 SDKでApple認識のSwift補助プログラムもビルドする。SDKがない環境やLinuxではAppleの準備を省略する。依存関係が変わった場合も再実行する。

[dev.sh](../scripts/dev.sh) は FastAPI を `127.0.0.1:24681` で起動し、`frontend/dist/` を配信する。操作画面は `/`、観客画面は `/view/demo`。バックエンドの変更は自動で読み込む。画面を変更した場合は `npm --prefix frontend run build` で再ビルドする。

フロントエンドを変更しながら確認する場合は、バックエンドを起動したまま別のターミナルで実行する。

```bash
npm --prefix frontend run dev
```

操作画面は <http://127.0.0.1:24682/static/>、観客画面は <http://127.0.0.1:24682/view/demo>。Viteが `/api` のHTTP・音声WebSocketと `/closedcaption` をバックエンドへ転送するため、接続設定の送信先も利用できる。終了時は各サーバーをCtrl+Cで止める。

## 環境変数

| 変数 | 用途 | 既定値 |
|---|---|---|
| `CAPTION_RELAY_PORT` | `dev.sh` のバックエンドのポート | `24681` |
| `CAPTION_RELAY_API_URL` | Vite が API を転送する接続先 | `http://127.0.0.1:24681` |
| `CAPTION_RELAY_UDTALK_URL` | UDトークのWeb字幕の閲覧リンク。未設定なら接続しない | 未設定 |
| `GEMINI_API_KEY` | GeminiのAPIキー | 未設定 |
| `ANTHROPIC_API_KEY` | ClaudeのAPIキー | 未設定 |
| `OPENAI_API_KEY` | OpenAIのAPIキー | 未設定 |
| `CAPTION_RELAY_OPENAI_API_KEY` | リポジトリ専用の音声認識用OpenAIキー | 未設定 |
| `CAPTION_RELAY_STT_JPY_PER_USD` | 音声認識の試験費用の円換算。税・地域処理を含む | 未設定 |
| `CAPTION_RELAY_STT_USAGE_PATH` | 音声認識の累積使用量台帳 | 利用者のキャッシュ配下 |
| `CAPTION_RELAY_AI_TIMEOUT_SECONDS` | AI要求全体の制限時間。0より大きく120以下 | `15` |

バックエンドのポートを変更するときは、`CAPTION_RELAY_PORT` と Vite の `CAPTION_RELAY_API_URL` を合わせて設定する。値の記入例は [.env.example](../.env.example) を参照する。

UDトークの実験用入力Adapterの設定・実機確認は[UDトークの入力接続](udtalk-input.md)を参照する。閲覧リンクは秘密として扱い、ログやPRに含めない。

[.env.example](../.env.example)が設定項目の一覧。起動スクリプトは `.env` を読み込まないため、起動するシェルの環境変数で渡す。Geminiを使う例：

```bash
read -r -s GEMINI_API_KEY
export GEMINI_API_KEY
bash scripts/dev.sh
```

入力待ちでキーを貼り付け、Enterを押す。キーをコマンド履歴に書かない。ClaudeとOpenAIも対応する変数で同様に設定する。操作画面のAI設定はキーの有無を表示するが、キー本体を返さない。AIは初期値オフで、画面で設定を保存した次の確定字幕から呼び出す。

UDトークのZoom送信先は画面の接続設定から取得する。編集用の参加リンクもこの画面で適用し、サーバーのメモリだけに保持する。再起動と配信先の変更で受信先の資格情報が変わるため、UDトーク側も設定し直す。「送られる字幕」だけを変更した場合は送信先と受信番号を保つ。送信先と参加リンクをログ・スクリーンショット・PRに含めない。`dev.sh`はURLの資格情報を記録しないようHTTPアクセスログを無効にする。

## 検証

```bash
bash scripts/check.sh
```

[check.sh](../scripts/check.sh) は API 型の一致、フロントエンドのテスト・型検査・ビルド、バックエンドの pyright 厳格モードと pytest を実行する。[GitHub Actions](../.github/workflows/ci.yml) も同じセットアップと検証を Linux 上で実行する。

変更箇所を確認するコマンドは次のとおり。いずれもルートから実行する。

| 対象 | コマンド |
|---|---|
| イベント伝播・状態遷移・Presenter・Root | `npm --prefix frontend test` |
| フロントエンドの型検査・ビルド | `npm --prefix frontend run build` |
| バックエンドの型検査 | `cd backend && uv run --locked --extra dev pyright` |
| バックエンドの振る舞い | `cd backend && uv run --locked --extra dev pytest -q` |

API モデルを変更した場合の再生成は[API の型生成](generated/README.md)を参照する。

画面を変更した場合は実ブラウザで対象操作を行い、実 API との通信を確認する。IME の変換確定による誤反映は、日本語入力ソフトを使った実機確認も必要。仕様ごとのテストと未検証の範囲は[現行 PoC の仕様](current-behavior.md)に記載する。
