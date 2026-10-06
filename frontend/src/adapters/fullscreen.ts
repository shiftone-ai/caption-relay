import type { FullscreenAdapter } from "../domain";

export function createFullscreenAdapter(target: () => HTMLElement | null, document: Document): FullscreenAdapter {
  return {
    available: document.fullscreenEnabled === true,
    isActive: () => Boolean(document.fullscreenElement),
    subscribe(emit) {
      const changed = () => emit({ type: "display.fullscreen.changed", active: Boolean(document.fullscreenElement) });
      document.addEventListener("fullscreenchange", changed);
      return () => document.removeEventListener("fullscreenchange", changed);
    },
    async setActive(active) {
      if (active) {
        const element = target();
        if (!element) throw new Error("Fullscreen target is not mounted");
        await element.requestFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    },
  };
}
