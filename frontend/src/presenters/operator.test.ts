import { defaultAi } from "../ai";
import { createActor, waitFor } from "xstate";
import { afterEach, expect, it, vi } from "vitest";
import { operatorMachine } from "../machines/operator";
import { presentOperator } from "./operator";
import type { Caption, OperatorApi, OperatorEvent, Snapshot } from "../domain";

const caption: Caption = { id: "one", utterance_id: "one", source_revision: 1, original: "原文", text: "字幕", revision: 1, human_edited: false, published: true, publish_eligible: true, source_final: true };
const actors: ReturnType<typeof createActor<typeof operatorMachine>>[] = [];
afterEach(() => { actors.splice(0).forEach(actor => actor.stop()); });

function start() {
  const api: OperatorApi = {
    load: vi.fn().mockResolvedValue({ visible: true, captions: [caption] }),
    save: vi.fn().mockReturnValue(new Promise<Caption>(() => {})),
    setVisible: vi.fn().mockReturnValue(new Promise<boolean>(() => {})),
    setPublicationMode: vi.fn().mockResolvedValue({ auto_publish: true }), setDisplay: vi.fn().mockImplementation(settings => Promise.resolve(settings)),
    setAi: vi.fn().mockImplementation(settings => Promise.resolve({ ...defaultAi, settings })),
    sendTest: vi.fn().mockReturnValue(new Promise<void>(() => {})),
  };
  const actor = createActor(operatorMachine, { input: { api } });
  actors.push(actor);
  return { actor: actor.start(), api };
}

it("disables commands during initial loading and permits them during background loading", async () => {
  const { actor, api } = start();
  expect(presentOperator(actor.getSnapshot()).toolbar).toMatchObject({ testDisabled: true, toggleDisabled: true });
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  vi.mocked(api.load).mockReturnValueOnce(new Promise<Snapshot>(() => {}));
  actor.send({ type: "refresh.requested" });
  const parameters = presentOperator(actor.getSnapshot());
  expect(parameters.toolbar).toMatchObject({ testDisabled: false, toggleDisabled: false });
  expect(parameters.rows[0]).toMatchObject({ disabled: false, readOnly: false });
});

it.each([
  { type: "caption.save.requested", captionId: "one" },
  { type: "visibility.toggle.requested" },
  { type: "test.requested" },
] satisfies OperatorEvent[])("disables commands while $type is in progress", async event => {
  const { actor } = start();
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  actor.send(event);
  const parameters = presentOperator(actor.getSnapshot());
  expect(parameters.toolbar).toMatchObject({ testDisabled: true, toggleDisabled: true });
  expect(parameters.rows[0]).toMatchObject({ disabled: true, readOnly: event.type === "caption.save.requested" });
});

it("allows an empty draft to request validation without making a save request", async () => {
  const { actor, api } = start();
  await waitFor(actor, state => state.matches({ ready: "idle" }));
  actor.send({ type: "caption.draft.changed", captionId: "one", text: "　 " });
  expect(presentOperator(actor.getSnapshot()).rows[0].disabled).toBe(false);
  actor.send({ type: "caption.save.requested", captionId: "one" });
  expect(api.save).not.toHaveBeenCalled();
  expect(presentOperator(actor.getSnapshot()).rows[0]).toMatchObject({ message: "字幕を入力してください。", invalid: true });
});
