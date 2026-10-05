# フロントエンドの構成と API の型

画面を変更する際に、Root、Passive View、Presenter、Mediator、Adapter の責務へ段階的に移す。現在の操作画面と観客画面は TypeScript、React、XState、shadcn/ui を使用する。Vite でビルドし、FastAPI が `frontend/dist/` を配信する。

## コンポーネント階層

各画面が Root を一つ持つ。`events/hierarchy.tsx` の Scope は親を必須とし、Root の外に生成するとエラーになる。shadcn/ui の表示部品も、所属する Scope の下に描画する。

各 View が自身の Scope を持ち、親 View の Scope の直下に接続する。操作画面の ToolbarView と CaptionListView・CaptionRowView は `src/views/operator/` に置く。操作を通知する View は Scope の描画関数が受け取る `emit` を使い、自身の Scope から伝播を始める。Scope 内の表示部品がイベントを通知する場合は `useBubble` で所属先へ接続できる。階層を作るためのラッパーを呼び出し側へ重ねる必要はない。

```text
Operator Root
└─ 操作画面
   ├─ 操作ボタン
   └─ 字幕一覧
      └─ 字幕行（字幕 ID ごと）

Audience Root
└─ 観客画面
```

Root は XState actor を起動して Presenter を接続する。actor は React のマウント期間に合わせて動作し、終了時に取得の AbortSignal と SSE 接続を解放する。

## 責務と流れ

1. `src/views/` の Passive View がユーザー操作を型付きイベントとして通知する。描画は渡された文字列や有効・無効の指定に従う。
2. `src/events/chain.ts` の Chain of Responsibility がイベントを発生元から親へ伝播させる。ハンドラーが `true` を返したら停止する。
3. Root が XState actor へイベントを渡す。`src/machines/` の Mediator が操作の可否、次の状態、副作用を裁定する。
4. `src/presenters/` が actor の状態を描画パラメータへ変換する。
5. `src/api.ts` の Adapter が HTTP と SSE を扱う。XState の invoke が結果・失敗を受け取り、状態遷移へ戻す。

View は actor や API を直接呼び出さず、業務状態を保持しない。入力イベントの読み取り、キーボード操作の対応、フォーカスや選択範囲は表示側の責務とする。下書きと編集開始時の改版は Mediator が保持する。

Presenter は操作ごとに `snapshot.can(event)` を参照し、ボタンの無効化や入力の読み取り専用指定へ変換する。状態名から操作の可否を再判定せず、Mediator の遷移と guard を使う。空欄の反映も検証メッセージを出すイベントとして受理し、通信するかどうかは Mediator が決める。

## 状態遷移

`src/machines/operator.ts` が取得、保存、表示切り替え、テスト入力を裁定する。

- 起動時は `loading → ready / failed`。取得失敗後は再取得で復帰する。
- ready の中で `idle → refreshing / saving / toggling / testing → idle` を遷移する。保存・切り替え・送信中の重複操作は受理しない。
- 下書きは背景取得や保存失敗でも保持する。競合時は最新文を提示し、明示的な再反映操作で最新改版へ保存する。
- 更新取得中に操作が始まると取得 actor を終了する。古い取得結果は適用せず、AbortSignal で HTTP を中断する。
- 定期取得は XState の after で開始し、actor 終了時にタイマーも終了する。

`src/machines/audience.ts` は `connecting → live ↔ reconnecting` を管理する。切断中は直前の字幕を保持し、再接続後のスナップショットで同期する。公開・非公開の決定はバックエンドが担当する。

## バックエンドと型の受け渡し

`backend/app/models.py` は Pydantic v2 のモデルを定義する。入力の余分な項目と暗黙の型変換を拒否し、字幕の空白だけの修正を検証する。コマンドは `show / hide` の Literal とし、不正な入力には FastAPI の 422 応答を返す。

`backend/app/relay.py` がセッション状態を所有する。API 層はモデルを渡して結果を受け取り、存在しない字幕や改版競合を HTTP エラーへ変換する。状態や購読キューの値も型付けし、応答モデルと SSE のシリアライズには Pydantic を使う。

観客への配信は PublicSnapshot と PublicCaption を使用し、字幕 ID、改版、表示文だけを送る。原文や入力側の管理情報は送らない。購読開始時のスナップショットと、満杯になったキューの再同期も同じモデルを使用する。

[API の型生成](generated/README.md)で OpenAPI と TypeScript 型を同期する。フロントエンドの Adapter は生成した型を使用し、独自に API モデルを再定義しない。TypeScript の型はブラウザでの JSON の実行時検証を行うものではなく、サーバー側の応答検証と組み合わせる。

## 検証と今後の移行

フロントエンドのテストはイベントの伝播・停止、下書き保持、保存失敗・競合、重複操作、取得のキャンセル、SSE の解放を確認する。バックエンドは入力検証、編集競合、公開データの分離、非表示期間、スナップショットを検証する。View の責務分離はソースレビューでも確認する。

次に触る画面・コンポーネントをこの構成へ移し、変更範囲の外まで一括で書き換えない。認証、永続化、UDトーク実機、Gemini 接続は未実装であり、今回の移行にも含めない。

## 使用した公式資料

- [XState と React](https://stately.ai/docs/xstate-react)
- [XState の invoke](https://stately.ai/docs/invoke)
- [shadcn/ui の Vite 導入](https://ui.shadcn.com/docs/installation/vite)
- [FastAPI の応答モデル](https://fastapi.tiangolo.com/tutorial/response-model/)
- [Pydantic のモデル](https://pydantic.dev/docs/validation/latest/concepts/models/)
