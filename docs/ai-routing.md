# AIの選択と振り分け

実接続の確認日：2026-10-11。GPT-5.4 Miniの料金確認日：2026-10-11。ほかの候補の調査日：2026-10-07。

操作画面のロボットアイコンから「AI設定」を開く。AIを指定するほか、候補を限定して費用・実測速度を優先できる。サーバーにAPIキーを設定した提供元へ、次の確定字幕から校正を依頼する。初期値はAIなし。設定方法は[開発手順](development.md#環境変数)を参照する。

## 選び方

| 設定 | 選択先 |
|---|---|
| AIなし（初期値） | 振り分けを作らず原文を採用 |
| AIを指定 | 指定したAI |
| 費用を優先 | 候補の中で入力200・出力100トークンの参考費用が最小のAI |
| 実測の速度を優先 | 候補の中で受信した応答時間の中央値が最小のAI |

速度は各AIの直近20件の成功結果を使う。測定値のない候補を比較から除き、すべて未計測なら指定AIを使う。指定AIのキーがない場合はキー設定済みの候補を使う。費用・速度優先は、キー設定済みの候補があればその中で選ぶ。どの候補にもキーがない場合は選択先を記録し、「キー未設定」と表示して原文を保持する。指定AIの設定では別の提供元へ自動で切り替えない。

初期値に架空の応答時間を入れない。候補は一つ以上必要で、指定AIを含める。設定変更は次の確定入力から使い、既存の依頼を書き換えない。途中結果・入力に同梱された修正結果・手修正済みの字幕は新しい振り分けを作らない。

「AI設定を保存」まで変更内容をサーバーへ送らない。保存に失敗した設定や、設定パネルを閉じたときの下書きはブラウザに保持する。字幕の公開モードとは別の設定であり、人の字幕修正には引き続き明示保存が必要。

パネル上部の「保存済み設定の選択先」は、保存した設定による現在の結果を示す。編集中の選択とは別に扱う。指定欄は、選び方に応じて「指定AI」「候補に残すAI」「未計測時のAI」「初期候補のAI」と表示する。費用優先の指定は候補に残す役割で、選択先を固定しない。候補のチェック欄は常に設定項目として置き、料金の単価・参考条件・速度の比較は「料金と速度の比較」を開いて確認できる。

## 候補と料金

標準API・テキスト・USDの比較。入力／出力は100万トークンあたり。参考1,000件は1件あたり入力200・出力100トークンで計算し、キャッシュ、追加機能、税、契約割引を含めない。思考に使う出力も課金される場合があり、実際の費用は利用量で変わる。Codex・Claudeの月額契約の料金とは分けて考える。

| 候補 | モデルID | 入力 | 出力 | 参考1,000件 | 根拠 |
|---|---|---:|---:|---:|---|
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | $0.25 | $1.50 | $0.20 | [Google公式料金](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-lite) |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1.00 | $5.00 | $0.70 | [Claude公式料金](https://platform.claude.com/docs/en/about-claude/pricing) |
| Codex / GPT-5.3-Codex | `gpt-5.3-codex` | $1.75 | $14.00 | $1.75 | [OpenAI公式料金](https://developers.openai.com/api/docs/pricing#specialized-models) |
| GPT-5.4 Mini | `gpt-5.4-mini-2026-03-17` | $0.75 | $4.50 | $0.60 | [OpenAI公式仕様・料金](https://developers.openai.com/api/docs/models/gpt-5.4-mini) |

Googleは[Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)を低遅延・費用効率を重視する軽い処理向けと説明している。字幕整形を試す最初の候補に適すると考えられるが、本アプリでの速度・日本語の訂正品質は未測定。[Claude Haiku 4.5の仕様](https://platform.claude.com/docs/en/models/haiku-4-5/overview)も速度を重視する候補として比較する。速度の説明だけで各社の実応答時間に順位を付けない。

[Codex](https://developers.openai.com/api/docs/guides/code-generation#use-codex)は開発用エージェントであり、モデルそのものとは異なる。この比較ではAPIで選べるGPT-5.3-Codexを候補に置いている。CLI・ChatGPT契約経由の選択肢は実装しておらず、字幕整形への適性も未検証。APIモデルの選択とエージェントの接続方式を同じ設定として扱わない。

GPT-5.3-Codexは2026-10-01に廃止予定が告知され、API停止予定日は2027-04-01。[公式の廃止予定](https://developers.openai.com/api/docs/deprecations)を確認し、それまでに候補を更新する。

GPT-5.4 Miniは既存の `OPENAI_API_KEY` を使う。無料枠の公式対象一覧に含まれる固定版を指定する。料金比較は標準の従量単価を使い、アカウントごとの無料枠や残量を見積もりへ織り込まない。各候補の料金確認日は画面の公式料金リンクに表示する。

料金・候補は `backend/app/ai.py`、型は `backend/app/models.py` に置く。提供状況や料金が変わったら公式資料を再確認して更新する。

## 結果の受け取り

`GET /api/ai`は設定・候補・料金・測定値・現在の選択先を返す。各候補の `configured` はキーの有無、`connected` は選択先のキーが設定されていることを示す。ネットワークへの到達や生成品質を示す値ではない。`PUT /api/ai`の設定例：

```json
{
  "strategy": "cost",
  "preferred_model": "gemini-3.1-flash-lite",
  "candidates": ["gemini-3.1-flash-lite", "claude-haiku-4-5", "gpt-5.3-codex", "gpt-5.4-mini-2026-03-17"]
}
```

確定した字幕の `ai_request` に依頼ID・選択モデル・入力改版を記録する。`ai_provider.py`がこの原文を送信し、`CaptionWorkflow`へ完全な校正結果を返す。外部Adapterから `PUT /api/captions/{caption_id}/formatted` へ結果を渡す経路も残す。

```json
{
  "source_revision": 1,
  "text": "本日はありがとうございます。",
  "ai": {
    "request_id": "字幕のai_request.id",
    "model_id": "gemini-3.1-flash-lite",
    "elapsed_ms": 250.0,
    "input_tokens": 200,
    "output_tokens": 100
  }
}
```

`elapsed_ms`はAdapterが送信開始から完全な結果の受信までを測り、負の値や非有限値は拒否する。モデル・依頼ID・入力改版が合わない結果は `stale`、同じ依頼の再送は `duplicate` として測定値にも加えない。手修正済みの文を上書きせず、AI候補として保持する。提供元情報なしの修正結果も受け付けるが、速度の測定値には含めない。AI設定や依頼情報は観客へ送らない。

## 校正要求と失敗時の扱い

Geminiは[generateContent](https://ai.google.dev/api/generate-content)、Claudeは[Messages](https://platform.claude.com/docs/en/api/messages/create)、OpenAIは[Responses](https://developers.openai.com/api/docs/guides/text)を使う。原文を利用者入力として送り、句読点・明らかな誤字・不要な言い直しだけを整える。意味・固有名詞・数字・否定表現を維持し、判断できない部分は残すよう指示する。文意に不要な単独の「えー」「あの」は除き、指示語など意味を持つ語は残す。本文だけを採用し、思考・説明用の応答を表示しない。指示だけで品質を保証するものではない。

出力上限は4096トークン、要求全体の時間超過は初期値15秒。完全に終了した応答だけを採用する。途中で切れた応答、空欄、通信エラー、ロック拒否、原文の更新では訂正を採用せず、原文または保存済みの表示文を保持する。提供元のエラー本文やAPIキーは操作画面とログへ返さない。別の提供元への自動再送は行わない。

同時要求は2件。対象原文の更新・モード変更・サーバー終了で古い要求を終了する。UDトークへの反映は生成後に対象発話を再確認し、編集要求の受付を確認してからローカルの表示文も更新する。ほかの編集者の訂正を受け取った場合は、人の訂正として保護する。

## 実接続での確認

2026-10-11、背景のChromeでGPT-5.3-Codexを指定して設定を保存し、[OpenAI STTで認識した合成音声の文](microphone-input.md#確認済みの範囲)を確定入力として送った。実FastAPIからOpenAI Responsesを呼び、成功した結果の採用と観客画面への配信を確認した。提供元の応答は模擬していない。

応答時間は2,144.826ms、入力151・出力39トークン。原文は既に句読点が整っており、結果は同じ文だった。「三人」「午後二時」「取り消しません」を保持したが、誤認識の訂正能力を示す試験ではない。[料金](https://developers.openai.com/api/docs/pricing)から算出した基本料金はUSD 0.00081025、200円/USD換算で約0.16円。請求確定額は未確認。[操作画面](assets/openai-synthetic/gpt-operator.png)・[観客表示](assets/openai-synthetic/gpt-audience.png)・[依頼IDと使用量](assets/openai-synthetic/verification.json)を参照する。

GPT-5.4 Miniでは、音声認識を始める前にAI設定を保存し、Appleが確定した字幕から自動校正を依頼した。認識後の文を入力APIへ送り直す操作はしていない。合成音声だけを使い、実認識・実Responses・自動公開・操作画面への反映・手修正の保存・観客表示・停止後の資源解放を確認した。

最初の試験でフィラーが残ったため校正指示を調整した。調整後の2種類の音声で、「えー」「あの」の除去と「あの建物」の保持を確認した。人数3人・13人、時刻2時・2時30分、金額1,250円、否定「予約は取り消しません」も保持した。数字周囲の空白と句読点を整えた。単語の意味を一般に保証する試験ではない。

[AI設定と料金比較](assets/gpt-mini-synthetic/settings.png)・[校正文の操作画面](assets/gpt-mini-synthetic/operator.png)・[手修正の保存後](assets/gpt-mini-synthetic/edited.png)・[観客表示](assets/gpt-mini-synthetic/audience.png)・[音声と使用量の記録](assets/gpt-mini-synthetic/verification.json)に結果を残す。2種類の最終確認で校正要求は約0.933秒と約1.152秒。アカウント画面への使用量反映と無料枠の適用確認は分けて記録する。

Geminiは利用者の指定で試験を見送り、Claudeも実接続していない。各社の品質比較、応答時間の分布、固有名詞や誤認識の訂正、会場条件での確認は残る。要求・応答の形式と失敗・取消は模擬HTTPで確認している。

### UDトークへの自動書き戻し

2026-10-24、UDトークの合成音声認識からGPT-5.4 Miniの実Responsesを呼び、2断片の字幕を純正iOS版とパスコード付き純正Web字幕へ自動で書き戻した。画面でAI設定を保存した後に認識を開始し、入力APIへの送り直しは行っていない。物理マイクは使用していない。

入力の「あの集合時刻は午後2時です。」から「あの」を除き、「13人」「午後2時」「予約は取り消しません」を保持した。2回の応答時間は2,059.473ms・1,191.205ms、いずれも入力180・出力29トークン。モデルは既存の固定版 `gpt-5.4-mini-2026-03-17`。試験ごとの全文・依頼IDは[使用量の記録](assets/udtalk-recovery-2026-10-24/ai-writeback.json)、[操作画面](assets/udtalk-recovery-2026-10-24/ai-relay.png)と[純正Web字幕](assets/udtalk-recovery-2026-10-24/ai-web.png)を参照する。

以前許可された専用プロジェクトで1日・Responses限定のキーを発行した。今回の2件への無料枠適用と請求確定額は未確認。純正編集アプリのロック通知表示、翻訳、推論中に実際の入力を変える競合試験は残る。回帰テストの保護処理と実機確認の範囲は[入力接続](udtalk-input.md#復旧後の実接続確認)を参照する。

## 実験のデータ共有と無料枠

2026-10-11、利用者は実験中のデータを学習に使う代わりに無料枠を使うことを承認した。OpenAIの入力・出力共有で、専用プロジェクト `caption-relay-verification` を選択対象へ追加し、無料枠への登録と保存後の設定を確認した。共有する実験データは合成音声と架空の文に限る。実際の会議や機密情報をこの設定へ送らない。

無料枠は特別なキーではなく、対象プロジェクトから対象モデルへ送った共有データに適用される。2026-10-11の[公式条件](https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai)では、今回試験した `gpt-5.3-codex` と `gpt-live-transcribe` は対象モデル一覧に含まれない。GPT-5.4 Miniの固定版は対象一覧に含まれる。正の残高と対象グループの日次上限などの条件があり、上限を超える要求は有料になる。無料適用は使用量画面のProcessing Tierに現れるデータ共有枠で照合する。2026-10-11 14:31 JSTの使用量画面では、GPT-5.4 Miniの1件（入力158・出力45トークン）がData sharing incentive tierに計上され、無料枠の適用を確認した。別の1件（入力195・出力39トークン）はdefault、残る2件は集計待ちだった。通常枠に分類された理由と請求確定額は未確認で、全件を無料扱いにしない。先の実測費用を無料扱いへ変更せず、音声認識の累積上限も維持する。今回の追加試験はAppleの端末内認識を使い、クラウドへの音声送信は増やしていない。
