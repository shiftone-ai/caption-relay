# Caption Relay の変更ルール

初回はルートで `bash scripts/setup.sh`、変更後の検証は `bash scripts/check.sh` を実行する。依存関係はロックファイルから導入し、API 型は生成コマンドで更新する。Codex Cloud と SSH 接続での開発手順は [リモート開発](docs/remote-development.md)を参照する。

画面・コンポーネントを新設または変更するときは、[フロントエンドの構成](docs/frontend-architecture.md)を読み、変更対象を次の構成へ段階的に移行する。

- 全コンポーネントを画面の Root 配下へ置き、親を明示する。
- MVP の Passive View は描画パラメータと DOM を扱い、ユーザー操作をイベントとして通知する。
- イベントは Chain of Responsibility に沿って親へ伝播させる。処理済みのイベントはその場所で伝播を止める。
- 操作の可否、業務状態、状態遷移、副作用の開始は XState のステートマシンとして振る舞う Mediator が裁定する。
- Presenter は状態から描画パラメータを作る。通信とタイマーは Adapter に置き、結果をイベントで返す。

移行は今回触る画面とその責務に限る。新旧の責務を同じ経路に重ねず、移行後の経路を一つにする。

状態遷移とイベント伝播は `cd frontend && npm test` で検証する。画面の変更は実ブラウザで対象操作を行い、実 API との通信を確認する。

バックエンドは FastAPI と Pydantic v2 を使用する。API の入力・応答と内部の状態をモデルで型付けし、`uv run --extra dev pyright` の厳格モードを通す。公開用モデルには観客へ送る項目だけを定義する。

API モデルを変更したら `cd frontend && npm run generate:api` で OpenAPI と TypeScript 型を再生成し、`npm run check:api` と `npm run build` を通す。`docs/generated/openapi.json` と `frontend/src/generated/api.d.ts` は生成ツールで更新する。
