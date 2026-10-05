# API の型生成

`openapi.json` は FastAPI の Pydantic モデルから生成する。`frontend/src/generated/api.d.ts` はその OpenAPI を `openapi-typescript` で変換する。入力、操作画面用字幕、観客用字幕、セッション、表示切り替えの型をフロントエンドへ渡す。

```bash
cd frontend
npm run generate:api
npm run check:api
```

生成ファイルは手で編集しない。`check:api` は現在の FastAPI モデル、保存された OpenAPI、TypeScript の生成結果を照合する。型生成ツールの対応範囲に合わせ、TypeScript は 5.9 系を使用する。
