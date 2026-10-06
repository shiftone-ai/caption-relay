# Caption Relay の変更ルール

初回はルートで `bash scripts/setup.sh` を実行する。依存関係はロックファイルから導入する。

## 作業に応じた参照先

| 変更対象 | 参照先 |
|---|---|
| 画面・コンポーネント | [フロントエンドの構成](docs/frontend-architecture.md) |
| バックエンドの状態・API・配信の境界 | [システム構成](ARCHITECTURE.md) |
| 字幕の入力・編集・公開の振る舞い | [現行 PoC の仕様](docs/current-behavior.md) |
| API モデル・生成した型 | [API の型生成](docs/generated/README.md) |
| 起動・依存関係・検証コマンド | [開発手順](docs/development.md) |
| Codex Cloud・SSH 接続 | [リモート開発](docs/remote-development.md) |

[ドキュメント一覧](docs/index.md)から必要な資料を選ぶ。将来設計は現行実装の仕様として扱わない。画面の責務の移行は今回触る画面・コンポーネントに限り、移行後の経路を一つにする。

## 完了条件

- 変更後は `bash scripts/check.sh` を通す。今回の変更による失敗は修正し、影響する検証を再実行する。
- 画面を変更した場合は、実ブラウザで対象操作を行い、実 API との通信を確認する。
- API モデルを変更した場合は `cd frontend && npm run generate:api` で再生成する。生成ファイルは手で編集しない。
- 仕様・構成・開発手順が変わった場合は対応する文書も更新し、文書の追加・移動では一覧と相対リンクを確認する。
