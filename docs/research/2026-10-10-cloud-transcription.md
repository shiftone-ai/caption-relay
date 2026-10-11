# クラウド文字起こしの比較（2026-10-10）

**最初の接続先は利用者の回答により OpenAI と決定した。** OpenAI と端末内の候補は[別の調査](2026-10-10-openai-apple-transcription.md)、接続経路・リポジトリ専用キーの条件・合計100円と送信20分の試験上限は[マイク入力](../microphone-input.md)に記載する。この文書はほかのクラウドを比較する資料として残す。

AmiVoice API の日本語 E2E 汎用エンジンには、発話開始・途中結果・認識完了のイベントと保存なしの接続先がある。これは字幕入力との適合性を調べた結果であり、精度が他社より高いという結論ではない。[エンジン](https://docs.amivoice.com/amivoice-api/manual/engines)、[イベント](https://docs.amivoice.com/amivoice-api/manual/websocket-interface-command-and-response/)、[ログ保存](https://docs.amivoice.com/amivoice-api/manual/log-retention/)

全候補について、同一音声での日本語精度・遅延は**未実測**。この調査ではキーを作成せず、音声を外部 API へ送信していない。公式資料と認証不要の公開価格 API を確認した。提供者の「高精度」「低遅延」という説明を、同一条件の測定値や保証値として扱わない。

## 日本語と途中結果

| 候補 | 日本語の根拠・精度評価の限界 | 途中結果と確定 |
| --- | --- | --- |
| AmiVoice API | 日本語 E2E 汎用は `-a2-ja-general`、会話汎用は `-a-general`。公式は新規利用で E2E を先に試すことを推奨している。E2E ではフィラーを自動削除し、著しく悪い音質や長い音声で結果を繰り返す場合がある。採用エンジンの実音声評価は必要。[エンジン](https://docs.amivoice.com/amivoice-api/manual/engines) | `U` が途中結果、`A` が認識完了。`resultUpdatedInterval` は既定 100 ms、100 ms 単位へ切り上げ、0 は途中結果なし。結果が更新されない場合も進行表示のドットが追加される。更新間隔は認識・通信の遅延保証ではない。[パラメータ](https://docs.amivoice.com/amivoice-api/manual/request-parameters#resultupdatedinterval)、[イベント](https://docs.amivoice.com/amivoice-api/manual/websocket-interface-command-and-response/) |
| Google Cloud Speech-to-Text v2 | Chirp 3 は `ja-JP` のストリーミング認識を GA として掲載。モデル文書の提供地域一覧は `us` と `eu` のマルチリージョンで、東京提供は今回未確認。日本語の他社比較値は採用しない。[Chirp 3](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3) | `interim_results=true` で途中結果を受信し、`is_final` で確定を判別する。1 レスポンスに確定部分と複数の途中部分が入る場合がある。固定の通知周期は今回確認できなかった。[v2 RPC](https://docs.cloud.google.com/speech-to-text/docs/reference/rpc/google.cloud.speech.v2#streamingrecognitionfeatures) |
| Azure AI Speech | Speech-to-Text の言語表に `ja-JP` を掲載。対応言語であることは確認できるが、このアプリの会場音声での精度は未実測。[言語対応](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support#speech-to-text) | Python Speech SDK の `recognizing` が途中結果、`recognized` が認識完了。継続認識の開始・停止・取消イベントがある。固定の通知周期は今回未確認。[継続認識](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-recognize-speech) |
| AWS Transcribe Streaming | `ja-JP` の streaming とカスタム語彙に対応。日本語のカスタム言語モデルは表では非対応。他社との精度順位は付けない。[言語・機能](https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html) | 同一セグメントを途中結果として更新し、`IsPartial=false` が確定。部分結果の安定化には低・中・高の設定があり、速さと精度のトレードオフがある。資料の例にある通知間隔を保証周期として扱わない。[部分結果](https://docs.aws.amazon.com/transcribe/latest/dg/streaming-partial-results.html) |
| Soniox（追加候補） | STT と共通の言語一覧に日本語 `ja` を掲載。リアルタイム API の現行サンプルは `stt-rt-v5`。日本語対応の追加候補であり、精度優位は未確認。[言語](https://soniox.com/docs/translation/supported-languages)、[リアルタイム認識](https://soniox.com/docs/stt/rt/real-time-transcription) | トークンごとに `is_final` があり、確定トークンは一度だけ届く。発話単位の字幕へは、確定済み部分と更新される部分を蓄積し、終端検出または手動確定で区切る必要がある。固定の通知周期は今回未確認。[リアルタイム認識](https://soniox.com/docs/stt/rt/real-time-transcription) |

**遅延の数値保証は、今回確認した各社の認識・制限・料金資料では確認できなかった。** AmiVoice の SLA は月間稼働率 99.95% とログの扱いを定めているが、字幕が何 ms 以内に届くという保証を掲載していない。通知周期、音声チャンク長、発話終了待ち、サービス稼働率は別々に評価する。[AmiVoice SLA](https://docs.amivoice.com/amivoice-api/legal/sla-2022-06-22)

## 分あたり料金と課金条件

単一チャンネルの標準的なリアルタイム認識を比較する。表の分単価は時間・秒単価からの換算であり、無料枠・契約割引・付加機能・アプリ実行費を含めた見積もりではない。USD の価格と税込 JPY の価格を、そのまま安さの順位にしない。USD 表示の税の含否と、この契約での税額・円換算は今回未確認。

| 候補・条件 | 分あたり | 課金単位・条件・根拠 |
| --- | --- | --- |
| AmiVoice 汎用 WebSocket、ログ保存なし | **税込 2.475 円／発話分**（税抜 2.25 円） | 税込 0.04125 円／秒を 60 倍した値。無音を除き、発話と判定された区間が対象。BGM・雑音が発話として検出される場合は課金対象。エンジンごとに毎月 3,600 秒無料、ミリ秒で集計して月計算時に 1 秒未満を切り捨てる。[価格・計算方法](https://acp.amivoice.com/amivoice_api/price/) |
| Google v2 Standard、月 500,000 分までの通常従量課金 | **USD 0.016／音声分** | 1 秒単位、リクエストごとに切り上げ。チャンネルごとに課金。V1 の月 60 分無料やログ保存あり価格を V2 に流用しない。Dynamic Batch の割引価格はライブ字幕向けの料金として採用しない。[料金](https://cloud.google.com/speech-to-text/pricing) |
| Azure、Japan East、S1 Speech To Text | **USD 0.01667／音声分**（USD 1.00／時間） | Japan East の `Azure Speech` / `S1 Speech To Text` の公開 Retail Prices API で `unitPrice=1.0`、`unitOfMeasure=1 Hour` を確認。価格ページは送信音声を 1 秒単位で課金と説明。F0 の無料枠と S1 の有料単価は別に扱う。[公開価格 API](https://prices.azure.com/api/retail/prices?%24filter=armRegionName+eq+%27japaneast%27+and+productName+eq+%27Azure+Speech%27+and+meterName+eq+%27S1+Speech+To+Text%27&currencyCode=USD)、[秒課金](https://azure.microsoft.com/en-us/pricing/details/speech/) |
| AWS、東京、Standard Streaming | **USD 0.010002／音声分**（約 USD 0.01） | 2026-09-11 公開の東京価格一覧で `APN1-StreamingAudio` は USD 0.0001667／秒、適用範囲 `0`〜`Inf`。現行価格ページは標準認識を 1 秒単位・最低課金なしと説明。古い開発ガイド PDF には最低 15 秒の記載が残るため、開始前に請求条件を再確認する。[東京価格 JSON](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/transcribe/current/ap-northeast-1/index.json)、[現行価格](https://aws.amazon.com/transcribe/pricing/)、[開発ガイド PDF](https://docs.aws.amazon.com/transcribe/latest/dg/transcribe-dg.pdf) |
| Soniox、通常のリアルタイム文字起こし | **約 USD 0.002／分**（約 USD 0.12／時間） | 固定の分課金ではなくトークン課金。入力音声 USD 2／100 万トークン、入力テキスト・出力テキストは各 USD 4／100 万トークン。公式の時間換算は概算で、実際の語数・文脈で変わる。接続を維持した無音期間もストリーム時間として課金される。[料金](https://soniox.com/pricing)、[接続維持と課金](https://soniox.com/docs/stt/rt/connection-keepalive) |

AmiVoice のログ保存ありは汎用 WebSocket で税込 1.65 円／発話分だが、音声と結果を研究開発・品質向上へ提供する条件が変わる。今後採用する場合も、この割引を使うにはデータの扱いを再判断する。保存なしで 60 発話分が無料枠を超えて追加された場合は、税込 148.5 円に相当する。これは公式単価からの計算であり、アカウントの既存使用量・月次端数処理を反映した請求額ではない。[価格](https://acp.amivoice.com/amivoice_api/price/)

## 音声・結果の保存と学習利用

| 候補 | 保存・学習に関する確認結果 |
| --- | --- |
| AmiVoice | 保存なしの WebSocket 接続先は `wss://acp-api.amivoice.com/v1/nolog/`。**末尾の `/` がないと保存ありになる**と公式が警告している。SLA は保存なしでは音声・認識結果ログを保存しないと規定。保存ありでは音声・結果を研究開発・品質向上に利用でき、保存期間の上限は今回未確認。サーバー動作ログは少なくとも 3 か月保持されるため、内容を保存しないことと動作メタデータを保存しないことを混同しない。[接続先と注意](https://docs.amivoice.com/amivoice-api/manual/log-retention/)、[SLA 2.10–2.11](https://docs.amivoice.com/amivoice-api/legal/sla-2022-06-22) |
| Google | Data usage FAQ は、データロギングに参加しなければ音声・結果をサービス提供以外に使わず、streaming/sync はメモリ処理で顧客データを保存しない、リクエスト時刻・サイズなどのメタデータは一時記録すると説明。ただし取得できた FAQ は **V1 の文書経路**。V2 / Chirp 3 と利用契約への適用範囲は、採用前に再確認する。[Data usage FAQ](https://docs.cloud.google.com/speech-to-text/docs/v1/data-usage-faq) |
| Azure | リアルタイム認識の入力音声は Azure サーバーのメモリだけで処理し、顧客の入力データを保持・保存しないと説明。バッチのストレージや Custom Speech 用に意図的にアップロードするデータは別条件。標準モデル学習への利用を禁止する契約条文そのものは今回未確認。[Speech-to-Text のデータ扱い](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/speech-to-text/data-privacy-security) |
| AWS | **標準では処理済み音声入力を保存し、サービス開発・改善に利用する**と説明。AWS Organizations の AI services opt-out policy で利用を拒否できる。音声・文字結果の具体的な保持期間と、利用アカウントの opt-out 適用状態は未確認。アプリが結果を保存しない設計だけでは、この提供者側の条件を変えられない。[利用拒否](https://docs.aws.amazon.com/transcribe/latest/dg/opt-out.html)、[AI Service Card](https://docs.aws.amazon.com/ai/responsible-ai/transcribe-speech-recognition/overview.html) |
| Soniox | 音声・文字結果をモデル・サービス改善に使わず、保存対応機能を明示的に使わなければ保持しないと説明。Async API の音声・結果は 30 日で自動削除。音声・文字内容を含まない診断・課金メタデータの記録は残る。日本リージョンでは処理・保存をその地域内に保つと説明。[データ扱い](https://soniox.com/docs/security-and-privacy)、[地域](https://soniox.com/docs/data-residency) |

## 認証と Python / FastAPI への接続

これらを FastAPI に統合する部分は**未実装**。公式 Python API があることと、このリポジトリの OS・依存関係で実行できることを分けて扱う。ローカルのバックエンド要件は Python 3.12 以上である。[プロジェクト設定](../../backend/pyproject.toml)

| 候補 | 認証 | 接続方式・実行環境 |
| --- | --- | --- |
| AmiVoice | API キー。WebSocket 接続時の HTTP Authorization ヘッダー、または開始コマンドの認証パラメータを使える。追加キーには期限・IP などの制限を付けられる。[認証](https://docs.amivoice.com/amivoice-api/manual/request-parameters#authorization)、[API キー](https://docs.amivoice.com/amivoice-api/manual/api-key) | WebSocket と JSON / テキスト制御パケット。公式に Python の WebSocket サンプルがある。ブラウザから音声を受けたバックエンドが provider 接続を所有する案なら、長期キーをブラウザへ渡さずに済む。サンプルをそのまま使った実行確認はしていない。[Python サンプル](https://docs.amivoice.com/amivoice-api/manual/websocket-interface/) |
| Google v2 | Application Default Credentials と IAM。プロジェクトで API・請求を有効にする必要がある。[事前設定・認証](https://docs.cloud.google.com/speech-to-text/docs/streaming-recognize) | 双方向 streaming は gRPC のみ。公式 Python `google.cloud.speech_v2.SpeechClient` で音声チャンクを送る。ブラウザ音声を FastAPI で受け、Python gRPC クライアントへ渡す案となる。[streaming](https://docs.cloud.google.com/speech-to-text/docs/streaming-recognize) |
| Azure | Speech リソースのキー、STS トークンまたは Microsoft Entra 認証。STS トークンは 10 分有効で、長時間使用時は更新が必要。[認証](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short#authentication) | Python Speech SDK と音声入力ストリームを使う。16-bit signed little-endian PCM、mono、8 kHz または 16 kHz が入力ストリームの要件。SDK は Windows・Linux・macOS に対応し、Linux の配布形態・ネイティブライブラリに条件がある。使用するコンテナでの導入確認は未実施。[音声ストリーム](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-use-audio-input-streams)、[Python SDK 環境](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/quickstarts/setup-platform?pivots=programming-language-python) |
| AWS | IAM と Signature Version 4。HTTP/2 または署名済み WebSocket 接続、Event Stream のエンコードが必要。WebSocket の署名 URL の有効期限上限 300 秒は、認証 URL の期限であり認識ストリームの最長時間ではない。[認証・プロトコル](https://docs.aws.amazon.com/transcribe/latest/dg/streaming-setting-up.html) | 旧 `amazon-transcribe-streaming-sdk` は非推奨になり、新公式 `aws-sdk-transcribe-streaming` を案内。新パッケージは Python 3.12 以上だが PyPI の開発状態は Pre-Alpha。採用する場合は SDK の成熟度を確認する。[旧 SDK の案内](https://github.com/awslabs/amazon-transcribe-streaming-sdk)、[新 SDK](https://pypi.org/project/aws-sdk-transcribe-streaming/) |
| Soniox | API キー。公式 Python SDK / WebSocket の手順がある。ブラウザへ渡す認証と長期キーの保管を同じ扱いにしない。[開始手順](https://soniox.com/docs/stt/get-started) | WebSocket で音声を送信し、トークンを蓄積する。公式に Python SDK と直接 WebSocket のサンプルがある。日本リージョンを使うときは、その地域の接続先を選ぶ。[Python サンプル](https://soniox.com/docs/stt/rt/real-time-transcription)、[地域](https://soniox.com/docs/data-residency) |

## ストリーム制限と再接続

| 候補 | 確認できた制限 | アプリ側で必要な扱い |
| --- | --- | --- |
| AmiVoice | 最大 24 時間、発話を検出できない状態 600 秒、無通信 60 秒で切断。1 発話は最大 15 秒で区切って結果を返す。[制限](https://docs.amivoice.com/amivoice-api/manual/limitations/) | 接続を開始し直す。切断前の未確定文字を成功扱いにしない。15 秒で区切られた発話も独立した字幕の発話として扱う。再送音声による重複回避はアプリ側の設計事項。 |
| Google v2 | 1 stream 最大 5 分、音声は実時間に近い速度で送信。制限文書は 1 メッセージ 25 KB、v2 RPC 参照は `audio` に 15 KB と記載し、資料間に差がある。[制限](https://docs.cloud.google.com/speech-to-text/docs/quotas)、[RPC](https://docs.cloud.google.com/speech-to-text/docs/reference/rpc/google.cloud.speech.v2#streamingrecognizerequest) | 5 分ごとの更新を前提にし、音声の引き継ぎと確定済み範囲の重複除去を行う。チャンクは両方の記載を下回る大きさにし、採用時の API / モデルで再確認する。 |
| Azure | 基本モデルの同時リアルタイム要求は有料枠で既定 100、無料枠で 1。リアルタイム話者分離は最大 240 分／session。通常の継続認識の最大接続時間は今回未確認。[制限](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits#real-time-speech-to-text-and-speech-translation) | `canceled` / `session_stopped` と認証期限を処理し、必要に応じて開始し直す。認識が止まったことを検知できるイベント処理が必要。[継続認識](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-recognize-speech) |
| AWS | HTTP/2 と WebSocket を合計して、地域・アカウントごとに同時 25 stream が既定。最大 session 時間の超過時は新 stream の開始が必要だが、その数値は今回確認した現行資料では未確認。音声ファイル長の上限と混同しない。[同時数](https://docs.aws.amazon.com/general/latest/gr/transcribe.html)、[streaming の制限エラー](https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html) | 上限・急な接続増加は指数バックオフで再試行。PCM の送信チャンクは公式が 50〜200 ms を推奨し、無音時も同量の無音を送る。[streaming の手順](https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html) |
| Soniox | 300 分／stream、同時要求 10、毎分 100 要求が既定。音声送信を止める間は少なくとも 20 秒ごとに keepalive が必要。keepalive で保持した時間にも課金される。[制限](https://soniox.com/docs/stt/rt/limits-and-quotas)、[接続維持](https://soniox.com/docs/stt/rt/connection-keepalive) | 300 分を超える前に新しい接続を作る。確定トークンは一度だけ届くため、切断前後で重複追記や未確定部分の消失を防ぐ。 |

## AmiVoice を字幕入力へ変換するときの注意

以下の前半は公式 API の事実、後半はそれを受けた設計案である。正式な実装前に、採用する E2E エンジンの音声でイベント列を取得して確認する。

1. **発話検出と認識処理の状態を別に持つ。** `S` / `E` は発話区間の開始・終了、`C` は認識開始。混雑や発話長によって `C` は `E` より後にも届く。`E` を認識完了にしない。[イベント順](https://docs.amivoice.com/amivoice-api/manual/websocket-interface-command-and-response/)
2. **途中結果の進行表示を字幕本文へ混ぜない。** `U` の JSON は最後の形態素に `written="..."` のダミーがあり、結合済み `text` にも付く。設計案は、この仕様上のダミーだけを除いた形態素列を本文として比較し、同じ本文では revision を増やさない。任意の本文の句読点を末尾から削らない。更新なし時のドット追加と E2E の実レスポンスでこの方法が成立するかは未実測。進行表示だけを無効にする設定は未確認で、`resultUpdatedInterval=0` は `U` 全体を停止する。[U の構造](https://docs.amivoice.com/amivoice-api/reference/websocket/event/u-event-packet)、[通知間隔](https://docs.amivoice.com/amivoice-api/manual/request-parameters#resultupdatedinterval)
3. **成功した `A` だけを確定にする。** 成功条件は `code` と `message` が空、`text` が非空。失敗は空の `text` とコード・メッセージを返し、`c` は取消を表す。取消・空文をそれまでの途中文字の確定へ変換しない。[A の成功・エラー条件](https://docs.amivoice.com/amivoice-api/reference/websocket/event/a-event-packet)
4. **アプリの発話 ID を API の確定 ID に依存させない。** `S` は音声開始からのミリ秒時刻、`C` は本文のない認識開始通知、`U` の定義に ID はなく、`A` では `utteranceid` が付く。設計案は接続世代とローカル発話番号で ID を作り、認識開始後の更新をその ID の revision にする。検出済み区間を別に保持し、後続の `S` で前の未完了結果を上書きしない。複数区間の結果順序を常に FIFO としてよい保証は今回未確認なので、A の時刻と対応も検証する。[S](https://docs.amivoice.com/amivoice-api/reference/websocket/event/s-event-packet)、[C](https://docs.amivoice.com/amivoice-api/reference/websocket/event/c-event-packet)、[U](https://docs.amivoice.com/amivoice-api/reference/websocket/event/u-event-packet)、[A](https://docs.amivoice.com/amivoice-api/reference/websocket/event/a-event-packet)
5. **保存なしの接続先と秘密情報の保管を固定する。** サーバー側の許可済み接続先を、末尾 `/` を含めて照合する。API キーはバックエンドだけに保管し、送信コマンド・ヘッダー・エラーに出力しない。これは、開始コマンドにも認証情報を入れられる公式方式を安全に使うための設計案である。[保存先の注意](https://docs.amivoice.com/amivoice-api/manual/log-retention/)、[認証方式](https://docs.amivoice.com/amivoice-api/manual/request-parameters#authorization)

## 実測前に残る確認

1. 採用エンジンの同一日本語音声で、初回の途中結果、発話終了後の確定、固有名詞・数字・誤った繰り返しを測る。
2. AmiVoice の E2E で、連続発話・15 秒分割・認識取消・更新なし・回線切断時のイベント列と ID 対応を確かめる。
3. 実アカウントの使用量と税・請求条件を確認し、決定済みの合計100円・送信20分以内に収まる停止条件を設定する。キー作成・有料 API の利用は、この調査に含めない。
4. Google を採用する場合は V2 の保存条件と提供地域、AWS を採用する場合は opt-out と現行 SDK の状態を再確認する。
5. 実行する OS / コンテナで SDK と音声フォーマットを確認する。ブラウザのマイク取得と実 API から字幕入力までの疎通は、実装後の検証で扱う。
