# Mac版の署名と一般配布

## Goal

Mac版をDeveloper IDで署名・公証し、ダウンロードした利用者が通常の起動手順で使える配布物を用意する。

## Context

- TauriのMac版とPython・Swiftの同梱は実装済み。使い方と実機確認は[Mac版](../../macos.md)を参照する。
- Apple SiliconのRelease版をリポジトリ外から起動し、マイク認識・訂正・観客表示・終了を確認した。
- 現在の設定はad-hoc署名。キーチェーンで利用できるDeveloper ID Applicationの署名用IDはない。
- 開発版の起動確認は、ダウンロード後のGatekeeper確認と区別する。

## Scope and Non-Goals

- Developer ID署名・Apple公証・配布物の検査と利用手順の更新。
- 字幕や接続の機能変更、Intel対応、自動更新、LANへの公開は含めない。

## Constraints From Decisions

- Chromiumを同梱せず、Tauriと既存のPython・Swiftを使う。
- APIキーと利用者の設定を配布物へ含めない。署名・公証の認証情報もGitへ保存しない。
- セキュリティ警告を回避する起動手順で一般配布の検証を代替しない。

## Remaining Work

1. 利用するDeveloper ID Applicationの証明書と公証の認証方法を確認する。
2. Tauriと同梱バイナリを署名・公証し、検査した配布物を用意する。
3. 別のMacでダウンロード後の起動、Keychain、マイク許可、訂正・観客表示・終了を確認する。
4. 確認した配布物と対応範囲をMac版の手順へ記録する。

## Now And Next

Developer IDと公証の認証方法が利用可能になったら、Tauri公式の署名手順と現在のビルド設定を確認する。開発用のad-hoc署名を一般配布用の署名済み配布物として扱わない。

## Blockers And Human Tasks

Developer ID Applicationの証明書と公証の認証情報が必要。Apple Developerの契約や認証情報の作成が必要な場合は利用者が行う。公開先へのアップロードは、配布物を検査してから利用者の指示に従う。

## Verification

- 署名と公証の検査が成功し、配布物に公証の結果を添付できる。
- ダウンロードした別のMacで通常の起動と権限確認が通る。
- 終了後に録音・内蔵サーバー・認識用子プロセスが残らない。
- 検証したCPU・OS・機能の範囲と未確認の範囲を区別して記録する。
