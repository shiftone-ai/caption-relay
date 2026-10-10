# リモート開発

Codex Cloud と Mac mini への SSH 接続の手順を記載する。推奨バージョン、共通コマンド、環境変数、検証方法は[開発手順](development.md)を参照する。

## Codex Cloud

環境に `shiftone-ai/caption-relay` を選び、次の内容でセットアップする。

- Node.js は `frontend/package.json` の要件を満たすもの、Python は 3.12 を使う。uv は 0.12.17 を基準にする。Cloud に用意された互換バージョンも使用できる。
- リポジトリのルートで `bash scripts/setup.sh` と `bash scripts/check.sh` を実行する。
- インストール手順に `bash scripts/setup.sh` を登録する。
- 起動手順に `bash scripts/dev.sh` を登録し、操作画面 `/` と観客画面 `/view/demo` を確認する。
- 環境の利用者は本人のみとする。依存関係の取得にはパッケージ管理用のネットワーク設定を使う。

検証後に環境を公開すると、その準備済みの環境を新しい作業で使える。リポジトリの更新後も、依存関係が変わった場合は `setup.sh`、画面が変わった場合はビルドを実行する。

環境の作成・更新・公開は [OpenAI の Cloud environments 手順](https://learn.chatgpt.com/docs/environments/cloud-environments)を参照する。

2026-10-05 の環境構築では、Cloud の Node.js 24.19.0、Python 3.12.14、uv 0.12.19 で共通のチェックを通した。Mac mini は Node.js 22.22.3、Python 3.12.13、uv 0.12.17 を使用した。

## Mac mini

実際の SSH 接続先とリポジトリの配置は公開文書に記載しない。利用端末で `CAPTION_RELAY_SSH_HOST`、接続先で `CAPTION_RELAY_REMOTE_REPO` を設定する。変数名は [.env.example](../.env.example) に記載するが、これらは以下の SSH 手順用であり、アプリの起動スクリプトは読み込まない。初回取得には Mac mini の GitHub SSH 認証を使用する。

```bash
ssh "$CAPTION_RELAY_SSH_HOST"
ghq get git@github.com:shiftone-ai/caption-relay.git
cd "$CAPTION_RELAY_REMOTE_REPO"
bash scripts/setup.sh
bash scripts/check.sh
bash scripts/dev.sh
```

Mac mini の Codex で作業する場合は、同じディレクトリで `codex` を起動する。Codex デスクトップからは設定した SSH 接続を選び、このディレクトリをプロジェクトとして開く。

ローカル端末で SSH ポート転送を開始する。

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:24683:127.0.0.1:24681 \
  -L 127.0.0.1:24684:127.0.0.1:24682 \
  "$CAPTION_RELAY_SSH_HOST"
```

操作画面は `http://127.0.0.1:24683/`、観客画面は `http://127.0.0.1:24683/view/demo`。Vite を起動した場合は `http://127.0.0.1:24684/static/` も使える。終了時はサーバーとポート転送をそれぞれ Ctrl+C で止める。

更新は作業前に `git status` を確認し、変更がない場合に `git pull --ff-only` を実行する。依存関係が変わったら `bash scripts/setup.sh` を再実行する。
