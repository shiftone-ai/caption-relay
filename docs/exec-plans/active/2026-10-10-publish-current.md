# 現行機能の取り込みと公開前点検

## Goal

旧作業場の現行機能を main に取り込み、公開前の秘密情報点検と README の整備を行う。公開設定と LICENSE は利用者の判断を待つ。

## Context

- 作業ブランチは `Eotel/publish-current`。取り込み元は `codex/udtalk-input` の未コミット差分と未追跡ファイル。元の作業場は読み取り専用。
- 元の HEAD のファイル内容は main と一致する。`codex/operator-view-scopes` は patch-id が main の変更と一致し、再取り込みは不要。
- 独立配信、編集参加、AI 提供元接続、話者表示を引き継いだ。外部への実接続に残る課題は別の active plan にある。

## Scope and Non-Goals

ローカル検証、PR、CI、独立レビュー、merge、履歴と作業ファイルの点検、必要な公開前修正まで。リポジトリの公開設定変更、履歴の書き換え、有料 API の契約や大量実行は含めない。

## Constraints From Decisions

- 元の作業場と他のブランチは変更しない。
- API キー、参加リンク、受信資格情報、社内の接続先や個人の連絡先は共有文面に出さない。
- 実 API に対するブラウザ操作と、模擬の外部接続を区別する。
- 変更は `bash scripts/check.sh` を通し、PR は Eotel に割り当てる。

## Remaining Work

1. 独立レビューを受けて指摘を解消し、PR の CI を確認して merge する。
2. main の全履歴、作業ファイル、文書、画像、テスト値、commit 文面を点検する。
3. 秘密情報の伏せ字化と README の整備を PR にして検証する。
4. 点検結果、履歴に残る要確認事項、LICENSE の選択肢を提示し、Orca のコメントを更新する。

## Now And Next

機能取り込みの PR を作成し、CI と独立レビューの最終結果を確認する。merge 後は main の点検を進める。

## Blockers And Human Tasks

公開設定の変更と LICENSE の選択は利用者の判断が必要。UDトークへの実反映と AI 実生成は、有効な編集参加リンクと利用する API キーが未提供のため未検証。

## Verification

- 全体チェックが成功し、API 生成結果がモデルに一致する。
- 背景ブラウザの実操作を実 API と SSE で確認し、証拠を残す。
- 独立レビューの blocker が解消し、PR と merge 後の CI が成功する。
- `gitleaks git` と `gitleaks dir` に加え、画像と秘密値の候補を手動確認する。
- 公開設定は private のまま維持する。
