---
name: Caption Relay
description: 日本語の字幕を比較し、必要な訂正と観客への表示を制御する画面
colors:
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  button-muted: "oklch(0.97 0 0)"
  button-border: "oklch(0.922 0 0)"
  surface: "#ffffff"
  surface-muted: "#fafafa"
  surface-monitor: "#f5f5f5"
  text: "#171717"
  text-secondary: "#404040"
  text-muted: "#525252"
  divider: "#d4d4d4"
  row-divider: "#e5e5e5"
  field-border: "#a3a3a3"
  editor-border: "#737373"
  live: "#15406a"
  editing: "#eff6ff"
  editing-border: "#93b3d1"
  unsaved: "#fffbeb"
  unsaved-text: "#92400e"
  focus: "#1d4ed8"
  selection: "#dbeafe"
  selection-text: "#172554"
  error: "#991b1b"
  audience-dark: "#0a0a0a"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "32px"
  title:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "24px"
  body:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "24px"
  transcript:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  button:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "24px"
  label:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "24px"
  compact-label:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  audience-default:
    fontFamily: 'system-ui, "Hiragino Sans", "Yu Gothic", sans-serif'
    fontSize: "64px"
    fontWeight: 700
    lineHeight: 1.5
rounded:
  control: "4px"
spacing:
  space: "8px"
  space-2: "16px"
  space-3: "24px"
  space-4: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "32px"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "32px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px"
    height: "32px"
    width: "32px"
  select:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 32px 0 8px"
    height: "32px"
  textarea:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px"
    width: "100%"
  output-link:
    textColor: "{colors.text}"
    typography: "{typography.body}"
    padding: "0 8px"
    height: "32px"
  settings-pane:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text}"
    padding: "16px"
    width: "384px"
  caption-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.transcript}"
    padding: "8px 24px"
  caption-default:
    backgroundColor: "{colors.audience-dark}"
    textColor: "{colors.surface}"
    typography: "{typography.audience-default}"
    padding: "48px"
---

# Design System: Caption Relay

## Overview

**Creative North Star: "白地の字幕ログ"**

保存済みの表示文を一列で読み、原文との照合は選択した字幕の訂正欄にまとめる。日本語の長文を並べても位置を見失わないよう、余白、行間、時刻、区切り線を揃える。既存の白地と状態色を引き継ぎ、装飾のためのアニメーションを追加しない。

操作画面は色、位置、アイコンの形で状態を分ける。観客画面は公開された字幕を読むための領域として、書体と寸法を設定から描画する。説明は変更対象と保存の結果を伝え、実装済みの動作と未接続の機能を区別する。

**Key Characteristics:**

- 白地、淡い灰色の領域、細い区切り線で情報を揃える。
- 8pxを基準にした余白と24pxの本文行間を使う。
- アイコンを優先し、操作名と状態の説明を残す。
- 下書き、保存済み文、観客への表示を読み分けられる。
- 観客画面とプレビューで同じ描画規則を使う。

確認元は [PRODUCT.md](PRODUCT.md)、[操作画面の方向](.impeccable/surfaces/operator.md)、[スタイル](frontend/src/styles.css)、[画面部品](frontend/src/views/operator.tsx)、[共通字幕描画](frontend/src/views/caption-display.tsx)、[描画パラメータ](frontend/src/presenters/display.ts)。これは現行PoCの実装を記録したもので、会場での可読性を保証するものではない。

## Colors

白と灰色を基調にし、青と淡い黄色を作業状態に割り当てる。値は冒頭のトークンを参照する。

### Primary

- **保存の黒**（`primary`、`primary-foreground`）：明示的な保存・反映ボタンに使う。
- **公開の青**（`live`）：現在公開中の受信時刻と目のアイコン、保存成功、新着の境界に使う。
- **編集中の淡い青**（`editing`、`editing-border`）：編集中の行を背景と内側の輪郭で示す。
- **未保存の淡い黄色**（`unsaved`、`unsaved-text`）：下書きのある行と未保存アイコンに使う。編集中の行では淡い青の背景を優先し、未保存はアイコンで残す。
- **操作位置の青**（`focus`）：フォーカスと訂正欄のキャレットに使う。文字選択は`selection`と`selection-text`を組み合わせる。
- **失敗の赤**（`error`）：保存失敗、入力エラー、通信の失敗を説明する文に使う。

### Neutral

- **白い作業面**（`surface`）：履歴、入力欄、ポップオーバーの背景。
- **薄い灰色の補助面**（`surface-muted`）：訂正・設定欄と履歴の見出し。監視欄は`surface-monitor`を使う。
- **本文・補助文**（`text`、`text-secondary`、`text-muted`）：保存済み文、原文、説明の順に濃さを分ける。
- **領域と行の境界**（`divider`、`row-divider`）：領域の境界と字幕行の区切りを分ける。文字を押せる部分のホバーにも行の区切りと同じ灰色を使う。
- **入力欄の輪郭**（`field-border`、`editor-border`）：選択欄と訂正欄を区別する。
- **共有ボタンの中間色**（`button-muted`、`button-border`）：outlineとghostのホバー・展開状態、outlineの輪郭に使う。
- **観客画面の黒**（`audience-dark`）：初期設定の背景。白文字と組み合わせる。観客画面の配色は設定値であり、操作画面の状態色には使わない。

**The State Separation Rule.** 編集位置、未保存、公開状態は別の情報として示す。背景色だけに判断を任せず、時刻、アイコン、操作名、フォーカス時の説明を併用する。

## Typography

**Body Font:** 端末標準の`system-ui`を使い、`-apple-system`、`sans-serif`を続ける。操作画面の書体はルートから継承する。

**Character:** 見出しより本文を読む時間が長い画面として、日本語の比較と訂正を優先する。時刻と費用の数値には等幅の数字を使い、本文は内容に応じて折り返す。

### Hierarchy

- **Headline**：画面名。モバイルではサイズと行間を縮める（18px／24px）。
- **Title**：訂正欄と設定欄の見出し。監視欄の公開文も同じ大きさを使い、標準の太さで表示する。
- **Body**：原文、訂正文、補助欄の本文。
- **Transcript**：履歴の保存済み文。PC・モバイルとも同じ大きさで一列に読む。
- **Button**：操作ボタン。本文と同じ大きさと行間で、太さを一段上げる。
- **Label**：領域名、補助説明、保存の結果。小さくても本文と同じ行間を保つ。
- **Compact Label**：受信時刻、料金比較、モデル名の補足、プレビューの説明。受信時刻は履歴と直近の入力の左端、訂正欄の見出しの横に置く。
- **Audience Default**：観客画面の初期値。文字の大きさ、太さ、行間は設定で変更できる。ゴシック、明朝、等幅の端末フォントから選び、観客の端末による差を説明する。

**The Reading Rhythm Rule.** 操作画面の本文と通常の補助文は24pxの行間に揃える。モバイルのtextareaとselectは16pxにし、観客字幕の可変サイズとは分ける。

## Layout

余白は`space`を基準に、`space-2`、`space-3`、`space-4`を使う。細い輪郭（1px）、フォントサイズ、光学的なアイコン位置は余白の単位とは別に扱う。画面全体はビューポートの高さに合わせ、履歴と訂正・設定の内容をそれぞれスクロールさせる。

現在の操作画面では、ヘッダー、直近の入力と観客への表示、履歴と訂正・設定欄の順に置く。履歴は最大960px幅とし、時刻、保存済み文、状態、編集操作を並べる（40px／可変／64px／32px）。本文を二列に分けず、原文は訂正欄の入力の上に表示する。列間は`space-2`、外側の横余白は`space-3`。短い字幕行の最低高さは48pxとし、長文は自然に伸ばす。右の補助欄は384px、画面幅の最大42%にする。保存操作は内容のスクロール領域から分ける。DOMと視覚の順序は履歴、補助欄に揃える。

切り替え幅（720px以下）では履歴と訂正・設定を縦に並べ、入力と観客への表示の監視欄は横に並べる。横余白は`space-2`、操作部品は40pxの高さにする。字幕本文のクリックで訂正を開き、重複する編集アイコンと行ごとの文章ラベルを省く。状態アイコンは本文の横に置く。補助欄を開いても履歴全体に256pxを残し、見出し・移動操作を差し引いた本文領域を確保する。高さ700px以下では画面全体を縦にスクロールできる配置にし、保存操作の切れを防ぐ。

**The Eight Pixel Rule.** 余白と部品寸法を8pxの倍数に揃える。状態説明や長文が増えたときは内容を切り詰めず、領域を伸ばすかスクロールさせる。

**The Stable Position Rule.** 新着位置と訂正位置を別に保つ。「最新へ」と「訂正位置へ」で往復でき、表示位置の更新は即時に行う。

## Elevation & Depth

領域の深さは淡い背景と細い輪郭で表す。履歴や補助欄に装飾の影を加えない。訂正欄の影は明示的に外している。ヘルプと状態説明は内容の上に重なるが、輪郭または黒い背景で区別する。

キーボードのフォーカスは青い輪郭（2px、外側の間隔2px）で示す。共有部品には既存のフォーカスリングもあるが、操作画面の輪郭を主な手掛かりにする。

**The Flat Workspace Rule.** 作業面は背景と境界で分ける。装飾の影や登場アニメーションを加えず、保存、編集、公開の状態を直接伝える。

## Shapes

履歴と補助欄は直線的な領域にする。押す・選ぶ・書く部品には小さな角丸（`control`）を使う。操作画面の角丸は共有部品の初期値より優先する。

Lucideの線画アイコンを使う。主なアイコンは16px、状態アイコンの枠は24px。デスクトップでは32pxの高さの中央に置き、編集ボタンと揃える。形が表す状態をアクセシブルな名前と説明でも伝える。

## Components

### Buttons

保存は黒い塗り、表示切り替えなどの操作は輪郭、行内の編集・移動はghostを使う。文字のあるボタンは横の内余白に`space-2`、文字とアイコンの間に`space`を使う。アイコンのみのボタンは操作名をアクセシブルな名前にする。破棄、保存、公開方法のように結果の説明が必要な操作は文字を残す。

ホバーと展開状態は共有部品の灰色を使う。既存ボタンの状態遷移（150ms）と押下時の移動（1px）を引き継ぐ。新たな装飾アニメーションは追加しない。処理中の操作は無効化し、保存の成否は文章でも通知する。

### Inputs / Fields

訂正欄は白い背景と輪郭を使い、内余白は`space`。デスクトップの最低高さは160px、モバイルは96px。縦方向のサイズ変更と長文の折り返しを許可する。入力エラーでは輪郭を赤にし、理由を入力欄の近くに示す。

selectはネイティブの選択操作を保ち、デスクトップでは置かれた領域の文字サイズを継承する。線画の矢印（16px）を右端から`space`だけ内側に置き、右の内余白（32px）で文字との重なりを防ぐ。強制配色ではブラウザの矢印を使う。色の入力もネイティブ部品を使う。

### Navigation

操作画面のヘッダーでは準備、公開方法、表示切り替え、AI・表示設定、観客画面への導線をまとめる。設定ボタンにはアイコンと操作名を付け、展開状態を通知する。観客画面のリンクは下線と外部リンクアイコンを使う。モバイルでは冗長な表示文字を減らし、操作名は残す。

### Cards / Containers

補助欄は淡い灰色、細い領域境界、`space-2`の内余白を使う。閉じる操作と見出しを先頭に、保存・反映操作と結果を末尾に置く。説明は変更される対象と反映のタイミングを伝える。AI設定には接続前で送信を行わないことを示す。

### Caption History

保存済みの表示文を一列で読む。原文との比較は選択した字幕の訂正欄にまとめる。連番を表示せず、時刻と本文を位置の手掛かりにする。編集ボタンの読み上げ名は本文を含め、受信日時の説明を添える。訂正欄の見出しは「字幕の訂正」、入力ラベルは「表示文」とする。長い原文は欄内でスクロールでき、キーボードでも全文を確認できる。下書きがある場合は保存済み文を折りたたみで参照できる。未保存の本文を履歴に混ぜない。未保存と編集中の背景、出所と公開状態の2つのアイコン、新着の境界はそれぞれ別の役割を持つ。状態の説明はホバーとフォーカスで表示する。

### Shared Caption Display

観客画面と設定プレビューは同じ描画部品とパラメータ生成を使う。観客画面は設定した実寸、プレビューは基準画面（1280×800px、16:10）の幅に対する比率で縮小する。文字サイズ、余白、発話間の間隔（16px）を同じ倍率で縮め、行間の倍率は保つ。16:9の領域は表示枠の内側に収め、上・中央・下の位置を反映する。

プレビューの枠はデスクトップで最大256px、モバイルで160px。表示例を使う場合は配信されない例文であることを明示する。内容・寸法の変更とリサイズで末尾へ移り、定期取得だけでは手動スクロールを戻さない。観客画面に管理情報を出さず、全画面の操作は48pxのボタンにする。

## Do's and Don'ts

### Do:

- **Do** 8pxの余白と24pxの本文行間を基準にし、長文の折り返しとスクロールを確認する。
- **Do** 状態を色、位置、アイコンの形、説明で分ける。
- **Do** アイコンのみの操作にアクセシブルな名前を付け、保存の結果と変更対象を文章で伝える。
- **Do** 保存済み文と下書きを区別し、明示的な保存・反映操作を保つ。
- **Do** 観客画面とプレビューに同じ描画規則を適用し、端末と実際の表示先で読みやすさを確認する。

### Don't:

- **Don't** 作業面に装飾の影や登場アニメーションを追加する。
- **Don't** 未保存、編集中、公開中を一つの状態にまとめる。
- **Don't** アイコンだけで結果や状態を説明し、操作名や補助説明を省く。
- **Don't** 観客画面へ管理情報を表示する。
- **Don't** 未接続のAIや会場の可読性を検証済みとして説明する。
