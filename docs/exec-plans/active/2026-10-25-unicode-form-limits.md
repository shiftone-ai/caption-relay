# ルーム名と背景の文字数をAPIへそろえる

## Goal

ルーム名とトークの背景でも、辞書と同じくUnicodeコードポイントで上限を判定する。

## Context

#21のNode更新はPR #34でマージ済み。#19の辞書の制限値はバックエンドから生成する。調査ではhome.tsxのルーム名maxLength=120、背景maxLength=4000、ai-settings.tsxの背景maxLength=4000にも同じUTF-16による切り詰めが残っている。APIのPydanticはUnicode文字数で判定する。

## Scope and Non-Goals

上記3入力の文字数、上限超過時の下書き保持と保存拒否、制限値の生成を対象にする。ルーム切替、API形式、認識Adapter、AIの要求内容、公開方針は変えない。

## Constraints From Decisions

- 既存の未コミット6項目と別作業ツリーを保持する。
- Viewは描画と通知のみ。入力検証はRoot/Mediatorなど既存の担当層へ置く。
- 生成値はPydanticのOpenAPIから作り、手で生成物を編集しない。
- 物理マイクと実音声サービスは使用しない。

## Remaining Work

1. 3入力の所有者と保存前の検査を確認し、補助漢字の切り詰めを再現する。
2. OpenAPIの上限値を生成し、入力の保存判定をUnicodeへそろえる。
3. 実APIとブラウザで上限以内の保存と上限超過時の保持を確認する。
4. 全チェックと別セッション監査、PR・CI・マージを完了する。

## Now And Next

homeのRootとOperator Mediatorの保存処理を読み、既存の辞書の修正と同じ考え方で回帰テストを追加する。

## Blockers And Human Tasks

なし。

## Verification

ルーム名120文字、背景4000文字の補助漢字を入力でき、APIが受け付ける。超過時は明確なエラーを示し、下書きと保存済み設定を保持する。API型と既存のルーム保護を維持する。
