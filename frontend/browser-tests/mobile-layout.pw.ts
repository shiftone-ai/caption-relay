import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type { Caption, RoomDetails } from "../src/domain";

const longText = "長い字幕でも原文を読み、訂正内容と保存結果を確認できます。".repeat(30);

async function connect(page: Page, request: APIRequestContext): Promise<RoomDetails> {
  const created = await request.post("/api/rooms", { data: { name: "画面の操作確認" } });
  expect(created.status()).toBe(201);
  const room: RoomDetails = await created.json();
  await request.post(`/api/rooms/${room.id}/connect`);
  await page.goto(`/rooms/${room.id}`);
  await expect(page.getByRole("button", { name: "字幕を隠す", exact: true })).toBeEnabled();
  return room;
}

async function source(request: APIRequestContext, id: string, text: string): Promise<Caption> {
  const response = await request.post("/api/source/events", { data: {
    utterance_id: id, source_event_id: id, revision: 1, text,
  } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function touchTarget(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  await expect.poll(() => control.evaluate(element => {
    const rectangle = element.getBoundingClientRect();
    return Math.min(rectangle.width, rectangle.height);
  })).toBeGreaterThanOrEqual(44);
  if (await control.isEnabled()) {
    await control.scrollIntoViewIfNeeded();
    await expect.poll(() => control.evaluate(element => {
      const rectangle = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rectangle.x + rectangle.width / 2, rectangle.y + rectangle.height / 2));
    })).toBe(true);
  }
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

test("home forms and a long room name remain usable in confirmation dialogs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいルームに接続", exact: true }).tap();
  await page.getByLabel("配信先", { exact: true }).selectOption("host");
  const name = page.getByLabel("ルーム名", { exact: true });
  await touchTarget(name);
  await name.fill("A".repeat(121));
  await expect(page.getByRole("alert")).toContainText("120文字以内");
  await name.fill("A".repeat(120));
  await page.getByRole("button", { name: "登録して接続", exact: true }).tap();
  await expect(page.getByRole("button", { name: "字幕をリセット", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "字幕をリセット", exact: true }).tap();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).tap();
  await expect(dialog).toBeHidden();
  await noHorizontalOverflow(page);
});

test("a long conflict leaves the editor and its save operation reachable", async ({ page, request }) => {
  await connect(page, request);
  const initial = await source(request, "conflict", "最初の字幕");
  await page.getByRole("button", { name: "編集：最初の字幕", exact: true }).tap();
  const editor = page.getByRole("complementary", { name: "字幕の訂正", exact: true });
  const input = editor.getByRole("textbox", { name: "表示文", exact: true });
  await input.fill("残しておきたい下書き");
  await request.patch("/api/captions/conflict", { data: {
    text: longText, base_revision: initial.revision, base_source_revision: initial.source_revision,
  } });
  await editor.getByRole("button", { name: "保存して公開", exact: true }).tap();
  await expect(editor).toContainText("別の更新がありました");
  // A positive text area is insufficient if an ancestor has collapsed and clips it.
  await expect.poll(() => input.evaluate(element => element.parentElement!.clientHeight)).toBeGreaterThanOrEqual(96);
  await expect(input).toHaveValue("残しておきたい下書き");
  await input.focus();
  await expect(input).toBeInViewport({ ratio: 0.5 });
  const saved = page.waitForResponse(response => response.url().includes("/api/captions/") && response.request().method() === "PATCH");
  await editor.getByRole("button", { name: "再保存して公開", exact: true }).tap();
  expect((await saved).ok()).toBeTruthy();
  await expect(editor).toContainText("保存して公開しました。");
  await noHorizontalOverflow(page);
});

test("all settings expose their controls and save through the real API", async ({ page, request }) => {
  const initialDictionary = await (await request.get("/api/dictionary")).json();
  await request.put("/api/dictionary", { data: { base_revision: initialDictionary.revision, entries: [] } });
  await connect(page, request);
  const panels = [
    ["字幕入力の接続設定", "字幕入力の接続設定"],
    ["AI設定", "字幕修正のAI設定"],
    ["単語辞書", "単語辞書"],
    ["表示設定", "観客画面の表示設定"],
  ];
  for (const [button, name] of panels) {
    await page.getByRole("button", { name: button, exact: true }).tap();
    const panel = page.getByRole("complementary", { name: new RegExp("^" + name) });
    await expect(panel).toBeVisible();
    for (const summary of await panel.locator("summary").all()) {
      await touchTarget(summary);
      if (!(await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open))) await summary.tap();
    }
    for (const control of await panel.locator("button:visible, select:visible, input:not([type=checkbox]):visible, a:visible").all()) {
      await touchTarget(control);
    }
    await noHorizontalOverflow(page);
    await page.getByRole("button", { name: button, exact: true }).tap();
  }
  await page.getByRole("button", { name: "単語辞書", exact: true }).tap();
  const dictionary = page.getByRole("complementary", { name: /^単語辞書/ });
  await dictionary.getByRole("button", { name: "単語を追加", exact: true }).tap();
  const terms = dictionary.getByRole("textbox", { name: /件目の表記$/ });
  const term = terms.last();
  await touchTarget(term);
  expect(await term.evaluate(element => getComputedStyle(element).fontSize)).toBe("16px");
  await term.fill("字幕用語");
  const enabled = dictionary.getByRole("checkbox").last();
  expect(await enabled.evaluate(element => element.closest("label")!.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  const saved = page.waitForResponse(response => response.url().includes("/api/dictionary") && response.request().method() === "PUT");
  await dictionary.getByRole("button", { name: "辞書を保存", exact: true }).tap();
  expect((await saved).ok()).toBeTruthy();
  const persisted = await (await request.get("/api/dictionary")).json();
  expect(persisted.entries).toEqual(expect.arrayContaining([expect.objectContaining({ term: "字幕用語" })]));
  await noHorizontalOverflow(page);
});

test("audience controls leave the entire subtitle area unobscured and match the preview", async ({ page, request, context }) => {
  const room = await connect(page, request);
  const { display } = await (await request.get("/api/session")).json();
  const applied = await request.put("/api/display", { data: { ...display, padding: 0, font_size: 32, position: "top" } });
  expect(applied.ok()).toBeTruthy();
  for (let index = 0; index < 16; index++) await source(request, `viewer-${index}`, `発言${index}。${longText.slice(0, 90)}`);
  const viewer = await context.newPage();
  await viewer.goto(`/view/demo?room_id=${room.id}`);
  const log = viewer.getByRole("log", { name: "字幕", exact: true });
  await expect(log).toContainText("発言15");
  const fullscreen = viewer.getByRole("button", { name: "全画面", exact: true });
  await touchTarget(fullscreen);
  const captionBounds = await viewer.locator(".caption-display").boundingBox();
  const controlsBounds = await viewer.locator(".audience-controls").boundingBox();
  expect(captionBounds!.y + captionBounds!.height).toBeLessThanOrEqual(controlsBounds!.y + 1);
  await log.evaluate(element => { element.scrollTop = 0; });
  await viewer.getByRole("button", { name: "最新へ", exact: true }).tap();
  await expect(viewer.getByRole("button", { name: "最新へ", exact: true })).toBeHidden();
  await fullscreen.tap();
  await expect(viewer.getByRole("button", { name: "全画面を解除", exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "全画面を解除", exact: true }).tap();
  await viewer.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "表示設定", exact: true }).tap();
  const preview = await page.locator(".display-sample > .caption-display").boundingBox();
  const actual = await viewer.locator(".caption-display").boundingBox();
  expect(preview!.height / preview!.width).toBeCloseTo(actual!.height / actual!.width, 2);
  const actualBackground = await viewer.locator(".audience-screen").evaluate(element => getComputedStyle(element).backgroundColor);
  await expect(page.locator(".display-sample")).toHaveCSS("background-color", actualBackground);
  await noHorizontalOverflow(page);
  await viewer.close();
});
