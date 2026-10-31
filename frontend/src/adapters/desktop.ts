import { invoke } from "@tauri-apps/api/core";
import type { CredentialsApi } from "../desktop";
import { OperationError } from "../domain";

function credentialError(error: unknown): never {
  const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message : "APIキーの設定を開けません。アプリを開き直してお試しください。";
  throw new OperationError(message);
}

export const credentialsApi: CredentialsApi = {
  status: () => invoke<Awaited<ReturnType<CredentialsApi["status"]>>>("credential_status").catch(credentialError),
  save: changes => invoke<void>("save_credentials", { changes }).catch(credentialError),
};
