# ドキュメント

用途に応じて文書を選んでください。現行の動作、実装の構成、将来の設計案は別の文書に分けています。

## 利用者向け

| 文書 | 内容 |
|---|---|
| [準備と起動](setup.md) | 必要なツール、起動、AIキー、マイク入力の準備 |
| [利用者向けマニュアル](manual.md) | 入力と配信先の選択、AI・辞書、訂正、観客画面、終了 |
| [ルームの接続と字幕リセット](rooms.md) | 接続、字幕のリセット、保存される情報 |
| [単語辞書](dictionary.md) | 登録、認識と校正への反映、保存先 |
| [マイク入力](microphone-input.md) | OpenAI・Appleの準備、開始・停止、試験上限、確認範囲 |
| [UDトークの入力接続](udtalk-input.md) | 独立配信、編集参加、Web入力、実機確認と制約 |
| [AIの選択と振り分け](ai-routing.md) | モデル、料金、実接続の確認 |

## 開発者向け

| 目的 | 文書 | 記載する内容 |
|---|---|---|
| 利用者とプロダクト方針を確認する | [PRODUCT.md](../PRODUCT.md) | 会場での利用、目的、優先順位、制約、未確定事項 |
| 変更ルールを確認する | [AGENTS.md](../AGENTS.md) | 作業に応じた参照先と完了条件 |
| 現在の動作と制約を確認する | [現行 PoC の仕様](current-behavior.md) | 入力、編集、公開、テストとの対応、未実装の範囲 |
| 責務やデータの境界を変更する | [システム構成](../ARCHITECTURE.md) | 実装を構成するファイル、状態の所有者、API と公開データの境界 |
| 画面・コンポーネントを変更する | [フロントエンドの構成](frontend-architecture.md) | Root、View、Presenter、Mediator、Adapter とイベント伝播 |
| 画面の見た目を揃える | [デザイン規則](../DESIGN.md) | 8pxの配置、文字、配色、状態、操作部品、観客表示の描画 |
| 環境を用意して検証する | [開発手順](development.md) | 依存関係、起動、環境変数、チェック |
| Cloud・SSH 接続で開発する | [リモート開発](remote-development.md) | Codex Cloud、SSH 接続とポート転送 |
| 公開前の点検結果を確認する | [公開前の点検](publication-check.md) | 検査範囲、修正、履歴に残る情報、公開と LICENSE の判断 |
| UDトークの字幕出力を参照する | [字幕出力の調査](udtalk-display.md) | 公式仕様、今回の対応範囲、未提供の機能 |
| UDトークへ訂正を戻す接続を調べる | [編集通信の解析](research/udtalk-editor-protocol.md)・[公開資料](research/udtalk-editor-protocol-sources.md) | 純正編集アプリの要求形式、オフライン実行結果、復旧後の実反映と未確認事項 |
| API モデルを変更する | [API の型生成](generated/README.md) | 生成元、再生成、型と入力制限の一致確認 |
| キーボード・読み上げへの対応を調べる | [アクセシビリティの確認](accessibility.md) | 入力エラー、フォーカス、字幕更新、画面幅と検証の限界 |
| 新しい機能の要件を検討する | [v0.2 の設計案](design-v0.2.md) | 将来要件、未確定事項、受け入れ条件の案 |
| クラウド音声認識を比較する | [クラウド候補の調査](research/2026-10-10-cloud-transcription.md) | Google・Azure・AmiVoice・AWS などの日本語対応、途中結果、料金、データの扱い |
| OpenAI・端末内音声認識を比較する | [OpenAI・Apple・Whisper の調査](research/2026-10-10-openai-apple-transcription.md) | 現行モデルと API、Apple の対応条件と日本語モデル確認、未実測の範囲 |

## 文書と実装の対応

ホームからの登録・再接続と字幕リセットは[ルームの接続と字幕リセット](rooms.md)を参照する。

現行仕様はコードとテスト、API のフィールドは [Pydantic モデル](../backend/app/models.py)と[生成した OpenAPI](generated/openapi.json)に照らして確認する。設計案の API、画面、性能目標を実装済みの機能として扱わない。外部連携は実接続と測定の結果で判断する。

文書を更新するときは、同じ詳細を複数の文書に書かず、担当する文書へリンクする。現行仕様・構成・設定を確認した場合は確認日も更新する。文書の追加・移動では、この一覧と相対リンクを更新する。

継続中の複数段階の作業に実行計画が必要なら `docs/exec-plans/active/` に現在の状態と次の手順を置く。完了した計画は残さず、結果を PR の説明、PR がなければコミット本文に記録する。

## 整理の参考資料

- [指示と参照資料の設計に関する記事（npaka）](https://note.com/npaka/n/naadacc239bc8)
- [記事が参照する OpenAI の解説](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)

AGENTS.md には参照条件と完了条件を置き、詳しい説明は必要なときに読む構成にした。
