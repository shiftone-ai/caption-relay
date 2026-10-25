# XStateのPromise取消

`xstate+5.33.2.patch` は、開発用のStrict Modeで取り消した通信の結果が、再開後の読み込みへ届く不具合を修正する。[上流への修正PR](https://github.com/statelyai/xstate/pull/5823)と同じ取消判定を、アプリが使うCJS・ESMの通常用・開発用バンドルに適用する。

`npm ci` の `postinstall` で適用し、適用できない場合は失敗させる。アプリ側の通信を取り消さない回避策は加えない。[ホームのStrict Modeテスト](../src/rooms.test.tsx)が、取消後も初回の読み込みを完了できることを検証する。

修正を含む正式リリースへ更新する際は、上流の収録内容を確認し、このパッチと `patch-package`、`postinstall` を削除する。再インストール、回帰テスト、開発用サーバーでの初回表示を確認する。
