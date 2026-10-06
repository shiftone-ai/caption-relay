# 開発手順

設定確認日：2026-10-06

リポジトリのルートで以下のコマンドを実行する。Codex Cloud と SSH 接続の固有手順は[リモート開発](remote-development.md)を参照する。

## 前提

| ツール | 基準・確認先 |
|---|---|
| Node.js | [.node-version](../.node-version) の 22.22.3 を推奨。利用可能な範囲は [frontend/package.json](../frontend/package.json) の `engines` |
| Python | [.python-version](../.python-version) の 3.12 |
| uv | [CI](../.github/workflows/ci.yml) と同じ 0.12.17 を基準とする |
| npm | フロントエンドの依存関係をロックファイルから導入する |

外部 API キー、データベース、コンテナは不要。

## セットアップと起動

```bash
bash scripts/setup.sh
bash scripts/dev.sh
```

[setup.sh](../scripts/setup.sh) は Node.js の要件を確認し、`backend/uv.lock` と `frontend/package-lock.json` から依存関係を導入して画面をビルドする。依存関係が変わった場合も再実行する。

[dev.sh](../scripts/dev.sh) は FastAPI を `127.0.0.1:24681` で起動し、`frontend/dist/` を配信する。操作画面は `/`、観客画面は `/view/demo`。バックエンドの変更は自動で読み込む。画面を変更した場合は `npm --prefix frontend run build` で再ビルドする。

フロントエンドを変更しながら確認する場合は、バックエンドを起動したまま別のターミナルで実行する。

```bash
npm --prefix frontend run dev
```

操作画面は <http://127.0.0.1:24682/static/>、観客画面は <http://127.0.0.1:24682/view/demo>。Vite が `/api` をバックエンドへ転送する。終了時は各サーバーを Ctrl+C で止める。

## 環境変数

| 変数 | 用途 | 既定値 |
|---|---|---|
| `CAPTION_RELAY_PORT` | `dev.sh` のバックエンドのポート | `24681` |
| `CAPTION_RELAY_API_URL` | Vite が API を転送する接続先 | `http://127.0.0.1:24681` |
| `CAPTION_RELAY_UDTALK_URL` | UDトークのWeb字幕の閲覧リンク。未設定なら接続しない | 未設定 |

バックエンドのポートを変更するときは、Vite の接続先も合わせる。

UDトークの実験用入力Adapterの設定・実機確認は[UDトークの入力接続](udtalk-input.md)を参照する。閲覧リンクは秘密として扱い、ログやPRに含めない。

```bash
CAPTION_RELAY_PORT=24685 bash scripts/dev.sh
# 別のターミナルで実行
CAPTION_RELAY_API_URL=http://127.0.0.1:24685 npm --prefix frontend run dev
```

[.env.example](../.env.example) の Gemini 設定は将来接続用であり、現行実装は使用しない。起動スクリプトは `.env` を読み込まないため、現行の設定はコマンドの環境変数で渡す。

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
