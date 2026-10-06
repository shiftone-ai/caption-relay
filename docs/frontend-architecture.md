# フロントエンドの構成

実装確認日：2026-10-06

すべてのアプリケーションコンポーネントを Root 配下に置き、Root、Passive View、Presenter、Mediator、Adapter に責務を分ける。現在の操作画面と観客画面は TypeScript、React、XState、shadcn/ui を使用する。システム全体の責務とバックエンドは[システム構成](../ARCHITECTURE.md)、画面の振る舞いは[現行 PoC の仕様](current-behavior.md)を参照する。

以下の `src/` は `frontend/src/` を指す。

## コンポーネント階層

各画面が Root を一つ持つ。`events/hierarchy.tsx` の共通階層を画面と共有部品が使う。Scope は親を必須とし、Root の外で View、Button、Textarea を生成するとエラーになる。Root の入れ子も禁止する。

各 View と共有部品は自身の Scope を持ち、親コンポーネントの Scope に接続する。ネイティブの HTML 要素と描画用の外部ライブラリ部品は、その所有コンポーネントの Scope 内に置く。Button は型付きの `intent`、Textarea は入力値とキー情報からイベントを作る関数を受け取り、部品自身の Scope から伝播を始める。これらの関数は操作内容を通知するだけで、保存や状態変更を行わない。

```text
OperatorRoot
└─ OperatorView
   ├─ ToolbarView
   │  └─ Button
   ├─ CaptionMonitorView
   ├─ CaptionListView
   │  ├─ CaptionRowView（字幕 ID ごと）
   │  │  └─ Button
   │  └─ Button
   ├─ CaptionEditorView
   │  ├─ Textarea
   │  └─ Button
   ├─ DisplaySettingsView
   │  ├─ CaptionDisplayView
   │  ├─ DisplayFieldView（設定項目ごと）
   │  └─ Button
   └─ AiSettingsView
      └─ Button

AudienceRoot
└─ AudienceView
   ├─ CaptionDisplayView
   └─ Button
```

Root は XState actor を起動して Presenter を接続する。actor は React のマウント期間に合わせて動作し、終了時に取得の AbortSignal、SSE 接続、全画面変更の DOM リスナーを解放する。OperatorRoot は Presenter が未保存と示す間だけ、離脱確認 Adapter を接続する。

## 責務と流れ

1. `src/views/` の Passive View がユーザー操作を型付きイベントとして通知する。描画は渡された文字列や有効・無効の指定に従う。
2. `src/events/chain.ts` の Chain of Responsibility がイベントを発生元から親へ伝播させる。ハンドラーが `true` を返したら停止する。
3. Root が `snapshot.can(event)` を確認し、受理可能なイベントを XState actor へ渡す。受理した場合だけ伝播を止める。`src/machines/` の Mediator が操作の可否、次の状態、副作用を裁定する。
4. `src/presenters/` が actor の状態を描画パラメータへ変換する。
5. `src/api.ts` の Adapter が HTTP と SSE、`src/adapters/fullscreen.ts` が全画面のブラウザ API と変更通知、`src/adapters/unsaved-changes.ts` が離脱確認を扱う。XState の invoke が結果・失敗を受け取り、状態遷移へ戻す。

View は actor や API を直接呼び出さず、業務状態を保持しない。入力値、キー情報、スクロール寸法の読み取りと、指示されたフォーカス・スクロールは表示側の責務とする。キーから保存・編集終了を選ぶ判断、追従位置の判定、配色の適用、AI候補の追加・除外は Mediator が行う。View は下書きを組み立てず、Presenter が渡した項目・選択肢・CSS・有効状態を描画する。下書きと編集開始時の改版は Mediator が保持する。編集へのフォーカス要求、履歴の移動先、新着IDもMediatorが管理し、Viewは指示された位置へ移る。

Presenter は操作ごとに `snapshot.can(event)` を参照し、ボタンの無効化や入力の読み取り専用指定へ変換する。状態名から操作の可否を再判定せず、Mediator の遷移と guard を使う。空欄の反映も検証メッセージを出すイベントとして受理し、通信するかどうかは Mediator が決める。

## 状態遷移

`src/machines/operator.ts` が取得、保存、表示切り替え、反映モード、表示設定、AI設定、テスト入力を裁定する。編集行と下書き、最新位置への追従もこのMediatorが保持する。AI設定と表示設定は同時に一つだけ開き、閉じても未保存の設定を保持する。

- 起動時は `loading → ready / failed`。取得失敗後は再取得で復帰する。
- ready の中で `idle → refreshing / saving / toggling / testing / settingMode / settingDisplay / settingAi → idle` を遷移する。保存・切り替え・送信中の重複操作は受理しない。
- 下書きは背景取得や保存失敗でも保持する。競合時は最新文を提示し、明示的な再反映操作で最新改版へ保存する。
- 更新取得中に操作が始まると取得 actor を終了する。古い取得結果は適用せず、AbortSignal で HTTP を中断する。
- 定期取得は XState の after で開始し、actor 終了時にタイマーも終了する。

`src/machines/audience.ts` は配信と全画面表示を並列の状態として管理する。配信は `connecting → live ↔ reconnecting` を遷移する。切断中は直前の字幕を保持し、再接続後のスナップショットで同期する。公開・非公開の決定はバックエンドが担当する。表示設定も公開スナップショットへ含め、Presenterが字幕数・書体・寸法へ変換する。全画面表示は `idle → changing → idle / failed` を遷移し、処理中の重複要求を拒否する。失敗は画面へ表示し、再試行を受理する。Escape などによるブラウザ側の解除も Adapter から通知して同期する。全画面要求はユーザー操作の間に Adapter が開始し、配信の再接続から独立して動作する。

## API 型の利用

[API の型生成](generated/README.md)で OpenAPI と TypeScript 型を同期する。フロントエンドの Adapter は生成した型を使用し、独自に API モデルを再定義しない。TypeScript の型はブラウザでの JSON の実行時検証を行うものではなく、サーバー側の応答検証と組み合わせる。

## 検証

`npm --prefix frontend test` でイベントの伝播・停止、下書き保持、保存失敗・競合、重複操作、取得のキャンセル、SSE の解放を確認する。`src/architecture.test.ts` が全コンポーネントの Scope、View の依存先、通知内の判断・副作用を検査する。全画面の重複要求・失敗・外部解除と DOM リスナーの解放もテストする。テストファイルの対応は[現行 PoC の仕様](current-behavior.md#検証の対応)、全体の検証とブラウザ操作は[開発手順](development.md#検証)を参照する。

新しいアプリケーションコンポーネントにも自身の Scope を設け、描画パラメータと操作通知だけを受け渡す。動作を変更する場合は Mediator、描画への変換を変更する場合は Presenter、外部 API を扱う場合は Adapter を変更する。

## 使用した公式資料

- [XState と React](https://stately.ai/docs/xstate-react)
- [XState の invoke](https://stately.ai/docs/invoke)
- [shadcn/ui の Vite 導入](https://ui.shadcn.com/docs/installation/vite)
- [FastAPI の応答モデル](https://fastapi.tiangolo.com/tutorial/response-model/)
- [Pydantic のモデル](https://pydantic.dev/docs/validation/latest/concepts/models/)

## 操作画面の余白

余白と部品寸法は8pxを基準にし、8・16・24・32pxを用いる。履歴の本文は16px・行間24pxで一列に表示し、短文の行は48px。履歴と直近の入力は連番を使わず、12pxの受信時刻を添える。原文との比較は選択した字幕の訂正欄で行う。長文の行は内容に応じて伸ばし、訂正欄を別の領域に置く。フォントサイズと1pxの区切り線は余白の規則から分ける。共有部品を一括で変更せず、操作画面のCSSに限定して適用する。

編集中の行は内側の輪郭を四辺に表示し、通常行の区切り線となる`::after`を非表示にする。輪郭の下辺と区切り線の重なりを防ぎ、編集を閉じると区切り線を戻す。

セレクトはネイティブの選択操作を保ち、16pxの矢印を右端から8px内側に置く。右の内余白32pxで文字と矢印の重なりを防ぐ。強制配色ではブラウザの矢印を使う。デスクトップの字幕行は状態アイコンを32pxの高さの中央に置き、編集ボタンのアイコンと揃える。

訂正・表示設定・AI設定のスクロール領域は、入力欄の外側に出るフォーカス輪郭を切らないよう8pxの内余白を確保する。左右の負のマージンで領域を広げ、入力欄の位置と幅は維持する。右側は既存のスクロールバー用の余白も残す。`scroll-padding-block` は上下8pxとし、キーボードで項目へ移る際の輪郭も保つ。

## 観客画面とプレビューの描画

`presenters/display.ts` は共通の描画パラメータを作る。実寸の観客画面ではpx、基準画面のプレビューではコンテナー幅の単位で同じ寸法比を使う。`CaptionDisplayView` は背景・表示枠・発話の描画を担当する。内容や寸法の変更を示す安定した `scrollVersion` が変わった場合とリサイズ時に末尾へ移り、操作画面の定期取得だけではプレビューの手動スクロールを戻さない。
