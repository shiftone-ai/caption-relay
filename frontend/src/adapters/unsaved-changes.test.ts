// @vitest-environment jsdom
import { expect, it } from "vitest";
import { protectUnsavedChanges } from "./unsaved-changes";

it("requests the browser confirmation while edits are unsaved and removes it on cleanup", () => {
  const release = protectUnsavedChanges(window);
  const unsavedReload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unsavedReload);
  expect(unsavedReload.defaultPrevented).toBe(true);

  release();
  const savedReload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(savedReload);
  expect(savedReload.defaultPrevented).toBe(false);
});
