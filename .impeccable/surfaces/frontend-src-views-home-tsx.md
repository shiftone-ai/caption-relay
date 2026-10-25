---
version: 1
slug: "frontend-src-views-home-tsx"
primary_target: "frontend/src/views/home.tsx"
related_targets: ["frontend/src/views/room.tsx"]
---

# ホームとルームの操作

Mode: Operate

## Direction contract

THESIS: 運用者が以前使ったルームへ戻り、新しいルームを登録し、次のトークのために字幕だけを消せるようにする。

OWN-WORLD: 既存の白い作業面、灰色の細い区切り、黒い主操作、青いフォーカス、Lucideの線画を引き継ぐ。余白は8・16・24・32pxを基準にし、ホームの本文は16px、行間24pxとする。削除を確定するボタンは白文字と暗い赤で区別する。

STORY: ホームで名前と最終利用日時からルームを選ぶ。追加時は名前・配信先・必要な参加リンクを入れる。接続後は字幕の確認と訂正に集中し、リセットと離脱は対象と下書きの有無を確かめる。

FIRST VIEWPORT: 上部にCaption Relayと新しいルームへの接続。下は区切り線のある一列のルーム一覧。各行の左に名前と接続方法・最終利用日時、右に接続設定と接続を置く。狭い画面では操作を次の行の右へ回す。ルーム画面は既存の操作画面の上に名前、ホーム、リセットを置く。

FORM: 既存のOperate画面の拡張。新しい世界や構成案の選択は行わず、受け入れ済みのホーム・ルーム操作を既存の部品と配色で実装する。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints

同時に入力するのは一つのルーム。字幕と背景を混ぜない。参加リンクは履歴のAPI応答へ返さない。リセットは確認後にCaption Relayの字幕と下書きだけを消し、UDトークの字幕とルーム設定を残す。Rootは一つとし、Viewは通知、Mediatorは判断、Adapterは通信を担当する。
