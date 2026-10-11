# 単語辞書

操作画面の本のアイコン「単語辞書」で、人名・会社名・専門用語を登録する。辞書は自前の音声認識とAI校正の参考にする。登録した表記が必ず認識されることや、AIが誤修正しないことは保証しない。

## 登録と編集

1. 「単語を追加」で、字幕に使いたい表記を入力する。
2. 必要なら読みと誤認識されやすい表記を入力する。誤認識の表記は1行1件、5件まで。
3. 「辞書を保存」で反映する。音声認識中に変更した場合は、停止して開始すると認識にも反映する。

各欄は80文字以内、単語は100件まで、全体は10,000文字以内。空白だけの表記、改行・制御文字・`<`・`>`、重複する表記を拒否する。表記の重複は全角/半角や大文字/小文字の差を無視して確認する。

「有効」を外すと、保存後の認識・校正では参照しなくなる。削除や編集は保存するまで適用しない。パネルを閉じたり字幕を更新取得したりしても下書きを保つ。「保存済みに戻す」は入力中の辞書を破棄し、接続先から読み直す。

別の操作画面が保存した場合は、古い辞書での上書きを拒否する。入力は保持するため、必要な内容を確認してから「保存済みに戻す」で最新の辞書を読み直す。保存先に書き込めない場合も、保存済みの辞書と下書きを保持する。

## 認識と校正での使い方

| 経路 | 使う項目 | 反映する時点 |
|---|---|---|
| OpenAIの自前音声入力 | 有効な単語の表記を `gpt-live-transcribe` の `keywords` に渡す | 次の認識開始 |
| Appleの自前音声入力 | 有効な単語の表記を `AnalysisContext.contextualStrings[.general]` に渡す | 次の認識開始 |
| Gemini・Claude・OpenAIのAI校正 | 表記・読み・誤認識例を字幕本文と分けて渡す | 次の確定字幕 |
| UDトークから受信した字幕 | AI校正で参照する。UDトーク側の認識辞書には送らない | 次の確定字幕 |

AIには文脈と読みが一致する場合だけ表記を整え、同音異義語を無条件に置き換えないよう指示する。辞書全体を単純な文字列置換に使わない。原文・手修正の保護と古い結果の照合は、従来の[AI校正](ai-routing.md)と同じ。保存時に既存字幕や進行中のAI要求を書き換えず、要求開始時の辞書を保持する。AIがオフなら、読みと誤認識例を使った校正は行わない。

Deepgramの認識ヒントとUDトークの単語登録を参考にした機能であり、両サービスとの辞書同期やDeepgramへの接続は提供しない。

## 保存先とAPI

通常起動では `$XDG_DATA_HOME/caption-relay/dictionary.json`、未設定なら `~/.local/share/caption-relay/dictionary.json` に保存する。`CAPTION_RELAY_DICTIONARY_PATH` で別のファイルを指定できる。字幕・接続・AI設定のメモリ保存とは異なり、辞書は再起動後も保持する。単一プロセスでのローカル利用を前提とし、同じファイルを複数のサーバーで同時に更新しない。

一時ファイルへ書いてから置き換え、失敗した場合は旧辞書を保持する。保存済みファイルが不正なら、空辞書で上書きせず起動を止める。保存先の内容を確認して修復する。辞書ファイルは単語・読み・誤認識例・有効状態・改版番号を含む。

`GET /api/dictionary` は `entries` と `revision`、`PUT /api/dictionary` は `entries` と `base_revision` を扱う。不正入力は422、改版競合は409、書込み失敗は503。観客API・SSEに辞書は含めない。有効な単語は選択したクラウドの音声認識・校正先に送るため、送信する内容と提供元のデータ設定を確認する。

## 根拠と検証

- [UDトークの単語登録](https://udtalk.jp/registering_word/)
- [Deepgram Keyterm Prompting](https://developers.deepgram.com/docs/keyterm)
- [OpenAIの認識文脈](https://developers.openai.com/api/docs/guides/realtime-transcription#add-transcription-context)
- [Appleの文脈用文字列](https://developer.apple.com/documentation/speech/analysiscontext/contextualstrings)。macOS 26 SDKの公開インターフェースと対応Macで確認する。
- [辞書API・保存・要求時点のテスト](../backend/tests/test_dictionary.py)、[Swift認識のテスト](../backend/tests/test_speech_helper.py)、[操作状態](../frontend/src/machines/operator.test.ts)、[画面の操作](../frontend/src/roots.test.tsx)。

2026-10-11に実ブラウザと実APIで追加・編集・無効化・削除・保存・再読込・再起動・2画面の保存競合を確認した。[辞書画面](assets/dictionary-synthetic/dictionary-desktop.png)、[狭い画面](assets/dictionary-synthetic/dictionary-mobile.png)、[競合時の下書き](assets/dictionary-synthetic/dictionary-conflict.png)、[検証記録](assets/dictionary-synthetic/verification.json)を参照する。

物理マイクを使わず、macOSの合成音声を音声入力へ渡した。Appleの原文「キャプシヨンリレー」「星見大科学間」を、実際のGPT-5.4 Miniが「Caption Relay」「星見台科学館」へ校正した。OpenAIの原文「キャプシオンリレー」も登録表記へ校正し、人数の13人/十三人と否定を保持した。両方で観客画面のSSE表示と音声資源の解放を確認した。

一方、同じ音声の別試行でAppleが「ディアプシ4リレー」と認識し、GPTがこの語を保持した例がある。最初のOpenAI試行にも製品名が期待する表記にならない例があり、認識原文を記録する前に検査が止まったため原因は未特定。会場での認識率、辞書なしとの比較、他モデルとの品質比較、請求確定額は未検証。成功した例だけで品質を保証しない。
