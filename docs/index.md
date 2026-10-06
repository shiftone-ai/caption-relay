# ドキュメント

作業に必要な文書から参照する。現行の振る舞い、実装の責務、将来の設計案をそれぞれ別の文書に置く。

## 目的から探す

| 目的 | 文書 | 記載する内容 |
|---|---|---|
| 起動して試す | [README](../README.md) | アプリの概要、起動、最初の操作 |
| 利用者とプロダクト方針を確認する | [PRODUCT.md](../PRODUCT.md) | 会場での利用、目的、優先順位、制約、未確定事項 |
| 変更ルールを確認する | [AGENTS.md](../AGENTS.md) | 作業に応じた参照先と完了条件 |
| 現在の動作と制約を確認する | [現行 PoC の仕様](current-behavior.md) | 入力、編集、公開、テストとの対応、未実装の範囲 |
| 責務やデータの境界を変更する | [システム構成](../ARCHITECTURE.md) | 実装の入口、状態の所有者、API と公開データの境界 |
| 画面・コンポーネントを変更する | [フロントエンドの構成](frontend-architecture.md) | Root、View、Presenter、Mediator、Adapter とイベント伝播 |
| 画面の見た目を揃える | [デザイン規則](../DESIGN.md) | 8pxの配置、文字、配色、状態、操作部品、観客表示の描画 |
| 環境を用意して検証する | [開発手順](development.md) | 依存関係、起動、環境変数、チェック |
| Cloud・SSH 接続で開発する | [リモート開発](remote-development.md) | Codex Cloud、Mac mini、SSH ポート転送 |
| UDトークの字幕出力を参照する | [字幕出力の調査](udtalk-display.md) | 公式仕様、今回の対応範囲、未提供の機能 |
| UDトークのWeb字幕を取り込む | [入力接続](udtalk-input.md) | 実験用Adapter、設定、断片と改版、実機確認と制約 |
| AIを選び、速度と費用を比較する | [AIの選択と振り分け](ai-routing.md) | Gemini・Claude・Codex、料金の根拠、振り分けと結果の照合 |
| API モデルを変更する | [API の型生成](generated/README.md) | 生成元、再生成、型の一致確認 |
| 新しい機能の要件を検討する | [v0.2 の設計案](design-v0.2.md) | 将来要件、未確定事項、受け入れ条件の案 |

## 文書と実装の対応

現行仕様はコードとテスト、API のフィールドは [Pydantic モデル](../backend/app/models.py)と[生成した OpenAPI](generated/openapi.json)に照らして確認する。設計案の API、画面、性能目標を実装済みの機能として扱わない。外部連携は実接続と測定の結果で判断する。

文書を更新するときは、同じ詳細を複数の文書に書かず、担当する文書へリンクする。現行仕様・構成・設定を確認した場合は確認日も更新する。文書の追加・移動では、この一覧と相対リンクを更新する。

継続中の複数段階の作業に実行計画が必要なら `docs/exec-plans/active/` に現在の状態と次の手順を置く。完了した計画は残さず、結果を PR の説明、PR がなければコミット本文に記録する。

## 整理の参考資料

- [指示と参照資料の設計に関する記事（npaka）](https://note.com/npaka/n/naadacc239bc8)
- [記事が参照する OpenAI の解説](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)

AGENTS.md には参照条件と完了条件を置き、詳しい説明は必要なときに読む構成にした。
