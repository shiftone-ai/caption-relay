# Caption Relay

認識結果のテキストを受け取り、人が字幕を修正して観客画面へ配信するローカル PoC です。操作画面と観客画面は React・TypeScript・XState、バックエンドは FastAPI・Pydantic v2 を使用します。

入力文をそのまま字幕として採用します。UDトーク実機との接続、Gemini による整形、認証、永続化は未実装です。単一プロセスで使用し、外部へ公開しないでください。再起動すると字幕は消えます。

## 起動

Node.js、Python 3.12、npm、uv が必要です。推奨バージョンと環境変数は[開発手順](docs/development.md)を参照してください。プロジェクトのルートから実行します。

```bash
bash scripts/setup.sh
bash scripts/dev.sh
```

| 画面 | URL |
|---|---|
| 操作画面 | <http://127.0.0.1:24681/> |
| 観客画面 | <http://127.0.0.1:24681/view/demo> |

`setup.sh` は依存関係を導入し、画面をビルドします。終了時はサーバーを Ctrl+C で止めます。フロントエンドの変更を即時確認する手順は[開発手順](docs/development.md)、Codex Cloud と SSH 接続は[リモート開発](docs/remote-development.md)に記載しています。

## 試す

1. 操作画面で「テスト字幕を送る」を押します。
2. 観客画面に字幕が表示されることを確認します。
3. 操作画面の表示文を修正し、「反映」を押します。Ctrl / Command + Enter でも反映できます。
4. 「非表示にする」で観客への表示を止め、「表示する」で新しい発話から再開します。

未反映の下書きは観客へ送られません。人が反映した文は後着の入力で上書きしません。編集競合、非表示期間、入力 API の詳細は[現行 PoC の仕様](docs/current-behavior.md)を参照してください。

## 変更する

```bash
bash scripts/check.sh
```

[AGENTS.md](AGENTS.md)が変更ルール、[システム構成](ARCHITECTURE.md)が実装の入口です。作業ごとの参照先は[ドキュメント一覧](docs/index.md)から選べます。
