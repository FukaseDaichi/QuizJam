import type { QuestionSet, QuestionSetSummary } from "../../shared/types";
import type { QuestionSetInput } from "../../shared/validateQuestionSet";

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(`${status} ${code}`); }
}

async function call<T>(path: string, init: RequestInit = {}, passphrase?: string): Promise<T> {
  const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
  if (init.body) headers["Content-Type"] = "application/json";
  if (passphrase) headers["Authorization"] = `Bearer ${passphrase}`;
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let code = "error";
    try { code = ((await res.json()) as { error?: string }).error ?? code; } catch { /* ignore */ }
    throw new ApiError(res.status, code);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  createRoom: () => call<{ roomCode: string; gmToken: string }>("/api/rooms", { method: "POST" }),
  roomExists: (code: string) =>
    call(`/api/rooms/${encodeURIComponent(code)}`).then(
      () => true,
      (e) => { if (e instanceof ApiError && e.status === 404) return false; throw e; },
    ),
  join: (code: string, nickname: string) =>
    call<{ participantId: string; participantToken: string; roomCode: string }>(
      `/api/rooms/${encodeURIComponent(code)}/join`,
      { method: "POST", body: JSON.stringify({ nickname }) },
    ),
  listQuestionSets: () => call<QuestionSetSummary[]>("/api/question-sets"),
  getQuestionSet: (id: string) => call<QuestionSet>(`/api/question-sets/${id}`),
  createQuestionSet: (input: QuestionSetInput, passphrase: string) =>
    call<QuestionSet>("/api/question-sets", { method: "POST", body: JSON.stringify(input) }, passphrase),
  updateQuestionSet: (id: string, input: QuestionSetInput, passphrase: string) =>
    call<QuestionSet>(`/api/question-sets/${id}`, { method: "PUT", body: JSON.stringify(input) }, passphrase),
  deleteQuestionSet: (id: string, passphrase: string) =>
    call<void>(`/api/question-sets/${id}`, { method: "DELETE" }, passphrase),
  uploadImage: async (blob: Blob, passphrase: string) => {
    const res = await fetch("/api/images", {
      method: "POST",
      headers: { "Content-Type": blob.type, Authorization: `Bearer ${passphrase}` },
      body: blob,
    });
    if (!res.ok) {
      let code = "error";
      try { code = ((await res.json()) as { error?: string }).error ?? code; } catch { /* ignore */ }
      throw new ApiError(res.status, code);
    }
    return (await res.json()) as { key: string; url: string };
  },
  verifyPassphrase: (passphrase: string) =>
    call("/api/admin/verify", { method: "POST" }, passphrase).then(() => true, () => false),
};
