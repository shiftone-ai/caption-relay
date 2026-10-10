import type { ConnectionStatus } from "./domain";

export const defaultConnection: ConnectionStatus = {
  mode: "host", state: "waiting", message: "UDトークからの字幕を待っています。", receiver_path: null,
  received_events: 0, editor_configured: false, client_verified: false, editable_caption_ids: [],
  zoom_text_format: "plain",
};
