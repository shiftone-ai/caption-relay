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

export interface ToolbarParameters {
  testDisabled: boolean;
  toggleDisabled: boolean;
  toggleLabel: string;
}

export interface OperatorParameters {
  toolbar: ToolbarParameters;
  message: string;
  rows: RowParameters[];
}

export function presentOperator(snapshot: OperatorSnapshot): OperatorParameters {
  const { context } = snapshot;
  return {
    toolbar: {
      testDisabled: !snapshot.can({ type: "test.requested" }),
      toggleDisabled: !snapshot.can({ type: "visibility.toggle.requested" }),
      toggleLabel: context.visible ? "非表示にする" : "表示する",
    },
    message: context.error,
    rows: context.captions.map(caption => {
      const draft = context.drafts.get(caption.id);
      const saving = context.pendingSave?.captionId === caption.id;
      return {
        id: caption.id, original: caption.original, text: draft?.text ?? caption.text,
        saveLabel: saving ? "反映中…" : (draft?.conflict || caption.human_edited ? "再反映" : "反映"),
        disabled: !snapshot.can({ type: "caption.save.requested", captionId: caption.id }),
        readOnly: !snapshot.can({ type: "caption.draft.changed", captionId: caption.id, text: draft?.text ?? caption.text }),
        message: draft?.conflict ?? "",
      };
    }),
  };
}
