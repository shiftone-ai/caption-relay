# リモート開発

開発環境は Node.js 22.22.3、Python 3.12、uv 0.12.17 を基準にする。アプリは FastAPI の単一プロセスで動き、React のビルドを配信する。現在の実装に外部 API キー、データベース、コンテナは不要。

## 共通コマンド

```bash
bash scripts/setup.sh
bash scripts/check.sh
bash scripts/dev.sh
```

`setup.sh` はロックファイルから依存関係を導入し、画面をビルドする。uv は `.python-version` の Python を使う。`check.sh` は API 型の一致、フロントエンドのテストとビルド、バックエンドの型検査とテストを実行する。`dev.sh` は `127.0.0.1:24681` で起動する。

フロントエンドの変更を即時確認する場合は、別ターミナルで `npm --prefix frontend run dev` を実行し、`http://127.0.0.1:24682/static/` を開く。API は既定で `127.0.0.1:24681` へ転送する。

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

## ssh-host

リポジトリは `[redacted-path]` に配置する。初回取得には Mac mini の GitHub SSH 認証を使用する。

```bash
ssh ssh-host
ghq get git@github.com:shiftone-ai/caption-relay.git
cd ~/caption-relay
bash scripts/setup.sh
bash scripts/check.sh
bash scripts/dev.sh
```

Mac mini の Codex で作業する場合は、同じディレクトリで `codex` を起動する。Codex デスクトップからは `ssh-host` 接続を選び、このディレクトリをプロジェクトとして開く。

ローカル端末で SSH ポート転送を開始する。

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:24683:127.0.0.1:24681 \
  -L 127.0.0.1:24684:127.0.0.1:24682 \
  ssh-host
```

操作画面は `http://127.0.0.1:24683/`、観客画面は `http://127.0.0.1:24683/view/demo`。Vite を起動した場合は `http://127.0.0.1:24684/static/` も使える。終了時はサーバーとポート転送をそれぞれ Ctrl+C で止める。

更新は作業前に `git status` を確認し、変更がない場合に `git pull --ff-only` を実行する。依存関係が変わったら `bash scripts/setup.sh` を再実行する。
