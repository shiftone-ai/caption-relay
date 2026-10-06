// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createFullscreenAdapter } from "./fullscreen";

it("requests the bound screen synchronously, observes browser changes and releases the listener", async () => {
  const target = document.createElement("main");
  const request = vi.fn().mockResolvedValue(undefined);
  target.requestFullscreen = request;
  const adapter = createFullscreenAdapter(() => target, document);
  const emit = vi.fn();
  const close = adapter.subscribe(emit);
  const result = adapter.setActive(true);
  expect(request).toHaveBeenCalledTimes(1);
  await result;
  document.dispatchEvent(new Event("fullscreenchange"));
  expect(emit).toHaveBeenLastCalledWith({ type: "display.fullscreen.changed", active: false });
  close();
  document.dispatchEvent(new Event("fullscreenchange"));
  expect(emit).toHaveBeenCalledTimes(1);
});

it("rejects a missing fullscreen target and does not attempt an exit outside fullscreen", async () => {
  const adapter = createFullscreenAdapter(() => null, document);
  await expect(adapter.setActive(true)).rejects.toThrow("not mounted");
  await expect(adapter.setActive(false)).resolves.toBeUndefined();
});
