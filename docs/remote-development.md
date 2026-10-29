# リモート開発

Codex Cloud と SSH 接続で開発する手順を記載する。推奨バージョン、共通コマンド、環境変数、検証方法は[開発手順](development.md)を参照する。

## Codex Cloud

環境に `shiftone-ai/caption-relay` を選び、次の内容でセットアップする。

- Node.js は `frontend/package.json` の要件を満たすもの、Python は 3.12 を使う。uv は 0.12.17 を基準にする。Cloud に用意された互換バージョンも使用できる。
- リポジトリのルートで `bash scripts/setup.sh` と `bash scripts/check.sh` を実行する。
- インストール手順に `bash scripts/setup.sh` を登録する。
- 起動手順に `bash scripts/dev.sh` を登録し、操作画面 `/` と観客画面 `/view/demo` を確認する。
- 環境の利用者は本人のみとする。依存関係の取得にはパッケージ管理用のネットワーク設定を使う。

検証後に環境を公開すると、その準備済みの環境を新しい作業で使える。リポジトリの更新後も、依存関係が変わった場合は `setup.sh`、画面が変わった場合はビルドを実行する。

環境の作成・更新・公開は [OpenAI の Cloud environments 手順](https://learn.chatgpt.com/docs/environments/cloud-environments)を参照する。

## SSH 接続

接続先と利用者名は自分の SSH 設定で管理する。内部のホスト名、利用者名、ホームディレクトリの絶対パスをリポジトリに記録しない。

SSH で接続したサーバー上で、このリポジトリを作業用ディレクトリへ取得する。

```bash
git clone https://github.com/shiftone-ai/caption-relay.git
cd caption-relay
bash scripts/setup.sh
bash scripts/check.sh
bash scripts/dev.sh
```

ローカル端末の Bash で SSH 接続先を入力し、ポート転送を開始する。サーバー側は `dev.sh` の既定ポートを使用する。ローカル側で同じポートを使用中なら、転送先の設定に合わせて空いているポートへ変更する。

```bash
read -r -p 'SSH 接続先: ' CAPTION_RELAY_SSH_TARGET
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:24681:127.0.0.1:24681 \
  -L 127.0.0.1:24682:127.0.0.1:24682 \
  -- "$CAPTION_RELAY_SSH_TARGET"
```

既定の転送では、ホームは <http://127.0.0.1:24681/>、デモ用の観客画面は <http://127.0.0.1:24681/view/demo>。Vite を起動した場合は <http://127.0.0.1:24682/> も使える。終了時はサーバーとポート転送をそれぞれ Ctrl+C で止める。

更新は作業前に `git status` を確認し、変更がない場合に `git pull --ff-only` を実行する。依存関係が変わったら `bash scripts/setup.sh` を再実行する。
