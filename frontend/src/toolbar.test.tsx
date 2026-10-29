// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { viewHierarchy } from "./events/hierarchy";
import type { ToolbarParameters } from "./presenters/operator";
import { ToolbarView } from "./views/operator/toolbar";

afterEach(cleanup);

it("shows publication controls only for local output, including when help was open", async () => {
  const parameters: ToolbarParameters = {
    audienceHref: "/view/demo",
    helpDisclosure: { id: "publication-help", open: true }, preparationDisclosure: { id: "preparation", open: false },
    preparationHint: "", testDisabled: false, toggleDisabled: false, toggleLabel: "字幕を隠す", visibilityIcon: "hide",
    mode: "auto", modeDisabled: false, settingsOpen: false, aiSettingsOpen: false, dictionarySettingsOpen: false,
    dictionarySettingsDisabled: false, aiTitle: "AI設定", connectionSettingsOpen: false, localOutput: true,
  };
  const handle = vi.fn(() => true);
  const toolbar = (overrides: Partial<ToolbarParameters>) => (
    <viewHierarchy.Root handle={handle}><ToolbarView parameters={{ ...parameters, ...overrides }} /></viewHierarchy.Root>
  );
  const { rerender } = render(toolbar({}));
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "新着の公開" }).disabled).toBe(false);
  expect(screen.getByText(/新しく届く確定字幕の公開方法/)).toBeTruthy();

  rerender(toolbar({ localOutput: false, modeDisabled: true }));
  expect(screen.queryByText("新着の公開")).toBeNull();
  expect(screen.queryByRole("combobox", { name: "新着の公開" })).toBeNull();
  expect(screen.queryByLabelText("公開方法の説明")).toBeNull();
  expect(screen.queryByText(/新しく届く確定字幕の公開方法/)).toBeNull();
  expect(screen.getByRole("button", { name: "AI設定" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "字幕入力の接続設定" })).toBeTruthy();

  rerender(toolbar({ modeDisabled: true }));
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "新着の公開" }).disabled).toBe(true);
  rerender(toolbar({}));
  await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "新着の公開" }), "manual");
  expect(handle).toHaveBeenLastCalledWith({ type: "publication.mode.requested", mode: "manual" });
});
