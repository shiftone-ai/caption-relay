# Caption Relay v0.2

認識結果を受け取り、人が字幕を修正して観客画面へ配信するローカル PoC です。操作画面と観客画面を TypeScript・React・XState・shadcn/ui へ移行し、バックエンドは FastAPI・Pydantic v2 で型付けしています。

現行実装は入力文をそのまま字幕として採用します。UDトーク実機との接続、Gemini による整形、認証、永続化は未実装です。単一プロセスで使用し、外部へ公開しないでください。

## 起動

Node.js 22.12 以上、Python 3.12 以上、npm、uv を使用します。プロジェクトのルートから実行します。

```bash
cd frontend
npm ci
npm run build
cd ../backend
uv sync --extra dev
uv run uvicorn app.main:app --host 127.0.0.1 --port 24681
```

操作画面は `http://127.0.0.1:24681/`、観客画面は `http://127.0.0.1:24681/view/demo` です。FastAPI が `frontend/dist/` を配信するため、初回起動とフロントエンド変更後にビルドしてください。

## 開発

バックエンドを上記のコマンドで起動し、別のターミナルでフロントエンドの開発サーバーを起動します。

```bash
cd frontend
npm run dev
```

開発画面は `http://127.0.0.1:24682/static/` です。API はバックエンドへ転送します。接続先を変える場合は `CAPTION_RELAY_API_URL` を環境変数で指定します。

```bash
CAPTION_RELAY_API_URL=http://127.0.0.1:24681 npm run dev
```

## 操作

「テスト字幕を送る」で検証用の発話を追加します。表示文を修正し、「反映」で保存します。Ctrl / Command + Enter でも反映できます。日本語の変換中の Enter は反映に使いません。

未反映の修正は観客画面へ送らず、定期取得でも下書きと編集開始時の改版を保持します。保存が失敗した場合も修正案を残します。競合時はサーバーの最新文を提示し、確認後の「再反映」で保存します。人が反映した文は後着の入力で上書きしません。

「非表示にする」は観客への出力を止めます。入力は続きます。「表示する」で再開しても、非表示期間の発話は自動で公開せず、新しい発話から公開します。

## 入力 API

本アプリの入力 API です。UDトークが提供する API ではありません。実機との連携には接続仕様に合わせた Adapter が必要です。

```bash
curl -X POST http://127.0.0.1:24681/api/source/events \
  -H 'Content-Type: application/json' \
  -d '{
    "utterance_id": "u-001",
    "revision": 1,
    "text": "本日はありがとうございます。",
    "is_final": true,
    "source_event_id": "event-001"
  }'
```

同じ発話には同じ `utterance_id` と増加する `revision` を渡します。`source_event_id` で再送を抑止します。入力は Pydantic の厳格モードで検証し、余分な項目、文字列の改版番号、不正なコマンドなどには 422 を返します。

主な API は `GET /api/session`、`GET /api/events`、`PATCH /api/captions/{id}`、`POST /api/commands`、`GET /api/view`、`GET /api/view/events` です。編集時の改版競合には 409 と最新の字幕を返します。観客 API と SSE は字幕 ID・改版・表示文のみを返し、原文や管理情報を含めません。

## 検証

```bash
cd frontend
npm run check:api
npm test
npm run build
cd ../backend
uv run --extra dev pyright
uv run --extra dev pytest -q
```

API モデルを変更したら `cd frontend && npm run generate:api` で型を再生成してください。生成元と TypeScript 型の一致は `check:api` で確認します。

テストではイベント伝播、下書き保持、保存失敗・競合、重複操作、古い取得結果、入力の型検証、公開データの分離、SSE スナップショットを確認します。日本語入力ソフトを使った IME の実機試験は別途必要です。

## 構成と制約

[フロントエンドの構成と API の型](docs/frontend-architecture.md)に Root、Passive View、Presenter、Mediator、Adapter の責務を記載しています。今後の変更では、触る画面・コンポーネントから段階的に適用します。[AGENTS.md](AGENTS.md)が変更ルール、[ドキュメント一覧](docs/index.md)が文書の入口です。

サーバーの状態はメモリ上にあり、再起動で消えます。複数ワーカー、監査履歴と取消、過去字幕の再表示、長時間運転・負荷試験は対応していません。`GEMINI_API_KEY` 等の環境変数は `.env.example` に残っていますが、現行実装では使用しません。

[design-v0.2.md](docs/design-v0.2.md)は将来要件を含む設計書です。実装範囲はこの README を参照してください。
