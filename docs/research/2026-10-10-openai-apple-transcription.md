# OpenAI・Apple・Whisper の文字起こし候補

確認日：2026-10-10。利用者の回答により、クラウドの初手は **OpenAI**、試験上限は **合計100円・送信合計20分以内**と決定した。端末内の候補は Apple SpeechAnalyzer とする。[ほかのクラウドの比較](2026-10-10-cloud-transcription.md)も残す。全候補の日本語精度・遅延は同一音声で未実測のため、精度の順位は付けない。

実装経路と判断事項は[実行計画](../exec-plans/active/2026-10-10-switchable-transcription.md)を参照する。以下は API の調査であり、Caption Relay の実装済み機能ではない。

## 候補の比較

| 候補 | 日本語・精度の根拠 | 途中結果と遅延 | 費用・実行環境 |
|---|---|---|---|
| OpenAI `gpt-live-transcribe` | 複数言語のヒントを受け付ける。確認した現行資料には日本語別の対応一覧・評価値がなく、`ja` 指定の受理と認識は未確認。[モデル](https://developers.openai.com/api/docs/models/gpt-live-transcribe)・[手順](https://developers.openai.com/api/docs/guides/realtime-transcription) | ライブ音声の delta と commit 後の completed。delay は5段階で調整できるが、更新間隔と遅延のミリ秒値は保証されていない。[手順](https://developers.openai.com/api/docs/guides/realtime-transcription) | 音声時間 **USD 0.017/分**、60分で USD 1.02。為替・税・地域処理の追加料金を含まない。課金丸めは未確認。サーバーは WebSocket、ブラウザは WebRTC を選べる。[料金](https://developers.openai.com/api/docs/pricing)・[接続](https://developers.openai.com/api/docs/guides/voice-websockets?api=realtime) |
| OpenAI `gpt-transcribe` | 録音または区切った音声向け。日本語の現場精度は未実測。[手順](https://developers.openai.com/api/docs/guides/speech-to-text) | Realtime でも commit 後に認識が始まる。音声を話している最中の字幕とは区別する。[手順](https://developers.openai.com/api/docs/guides/realtime-transcription) | **USD 0.0045/分**。安価なファイル処理の比較対象とし、ライブ入力の第一候補にはしない。[料金](https://developers.openai.com/api/docs/pricing) |
| Apple `SpeechAnalyzer` + `SpeechTranscriber` | 対応は端末で `isAvailable` と `supportedLocale(equivalentTo:)` を確認する。この Mac では `ja-JP` を確認。精度は未実測。[対応 API](https://developer.apple.com/documentation/speech/speechtranscriber) | `volatileResults` で暫定結果と改版を受け取る。音声範囲と確定境界を使える。固定の更新間隔・遅延値は未確認。[結果](https://developer.apple.com/documentation/speech/speechtranscriber/result)・[暫定結果](https://developer.apple.com/documentation/speech/speechtranscriber/reportingoption/volatileresults) | macOS 26 以降の対応端末。iOS/iPadOS/macCatalyst/tvOS/visionOS も26以降、watchOS は対象外。Swift のシステム API で処理し、クラウドの従量 API 課金を使わない。機器・電力・配布の費用は別。[提供 OS](https://developer.apple.com/documentation/speech/speechanalyzer.md) |
| ローカル Whisper / whisper.cpp | OpenAI の公式実装は日本語を指定できる。多言語モデルを使う。会場の精度は未実測。[Whisper](https://github.com/openai/whisper) | whisper.cpp のマイク例は既定で500msごとに窓を再認識する簡易実装。API の確定イベントとは異なるため、窓の重複・改版・区切りを Adapter 側で解決する必要がある。[マイク例](https://github.com/ggml-org/whisper.cpp/blob/master/examples/stream/README.md) | ネイティブのマイク例は SDL2 が必要。モデルの導入と端末性能の確認が必要。WASM のブラウザ例もある。従量 API 課金は使わず、Whisper のコード・重みは MIT ライセンス。[ブラウザ例](https://github.com/ggml-org/whisper.cpp/blob/master/examples/stream.wasm/README.md)・[ライセンス](https://github.com/openai/whisper#license) |

## OpenAI をつなぐときの条件

1. `gpt-live-transcribe` は `server_vad` と `semantic_vad` に対応しない。既存の VAD をアプリ側で利用して発話を区切り、`input_audio_buffer.commit` を送る。ガイドの PCM 例は24kHz。別モデル向けの VAD 設定を流用しない。[手順](https://developers.openai.com/api/docs/guides/realtime-transcription)
2. delta を発話ごとの全文へ組み立て、completed の全文で置き換える。発話間の完了順は保証されないため `item_id` で照合する。話者ラベル・単語時刻・信頼度はこのモデルから取得できない。[イベント](https://developers.openai.com/api/docs/guides/realtime-transcription)
3. 長期 API キーはバックエンドに置く。ブラウザへ長期キーを配らず、今回の共通音声経路ではバックエンドが提供元へ接続する。このリポジトリ用と確認できるキーだけを使い、他プロジェクトのキーは使わない。キー本文を表示・転記しない。[認証](https://developers.openai.com/api/docs/guides/voice-websockets?api=realtime)
4. API 入力は明示的に共有へ参加しなければ学習に使われない。`/v1/realtime` の標準設定は不正利用監視ログを通常最大30日保持し、アプリ状態の保存はなし。Zero Data Retention は承認が必要。`/v1/audio/transcriptions` の保存なしを Realtime に当てはめない。個別アカウントの承認・地域設定は未確認。[データ管理](https://developers.openai.com/api/docs/guides/your-data)
5. `whisper-1`・`gpt-4o-transcribe`・`gpt-4o-mini-transcribe`・`gpt-4o-transcribe-diarize` は2027-02-26終了予定。新しい接続の既定モデルにしない。ローカル Whisper のコード・重みの利用はこの API の終了とは別。[廃止予定](https://developers.openai.com/api/docs/deprecations)

公式資料には分あたりの費用が載っているが、アカウントのモデル利用可否、同時接続枠、再接続での音声再送の課金は実測していない。20分の基本料金は USD 0.34。実測前に為替・税・追加料金・課金丸めを含む円換算を確認し、送信累計と費用見積もりの両方で上限より前に停止する。モデルと料金は実装再開時にもう一度確認する。[料金](https://developers.openai.com/api/docs/pricing)

## Apple の具体的な接続経路

ブラウザで取得した音声を、同じ Mac 上の FastAPI から Swift 補助プログラムの標準入力へ渡す。補助プログラムは Speech.framework を呼び、音声範囲・本文・確定境界を JSON Lines で標準出力へ返す。この構成は設計判断であり、現行コードには未実装。

Apple の公式 API は Swift の actor・AsyncSequence・音声バッファを使う。確認した資料にはブラウザから SpeechAnalyzer を直接呼ぶ API はない。Web Speech API も認識エンジンを任意指定する契約を持たないため、Apple を確実に選ぶ用途には使わない。[Apple の API](https://developer.apple.com/documentation/speech/speechanalyzer)・[ブラウザの API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)

| 境界 | 実装時の扱い |
|---|---|
| 準備 | 対応 OS・端末・`ja-JP` を確認し、未導入のアセットは `AssetInventory.assetInstallationRequest(supporting:)` で準備する。モデル更新・導入にはネットワークが必要になり得る。[アセット](https://developer.apple.com/documentation/speech/assetinventory/assetinstallationrequest(supporting:)) |
| 音声 | `bestAvailableAudioFormat(compatibleWith:)` で対応形式を確認し、入力 PCM を変換して `AnalyzerInput` の時刻を連続させる。[音声入力](https://developer.apple.com/documentation/speech/speechanalyzer) |
| 途中結果 | `volatileResults` の範囲を置き換える。`text` が空なら、その範囲の暫定結果の撤回として扱う。文字列を追記するだけでは改版を表せない。[本文](https://developer.apple.com/documentation/speech/speechtranscriber/result/text) |
| 確定 | `isFinal=false` の結果が同じ範囲で `true` として再通知されるとは限らない。`resultsFinalizationTime` より前にある保持済み範囲も確定させる。範囲の変化で不要になった未確定行は取り下げる。[確定境界](https://developer.apple.com/documentation/speech/speechmoduleresult/resultsfinalizationtime)・[確定状態](https://developer.apple.com/documentation/speech/speechmoduleresult/isfinal) |
| 終了と保存 | 正常停止では入力を終了し `finalizeAndFinishThroughEndOfInput()` を待つ。エラーでは新しい analyzer が必要。SpeechAnalyzer の認識音声は Apple のサーバーへ送られない。アプリも音声をファイル保存しない構成にする。[終了](https://developer.apple.com/documentation/speech/speechanalyzer/finalizeandfinishthroughendofinput())・[音声の扱い](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition) |

ネイティブ Mac アプリでマイクを取る場合は、そのアプリでマイクの権限と入力デバイスを扱い、音声バッファを渡す。今回はクラウドとの共通経路を使い、補助プログラムではマイクを開かない。Linux のバックエンドや、別の Mac への音声転送を「利用端末内の認識」とは説明しない。

## 実機で確認した範囲

macOS 26.6.2 / arm64、Apple Swift 6.4 の環境で、次のメタデータ確認だけをコンパイルして実行した。

```swift
import Foundation
import Speech
@main struct Probe {
    static func main() async {
        print("isAvailable=\(SpeechTranscriber.isAvailable)")
        let ja = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "ja-JP"))
        print("japaneseSupported=\(ja?.identifier(.bcp47) ?? "none")")
        let installed = await SpeechTranscriber.installedLocales
        print("japaneseInstalled=\(installed.contains { $0.identifier(.bcp47) == "ja-JP" })")
    }
}
```

`xcrun swiftc -parse-as-library` でのコンパイルと実行はともに終了コード0。出力：

```text
isAvailable=true
japaneseSupported=ja-JP
japaneseInstalled=true
```

マイクの権限要求・録音・認識・モデルの追加ダウンロードは行っていない。この結果は他端末の対応や、日本語精度・遅延・オフライン運転の証拠にはならない。この worktree のルート・backend・frontend の `.env*`（example を除く）に設定ファイルは見つからず、他プロジェクトのキーや継承した API キーは調査・利用していない。有料呼び出しは行っていない。キーがなくても設計を進め、実接続が必要な時点で `要判断:` として止まる。

## 共通のマイク入力に必要な条件

`getUserMedia()` は HTTPS または localhost などの安全な文脈と利用者の権限が必要。音声の取得と認識開始は明示操作から行う。AudioWorklet で音声処理を別スレッドへ置く。[マイク](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)・[音声処理](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)

ブラウザの通常 WebSocket に自動の流量制御はない。送信待ち量とキューの上限を設け、処理が追いつかない場合は認識を停止して欠落を表示する。停止時に音声 track・AudioContext・通信を解放する設計とする。[WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
