# 操作画面

Mode: Operate

## Direction contract

THESIS: 講演が進む中で字幕を訂正する。訂正位置と新着位置を別に保ち、保存前の文を公開済みの文と取り違えない。

OWN-WORLD: 既存の白地の比較表を維持する。8px単位の余白、24pxの本文行間、16pxのLucideアイコン、1pxの区切り線で情報を揃える。未保存は淡い黄色、編集中は淡い青、公開中は番号と目のアイコンで示す。

STORY: 運用者は直近の入力と観客への表示を確認し、原文と保存済み文を比較する。必要な字幕だけ訂正し、保存の結果を確認する。新着を見たあと、下書きを保って訂正へ戻る。

FIRST VIEWPORT: ヘッダーに新着の公開方法、準備、表示切り替え、AI・表示設定、観客画面への導線を置く。直下に入力3件と観客への表示。下はスクロールする比較表と右の訂正・設定欄。保存は欄の下に固定する。モバイルは監視を残して縦に並べ、履歴領域を確保する。

FORM: 既存UIの改善。新しいブランドやカタログの世界へ置き換えない。画像提案は構成の参考とし、表示内容・状態・動作はコードと現行仕様から決める。主な操作は「最新へ」と「訂正位置へ」の往復。操作中の位置は即時に更新し、装飾のアニメーションは追加しない。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints

人の修正は明示的に保存する。外部AIへの接続は後の段階に行い、今回は選択・振り分けと結果の受け取りまで。画面はRoot配下のPassive Viewとし、操作をChain経由で状態機械のMediatorへ渡す。認証・永続化・会場実機の試験は現行PoCの対象外。
