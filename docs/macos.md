# Mac版

Caption RelayのMac版はTauri 2のWKWebViewで既存の操作画面と観客画面を表示する。Chromium、Node.js、Pythonの追加導入と、サーバーの手動起動は利用者に求めない。字幕処理用のPythonと依存ライブラリ、Apple認識のSwift補助プログラムをアプリへ同梱する。

現在はApple Siliconの開発版。一般配布用のDeveloper ID署名とApple公証は未実施。macOSの対応範囲と実機確認は末尾の検証範囲を参照する。

## 利用する

1. `Caption Relay.app`を開き、ルームを選ぶ。
2. AIを使う場合は、アプリメニューの「APIキーの設定…」から利用者自身のキーを設定する。通常の字幕入力・編集にキーは不要。
3. 操作画面の「観客画面」で別のウィンドウを開く。別ルームから同じ操作をすると、そのルームの観客表示へ切り替わる。
4. 最後のウィンドウを閉じるかアプリを終了すると、録音・AI要求・UDトーク接続と内蔵サーバーを終了する。字幕は消え、ルーム設定と辞書は残る。

キーを保存するとアプリを再起動する。確認画面で現在の字幕と未保存の訂正が消えることを知らせ、キャンセルした場合は設定の下書きを保持する。空欄のキーは保存済みの値を保持し、削除はチェックボックスで指定する。

OpenAI音声認識のキーはAI校正用と分け、円換算を設定する。試験上限とApple認識の準備条件は[マイク入力](microphone-input.md)に従う。Apple認識はmacOS 26以降と導入済みの日本語モデルが必要であり、アプリからモデルを自動導入しない。

## 保存と通信

- APIキーはMacのKeychainに保存し、画面には設定済みかどうかだけを返す。秘密ではない円換算は保存値を表示する。
- ルーム設定と辞書は、Tauriの利用者用データディレクトリ `~/Library/Application Support/ai.shiftone.caption-relay/` に保存する。従来のWeb版の保存ファイルは変更しない。
- 音声認識の試験使用量は従来の台帳を使い、アプリの再インストールで試験上限を初期化しない。
- 内蔵サーバーは空いているloopbackポートを使う。起動ごとの認証用CookieとHost・Origin検査で操作APIを保護する。UDトークのZoom受信先は従来の署名を使う。
- LANへ操作画面を公開しない。キーと共有URLをアプリの配布物に入れない。外部サービスを使う認識・AI・UDトーク接続には従来どおり通信が必要。

## ビルドする

[開発手順](development.md)にある依存関係に加え、Rust 1.90以降とmacOS 26以降のSDKを用意する。Rustの下限はロックされたTauriの要件で、今回の実機確認にはRust 1.95を使った。依存関係は`frontend/package-lock.json`、`backend/uv.lock`、`desktop/Cargo.lock`から導入する。

```sh
bash scripts/setup.sh
bash scripts/build-desktop.sh --debug --bundles app --ci
```

開発用アプリは`desktop/target/debug/bundle/macos/Caption Relay.app`に生成する。`scripts/desktop.spec`が指定したReactのビルド成果物・Python処理・Swiftだけを同梱し、`.env`や利用者の設定を収集しない。アイコンは`desktop/icon.svg`からTauri CLIで生成する。

Release版は`bash scripts/build-desktop.sh --bundles app --ci`でビルドし、`desktop/target/release/bundle/macos/Caption Relay.app`に生成する。

梱包時の`webrtcvad-wheels`対応は[上流PR #1057](https://github.com/pyinstaller/pyinstaller-hooks-contrib/pull/1057)の修正コミットを固定して使う。PyInstallerのフックをアプリ内で上書きする構成にはしない。上流のリリースへ入ったら、固定先を更新して同梱・実行を再検証する。

設定の`signingIdentity`は開発用のad-hoc署名。一般配布ではDeveloper ID証明書と公証の認証情報を用意し、[TauriのmacOS署名手順](https://v2.tauri.app/distribute/sign/macos/)に従って署名・公証する。開発版の起動確認を、ダウンロード配布後のGatekeeper確認と同一視しない。

## 検証範囲

macOS 26のApple Silicon上で、同梱アプリの起動、ルーム接続、テスト字幕の入力、手動訂正、観客ウィンドウへの反映と別ルームへの切り替え、APIキー設定画面での円換算の保存・キャンセル・再起動・再表示、通常終了後の内蔵サーバー停止を確認した。マイクは認識開始前の候補取得、BlackHole 2chの選択、認識の開始・停止を操作した。テスト字幕は音声認識やUDトークの実接続の証拠にはしない。

リポジトリ外へコピーした同梱サーバーでは、認証、字幕の訂正と公開、親の終了に伴う停止を検証した。WKWebViewの録音はエコー除去を無効にし、BlackHole 2chからの合成音声をApple認識へ渡して、文章全体の認識・公開・停止・再開始・認識中の手動訂正を実画面で確認した。物理マイクの音響、長時間運転、UDトーク・クラウド認識・AIのMac版からの実接続は未確認。

Release版のアプリ全体をリポジトリ外へコピーし、Pythonやサーバーを別途起動せずに、ルーム接続・BlackHole 2chのApple認識・手動訂正・別ウィンドウの観客表示を確認した。最後のウィンドウを閉じた後、内蔵サーバーのポートと認識用子プロセスが残らないことも確認した。

Apple認識では、開始直後の無音部分に短い誤字幕が出る例もあった。会場の音響と認識品質は別途確認する。Intel・他のmacOSでの動作、Developer ID署名・公証後の配布は未確認。開発用のad-hoc署名では再ビルド後にKeychainのアクセス確認が出る場合がある。自動更新は未実装。
