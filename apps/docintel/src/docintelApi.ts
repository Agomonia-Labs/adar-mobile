import { AxiosInstance } from 'axios';
import * as FileSystem from 'expo-file-system';

// Client for adar-rag/backend (the DocIntel API) -- a user-shaped
// deployment, distinct from adar-core's team-shaped domains (Front
// Desk/ARCL/Geetabitan). Every call here needs the signed-in user's
// bearer token, already attached by shared-auth's client (see
// AuthContext.tsx -- the session's accessToken is NOT auto-attached by
// createAuthClient since docintel has no X-API-Key concept; callers pass
// it explicitly below, mirroring adar-rag/frontend's axios interceptor).

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Wraps a single axios call with a GUARANTEED timeout, independent of both
 *  axios's own `timeout` config option AND of AbortController actually
 *  succeeding at cancelling anything.
 *
 *  History of this function, because it has been "fixed" twice and still
 *  hung a third time -- each version closed a real gap, but not the whole
 *  gap: (1) originally there was no timeout at all; (2) passing `timeout`
 *  in axios's config (as quickScore already did) turned out unreliable on
 *  this app's RN stack; (3) this was rewritten to arm a real
 *  AbortController and `await run(signal)`, which is correct IF the
 *  underlying request promise actually rejects once `.abort()` is called
 *  -- but that still depends on react-native's XMLHttpRequest polyfill
 *  properly firing its 'abort' event back up through axios's xhr adapter,
 *  and a genuinely stuck/stalled connection (not just a slow one) does not
 *  reliably do that here, so `await run(signal)` could still hang forever
 *  even with the controller aborted right on schedule.
 *
 *  This version uses Promise.race() instead: the timeout promise below is
 *  a plain setTimeout + reject with NO dependency on the network call
 *  itself ever settling, so withTimeout() is now guaranteed to settle on
 *  schedule purely at the JS Promise level, whatever axios/RN's XHR layer
 *  does or doesn't do. `controller.abort()` is still fired as a best-effort
 *  attempt to actually free the underlying connection, but nothing here
 *  waits on it succeeding anymore. (Promise.race() attaches its own
 *  then/catch to every promise it's given, so a slow real request that
 *  eventually rejects after we've already timed out is consumed quietly
 *  by that internal handler -- it does not surface as a separate unhandled
 *  rejection later.)
 *
 *  Any call that gates a screen's loading spinner (scope resolution,
 *  quick-score, feedback) should go through this, so a slow/hung backend
 *  can never leave the UI stuck forever with no error and no way to retry.
 *  On timeout the thrown error carries `code: 'ECONNABORTED'`, matching
 *  what a native axios timeout would have set, so existing callers that
 *  already branch on that code (e.g. AnswerFeedback.tsx's retry prompt)
 *  keep working unchanged. */
async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(); // best-effort -- see comment above for why this alone isn't trusted
      const timeoutErr: any = new Error(timeoutMessage);
      timeoutErr.code = 'ECONNABORTED';
      timeoutErr.isTimeout = true;
      reject(timeoutErr);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

// ── Documents (routes/documents.py, prefix /api/documents) ─────────────────

export interface DocIntelDocument {
  id: string;
  original_name: string;
  file_type: string;
  file_size: number;
  status: string; // uploading | chunking | chunked | embedding | embedded | error | deleted
  chunk_count: number | null;
  error_message: string | null;
  workspace_id: string | null;
  doc_type: string | null;
  doc_domain: string | null;
  doc_language: string | null;
  tags: { id: string; name: string; color: string }[];
  created_at: string;
  updated_at: string;
}

/** GET /api/documents/ (personal docs, workspace_id null) or
 *  GET /api/workspaces/{id}/documents (a workspace's shared docs). */
export async function listDocuments(
  client: AxiosInstance,
  accessToken: string,
  workspaceId?: string
): Promise<DocIntelDocument[]> {
  const path = workspaceId ? `/api/workspaces/${workspaceId}/documents` : '/api/documents/';
  const { data } = await client.get<DocIntelDocument[]>(path, { headers: authHeaders(accessToken) });
  return data;
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string | null;
}

/** POST /api/documents/upload (multipart) -- accepts any document, audio,
 *  or video file; the backend's detect_type() picks the ingestion pipeline
 *  from the extension/content-type. Chunking + embedding happen as a
 *  background job server-side -- poll listDocuments()/getDocument() and
 *  watch `status` go uploading -> chunking -> embedded (or error). */
export async function uploadDocuments(
  client: AxiosInstance,
  accessToken: string,
  files: PickedFile[],
  opts?: { workspaceId?: string; redactPii?: boolean }
): Promise<{ uploaded: { doc_id: string; filename: string }[] }> {
  const form = new FormData();
  for (const f of files) {
    // React Native's FormData accepts this {uri,name,type} shape directly
    // -- see expo-document-picker's docs / RN's Blob polyfill.
    form.append('files', {
      uri: f.uri,
      name: f.name,
      type: f.mimeType || 'application/octet-stream',
    } as unknown as Blob);
  }
  if (opts?.redactPii) form.append('redact_pii', 'true');
  const params = opts?.workspaceId ? { workspace_id: opts.workspaceId } : undefined;
  const { data } = await client.post('/api/documents/upload', form, {
    headers: { ...authHeaders(accessToken), 'Content-Type': 'multipart/form-data' },
    params,
  });
  return data;
}

export async function getDocument(
  client: AxiosInstance,
  accessToken: string,
  docId: string
): Promise<DocIntelDocument> {
  const { data } = await client.get<DocIntelDocument>(`/api/documents/${docId}`, {
    headers: authHeaders(accessToken),
  });
  return data;
}

export async function deleteDocument(client: AxiosInstance, accessToken: string, docId: string): Promise<void> {
  await client.delete(`/api/documents/${docId}`, { headers: authHeaders(accessToken) });
}

/** POST /api/documents/{doc_id}/classify -- runs the 39-type/7-domain
 *  classifier server-side and stores doc_type/doc_domain on the document. */
export async function classifyDocument(
  client: AxiosInstance,
  accessToken: string,
  docId: string
): Promise<DocIntelDocument> {
  const { data } = await client.post<DocIntelDocument>(
    `/api/documents/${docId}/classify`,
    {},
    { headers: authHeaders(accessToken) }
  );
  return data;
}

/** POST /api/documents/{doc_id}/embed -- reads the chunks already written
 *  to GCS by chunking and generates+stores their vectors. The same call
 *  serves both "Embed" (status 'chunked') and "Re-embed" (status
 *  'embedded' -- the backend deletes any existing vectors for the doc
 *  first) exactly as the desktop app's single triggerEmbed() does. */
export async function triggerEmbed(
  client: AxiosInstance,
  accessToken: string,
  docId: string
): Promise<{ message: string; doc_id: string }> {
  const { data } = await client.post(`/api/documents/${docId}/embed`, {}, { headers: authHeaders(accessToken) });
  return data;
}

// ── Chunk viewer (routes/documents.py's /chunks endpoints) ─────────────────
// Mirrors the desktop app's ChunksViewer.jsx: a chunk-index list (word
// counts only, cheap) plus an on-demand fetch of one chunk's full text.
// Only available once a document has been chunked (status chunked/
// embedding/embedded) -- the backend 400s otherwise.

export interface DocumentChunkMeta {
  index: number;
  word_count: number;
  gcs_path?: string;
}

export interface DocumentChunksList {
  document: { filename?: string; file_type?: string; [key: string]: unknown };
  chunks: DocumentChunkMeta[];
}

/** GET /api/documents/{doc_id}/chunks -- chunk index + word counts (not the
 *  full text of every chunk -- that would be a lot of data for a large
 *  document). Call getDocumentChunkContent() per chunk on demand instead. */
export async function getDocumentChunks(
  client: AxiosInstance,
  accessToken: string,
  docId: string
): Promise<DocumentChunksList> {
  const { data } = await client.get(`/api/documents/${docId}/chunks`, { headers: authHeaders(accessToken) });
  return data;
}

/** GET /api/documents/{doc_id}/chunks/{chunk_index} -- one chunk's full
 *  text, optionally PII-redacted server-side (same redact_pii=true query
 *  param the desktop chunk viewer's PII toggle uses). */
export async function getDocumentChunkContent(
  client: AxiosInstance,
  accessToken: string,
  docId: string,
  chunkIndex: number,
  redactPii = false
): Promise<{ chunk_index: number; content: string }> {
  const { data } = await client.get(`/api/documents/${docId}/chunks/${chunkIndex}`, {
    params: redactPii ? { redact_pii: true } : undefined,
    headers: authHeaders(accessToken),
  });
  return data;
}

// ── Tags / classification (routes/tags.py, prefix /api/tags) ───────────────

export interface DocIntelTag {
  id: string;
  name: string;
  color: string;
  doc_count: number;
}

export async function listTags(client: AxiosInstance, accessToken: string): Promise<DocIntelTag[]> {
  const { data } = await client.get<DocIntelTag[]>('/api/tags/', { headers: authHeaders(accessToken) });
  return data;
}

export async function createTag(client: AxiosInstance, accessToken: string, name: string): Promise<DocIntelTag> {
  const { data } = await client.post<DocIntelTag>(
    '/api/tags/',
    { name },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

export async function assignTag(
  client: AxiosInstance,
  accessToken: string,
  documentId: string,
  tagId: string
): Promise<void> {
  await client.post(
    '/api/tags/assign',
    { document_id: documentId, tag_id: tagId },
    { headers: authHeaders(accessToken) }
  );
}

// ── Workspaces (routes/workspaces.py, prefix /api/workspaces) ──────────────
// This IS the mobile app's workspace-isolation UI -- every document,
// course (Academy) and chat query is scoped to "personal" (no
// workspace_id) or to one of these shared workspaces, exactly like the
// web app.

export interface DocIntelWorkspace {
  id: string;
  name: string;
  owner_id: string;
  my_role: 'viewer' | 'editor' | 'owner' | null;
  doc_count: number;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export async function listWorkspaces(client: AxiosInstance, accessToken: string): Promise<DocIntelWorkspace[]> {
  const { data } = await client.get<DocIntelWorkspace[]>('/api/workspaces/', { headers: authHeaders(accessToken) });
  return data;
}

export async function createWorkspace(
  client: AxiosInstance,
  accessToken: string,
  name: string
): Promise<DocIntelWorkspace> {
  const { data } = await client.post<DocIntelWorkspace>(
    '/api/workspaces/',
    { name },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

// Owner-only server-side (routes/workspaces.py's delete_workspace requires
// the "owner" role via _require_role -- a non-owner call 403s even if this
// were somehow reached from the UI). Documents in the workspace are NOT
// deleted; the backend detaches them back to Personal first.
export async function deleteWorkspace(client: AxiosInstance, accessToken: string, workspaceId: string): Promise<void> {
  await client.delete(`/api/workspaces/${workspaceId}`, { headers: authHeaders(accessToken) });
}

// ── Account deletion (App Store Review Guideline 5.1.1(v)) ─────────────────
export interface AccountDeletionImpact {
  owned_shared_workspaces: { id: string; name: string; member_count: number }[];
}

/** What deleting this account destroys for OTHER people -- shown as a
 *  warning before the final confirm. See auth/router.py's
 *  account_deletion_impact for why: owning a shared workspace means
 *  deleting your own account deletes that workspace for every member. */
export async function getAccountDeletionImpact(client: AxiosInstance, accessToken: string): Promise<AccountDeletionImpact> {
  const { data } = await client.get<AccountDeletionImpact>('/api/auth/account/deletion-impact', {
    headers: authHeaders(accessToken),
  });
  return data;
}

/** Self-service account deletion -- re-enter password as the confirm step
 *  (matching how the equivalent web/desktop account-deletion flow across
 *  ADAR apps confirms this, not just a second tap), same as
 *  auth/router.py's delete_own_account expects. A wrong password reject
 *  surfaces via extractDocIntelError like any other API error. */
export async function deleteAccount(client: AxiosInstance, accessToken: string, password: string): Promise<void> {
  await client.delete('/api/auth/account', { data: { password }, headers: authHeaders(accessToken) });
}

// ── SSE streaming (chat / summarize / compare) ──────────────────────────────
// React Native's fetch() doesn't reliably expose a readable stream across
// iOS/Android/Hermes, so -- same trick used by RN chat apps generally --
// we read the SSE response incrementally via XMLHttpRequest's onprogress,
// which RN supports consistently. Every one of these backend routes
// yields `data: {"type": "token"|"done"|"error", ...}\n\n` lines (see
// adar-rag/backend/routes/chat.py, summarize.py, compare.py).

export interface StreamHandlers {
  onToken?: (text: string) => void;
  onDone?: (payload: Record<string, unknown>) => void;
  onError?: (message: string) => void;
}

// A genuinely stalled connection -- the server accepted the request but its
// own multi-stage pipeline (retrieval, re-rank, generation, ...) never
// produces another byte, e.g. because one stage hangs with no timeout of its
// own -- previously left the caller's promise pending forever: none of
// onprogress/onerror/onload ever fires on a connection that just goes quiet.
// This watchdog resets on every byte received and only fires when NOTHING
// has arrived for STALL_TIMEOUT_MS, so a slow-but-actively-streaming answer
// (long summaries, flashcards, etc.) is never cut short -- only a truly dead
// connection is. This is what was behind "Flashcards for entire lesson runs
// forever": Study Tools/AI Tutor generation shares this same streamSse().
const STALL_TIMEOUT_MS = 90000;

function streamSse(
  baseURL: string,
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
  handlers: StreamHandlers
): { cancel: () => void } {
  const xhr = new XMLHttpRequest();
  let lastLength = 0;
  // onprogress fires on whatever chunk boundaries the underlying network
  // layer happens to flush at -- NOT on SSE message boundaries. A `data:
  // {...}\n\n` line (especially the `done` event, which can run several KB
  // for a Study Guide/Key Concepts answer with many source chunks) can
  // arrive split across two separate onprogress deliveries. `buffer` holds
  // whatever text after the last complete '\n' hasn't been processed yet,
  // so a split line is reassembled correctly instead of having its leading
  // fragment fail JSON.parse and get silently dropped, and its trailing
  // fragment skipped outright for not starting with 'data:'. This is the
  // root cause behind "Study Guide generates fine, then spinner runs
  // forever": the done event's line got split, so it was never recognized,
  // the connection then closed normally (200, no more bytes), and nothing
  // was left to ever resolve the caller's promise.
  let buffer = '';
  // Once a 'done'/'error' SSE event has been handled (or the caller cancels),
  // the request is considered finished. Without this, the XHR connection was
  // being left open after the UI already showed the final answer -- the app
  // would display a result but the network request kept "running" in the
  // background until the OS/socket layer eventually noticed the server had
  // closed its end. Setting this and calling xhr.abort() closes the
  // connection the instant we know we're done, and guards onerror/onloadend
  // (which abort() can still trigger) from re-firing a stale callback.
  let settled = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;

  const clearStallTimer = () => {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };
  const armStallTimer = () => {
    clearStallTimer();
    stallTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      handlers.onError?.('This is taking longer than expected and may have stalled -- please try again.');
      xhr.abort();
    }, STALL_TIMEOUT_MS);
  };

  // Parses one complete (already newline-delimited) line. Shared by
  // onprogress (as lines complete) and onloadend (last-resort: in case the
  // very last line reached the buffer but was never newline-terminated
  // because the connection closed right after it, e.g. a server that
  // doesn't end its final SSE write with a trailing blank line).
  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const jsonStr = trimmed.slice(5).trim();
    if (!jsonStr) return;
    try {
      const evt = JSON.parse(jsonStr);
      if (evt.type === 'token') {
        handlers.onToken?.(evt.text ?? '');
      } else if (evt.type === 'done') {
        settled = true;
        clearStallTimer();
        handlers.onDone?.(evt);
        xhr.abort();
      } else if (evt.type === 'error') {
        settled = true;
        clearStallTimer();
        handlers.onError?.(evt.error ?? 'Stream error');
        xhr.abort();
      }
    } catch {
      // Not (yet) valid JSON -- for a genuinely complete line this
      // shouldn't happen; onloadend's last-resort pass below is what
      // catches a truncated/malformed final line instead of hanging.
    }
  };

  xhr.open('POST', `${baseURL}${path}`, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);

  xhr.onprogress = () => {
    if (settled) return;
    armStallTimer(); // fresh bytes just arrived -- the connection is alive, push the deadline out
    buffer += xhr.responseText.slice(lastLength);
    lastLength = xhr.responseText.length;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // keep the possibly-incomplete trailing fragment for the next delivery
    for (const line of lines) {
      processLine(line);
      if (settled) break;
    }
  };
  xhr.onerror = () => {
    if (settled) return;
    settled = true;
    clearStallTimer();
    handlers.onError?.('Network error while streaming');
  };
  xhr.onloadend = () => {
    if (settled) return; // already handled via a 'done'/'error' SSE event, or cancel()
    clearStallTimer();
    if (xhr.status >= 400 && xhr.status !== 0) {
      settled = true;
      try {
        const parsed = JSON.parse(xhr.responseText);
        handlers.onError?.(parsed?.detail || `Request failed (HTTP ${xhr.status})`);
      } catch {
        handlers.onError?.(`Request failed (HTTP ${xhr.status})`);
      }
      return;
    }
    // The connection closed without an HTTP error, but we never recognized
    // a done/error SSE event -- give the buffered trailing fragment one
    // last parse attempt (covers a final line with no trailing newline),
    // then, if that still doesn't resolve anything, surface a clear error
    // instead of leaving the caller's promise pending forever. This is the
    // fallback for the streamed-fine-then-hung-forever bug above -- with
    // proper buffering in onprogress it shouldn't be needed, but a caller
    // should never be left hanging silently just because the server sent
    // something this client didn't recognize.
    if (buffer.trim()) {
      processLine(buffer);
      buffer = '';
    }
    if (!settled) {
      settled = true;
      handlers.onError?.('The response ended unexpectedly -- please try again.');
    }
  };
  armStallTimer(); // arm before send too -- covers a server that never responds at all
  xhr.send(JSON.stringify(body));

  return { cancel: () => { clearStallTimer(); settled = true; xhr.abort(); } };
}

/** POST /api/chat/stream -- document-grounded RAG chat. Requires at least
 *  one already-embedded document id (see DocIntelDocument.status). */
export function streamChat(
  baseURL: string,
  accessToken: string,
  params: {
    question: string;
    documentIds: string[];
    workspaceId?: string;
    history?: { role: string; content: string }[];
    // 'en' | 'es' | 'hi' | 'bn' | 'fr' -- see apps/docintel/src/i18n. Left
    // undefined, the backend auto-detects from the documents' own
    // language (routes/chat.py's ChatRequest.response_language); passed
    // explicitly, it overrides that with the user's chosen app language,
    // so switching languages in Profile changes what language the AI
    // Tutor/Chat/Study Tools answer in, not just the screen's own labels.
    responseLanguage?: string;
  },
  handlers: StreamHandlers
) {
  return streamSse(baseURL, '/api/chat/stream', accessToken, {
    question: params.question,
    document_ids: params.documentIds,
    history: params.history ?? [],
    workspace_id: params.workspaceId,
    response_language: params.responseLanguage,
  }, handlers);
}

export type SummaryType = 'executive' | 'detailed' | 'bullets' | 'sections';

/** POST /api/summarize/document/{doc_id}/stream */
export function streamSummarize(
  baseURL: string,
  accessToken: string,
  docId: string,
  summaryType: SummaryType,
  handlers: StreamHandlers
) {
  return streamSse(baseURL, `/api/summarize/document/${docId}/stream`, accessToken, {
    summary_type: summaryType,
  }, handlers);
}

/** POST /api/compare/stream -- side-by-side AI comparison of two documents. */
export function streamCompare(
  baseURL: string,
  accessToken: string,
  documentId1: string,
  documentId2: string,
  handlers: StreamHandlers
) {
  return streamSse(baseURL, '/api/compare/stream', accessToken, {
    document_id_1: documentId1,
    document_id_2: documentId2,
  }, handlers);
}

// ── Knowledge Academy (routes/learning.py, prefix /api/learning) ───────────
// Phase 1 slice: course list/create (the admin/teacher "configure Academy"
// entry point) and the learner question flow (the core student
// interaction). Curriculum authoring, assignments, artifacts and mastery
// tracking are real backend features not yet wired into a Phase 1 screen
// -- see AcademyScreen.tsx's header comment.

export interface DocIntelCourse {
  id: string;
  title: string;
  course_code: string;
  semester: string;
  description: string;
  instructor_name: string;
  domain: string;
  persona: 'teacher' | 'student' | 'advisor' | 'admin' | null;
  member_count: number;
  asset_count: number;
  workspace_id: string;
}

export async function listCourses(
  client: AxiosInstance,
  accessToken: string,
  workspaceId: string
): Promise<DocIntelCourse[]> {
  const { data } = await client.get<DocIntelCourse[]>('/api/learning/courses', {
    headers: authHeaders(accessToken),
    params: { workspace_id: workspaceId },
  });
  return data;
}

export async function createCourse(
  client: AxiosInstance,
  accessToken: string,
  params: { workspaceId: string; title: string; courseCode: string; semester: string; description: string; instructorName: string; domain: string }
): Promise<DocIntelCourse> {
  const { data } = await client.post<DocIntelCourse>(
    '/api/learning/courses',
    {
      workspace_id: params.workspaceId,
      title: params.title,
      course_code: params.courseCode,
      semester: params.semester,
      description: params.description,
      instructor_name: params.instructorName,
      objectives: [],
      domain: params.domain,
      domain_config: {},
      publication_status: 'draft',
    },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

/** POST /api/learning/courses/{course_id}/questions -- a learner's
 *  question, routed to the course's teacher/advisor (human-in-the-loop,
 *  not an AI answer -- see learning.py's ask_human()). */
export async function askCourseQuestion(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  question: string,
  targetRole: 'teacher' | 'advisor' = 'teacher'
): Promise<{ id: string; question: string; status: string }> {
  const { data } = await client.post(
    `/api/learning/courses/${courseId}/questions`,
    { question, target_role: targetRole, context: {} },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

export function extractDocIntelError(err: unknown, fallback: string): string {
  const anyErr = err as { response?: { data?: { detail?: string } }; message?: string; isTimeout?: boolean };
  return anyErr?.response?.data?.detail || (anyErr?.isTimeout ? anyErr.message : undefined) || fallback;
}

// ── Video (routes/video.py, prefix /api/video) ──────────────────────────────
// Videos get their OWN pipeline, separate from uploadDocuments() above:
// a GCS-signed-URL direct upload (so large files never pass through the
// FastAPI request body), then a background processing job that extracts a
// timeline of segments + representative frames, then embeds the
// transcript/OCR/captions for Q&A. Poll getVideoStatus() while
// processing_status moves through its states; getVideoTimeline() only
// returns data once it's done.

export interface VideoUploadSession {
  doc_id: string;
  upload_url: string;
  gcs_source_path: string;
  expires_in_seconds: number;
  method: string;
  headers: Record<string, string>;
}

/** GET /api/video/documents's per-row shape -- a LEFT JOIN of documents +
 *  video_documents (plus the same progress-from-metadata merge as
 *  getVideoStatus's _with_video_progress), purpose-built for a video list
 *  so the list can show real duration/progress/chunk info per row without
 *  an N+1 getVideoStatus() call per video. Distinct from VideoStatus below
 *  (that one is the single-video detail shape, keyed document_status not
 *  status, and includes fields like checkpoint_summary this list doesn't). */
export interface VideoDocumentSummary {
  id: string;
  original_name: string;
  file_type: string;
  status: string; // generic ingestion status: uploading | uploaded | chunking | chunked | embedding | embedded | error
  chunk_count: number | null;
  error_message: string | null;
  doc_type: string | null;
  doc_domain: string | null;
  workspace_id: string | null;
  video_id: string | null;
  processing_status: string | null; // video-specific: running | ready | error | not_processed | ...
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  frame_count: number | null;
  progress_step: string | null;
  progress_pct: number | null;
  progress_message: string | null;
  progress_updated_at: string | null;
}

/** GET /api/video/documents -- the video-specific list endpoint (mirrors
 *  VideoPanel.jsx's own video list load). Prefer this over the generic
 *  listDocuments()+filter for anywhere that needs to show video progress/
 *  duration/chunk info per row -- listDocuments() only returns the plain
 *  documents table columns, so duration/processing_status/progress were
 *  never there to show no matter how the list UI rendered them. */
export async function listVideoDocuments(
  client: AxiosInstance,
  accessToken: string,
  workspaceId?: string
): Promise<VideoDocumentSummary[]> {
  const { data } = await client.get('/api/video/documents', {
    params: { workspace_id: workspaceId },
    headers: authHeaders(accessToken),
  });
  return data;
}

/** POST /api/video/upload-session -- mints a doc_id + a signed PUT URL.
 *  Nothing is uploaded yet; the caller PUTs the file bytes straight to
 *  GCS at upload_url (see uploadVideoFile below), then calls
 *  completeVideoUpload(). */
export async function createVideoUploadSession(
  client: AxiosInstance,
  accessToken: string,
  params: { filename: string; contentType: string; fileSize: number; workspaceId?: string }
): Promise<VideoUploadSession> {
  const { data } = await client.post<VideoUploadSession>(
    '/api/video/upload-session',
    {
      filename: params.filename,
      content_type: params.contentType,
      file_size: params.fileSize,
      workspace_id: params.workspaceId,
    },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

/** PUT the picked video's bytes directly to GCS at the signed URL from
 *  createVideoUploadSession -- streamed from disk via expo-file-system
 *  (FileSystem.uploadAsync), not loaded into JS memory, since these files
 *  can be hundreds of MB. No auth header needed: the signed URL itself is
 *  the credential. */
export async function uploadVideoFile(
  uploadUrl: string,
  localFileUri: string,
  contentType: string,
  onProgress?: (fractionComplete: number) => void
): Promise<void> {
  const task = FileSystem.createUploadTask(
    uploadUrl,
    localFileUri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': contentType },
    },
    onProgress
      ? (progress) => {
          const total = progress.totalBytesExpectedToSend || 1;
          onProgress(progress.totalBytesSent / total);
        }
      : undefined
  );
  const result = await task.uploadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`Video upload to storage failed (HTTP ${result?.status ?? 'unknown'})`);
  }
}

/** POST /api/video/upload-complete -- registers the now-uploaded video as
 *  a document. Mirrors the web app's VideoPanel.jsx exactly: processing is
 *  ALWAYS a separate explicit step (process_after_upload defaults false
 *  here too, matching frontend/src/services/api.js's hardcoded false) --
 *  the caller uploads first, then the user reviews/adjusts processing
 *  options and taps "Process Video" (processVideoDocument() below) to
 *  actually start the job. */
export async function completeVideoUpload(
  client: AxiosInstance,
  accessToken: string,
  params: {
    docId: string;
    filename: string;
    contentType: string;
    fileSize: number;
    gcsSourcePath: string;
    workspaceId?: string;
    rightsConfirmed: boolean;
    processAfterUpload?: boolean;
  }
): Promise<{ doc_id: string; status: string; job_id: string | null }> {
  const { data } = await client.post(
    '/api/video/upload-complete',
    {
      doc_id: params.docId,
      filename: params.filename,
      content_type: params.contentType,
      file_size: params.fileSize,
      gcs_source_path: params.gcsSourcePath,
      workspace_id: params.workspaceId,
      process_after_upload: params.processAfterUpload ?? false,
      rights_confirmed: params.rightsConfirmed,
    },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

export interface ProcessVideoOptions {
  rightsConfirmed?: boolean;
  maxFrames?: number;
  segmentSeconds?: number;
  embedAfterProcessing?: boolean;
  /** 'auto' | 'en-US' | 'hi-IN' | 'bn-IN' | 'ar-XA' | 'es-ES' -- same set
   *  VideoPanel.jsx's "Transcript language" <select> offers. */
  transcriptLanguage?: string;
}

/** POST /api/video/{doc_id}/process -- the explicit "Process Video" call,
 *  same endpoint and same default option values (max_frames 12,
 *  segment_seconds 60, embed_after_processing true, transcript_language
 *  'auto') as the web app's Process Video form. Idempotent/resumable on
 *  the backend (create_or_reuse_video_job reuses an active job, or
 *  re-queues an errored one from its last checkpoint) -- so calling this
 *  again after a failure IS the retry path, exactly like re-clicking
 *  "Process Video" on desktop; there's no separate retry endpoint. */
export async function processVideoDocument(
  client: AxiosInstance,
  accessToken: string,
  docId: string,
  options: ProcessVideoOptions = {}
): Promise<{ message: string; doc_id: string; job_id: string | null; job_reused: boolean; dispatch_mode: string }> {
  const { data } = await client.post(
    `/api/video/${docId}/process`,
    {
      rights_confirmed: options.rightsConfirmed ?? true,
      source_type: 'upload',
      max_frames: options.maxFrames ?? 12,
      segment_seconds: options.segmentSeconds ?? 60,
      embed_after_processing: options.embedAfterProcessing ?? true,
      transcript_language: options.transcriptLanguage ?? 'auto',
    },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

export interface VideoProcessingJob {
  id: string;
  status: string; // queued | dispatching | running | completed | error | dead_letter | cancelled
  dispatch_mode: string | null;
  dispatch_reference: string | null;
  attempt_count: number;
  error_message: string | null;
  heartbeat_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface VideoCheckpointStage {
  stage: string;
  counts: Record<string, number>;
  attempts: number;
  updated_at: string | null;
}

export interface VideoCheckpointSummary {
  job_id: string;
  stages: VideoCheckpointStage[];
}

/** GET /api/video/{doc_id}/status's real response shape -- routes/video.py
 *  merges documents + video_documents + the latest video_processing_jobs
 *  row + a checkpoint summary into this one object. There is NO top-level
 *  `status` field (a prior version of this client wrongly read one, which
 *  meant the "is this video ready" check was always false). Use
 *  `document_status`/`processing_status` instead, or isVideoReady() below. */
export interface VideoStatus {
  document_id: string;
  doc_id: string;
  document_status: string;
  chunk_count: number | null;
  document_error: string | null;
  processing_status: string; // 'running' | 'ready' | 'error' | 'not_processed' | ...
  duration_seconds: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  audio_codec: string | null;
  bitrate: number | null;
  frame_count: number | null;
  error_message: string | null;
  progress_step: string | null;
  progress_pct: number | null;
  progress_message: string | null;
  progress_updated_at: string | null;
  processing_job: VideoProcessingJob | null;
  checkpoint_summary: VideoCheckpointSummary | null;
  processing_stalled: boolean;
}

/** Same readiness gate as VideoPanel.jsx's isVideoReadyForTimeline(). */
export function isVideoReady(status: VideoStatus | null | undefined): boolean {
  if (!status) return false;
  const ps = (status.processing_status || '').toLowerCase();
  const ds = (status.document_status || '').toLowerCase();
  return ['ready', 'completed', 'complete'].includes(ps) || ['chunked', 'embedded'].includes(ds);
}

/** GET /api/video/{doc_id}/status -- poll every 5s (matching the web
 *  app's interval) while processing_status/document_status is one of
 *  running/processing/queued; `processing_stalled: true` means the
 *  background job's lease expired (worth surfacing a retry prompt). */
export async function getVideoStatus(client: AxiosInstance, accessToken: string, docId: string): Promise<VideoStatus> {
  const { data } = await client.get(`/api/video/${docId}/status`, { headers: authHeaders(accessToken) });
  return data;
}

export interface VideoSegment {
  id: string;
  segment_index: number;
  start_seconds: number;
  end_seconds: number;
  segment_type: string;
  title: string | null;
  summary: string | null;
  transcript: string | null;
}

export interface VideoFrame {
  id: string;
  segment_id: string | null;
  frame_index: number;
  timestamp_seconds: number;
  caption: string | null;
  frame_path?: string | null;
}

/** GET /api/video/{doc_id}/timeline -- only populated once processing
 *  has completed (404s otherwise, per video.py). */
export async function getVideoTimeline(
  client: AxiosInstance,
  accessToken: string,
  docId: string
): Promise<{ video: any; segments: VideoSegment[]; frames: VideoFrame[] }> {
  const { data } = await client.get(`/api/video/${docId}/timeline`, { headers: authHeaders(accessToken) });
  return data;
}

export async function getVideoFrameUrl(
  client: AxiosInstance,
  accessToken: string,
  docId: string,
  frameIndex: number
): Promise<string> {
  const { data } = await client.get(`/api/video/${docId}/frames/${frameIndex}/view-url`, {
    headers: authHeaders(accessToken),
  });
  return data.url;
}

/** POST /api/video/{doc_id}/ask -- NOT a stream (unlike chat/summarize/
 *  compare): the backend buffers the whole answer server-side and returns
 *  it as one JSON object, with per-source timestamps. */
export async function askVideo(
  client: AxiosInstance,
  accessToken: string,
  docId: string,
  question: string
): Promise<{ answer: string; sources: { source: number; start_time: string | null; end_time: string | null; doc_name: string }[] }> {
  const { data } = await client.post(
    `/api/video/${docId}/ask`,
    { question, limit: 8 },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

// ── Voice input (routes/voice.py, prefix /api/voice) ────────────────────────

/** POST /api/voice/transcribe (multipart) -- one-shot: record a clip,
 *  send the whole file, get text back. Not a live/streaming transcription. */
export async function transcribeVoice(
  client: AxiosInstance,
  accessToken: string,
  recording: { uri: string; mimeType: string; name: string },
  language = ''
): Promise<{ text: string }> {
  const form = new FormData();
  form.append('audio', { uri: recording.uri, name: recording.name, type: recording.mimeType } as unknown as Blob);
  if (language) form.append('language', language);
  const { data } = await client.post('/api/voice/transcribe', form, {
    headers: { ...authHeaders(accessToken), 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/** POST /api/voice/speak -- server-side text-to-speech via Google Cloud
 *  TTS, using the SAME voices adar-core's Geetabitan /api/tts and ADAR
 *  Front Desk /api/demo/tts already use -- most importantly
 *  bn-IN-Chirp3-HD-Fenrir, an explicitly male Bangla voice, rather than
 *  whatever generic voice the on-device OS happens to pick for
 *  expo-speech. The backend also strips markdown and inserts real
 *  paragraph/line pauses (see routes/voice.py's _build_speech_ssml) so a
 *  multi-paragraph answer doesn't run together or have stray "asterisk"/
 *  "greater than" noise spoken at formatting marks. Returns base64 MP3 --
 *  play it with expo-av's Audio.Sound via a `data:audio/mpeg;base64,...`
 *  URI, there's no separate file to fetch. `language` is the 2-letter
 *  i18n code (languages.ts's LanguageCode), not the BCP-47 ttsLocale. */
export async function speakText(
  client: AxiosInstance,
  accessToken: string,
  text: string,
  language: string
): Promise<{ audioBase64: string; mimeType: string }> {
  const { data } = await withTimeout(
    (signal) =>
      client.post(
        '/api/voice/speak',
        { text, language },
        { headers: authHeaders(accessToken), timeout: 30000, signal }
      ),
    30000,
    'Generating speech timed out -- please try again.'
  );
  return { audioBase64: data.audio_base64, mimeType: data.mime_type };
}

// ── Knowledge Academy: curriculum / assignments / mastery / instructor
// dashboard (routes/learning.py) ────────────────────────────────────────────
// These extend the Phase-1 course list + ask-a-question slice above with
// the rest of the real, already-shipped LMS backend. `getCourseWorkspace`
// mirrors learning.py's `_course_workspace()` aggregate -- one call returns
// modules/lessons, assets, assignments+submissions, questions and the
// caller's persona/can_manage flag, which is what CourseDetailScreen.tsx
// is built around.

export interface CourseLesson {
  id: string;
  module_id: string;
  title: string;
  description: string;
  position: number;
  objectives: string[];
  competencies: string[];
}

export interface CourseModule {
  id: string;
  title: string;
  description: string;
  position: number;
  lessons: CourseLesson[];
}

export interface RubricCriterion {
  id: string;
  title: string;
  description: string;
  weight: number;
}

export interface DocIntelAssignment {
  id: string;
  course_id: string;
  module_id: string | null;
  lesson_id: string | null;
  module_title?: string | null;
  lesson_title?: string | null;
  title: string;
  description: string;
  assignment_type: 'written' | 'document' | 'presentation' | 'project';
  rubric: RubricCriterion[];
  source_document_ids: string[];
  max_score: number;
  due_at: string | null;
  publication_status: 'draft' | 'published' | 'closed';
  created_at: string;
  updated_at: string;
}

export interface DocIntelSubmission {
  id: string;
  course_id: string;
  assignment_id: string;
  user_id: string;
  email?: string;
  full_name?: string;
  assignment_title?: string;
  max_score?: number;
  submission_text: string;
  document_ids: string[];
  presentation_document_id: string | null;
  status: 'draft' | 'submitted' | 'in_review' | 'revision_requested' | 'approved';
  revision_number: number;
  ai_evaluation: any;
  instructor_feedback: string;
  score: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
  revisions?: any[];
}

/** GET /api/learning/courses/{course_id} -- the full course workspace
 *  (learning.py's _course_workspace): modules/lessons, assets, artifacts,
 *  assignments+submissions, questions, members, my_persona/can_manage. */
export async function getCourseWorkspace(
  client: AxiosInstance,
  accessToken: string,
  courseId: string
): Promise<any> {
  const { data } = await client.get(`/api/learning/courses/${courseId}`, {
    headers: authHeaders(accessToken),
  });
  return data;
}

/** PUT /api/learning/courses/{course_id}/curriculum -- whole-tree replace:
 *  any module/lesson omitted from `modules` is deleted server-side. Pass
 *  back `id` on an existing module/lesson to update it in place, or omit
 *  `id` to create a new one. */
export async function saveCurriculum(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  modules: Array<{
    id?: string;
    title: string;
    description?: string;
    lessons: Array<{ id?: string; title: string; description?: string; objectives?: string[]; competencies?: string[] }>;
  }>
): Promise<any> {
  const { data } = await client.put(
    `/api/learning/courses/${courseId}/curriculum`,
    { modules },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

export async function createAssignment(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  body: {
    title: string;
    description?: string;
    assignmentType?: DocIntelAssignment['assignment_type'];
    moduleId?: string | null;
    lessonId?: string | null;
    rubric?: RubricCriterion[];
    sourceDocumentIds?: string[];
    maxScore?: number;
    dueAt?: string | null;
    publicationStatus?: DocIntelAssignment['publication_status'];
  }
): Promise<DocIntelAssignment> {
  const { data } = await client.post(
    `/api/learning/courses/${courseId}/assignments`,
    {
      title: body.title,
      description: body.description || '',
      assignment_type: body.assignmentType || 'written',
      module_id: body.moduleId || null,
      lesson_id: body.lessonId || null,
      rubric: body.rubric || [],
      source_document_ids: body.sourceDocumentIds || [],
      max_score: body.maxScore ?? 100,
      due_at: body.dueAt || null,
      publication_status: body.publicationStatus || 'draft',
    },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

export async function updateAssignment(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  assignmentId: string,
  patch: Partial<{
    title: string; description: string; assignment_type: string; rubric: RubricCriterion[];
    source_document_ids: string[]; max_score: number; due_at: string | null; publication_status: string;
  }>
): Promise<DocIntelAssignment> {
  const { data } = await client.patch(
    `/api/learning/courses/${courseId}/assignments/${assignmentId}`,
    patch,
    { headers: authHeaders(accessToken) }
  );
  return data;
}

export async function deleteAssignment(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  assignmentId: string
): Promise<void> {
  await client.delete(`/api/learning/courses/${courseId}/assignments/${assignmentId}`, {
    headers: authHeaders(accessToken),
  });
}

/** PUT /api/learning/courses/{course_id}/assignments/{assignment_id}/submission
 *  -- a learner's own submission (draft when submit:false, locked for
 *  instructor review once submit:true). */
export async function saveAssignmentSubmission(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  assignmentId: string,
  body: { submissionText?: string; documentIds?: string[]; presentationDocumentId?: string | null; submit: boolean }
): Promise<DocIntelSubmission> {
  const { data } = await client.put(
    `/api/learning/courses/${courseId}/assignments/${assignmentId}/submission`,
    {
      submission_text: body.submissionText || '',
      document_ids: body.documentIds || [],
      presentation_document_id: body.presentationDocumentId || null,
      submit: body.submit,
    },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

/** POST .../submissions/{submission_id}/evaluate -- runs the AI first-pass
 *  rubric evaluation against the submission's evidence; moves it to
 *  in_review. Instructor-only (course manage access). */
export async function evaluateAssignmentSubmission(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  assignmentId: string,
  submissionId: string
): Promise<DocIntelSubmission> {
  const { data } = await client.post(
    `/api/learning/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}/evaluate`,
    {},
    { headers: authHeaders(accessToken) }
  );
  return data;
}

export async function reviewAssignmentSubmission(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  assignmentId: string,
  submissionId: string,
  body: { status: 'in_review' | 'revision_requested' | 'approved'; instructorFeedback?: string; score?: number | null }
): Promise<DocIntelSubmission> {
  const { data } = await client.patch(
    `/api/learning/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}/review`,
    { status: body.status, instructor_feedback: body.instructorFeedback || '', score: body.score ?? null },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

/** GET /api/learning/courses/{course_id}/mastery -- self by default;
 *  pass learnerId to review another learner (requires can_manage/advisor). */
export async function getCourseMastery(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  learnerId?: string
): Promise<any> {
  const { data } = await client.get(`/api/learning/courses/${courseId}/mastery`, {
    headers: authHeaders(accessToken),
    params: learnerId ? { learner_id: learnerId } : undefined,
  });
  return data;
}

export async function updateLessonProgress(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  lessonId: string,
  body: { status: 'not_started' | 'in_progress' | 'completed'; progressPct?: number; timeSpentSeconds?: number; lastPositionSeconds?: number | null }
): Promise<any> {
  const { data } = await client.put(
    `/api/learning/courses/${courseId}/lessons/${lessonId}/progress`,
    {
      status: body.status, progress_pct: body.progressPct ?? (body.status === 'completed' ? 100 : 0),
      time_spent_seconds: body.timeSpentSeconds ?? 0, last_position_seconds: body.lastPositionSeconds ?? null,
    },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

/** GET /api/learning/courses/{course_id}/instructor-dashboard -- cohort
 *  progress/risk/content-gap rollup. Requires manage access. */
export async function getInstructorDashboard(
  client: AxiosInstance,
  accessToken: string,
  courseId: string
): Promise<any> {
  const { data } = await client.get(`/api/learning/courses/${courseId}/instructor-dashboard`, {
    headers: authHeaders(accessToken),
  });
  return data;
}

export async function answerCourseQuestion(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  questionId: string,
  body: { answer?: string; status?: 'open' | 'answered' | 'closed' }
): Promise<any> {
  const { data } = await client.patch(
    `/api/learning/courses/${courseId}/questions/${questionId}`,
    body,
    { headers: authHeaders(accessToken) }
  );
  return data;
}

// ── Viewing original files (routes/documents.py's /view-url,
// routes/video.py's own /view-url for frames) ──────────────────────────────

/** GET /api/documents/{doc_id}/view-url -- a time-limited signed GCS URL
 *  to the ORIGINAL uploaded file (PDF, Office doc, image, audio, or
 *  video), independent of chunking/embedding status. DocumentViewerScreen
 *  renders it inline based on file_type. */
export async function getDocumentViewUrl(
  client: AxiosInstance,
  accessToken: string,
  docId: string
): Promise<{ url: string; expires_in_seconds: number }> {
  // Now exercised much more heavily -- every student tapping a Course
  // Content card, not just the main Documents tab -- so it gets the same
  // withTimeout() guarantee as resolveLearningScope/quickScore/
  // submitFeedback rather than waiting to be reported stuck too.
  const { data } = await withTimeout(
    (signal) =>
      client.get(`/api/documents/${docId}/view-url`, {
        headers: authHeaders(accessToken),
        timeout: 20000,
        signal,
      }),
    20000,
    'Opening this file timed out -- please try again.'
  );
  return data;
}


// ── Feedback + inline eval scoring (routes/feedback.py, routes/evals.py) ────
// Same backend the web app's ChatTab uses for its thumbs up/down and eval
// badges under chat/summarize/compare answers -- these are general-purpose
// endpoints (not DocIntel-specific), so the mobile app calls them directly.

export interface QuickScoreResult {
  score: number | null;
  verdict: string;
  reasoning: string;
  passed: boolean;
}

export type EvalType = 'relevance' | 'specificity' | 'confidence' | 'coherence';

/** POST /api/evals/quick-score -- self-contained inline scoring (no
 *  reference answer needed): scores an already-generated answer against
 *  the question that produced it. Used to show the small relevance/
 *  specificity/confidence badges under chat/summarize/compare answers. */
export async function quickScore(
  client: AxiosInstance,
  accessToken: string,
  question: string,
  answer: string,
  evalTypes: EvalType[] = ['relevance', 'specificity', 'confidence']
): Promise<Record<string, QuickScoreResult>> {
  const { data } = await withTimeout(
    (signal) =>
      client.post(
        '/api/evals/quick-score',
        { question, answer, eval_types: evalTypes },
        {
          headers: authHeaders(accessToken),
          // The backend caps each individual Gemini judge call at 30s and runs
          // them concurrently (services/evaluator.py's httpx client + evals.py's
          // asyncio.gather), so the true worst case here is ~30-35s. `timeout`
          // is kept as a first line of defense; withTimeout()'s AbortController
          // above is the actual guarantee -- see its comment for why.
          timeout: 45000,
          signal,
        }
      ),
    45000,
    'Scoring timed out -- please try again.'
  );
  return data.scores;
}

/** POST /api/feedback/ -- thumbs up (1) / thumbs down (-1) on a single
 *  answer. `messageId` just needs to be stable and unique per answer on
 *  the device (the backend upserts one rating per message_id per user);
 *  `sessionId` is optional -- the mobile app doesn't keep server-side
 *  chat sessions the way the web app does, so it's omitted here and
 *  feedback state lives only in the screen's own state for now (it won't
 *  survive an app restart, unlike the web app's session reload). */
export async function submitFeedback(
  client: AxiosInstance,
  accessToken: string,
  params: { messageId: string; rating: 1 | -1; question?: string; answer?: string; sessionId?: string }
): Promise<void> {
  await withTimeout(
    (signal) =>
      client.post(
        '/api/feedback/',
        {
          message_id: params.messageId,
          rating: params.rating,
          question: params.question,
          answer: params.answer,
          session_id: params.sessionId,
        },
        { headers: authHeaders(accessToken), timeout: 30000, signal }
      ),
    30000,
    'Submitting feedback timed out -- please try again.'
  );
}

// ── Knowledge Academy: learning scope, AI Tutor, Study Tools, Calendar,
// Course Content (routes/learning.py) ───────────────────────────────────────
// getCourseWorkspace() already returns calendar_items, assets, artifacts,
// quiz_attempts and questions as part of its one aggregate call -- these
// functions are the CUD/action endpoints that mutate that data (the tabs
// below re-call getCourseWorkspace's refresh() after each one, same
// pattern as CurriculumTab/AssignmentsTab already use).

export interface LearningScope {
  course_id: string;
  workspace_id: string;
  module_id: string | null;
  lesson_id: string | null;
  scope_type: 'course' | 'module' | 'lesson';
  label: string;
  instruction: string;
  document_ids: string[];
  evidence_ranges: { document_id: string; ranges: { start_seconds: number; end_seconds: number }[] }[];
}

/** GET /api/learning/courses/{course_id}/scope -- resolves which embedded
 *  documents + grounding instruction apply to a course (or a module/lesson
 *  within it). The AI Tutor sends `instruction` + these document_ids into
 *  the same /api/chat/stream the main Chat tab uses -- Knowledge Academy's
 *  "AI Tutor" isn't a separate AI, it's the same RAG chat, scoped and
 *  given a course-aware system instruction. */
export async function resolveLearningScope(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  moduleId?: string | null,
  lessonId?: string | null
): Promise<LearningScope> {
  const { data } = await withTimeout(
    (signal) =>
      client.get(`/api/learning/courses/${courseId}/scope`, {
        params: { module_id: moduleId || undefined, lesson_id: lessonId || undefined },
        headers: authHeaders(accessToken),
        timeout: 30000,
        signal,
      }),
    30000,
    'Loading this scope timed out -- please try again.'
  );
  return data;
}

export type ArtifactType = 'summary' | 'study_guide' | 'key_concepts' | 'flashcards' | 'practice_questions';

export interface LearningArtifact {
  id: string;
  artifact_type: ArtifactType;
  title: string;
  content: string; // markdown for summary/study_guide/key_concepts; JSON string for flashcards/practice_questions
  source_document_ids: string[];
  module_id: string | null;
  lesson_id: string | null;
  created_at: string;
}

/** POST /api/learning/courses/{course_id}/artifacts -- saves AI-generated
 *  study material (Study Tools). The content itself is generated
 *  client-side via streamChat with a study-tool-specific prompt (same
 *  trick as the AI Tutor -- see StudyToolsScreen.tsx), then persisted
 *  here so it survives leaving the screen. */
export async function saveArtifact(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  body: { artifact_type: ArtifactType; title: string; content: string; source_document_ids: string[]; module_id?: string | null; lesson_id?: string | null }
): Promise<LearningArtifact> {
  const { data } = await client.post(`/api/learning/courses/${courseId}/artifacts`, body, {
    headers: authHeaders(accessToken),
  });
  return data;
}

export async function deleteArtifact(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  artifactId: string
): Promise<void> {
  await client.delete(`/api/learning/courses/${courseId}/artifacts/${artifactId}`, {
    headers: authHeaders(accessToken),
  });
}

export interface QuizAttemptResult {
  id: string;
  answers: Record<string, string[]>;
  result: Record<string, { correct: boolean; correct_options: string[] }>;
  correct_count: number;
  question_count: number;
  completed: boolean;
}

/** POST /api/learning/courses/{course_id}/artifacts/{artifact_id}/attempts
 *  -- grades a practice-question artifact against the student's picked
 *  options; `replace: true` restarts the attempt instead of merging. */
export async function submitQuizAttempt(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  artifactId: string,
  answers: Record<string, string[]>,
  replace = false
): Promise<QuizAttemptResult> {
  const { data } = await client.post(
    `/api/learning/courses/${courseId}/artifacts/${artifactId}/attempts`,
    { answers, replace },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

export interface CourseCalendarItem {
  id: string;
  item_type: 'announcement' | 'deadline';
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
}

export async function createCourseCalendarItem(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  body: { item_type: 'announcement' | 'deadline'; title: string; description?: string; starts_at: string; ends_at?: string | null; all_day?: boolean }
): Promise<CourseCalendarItem> {
  const { data } = await client.post(`/api/learning/courses/${courseId}/calendar`, body, {
    headers: authHeaders(accessToken),
  });
  return data;
}

export async function deleteCourseCalendarItem(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  itemId: string
): Promise<void> {
  await client.delete(`/api/learning/courses/${courseId}/calendar/${itemId}`, {
    headers: authHeaders(accessToken),
  });
}

/** POST /api/learning/courses/{course_id}/assets -- maps an already-
 *  uploaded/embedded document (or video, or a specific time range within
 *  one) into a course's Course Content, optionally scoped to one module or
 *  lesson. This is what makes a document eligible for the AI Tutor and
 *  Study Tools to draw on. */
export async function addCourseAsset(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  body: { document_id: string; module_id?: string | null; lesson_id?: string | null; title?: string }
): Promise<any> {
  const { data } = await client.post(`/api/learning/courses/${courseId}/assets`, body, {
    headers: authHeaders(accessToken),
  });
  return data;
}

export async function removeCourseAsset(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  assetId: string
): Promise<void> {
  await client.delete(`/api/learning/courses/${courseId}/assets/${assetId}`, {
    headers: authHeaders(accessToken),
  });
}

/** PATCH /api/learning/courses/{course_id}/calendar/{item_id} -- edit an
 *  existing course-calendar entry (announcement or deadline). Only entries
 *  with `editable: true` (course_calendar-sourced, not assignment-derived
 *  due dates) can be changed this way. */
export async function updateCourseCalendarItem(
  client: AxiosInstance,
  accessToken: string,
  courseId: string,
  itemId: string,
  body: { item_type?: 'announcement' | 'deadline'; title?: string; description?: string; starts_at?: string; ends_at?: string | null; all_day?: boolean }
): Promise<CourseCalendarItem> {
  const { data } = await client.patch(`/api/learning/courses/${courseId}/calendar/${itemId}`, body, {
    headers: authHeaders(accessToken),
  });
  return data;
}

export interface LearningDocument {
  id: string;
  original_name: string;
  file_type: string;
  doc_type: string;
  doc_domain: string;
  status: string;
  chunk_count: number;
  created_at: string;
}

/** GET /api/learning/documents?workspace_id=... -- every processed file in
 *  the course's workspace, for the Course Content tab's "attach" picker
 *  (regardless of whether it's already mapped into the course as an
 *  asset). */
export async function listLearningDocuments(
  client: AxiosInstance,
  accessToken: string,
  workspaceId: string
): Promise<LearningDocument[]> {
  const { data } = await client.get(`/api/learning/documents`, {
    params: { workspace_id: workspaceId },
    headers: authHeaders(accessToken),
  });
  return data;
}

// ── Conversation Assistant (routes/telephony.py's in-app conversation
// session flow) ──────────────────────────────────────────────────────────
// Mirrors adar-rag/frontend/src/components/ConversationPanel.jsx: a live,
// turn-by-turn voice conversation with an AI assistant, backed by the same
// telephony_calls/conversation_turns tables real phone-call transcripts
// use. A finished conversation's transcript becomes the underlying
// document's text (see approveConversationTranscript); a separate combined
// audio recording (participant + synthesized assistant replies, stitched
// in order) is built server-side once the session is finalized and served
// via getConversationRecordingUrl -- there's no equivalent of that second
// part in ConversationPanel.jsx today, since desktop's own review view
// never plays audio back at all.

export interface ConversationTurn {
  id: string;
  call_id: string;
  sequence: number;
  role: 'user' | 'assistant';
  speaker: string;
  transcript: string;
  audio_gcs_path: string | null;
  collected_fields: Record<string, unknown>;
  citations: { doc_name?: string; source?: string; start_time?: number; end_time?: number }[];
  created_at: string;
}

export interface TelephonyCall {
  id: string;
  document_id: string;
  external_call_id: string;
  language_code: string;
  consent_status: 'unknown' | 'confirmed' | 'declined';
  processing_status: 'awaiting_consent' | 'active' | 'received' | 'in_review' | 'completed' | 'error';
  processing_step: string;
  progress_pct: number;
  review_status: 'draft' | 'in_review' | 'approved' | 'withdrawn';
  session_state: {
    missing_required_fields?: string[];
    ready_to_finish?: boolean;
    awaiting_save_confirmation?: boolean;
    [key: string]: unknown;
  };
  summary: { overview?: string; key_points?: string[] };
  duration_seconds: number | null;
  error_message: string | null;
  recording_gcs_uri: string | null;
  created_at: string;
  updated_at: string;
  turns?: ConversationTurn[];
  segments?: { id: string; speaker: string; start_seconds: number; end_seconds: number; transcript: string }[];
}

/** GET /api/telephony/calls -- past conversations (and any real phone-call
 *  transcripts, though the mobile app only ever creates in-app ones). */
export async function listTelephonyCalls(
  client: AxiosInstance,
  accessToken: string,
  workspaceId?: string | null
): Promise<TelephonyCall[]> {
  const { data } = await client.get('/api/telephony/calls', {
    params: workspaceId ? { workspace_id: workspaceId } : undefined,
    headers: authHeaders(accessToken),
  });
  return data;
}

export async function getTelephonyCall(client: AxiosInstance, accessToken: string, callId: string): Promise<TelephonyCall> {
  const { data } = await client.get(`/api/telephony/calls/${callId}`, { headers: authHeaders(accessToken) });
  return data;
}

export async function retryTelephonyCall(client: AxiosInstance, accessToken: string, callId: string): Promise<void> {
  await client.post(`/api/telephony/calls/${callId}/retry`, null, { headers: authHeaders(accessToken) });
}

export async function deleteTelephonyCall(client: AxiosInstance, accessToken: string, callId: string): Promise<void> {
  await client.delete(`/api/telephony/calls/${callId}`, { headers: authHeaders(accessToken) });
}

/** GET /api/telephony/calls/{call_id}/recording-url -- signed URL for the
 *  combined recording the backend stitches together in the background once
 *  finalizeConversationSession() is called. `url` is null until that
 *  background step finishes (or if it found nothing to concatenate) --
 *  treat that as "not ready yet", not an error, and poll again later. */
export async function getConversationRecordingUrl(
  client: AxiosInstance,
  accessToken: string,
  callId: string
): Promise<{ url: string | null; expires_in_seconds?: number }> {
  const { data } = await client.get(`/api/telephony/calls/${callId}/recording-url`, { headers: authHeaders(accessToken) });
  return data;
}

/** POST /api/telephony/conversation/sessions -- creates the call/document
 *  pair and returns awaiting_consent; the caller must still confirm
 *  consent (setConversationConsent) before any turn can be recorded. */
export async function startConversationSession(
  client: AxiosInstance,
  accessToken: string,
  body: { workspace_id?: string | null; template_id?: string; language_code: string; title?: string; redact_pii?: boolean }
): Promise<{ session_id: string; document_id: string; status: string; template: Record<string, unknown> }> {
  const { data } = await client.post('/api/telephony/conversation/sessions', body, { headers: authHeaders(accessToken) });
  return data;
}

export async function setConversationConsent(
  client: AxiosInstance,
  accessToken: string,
  sessionId: string,
  confirmed: boolean
): Promise<{ session_id: string; consent_status: string; greeting: string }> {
  const { data } = await client.post(
    `/api/telephony/conversation/sessions/${sessionId}/consent`,
    { confirmed },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

/** POST /api/telephony/conversation/sessions/{id}/turns -- submit one turn
 *  (a recorded audio clip, a typed fallback, or both) and get the AI
 *  assistant's text reply back. Mirrors VoiceRecorderButton's/
 *  transcribeVoice's multipart pattern for the audio part; unlike that
 *  endpoint, transcription here happens server-side as part of this same
 *  call (routes/telephony.py transcribes before generating the reply), so
 *  there's nothing extra to call first. */
export async function addConversationTurn(
  client: AxiosInstance,
  accessToken: string,
  sessionId: string,
  turn: { transcript?: string; audio?: { uri: string; mimeType: string; name: string } }
): Promise<{
  session_id: string;
  user_transcript: string;
  assistant: {
    response: string;
    collected_fields: Record<string, unknown>;
    citations: unknown[];
    missing_required_fields: string[];
    ready_to_finish: boolean;
    awaiting_save_confirmation: boolean;
    save_conversation: boolean;
    answered_from_knowledgebase: boolean;
  };
}> {
  const form = new FormData();
  form.append('transcript', turn.transcript || '');
  if (turn.audio) {
    form.append('audio', { uri: turn.audio.uri, name: turn.audio.name, type: turn.audio.mimeType } as unknown as Blob);
  }
  const { data } = await withTimeout(
    (signal) =>
      client.post(`/api/telephony/conversation/sessions/${sessionId}/turns`, form, {
        headers: { ...authHeaders(accessToken), 'Content-Type': 'multipart/form-data' },
        timeout: 45000,
        signal,
      }),
    45000,
    'That turn is taking too long to process -- please try again.'
  );
  return data;
}

export async function finalizeConversationSession(
  client: AxiosInstance,
  accessToken: string,
  sessionId: string
): Promise<{ session_id: string; document_id: string; status: string }> {
  const { data } = await client.post(`/api/telephony/conversation/sessions/${sessionId}/finalize`, null, {
    headers: authHeaders(accessToken),
  });
  return data;
}

export async function approveConversationTranscript(
  client: AxiosInstance,
  accessToken: string,
  sessionId: string,
  transcript: string
): Promise<{ session_id: string; document_id: string; review_status: string; status: string }> {
  const { data } = await client.post(
    `/api/telephony/conversation/sessions/${sessionId}/approve-transcript`,
    { transcript },
    { headers: authHeaders(accessToken) }
  );
  return data;
}
