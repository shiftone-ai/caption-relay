# フロントエンドの構成

実装確認日：2026-10-29

すべてのアプリケーションコンポーネントを Root 配下に置き、Root、Passive View、Presenter、Mediator、Adapter に責務を分ける。現在の操作画面と観客画面は TypeScript、React、XState、shadcn/ui を使用する。システム全体の責務とバックエンドは[システム構成](../ARCHITECTURE.md)、画面の振る舞いは[現行 PoC の仕様](current-behavior.md)を参照する。

以下の `src/` は `frontend/src/` を指す。

## コンポーネント階層

各画面が Root を一つ持つ。`events/hierarchy.tsx` の共通階層を画面と共有部品が使う。Scope は親を必須とし、Root の外で View、Button、Textarea、Disclosure を生成するとエラーになる。Root の入れ子も禁止する。

各 View と共有部品は自身の Scope を持ち、親コンポーネントの Scope に接続する。ネイティブの HTML 要素と描画用の外部ライブラリ部品は、その所有コンポーネントの Scope 内に置く。Button は型付きの `intent`、Textarea は入力値とキー情報からイベントを作る関数を受け取り、部品自身の Scope から伝播を始める。これらの関数は操作内容を通知するだけで、保存や状態変更を行わない。共通部品の props は DOM の操作コールバックを受け付けず、呼び出し元が直接動作を差し込めないようにする。

説明欄と設定グループの開閉は共通の Disclosure を使う。`id` と `open` を描画パラメータで受け取り、クリックと Enter・Space による操作を `disclosure.toggled` として自身の Scope から通知する。ブラウザによる開閉はキャンセルし、Mediator が受理して Presenter が新しい `open` を渡した場合にだけ表示を変える。

```text
OperatorRoot
└─ OperatorView
   ├─ ToolbarView
   │  ├─ Disclosure
   │  │  └─ Button（準備欄）
   │  └─ Button
   ├─ CaptionMonitorView
   ├─ CaptionListView
   │  ├─ CaptionRowView（字幕 ID ごと）
   │  │  └─ Button
   │  └─ Button
   ├─ CaptionEditorView
   │  ├─ Textarea
   │  ├─ Disclosure
   │  └─ Button
   ├─ DisplaySettingsView
   │  ├─ CaptionDisplayView
   │  ├─ DisplayFieldView（設定項目ごと）
   │  ├─ Disclosure
   │  │  └─ DisplayFieldView（設定グループ内）
   │  └─ Button
   ├─ AiSettingsView
   │  ├─ Disclosure
   │  └─ Button
   ├─ DictionarySettingsView
   │  ├─ Textarea
   │  └─ Button
   └─ ConnectionSettingsView
      ├─ Textarea
      ├─ Disclosure
      └─ Button

AudienceRoot
└─ AudienceView
   ├─ CaptionDisplayView
   └─ Button
```

Root は XState actor を起動して Presenter を接続する。actor は React のマウント期間に合わせて動作し、終了時に取得の AbortSignal、SSE 接続、全画面変更の DOM リスナーを解放する。OperatorRoot は Presenter が未保存と示す間だけ、離脱確認 Adapter を接続する。キー通知の Adapter は画面全体のkeydownをRootへ送り、終了時に購読を解放する。状態説明をホバーしている間は、フォーカスが履歴の外にあってもEscapeで閉じられる。

## 責務と流れ

1. `src/views/` の Passive View がユーザー操作を型付きイベントとして通知する。描画は渡された文字列や有効・無効の指定に従う。
2. `src/events/chain.ts` の Chain of Responsibility がイベントを発生元から親へ伝播させる。ハンドラーが `true` を返したら停止する。
3. Root が `snapshot.can(event)` を確認し、受理可能なイベントを XState actor へ渡す。受理した場合だけ伝播を止める。`src/machines/` の Mediator が操作の可否、次の状態、副作用を裁定する。両画面の Mediator は共通の View イベントを受け取り、担当外のイベントには遷移を定義せず拒否する。Root はイベントの種別を独自に選別しない。
4. `src/presenters/` が actor の状態を描画パラメータへ変換する。
5. `src/api.ts` の Adapter が HTTP と SSE、`src/adapters/fullscreen.ts` が全画面のブラウザ API と変更通知、`src/adapters/unsaved-changes.ts` が離脱確認を扱う。XState の invoke が結果・失敗を受け取り、状態遷移へ戻す。

View は actor や API を直接呼び出さず、業務状態を保持しない。入力値、キー情報、スクロール寸法の読み取りと、指示されたフォーカス・スクロールは表示側の責務とする。キーから保存・編集終了を選ぶ判断、追従位置の判定、配色の適用、AI候補の追加・除外は Mediator が行う。View は下書きを組み立てず、Presenter が渡した項目・選択肢・CSS・有効状態を描画する。下書きと編集開始時の改版は Mediator が保持する。編集へのフォーカス要求、履歴の移動先、新着IDもMediatorが管理し、Viewは指示された位置へ移る。

設定パネルのフォーカスも Mediator が移動先と要求番号を決め、Presenter が DOM の対象セレクターへ変換する。View は番号が変わったときだけ対象へフォーカスする。定期取得ではフォーカスを移さない。設定を閉じると起点のボタンへ戻し、字幕を選択する場合と「編集中の字幕へ」の場合は編集欄へ移す。View は以前のパネルや編集状態を記憶して戻し先を判断しない。編集中の字幕行は IntersectionObserver で一覧内の交差率を測り、Mediator が表示範囲内かを保持する。Presenter はその行が表示範囲外か、設定で訂正欄が隠れている場合だけ「編集中の字幕へ」を表示する。

Presenter は操作ごとに `snapshot.can(event)` を参照し、ボタンの無効化や入力の読み取り専用指定へ変換する。状態名から操作の可否を再判定せず、Mediator の遷移と guard を使う。空欄の反映も検証メッセージを出すイベントとして受理し、通信するかどうかは Mediator が決める。

Mediatorは字幕IDの索引を保持し、取得・保存・競合結果とともに更新する。操作可否の判定では全履歴を再走査しない。Presenterは変更のない行の描画パラメータを再利用し、履歴行のmemo化で入力・スクロール時の再描画を抑える。操作の可否は引き続きMediatorのguardで判断する。

訂正履歴の選択は `caption.history.selected` で通知し、Mediatorが選んだ改版の文を現在の改版に対する下書きへ取り込む。再公開は保存イベントの `republish` で明示する。保存失敗時は本文と保存番号を保持し、同じ要求の再送に使う。新しい本文と競合確認後の保存には新しい番号を発行する。成功応答より新しい字幕を取得済みの場合は、その字幕を保持する。

## 状態遷移

ホームの `HomeRoot` は `machines/home.ts` を使い、一覧取得、登録・設定変更、接続を順に行う。`RoomRoot` は `machines/room.ts` で接続と確認付きリセット・離脱を裁定する。字幕画面がある間は `OperatorRoot` がRootを一つ所有し、ルームと字幕の各Mediatorへ `snapshot.can(event)` で通知する。Rootを入れ子にしない。

`adapters/rooms.ts` はルームAPIとページ遷移を扱う。操作APIと音声WebSocketにはルームとリセットの世代を付け、観客リンクには `room_id` を付ける。リセットが成功したら新しい世代で操作画面を作り直して下書きを捨てる。ホームへ戻る際は、操作画面と離脱確認の購読を解放した後でページを移る。確認ダイアログ内のEscapeは、背後の字幕編集へ通知しない。

`src/machines/operator.ts`が取得、保存、表示切り替え、公開方法、表示設定、AI設定、接続設定、テスト入力を裁定する。編集行と下書き、最新位置への追従もこのMediatorが保持する。設定パネルは一つの選択状態で管理し、同時に一つだけ開く。閉じても未保存の設定を保持する。接続設定の参加リンクは適用成功時にブラウザの入力状態から消す。

説明欄の開閉は Mediator の集合で管理する。欄ごとに独立し、定期取得とパネルの切り替えでも保持する。再読み込み時は初期状態に戻す。字幕ごとの説明は字幕IDと結び付け、存在しない字幕への操作を拒否する。Presenter は該当する欄の開閉が変わった場合にだけ、その字幕行のパラメータを作り直す。

接続設定は `connection.mode.selected`・`connection.url.changed`・`connection.save.requested` を通知する。取得Adapterが接続状態を読み、送信先を現在の画面のoriginに合わせる。Mediatorは編集参加で観客表示・テスト字幕・公開方法を無効にし、現在の接続で受信した確定字幕だけの保存を許可する。ViewはPresenterの `localOutput` に従い、編集参加では公開方法の選択欄とその説明を表示しない。Presenterが保存先と純正表示の確認を説明する。無効なリンクと保存失敗でも字幕の下書きは保持する。

状態説明のポインター・フォーカス・解除もMediatorが管理する。Viewは領域への入退出とフォーカスの変化、描画した領域の寸法を通知し、Presenterが示す開閉状態と位置を描画する。説明は画面内へ収め、スクロール領域で切れないようfixedで表示する。説明へポインターを移しても保持し、Escapeで解除したあとは元の操作領域を離れるまで再表示しない。子で受理したキーは親で重ねて裁定しない。編集終了時の戻し先も描画パラメータで指定し、Viewが起点の字幕へフォーカスを戻す。履歴確認中の新着件数は短いpolite通知で伝える。

- 起動時は `loading → ready / failed`。取得失敗後は再取得で復帰する。
- readyの中で `idle → refreshing / saving / toggling / testing / settingMode / settingDisplay / settingAi / settingConnection → idle` を遷移する。保存・切り替え・送信中の重複操作は受理しない。
- 下書きは背景取得や保存失敗でも保持する。競合時は最新文を提示し、明示的な再反映操作で最新改版へ保存する。
- 更新取得中に操作が始まると取得 actor を終了する。古い取得結果は適用せず、AbortSignal で HTTP を中断する。
- 定期取得は XState の after で開始し、actor 終了時にタイマーも終了する。

`src/machines/audience.ts` は配信と全画面表示を並列の状態として管理する。配信は `connecting → live ↔ reconnecting` を遷移する。切断中は直前の字幕を保持し、再接続後のスナップショットで同期する。公開・非公開の決定はバックエンドが担当する。表示設定も公開スナップショットへ含め、Presenterが字幕数・書体・寸法へ変換する。全画面表示は `idle → changing → idle / failed` を遷移し、処理中の重複要求を拒否する。失敗は画面へ表示し、再試行を受理する。Escape などによるブラウザ側の解除も Adapter から通知して同期する。全画面要求はユーザー操作の間に Adapter が開始し、配信の再接続から独立して動作する。

Zoom送信の名前付き形式は接続設定から `connection.text-format.selected` で選ぶ。Mediatorが値と下書きを保持し、Presenterが選択値を渡す。適用後の接続状態から再取得し、パネルを閉じる場合と再読み込みの場合の両方で設定を表示する。

## API 型の利用

[API の型生成](generated/README.md)で OpenAPI と TypeScript 型を同期する。フロントエンドの Adapter は生成した型を使用し、独自に API モデルを再定義しない。TypeScript の型はブラウザでの JSON の実行時検証を行うものではなく、サーバー側の応答検証と組み合わせる。

## 検証

`npm --prefix frontend test` でイベントの伝播・停止、下書き保持、保存失敗・競合、重複操作、取得のキャンセル、SSE の解放を確認する。`src/architecture.test.ts` が View と共通部品の Scope、依存先、通知内の判断・副作用を検査する。関数宣言、アロー関数、memo のラップ、複数の return を対象とし、共通部品を経由しない details と DOM 以外の状態を保持する ref も検出する。通知だけでは開閉が変わらないこと、担当外のイベントの拒否、フォーカス指示もテストする。全画面の重複要求・失敗・外部解除と DOM リスナーの解放もテストする。テストファイルの対応は[現行 PoC の仕様](current-behavior.md#検証の対応)、全体の検証とブラウザ操作は[開発手順](development.md#検証)を参照する。

新しいアプリケーションコンポーネントにも自身の Scope を設け、描画パラメータと操作通知だけを受け渡す。動作を変更する場合は Mediator、描画への変換を変更する場合は Presenter、外部 API を扱う場合は Adapter を変更する。

## 使用した公式資料

- [XState と React](https://stately.ai/docs/xstate-react)
- [XState の invoke](https://stately.ai/docs/invoke)
- [shadcn/ui の Vite 導入](https://ui.shadcn.com/docs/installation/vite)
- [FastAPI の応答モデル](https://fastapi.tiangolo.com/tutorial/response-model/)
- [Pydantic のモデル](https://pydantic.dev/docs/validation/latest/concepts/models/)

## 操作画面の余白

幅720px以下の「準備」と「公開方法の説明」は、ヘッダーを基準にその下へ配置する。画面上端からの固定座標は使わず、ルーム名やツールバーの折り返しでヘッダーの高さが変わっても開閉ボタンを隠さない。

余白と部品寸法は8pxを基準にし、8・16・24・32pxを用いる。履歴の本文は16px・行間24pxで一列に表示し、短文の行は48px。履歴と直近の入力は連番を使わず、12pxの受信時刻を添える。原文との比較は選択した字幕の訂正欄で行う。長文の行は内容に応じて伸ばし、訂正欄を別の領域に置く。フォントサイズと1pxの区切り線は余白の規則から分ける。共有部品を一括で変更せず、操作画面のCSSに限定して適用する。

編集中の行は内側の輪郭を四辺に表示し、通常行の区切り線となる`::after`を非表示にする。輪郭の下辺と区切り線の重なりを防ぎ、編集を閉じると区切り線を戻す。

セレクトはネイティブの選択操作を保ち、16pxの矢印を右端から8px内側に置く。右の内余白32pxで文字と矢印の重なりを防ぐ。強制配色ではブラウザの矢印を使う。字幕行の状態アイコンは32pxの領域に置く。行全体を字幕本文の編集ボタンのクリック領域とし、状態アイコンの説明は独立して操作できる。

訂正・表示設定・AI設定・接続設定のスクロール領域は共通の `operator-panel-scroll` を使い、入力欄の外側に出るフォーカス輪郭を切らないよう8pxの内余白を確保する。左右の負のマージンで領域を広げ、入力欄の位置と幅は維持する。右側は既存のスクロールバー用の余白も残す。`architecture.test.ts` がフォーム入力を含むスクロール領域への共通クラスの適用を検査する。`scroll-padding-block` は上下8pxとし、キーボードで項目へ移る際の輪郭も保つ。

表示設定とAI設定は、幅720px以下または高さ700px以下でパネル全体をスクロールさせる。入力欄だけを縮めず、見出しと保存操作をstickyで維持する。その画面では上64px・下96pxのスクロール余白で、フォーカスした項目が固定領域に隠れるのを防ぐ。モバイルの低い画面ではページ全体もスクロールできる。

## 観客画面とプレビューの描画

`presenters/display.ts` は共通の描画パラメータを作る。実寸の観客画面ではpx、基準画面のプレビューではコンテナー幅の単位で同じ寸法比を使う。`CaptionDisplayView` は背景・表示枠・発話の描画を担当する。追従中は字幕ID・本文・寸法の変更を示す安定した `scrollVersion` が変わった場合とリサイズ時に末尾へ移る。同文の新しい発話にも追従し、操作画面の定期取得だけではプレビューの手動スクロールを戻さない。

幅420px以下では見出し、6つの操作アイコン、公開操作を3行に分け、辞書アイコンの追加で本文と操作が重ならないようにする。2026-10-11に実ブラウザの幅390pxで辞書の編集欄・保存操作へスクロールできることを確認した。[画面と検証記録](dictionary.md#根拠と検証)を参照する。

字幕行の原文・AI・手修正の状態と、独立配信の観客の表示状態は32pxの幅で8px間隔に揃える。編集参加で全行に共通する接続表示と、行のクリックと重なる編集アイコンは置かない。観客の表示状態は開いた目と閉じた目で示し、詳細はフォーカス・ホバーで確認する。保存された方式で観客へ送る公開字幕を表示対象として扱い、プレビューの未保存設定には連動させない。

観客画面のスクロール寸法は共通Viewから `display.scrolled` で通知する。観客Mediatorが末尾との距離から追従を停止・再開し、Presenterが `followLatest` と「最新へ」の表示を決める。追従停止中はViewの末尾移動とリサイズ追従を止める。`display.latest.requested` は追従再開・末尾移動・字幕へのフォーカス要求を更新する。公開履歴はSSEの完全なスナップショットで同期し、クライアントが未公開の字幕を蓄積しない。

AIの処理状態はPresenterが `aiPending`・`aiProgressLabel` へ変換し、Viewは原文と併せて描画する。パネル開始・訂正文・処理中の動きはCSSで定義し、定期取得でパネルを再マウントしない。`prefers-reduced-motion` では回転・移動・反復を無効にする。

右ペインの幅・ドラッグ中のプレビュー・操作中のポインターはOperator Mediatorが保持する。InspectorResizeViewは境界のポインターを捕捉し、座標と作業領域の寸法、キー、取消を通知する。Viewに業務状態を保持しない。確定幅の制限と右端での収納はMediatorが決め、設定・訂正欄を閉じる経路でもドラッグ状態を解除する。
