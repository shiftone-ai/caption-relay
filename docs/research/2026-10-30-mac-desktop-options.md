# Mac デスクトップ版の配布方式

Mac版は**Chromiumを同梱しないTauri 2を採用する**。利用者はChromiumを避けたい意向を示した。既存のReact画面、Pythonバックエンド、Apple認識用のSwift補助プログラムを同梱し、アプリから起動・終了する。現時点の使い方と検証範囲は[Mac版](../macos.md)を参照する。

## 現在の実装との関係

現在はReact DOMとViteの画面をFastAPIが配信し、HTTP・SSE・WebSocketで通信する。[システム構成](../../ARCHITECTURE.md)と[開発手順](../development.md)を確認した。字幕の編集・UDトーク接続・AI処理のロジックを維持する構成にできる。

[マイク入力](../../frontend/src/adapters/microphone.ts)は`getUserMedia`と`AudioWorklet`でPCM音声を取得し、バックエンドへ送る。ブラウザの`SpeechRecognition`には依存していない。Apple認識は[Swift補助プログラム](../../native/speech-helper.swift)が担うため、Pythonとともにビルド済みの補助プログラムも同梱する。[Apple Adapter](../../backend/app/transcription/apple.py)は、同梱した補助プログラムのリソースパスを起動環境から受け取る。

## 候補の比較

| 候補 | 既存コードの利用 | 利点と負担 | 判断 |
| --- | --- | --- | --- |
| Tauri 2 | React DOM・CSS・Pythonの実行ファイルを維持できる | macOS標準のWKWebViewを使い、ブラウザを同梱しない。Rust側で補助プロセスを管理する。既存画面とマイク入力についてWebKitでの確認が増える | 採用 |
| Electron | React DOM・CSS・FastAPIを維持できる | ChromiumとNode.jsを同梱する。現在のChromiumでの検証を生かせるが、実際のアプリで録音権限・終了処理の確認は必要。ランタイム更新も配布側の責任になる | Chromiumを避ける意向により対象外 |
| React Native macOS | TypeScriptの状態管理や一部のロジックは利用できるが、DOM画面は直接移せない | ネイティブのView・Text・入力部品へ画面を移植し、録音やPython起動の接続も用意する。既存画面を配る目的に対して変更範囲が大きい | 画面を作り直す場合の候補 |

根拠は[Electronの構成](https://www.electronjs.org/docs/latest/tutorial/process-model)、[TauriのWebView](https://v2.tauri.app/reference/webview-versions/)、[Tauriの外部バイナリ同梱](https://v2.tauri.app/develop/sidecar/)、[React Nativeの描画部品](https://reactnative.dev/docs/intro-react-native-components)、[React Native macOS](https://microsoft.github.io/react-native-macos/docs/getting-started)。選定の評価は本アプリの構成に基づく推論であり、容量・起動時間・メモリの比較値は未測定。

## 最初のMac版の構成案

1. 既存バックエンドをPyInstallerなどでPython込みの実行形式にし、Reactのビルド成果物とSwift補助プログラムを`.app`へ同梱する。利用者にPython・Node.js・ターミナル操作を求めない。
2. アプリがバックエンドをloopbackだけで起動し、起動完了を確認してから同じHTTP originの画面を開く。操作APIは起動ごとの認証情報とHost・Originの検査で保護する。観客表示とUDトーク受信は利用経路に合わせて権限を分け、CORSやLANへの公開範囲を広げない。
3. アプリ終了時に録音・AI要求・UDトーク接続・バックエンドを終了する。二重起動・起動失敗・異常終了でも子プロセスが残らないことを確かめる。設定と辞書はアプリ外の利用者用保存先へ置く。
4. AIキーを配布物へ埋め込まず、利用者ごとに入力してもらい、macOS Keychainを利用する保存方式を用意する。現行の専用キーを配布用の共通キーにはしない。
5. 署名・公証したDMGで配布する。最初はApple Siliconを対象に検証し、Intel対応が必要ならPythonの拡張モジュールとSwiftを含めて別途ビルド・検証する。自動更新は初回配布と分けて判断する。

PyInstallerはPythonと依存ライブラリをまとめられるが、macOSのCPU構成ごとに整合したバイナリが必要であり、個別の`onefile`成果物を単純に結合してUniversal版にはできない。[PyInstallerのmacOS対応](https://pyinstaller.org/en/stable/feature-notes.html#macos-multi-arch-support)

Electronのマイク権限にはアプリの`Info.plist`設定が必要。TauriのWKWebViewでもOSとWebコンテンツの録音権限を確認する必要がある。通常のブラウザで録音できたことだけでは、署名後のアプリの録音を保証しない。[Electronの録音権限](https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesaskformediaaccessmediatype-macos)、[AppleのWebView録音権限](https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:requestmediacapturepermissionfor:initiatedbyframe:type:decisionhandler:))

Electronの`safeStorage`はmacOSのKeychainを利用して暗号化用の鍵を保持し、APIキーなどの暗号化・復号を提供する。採用したTauri版はRustの`security-framework`からKeychainを使う。利用者ごとのAPIキーを保存し、配布物には埋め込まない。[ElectronのsafeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

ブラウザからダウンロードして開く配布物では、署名・公証を用意する。自動更新を入れる場合も署名を含む配布経路を設計する。[Electronの署名](https://www.electronjs.org/docs/latest/tutorial/code-signing)、[TauriのmacOS署名・公証](https://v2.tauri.app/distribute/sign/macos/)、[Tauriの更新署名](https://v2.tauri.app/plugin/updater/)

## 公開プロジェクトから参考にする部分

| プロジェクト | 確認した構成 | 参考にする部分・採用しない部分 |
| --- | --- | --- |
| [dieharders/example-tauri-v2-python-server-sidecar](https://github.com/dieharders/example-tauri-v2-python-server-sidecar) | Tauri 2からPyInstaller化したFastAPIを起動し、標準入出力で終了を指示する例 | Pythonを同梱する構成と子プロセス終了の検討に使う。固定ポートや外部Web画面からのアクセス許可は持ち込まない |
| [yoDon/electron-python](https://github.com/yoDon/electron-python) | ElectronがPythonのFlaskサーバーを起動し、生成した認証トークンを画面と共有する例 | アプリによるPython起動管理と、ローカルAPIの認証境界を参考にする。古いCreate React App・依存関係・GraphQLへの移行は採用しない |

両例は構成を調べた参考資料であり、コードは取り込んでいない。Caption Relayの依存ライブラリを同梱できることや、Macでの動作を証明するものではない。

## 採用する構成

TauriによるMac版から始め、React画面・Python・Swiftを維持する。HTTP通信はアプリ内に限定して使う。PythonのロジックをRustへ移植する場合は、字幕の競合・訂正・音声処理を改めて検証する必要があるため、同梱する変更とは分けて判断する。

アプリ化だけでは別のスマホから観客画面へ接続できるようにはならない。現在のローカル専用の範囲を維持し、ネットワーク越しの配信が必要なら認証・公開範囲を別に設計する。
