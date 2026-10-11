import { createActor, waitFor } from "xstate";
import { afterEach, expect, it, vi } from "vitest";
import { defaultAi } from "../ai";
import type { Caption, OperatorApi } from "../domain";
import { operatorMachine } from "../machines/operator";
import { presentOperator } from "./operator";

const caption: Caption = { id: "one", utterance_id: "one", received_at: "2026-10-06T01:02:03Z", source_revision: 1, original: "原文", text: "字幕", revision: 1, human_edited: false, published: true, publish_eligible: true, source_final: true, ai_status: "off" };
const actors: ReturnType<typeof createActor<typeof operatorMachine>>[] = [];
afterEach(() => { actors.splice(0).forEach(actor => actor.stop()); });

async function start(captions: Caption[]) {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions }),
    save: vi.fn().mockReturnValue(new Promise<Caption>(() => {})),
    setVisible: vi.fn(), sendTest: vi.fn(), setPublicationMode: vi.fn(), setDisplay: vi.fn(),
    setConnection: vi.fn(), setDictionary: vi.fn(), setAi: vi.fn().mockImplementation(settings => Promise.resolve({ ...defaultAi, settings })),
  };
  const actor = createActor(operatorMachine, { input: { api } }).start();
  actors.push(actor);
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  return actor;
}

it("grows caption lookups linearly when the history doubles", async () => {
  const reads: number[] = [];
  for (const count of [150, 300]) {
    let idReads = 0;
    const captions = Array.from({ length: count }, (_, index) => ({ ...caption,
      get id() { idReads++; return String(index); }, utterance_id: String(index),
    }));
    const actor = await start(captions);
    idReads = 0;
    expect(presentOperator(actor.getSnapshot()).rows).toHaveLength(count);
    reads.push(idReads);
  }
  // Count data accesses instead of depending on the machine's clock or CI speed.
  expect(reads[1]).toBeLessThan(reads[0] * 2.5);
});

it("reuses unaffected rows through typing and scrolling but refreshes operation permissions", async () => {
  const actor = await start([caption, { ...caption, id: "two", utterance_id: "two", text: "次の字幕" }]);
  const initial = presentOperator(actor.getSnapshot());
  actor.send({ type: "caption.edit.requested", captionId: "one" });
  const selected = presentOperator(actor.getSnapshot());
  expect(selected.rows[1]).toBe(initial.rows[1]);
  actor.send({ type: "caption.draft.changed", captionId: "one", text: "訂正中" });
  const typed = presentOperator(actor.getSnapshot());
  expect(typed.rows[0]).not.toBe(selected.rows[0]);
  expect(typed.rows[0].draftText).toBe("訂正中");
  expect(typed.rows[1]).toBe(selected.rows[1]);
  actor.send({ type: "timeline.scrolled", scrollHeight: 1000, clientHeight: 400, scrollTop: 100 });
  const scrolled = presentOperator(actor.getSnapshot());
  expect(scrolled.rows[0]).toBe(typed.rows[0]);
  expect(scrolled.rows[1]).toBe(typed.rows[1]);
  actor.send({ type: "disclosure.toggled", id: "caption-saved:one" });
  const disclosed = presentOperator(actor.getSnapshot());
  expect(disclosed.rows[0]).not.toBe(scrolled.rows[0]);
  expect(disclosed.rows[0].savedDisclosure.open).toBe(true);
  expect(disclosed.rows[1]).toBe(scrolled.rows[1]);
  actor.send({ type: "caption.save.requested", captionId: "one" });
  const saving = presentOperator(actor.getSnapshot());
  expect(saving.rows[0]).toMatchObject({ readOnly: true, disabled: true, saveLabel: "保存中…" });
  expect(saving.rows[1]).not.toBe(scrolled.rows[1]);
  expect(saving.rows[1]).toMatchObject({ readOnly: false, disabled: true });
});
