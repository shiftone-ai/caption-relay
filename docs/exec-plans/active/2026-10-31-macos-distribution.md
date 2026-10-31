# Mac版の配布と別Macでの初回起動確認

## Goal

Mac版をDeveloper IDで署名・公証し、ダウンロードした利用者が通常の起動手順で使える配布物を用意する。

## Context

- TauriのMac版とPython・Swiftの同梱は実装済み。使い方と実機確認は[Mac版](../../macos.md)を参照する。
- Apple SiliconのRelease版をリポジトリ外から起動し、マイク認識・訂正・観客表示・終了を確認した。
- 通常の開発用ビルドはad-hoc署名。一般配布用のビルドでは環境変数でDeveloper IDを指定する。
- 利用者が選んだApple Developerチームで、秘密鍵を伴うDeveloper ID Application証明書をこのMacへ作成済み。
- Developer ID署名版で録音・認識・訂正・観客表示・終了を確認済み。同梱する28個のMach-Oは同じチームの署名・タイムスタンプ・Hardened Runtimeを確認済み。
- 配布物の準備と公証の再開は`node scripts/notarize-desktop.mjs --help`、手順は[Mac版](../../macos.md#developer-id署名と公証)を参照する。
- Apple公証はAccepted（指摘なし）。公証チケット添付、GatekeeperのNotarized Developer ID判定、ZIP展開後の署名・チケット検査が成功している。
- 配布物の場所は`.cache/distribution/package-path`、提出IDと配布ZIPのSHA-256は配布物内の`verification.json`を参照する。これらのローカル参照ファイルはGitへ保存しない。
- 開発版の起動確認は、ダウンロード後のGatekeeper確認と区別する。

## Scope and Non-Goals

- Developer ID署名・Apple公証・配布物の検査と利用手順の更新。
- 字幕や接続の機能変更、Intel対応、自動更新、LANへの公開は含めない。

## Constraints From Decisions

- Chromiumを同梱せず、Tauriと既存のPython・Swiftを使う。
- APIキーと利用者の設定を配布物へ含めない。署名・公証の認証情報もGitへ保存しない。
- セキュリティ警告を回避する起動手順で一般配布の検証を代替しない。

## Remaining Work

1. ダウンロード後の検証に使う別のMacと、公開先を決める。
2. 別のMacでダウンロード後の起動、Keychain、マイク許可、訂正・観客表示・終了を確認する。
3. 確認したCPU・macOSと、実際に使った配布物をMac版の手順へ記録する。

## Now And Next

`.cache/distribution/package-path`を読んで配布物の場所を取得し、`verification.json`と配布ZIPのSHA-256が一致することを確認する。検証用のMacと公開先を決めてから、配布ZIPをそのまま使って初回起動を確認する。

```sh
CAPTION_RELEASE_DIR="$(cat .cache/distribution/package-path)"
cat "$CAPTION_RELEASE_DIR/verification.json"
shasum -a 256 "$CAPTION_RELEASE_DIR/Caption-Relay-macos.zip"
```

参照ファイルや配布物がない場合は、[署名と公証の手順](../../macos.md#developer-id署名と公証)から新しい配布物を準備する。同じMacでのGatekeeper判定を、別のMacでのダウンロード後の初回起動確認として扱わない。

## Blockers And Human Tasks

検証に使う別のMacと公開先が未定。公証の認証情報の追加操作は不要。公開先へのアップロードは利用者の指示に従う。初回のKeychain・マイク許可などOSが求める本人確認は利用者が行う。

## Verification

- 署名と公証の検査が成功し、配布物に公証の結果を添付できる。
- ダウンロードした別のMacで通常の起動と権限確認が通る。
- 終了後に録音・内蔵サーバー・認識用子プロセスが残らない。
- 検証したCPU・OS・機能の範囲と未確認の範囲を区別して記録する。
