import { createActor, waitFor } from "xstate";
import { describe, expect, it, vi } from "vitest";
import { desktopSettingsMachine } from "./desktop-settings";
import { presentDesktopSettings } from "../presenters/desktop-settings";
import type { CredentialsApi } from "../desktop";

describe("desktop credentials", () => {
  it("requires confirmation and preserves unchanged keys while applying explicit removal", async () => {
    const save = vi.fn<CredentialsApi["save"]>().mockResolvedValue();
    const actor = createActor(desktopSettingsMachine, { input: { api: {
      status: async () => ({ configured: { OPENAI_API_KEY: true, ANTHROPIC_API_KEY: false, GEMINI_API_KEY: true,
        CAPTION_RELAY_OPENAI_API_KEY: false, CAPTION_RELAY_STT_JPY_PER_USD: true }, stt_rate: "200" }), save,
    } } }).start();
    await waitFor(actor, state => state.matches("ready"));
    expect(presentDesktopSettings(actor.getSnapshot()).fields.find(field => field.key === "CAPTION_RELAY_STT_JPY_PER_USD")?.value).toBe("200");
    expect(presentDesktopSettings(actor.getSnapshot()).saveDisabled).toBe(true);
    actor.send({ type: "desktop.changed", key: "ANTHROPIC_API_KEY", value: "new-test-value" });
    actor.send({ type: "desktop.removal.changed", key: "GEMINI_API_KEY", remove: true });
    actor.send({ type: "desktop.save.requested" });
    expect(presentDesktopSettings(actor.getSnapshot()).confirmation.open).toBe(true);
    expect(save).not.toHaveBeenCalled();
    actor.send({ type: "desktop.save.cancelled" });
    expect(actor.getSnapshot().context.values.ANTHROPIC_API_KEY).toBe("new-test-value");
    actor.send({ type: "desktop.save.requested" });
    actor.send({ type: "desktop.save.confirmed" });
    await waitFor(actor, state => state.matches("restarting"));
    expect(save).toHaveBeenCalledExactlyOnceWith({ ANTHROPIC_API_KEY: "new-test-value", GEMINI_API_KEY: "" });
    actor.stop();
  });
});
