# API の型生成

API モデルを変更するときに参照する。生成の流れは次のとおり。

| 役割 | ファイル・ツール |
|---|---|
| 生成元 | [backend/app/models.py](../../backend/app/models.py) の Pydantic モデルと [main.py](../../backend/app/main.py) のルート・応答モデル |
| OpenAPI の生成 | [scripts/export_openapi.py](../../scripts/export_openapi.py) → [openapi.json](openapi.json) |
| TypeScript の生成 | `openapi-typescript` → [frontend/src/generated/api.d.ts](../../frontend/src/generated/api.d.ts) |

入力、操作画面用字幕、観客用字幕、セッション、表示切り替えの型をフロントエンドへ渡す。公開モデルの境界は[システム構成](../../ARCHITECTURE.md#api-と公開データの境界)を参照する。

```bash
cd frontend
npm run generate:api
npm run check:api
npm run build
```

生成ファイルは手で編集しない。モデル変更と再生成結果を同じ変更に含める。`check:api` は現在の FastAPI モデル、保存された OpenAPI、TypeScript の生成結果を照合する。全体の検証はルートで `bash scripts/check.sh` を実行する。

TypeScript の型はブラウザで JSON の実行時検証を行うものではない。型生成ツールの対応範囲に合わせ、TypeScript は 5.9 系を使用する。
