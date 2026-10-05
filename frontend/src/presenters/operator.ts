import type { OperatorSnapshot } from "../machines/operator";

export interface RowParameters {
  id: string;
  original: string;
  text: string;
  saveLabel: string;
  disabled: boolean;
  readOnly: boolean;
  message: string;
}

export interface OperatorParameters {
  disabled: boolean;
  toggleLabel: string;
  message: string;
  rows: RowParameters[];
}

export function presentOperator(snapshot: OperatorSnapshot): OperatorParameters {
  const { context } = snapshot;
  const disabled = !snapshot.matches({ ready: "idle" }) && !snapshot.matches({ ready: "refreshing" });
  return {
    disabled, toggleLabel: context.visible ? "非表示にする" : "表示する",
    message: context.error,
    rows: context.captions.map(caption => {
      const draft = context.drafts.get(caption.id);
      const saving = context.pendingSave?.captionId === caption.id;
      return {
        id: caption.id, original: caption.original, text: draft?.text ?? caption.text,
        saveLabel: saving ? "反映中…" : (draft?.conflict || caption.human_edited ? "再反映" : "反映"),
        disabled, readOnly: saving, message: draft?.conflict ?? "",
      };
    }),
  };
}
