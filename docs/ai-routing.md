# AIの選択と振り分け

確認日：2026-10-05

操作画面のロボットアイコンから「AI設定」を開く。AIを指定するほか、候補を限定して費用・実測速度を優先できる。今回は設定と振り分け先の記録、結果の受け取りまでを提供する。外部AIへの送信、APIキーの読み込み、CLIの起動は行わない。

## 選び方

| 設定 | 選択先 |
|---|---|
| AIなし（初期値） | 振り分けを作らず原文を採用 |
| AIを指定 | 指定したAI |
| 費用を優先 | 候補の中で入力200・出力100トークンの参考費用が最小のAI |
| 実測の速度を優先 | 候補の中で受信した応答時間の中央値が最小のAI |

速度は各AIの直近20件の成功結果を使う。測定値のない候補を比較から除き、すべて未計測なら指定AIを使う。初期値に架空の応答時間を入れない。候補は一つ以上必要で、指定AIを含める。設定変更は次の確定入力から使い、既存の依頼を書き換えない。途中結果・入力に同梱された修正結果・手修正済みの字幕は新しい振り分けを作らない。

「AI設定を保存」まで変更内容をサーバーへ送らない。保存に失敗した設定や、設定パネルを閉じたときの下書きはブラウザに保持する。字幕の公開モードとは別の設定であり、人の字幕修正には引き続き明示保存が必要。

## 候補と料金

標準API・テキスト・USDの比較。入力／出力は100万トークンあたり。参考1,000件は1件あたり入力200・出力100トークンで計算し、キャッシュ、追加機能、税、契約割引を含めない。思考に使う出力も課金される場合があり、実際の費用は利用量で変わる。Codex・Claudeの月額契約の料金とは分けて考える。

| 候補 | モデルID | 入力 | 出力 | 参考1,000件 | 根拠 |
|---|---|---:|---:|---:|---|
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | $0.25 | $1.50 | $0.20 | [Google公式料金](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-lite) |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1.00 | $5.00 | $0.70 | [Claude公式料金](https://platform.claude.com/docs/en/about-claude/pricing) |
| Codex / GPT-5.3-Codex | `gpt-5.3-codex` | $1.75 | $14.00 | $1.75 | [OpenAI公式料金](https://developers.openai.com/api/docs/pricing#specialized-models) |

Googleは[Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)を低遅延・費用効率を重視する軽い処理向けと説明している。字幕整形を試す最初の候補に適すると考えられるが、本アプリでの速度・日本語の訂正品質は未測定。[Claude Haiku 4.5の仕様](https://platform.claude.com/docs/en/models/haiku-4-5/overview)も速度を重視する候補として比較する。速度の説明だけで各社の実応答時間に順位を付けない。

[Codex](https://developers.openai.com/api/docs/guides/code-generation#use-codex)は開発用エージェントであり、モデルそのものとは異なる。この比較ではAPIで選べるGPT-5.3-Codexを候補に置いている。CLI・ChatGPT契約経由の選択肢は実装しておらず、字幕整形への適性も未検証。APIモデルの選択とエージェントの接続方式を同じ設定として扱わない。

料金・候補は `backend/app/ai.py`、型は `backend/app/models.py` に置く。提供状況や料金が変わったら公式資料を再確認して更新する。

## 結果の受け取り

`GET /api/ai` は設定・候補・料金・測定値・現在の選択先を返す。`connected: false` は外部接続が未実装であることを示す。`PUT /api/ai` の設定例：

```json
{
  "strategy": "cost",
  "preferred_model": "gemini-3.1-flash-lite",
  "candidates": ["gemini-3.1-flash-lite", "claude-haiku-4-5", "gpt-5.3-codex"]
}
```

確定した字幕の `ai_request` に依頼ID・選択モデル・入力改版を記録する。将来のAdapterはこの記録に対応する原文を送信し、`PUT /api/captions/{caption_id}/formatted` へ結果を返す。

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

`elapsed_ms` は将来のAdapterが送信開始から完全な結果の受信までを測り、負の値や非有限値は拒否する。モデル・依頼ID・入力改版が合わない結果は `stale`、同じ依頼の再送は `duplicate` として測定値にも加えない。手修正済みの文を上書きせず、AI候補として保持する。既存の提供元情報なしの修正結果も受け付けるが、速度の測定値には含めない。AI設定や依頼情報は観客へ送らない。

## 接続時の比較

実接続は後の段階で行う。会場の日本語の入力例を使い、同じ条件で各社の応答時間の中央値と遅い側の分布、トークン数と実費、固有名詞・数字・否定表現の保持を比較する。時間超過や失敗時の処理、候補外のAIへの再送は接続時に決める。現在の振り分けは別の提供元への自動再送を行わない。
