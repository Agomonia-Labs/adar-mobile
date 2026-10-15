import { AxiosInstance } from 'axios';

// Client for the restaurant marketplace routes on adar-rag/backend
// (/api/restaurant/*, same deployment DocIntel uses -- see App.tsx).
// Mirrors apps/docintel/src/docintelApi.ts's pattern: this backend has no
// X-API-Key concept, so every call needs the signed-in user's bearer
// token passed explicitly (shared-auth's client doesn't auto-attach it).
function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export interface EatsRestaurant {
  id: string;
  name: string;
  cuisine_type: string;
  address: string;
  phone: string;
  email: string;
  workspace_id: string | null;
  menu_count: number;
  min_price: number | null;
  max_price: number | null;
  rating_count: number;
  avg_rating: number | null;
  verified_rating_count: number;
  can_manage: boolean;
  marketplace_visible: boolean;
  latitude?: number | null;
  longitude?: number | null;
  city?: string;
  state?: string;
  // Miles from the lat/lng passed to the list call -- null/undefined
  // when no location was given, or this restaurant has no coordinates
  // of its own yet (address not geocoded -- see backend's geocoding.py).
  distance_miles?: number | null;
  dine_in_enabled?: boolean;
  scheduling_practice_id?: string;
  // IANA timezone (e.g. "America/New_York"), resolved from lat/lng by the
  // backend's geocoding (services/geocoding.py's get_timezone). Used to
  // show/pick a pickup time as the RESTAURANT's own local wall-clock time
  // -- see PickupTimePicker.tsx.
  timezone?: string;
}

/** Location scoping shared by listMarketplaceRestaurants/searchMarketplaceMenu/
 *  compareMarketplaceMenu/searchMenuAdvanced -- mirrors the backend's own
 *  params (routes/restaurant.py). `lat`/`lng` scope by distance (radiusMiles,
 *  default 50); `city` additionally includes a same-city restaurant even if
 *  it's outside that radius. Passing neither applies no location filter at
 *  all (old behavior, e.g. for an owner's own-workspace calls). */
export interface EatsGeoScope {
  name?: string;
  city?: string;
  state?: string;
  lat?: number | null;
  lng?: number | null;
  radiusMiles?: number;
}

function geoScopeParams(opts?: EatsGeoScope): Record<string, string | number> {
  if (!opts) return {};
  const params: Record<string, string | number> = {};
  if (opts.name) params.name = opts.name;
  if (opts.city) params.city = opts.city;
  if (opts.state) params.state = opts.state;
  if (opts.lat != null && opts.lng != null) {
    params.lat = opts.lat;
    params.lng = opts.lng;
    params.radius_miles = opts.radiusMiles ?? 50;
  }
  return params;
}

/** GET /api/restaurant/restaurants?marketplace=true -- every restaurant
 *  that has opted into the public marketplace, across all workspaces.
 *  (Owners opt in via POST /api/restaurant/restaurants/{id}/marketplace.) */
export interface EatsRestaurantList {
  restaurants: EatsRestaurant[];
  // true when a city/state/lat+lng location was given but matched zero
  // restaurants, so the backend fell back to the full marketplace list
  // instead of returning nothing (see routes/restaurant.py's
  // list_restaurants) -- almost always because the matching restaurants
  // haven't been geocoded yet, not because there's truly nothing there.
  locationRelaxed: boolean;
}

export async function listMarketplaceRestaurants(
  client: AxiosInstance,
  accessToken: string,
  geo?: EatsGeoScope
): Promise<EatsRestaurantList> {
  const { data } = await client.get('/api/restaurant/restaurants', {
    headers: authHeaders(accessToken),
    params: { marketplace: true, ...geoScopeParams(geo) },
  });
  return {
    restaurants: data.restaurants as EatsRestaurant[],
    locationRelaxed: !!data.location_relaxed,
  };
}

export interface EatsMenuItem {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  address: string;
  cuisine_type: string;
  item_name: string;
  description: string;
  category: string;
  price: number | null;
  currency: string;
  quantity: string;
  dietary_tags: string[];
  spice_level: string;
  availability: string;
  rating_count: number;
  avg_rating: number | null;
  verified_rating_count: number;
  // Signed GCS url, resolved server-side by _menu_row/_menu_search_row for
  // every menu item (owner-managed or marketplace search result alike) --
  // declared here (not just on EatsOwnerMenuItem) so a customer-facing
  // detail popup can show the photo too.
  image_url: string | null;
  restaurant_city?: string;
  restaurant_state?: string;
  distance_miles?: number | null;
}

/** The standard menu sections every restaurant's items get grouped into
 *  on screen -- Appetizer/Entree/Dessert etc, the grouping the user asked
 *  for ("menu category like Aptetizer, Entree, Desert"). The backend's
 *  voice-scribe extraction (services/restaurant_intelligence.py) is now
 *  prompted to pick one of these for new items, but `category` has always
 *  been a free-text column, so older/unexpected values still need to land
 *  somewhere -- this buckets any string into the closest standard section,
 *  falling back to "Other" rather than dropping the item or crashing. */
export const MENU_CATEGORY_ORDER = [
  'Appetizer',
  'Soup',
  'Salad',
  'Entree',
  'Side',
  'Dessert',
  'Beverage',
  'Other',
] as const;

export type MenuCategoryBucket = (typeof MENU_CATEGORY_ORDER)[number];

const MENU_CATEGORY_SYNONYMS: Record<string, MenuCategoryBucket> = {
  appetizer: 'Appetizer',
  appetizers: 'Appetizer',
  starter: 'Appetizer',
  starters: 'Appetizer',
  snack: 'Appetizer',
  snacks: 'Appetizer',
  soup: 'Soup',
  soups: 'Soup',
  salad: 'Salad',
  salads: 'Salad',
  entree: 'Entree',
  entrees: 'Entree',
  'main course': 'Entree',
  'main courses': 'Entree',
  main: 'Entree',
  mains: 'Entree',
  curry: 'Entree',
  curries: 'Entree',
  rice: 'Entree',
  'rice dishes': 'Entree',
  biryani: 'Entree',
  side: 'Side',
  sides: 'Side',
  'side dish': 'Side',
  'side dishes': 'Side',
  bread: 'Side',
  breads: 'Side',
  dessert: 'Dessert',
  desserts: 'Dessert',
  sweet: 'Dessert',
  sweets: 'Dessert',
  beverage: 'Beverage',
  beverages: 'Beverage',
  drink: 'Beverage',
  drinks: 'Beverage',
};

export function menuCategoryBucket(category: string | null | undefined): MenuCategoryBucket {
  const key = (category || '').trim().toLowerCase();
  if (!key) return 'Other';
  if (MENU_CATEGORY_SYNONYMS[key]) return MENU_CATEGORY_SYNONYMS[key];
  const found = MENU_CATEGORY_ORDER.find((bucket) => bucket.toLowerCase() === key);
  return found ?? 'Other';
}

/** GET /api/restaurant/menu/search?marketplace=true -- free-text search
 *  across every marketplace restaurant's menu. */
export async function searchMarketplaceMenu(
  client: AxiosInstance,
  accessToken: string,
  query: string,
  geo?: EatsGeoScope
): Promise<EatsMenuItem[]> {
  const { data } = await client.get('/api/restaurant/menu/search', {
    headers: authHeaders(accessToken),
    params: { query, marketplace: true, ...geoScopeParams(geo) },
  });
  return data.items as EatsMenuItem[];
}

export interface EatsMenuCompare {
  query: string;
  count: number;
  lowest_price: number | null;
  highest_price: number | null;
  items: EatsMenuItem[];
}

/** GET /api/restaurant/menu/compare?marketplace=true -- same search, plus
 *  the lowest/highest price seen for that item name across restaurants. */
export async function compareMarketplaceMenu(
  client: AxiosInstance,
  accessToken: string,
  query: string,
  geo?: EatsGeoScope
): Promise<EatsMenuCompare> {
  const { data } = await client.get('/api/restaurant/menu/compare', {
    headers: authHeaders(accessToken),
    params: { query, marketplace: true, ...geoScopeParams(geo) },
  });
  return data as EatsMenuCompare;
}

// ── Owner dashboard: voice -> transcript -> AI-extracted menu -> review ──
// -> approve -> per-item photo upload. Mirrors the existing web flow in
// adar-rag/frontend/src/components/RestaurantPanel.jsx's "scribe" tab,
// which talks to the exact same backend endpoints below. The only piece
// that didn't already exist anywhere (web or backend) is per-menu-item
// photo upload -- routes/restaurant.py's POST/DELETE
// /restaurants/{id}/menu-items/{item_id}/photo and the
// restaurant_menu_items.image_gcs_path column were added alongside this
// mobile screen.

export interface EatsRestaurantWorkspace {
  workspace_id: string;
  workspace_name: string;
}

/** GET /api/restaurant/workspace -- resolves (and, the first time, joins
 *  the caller to) the one shared restaurant workspace every adar-eats
 *  mobile owner/user acts in. Mobile never operates in a personal
 *  (workspace_id=null) context on this screen -- see WorkspaceContext.tsx,
 *  which calls this once at startup and uses the result for every
 *  owner-side call from then on. Throws (404-shaped by the client lib as
 *  a 409) only in the bootstrap case where no restaurant workspace exists
 *  anywhere yet. */
export async function getRestaurantWorkspace(
  client: AxiosInstance,
  accessToken: string
): Promise<EatsRestaurantWorkspace> {
  const { data } = await client.get('/api/restaurant/workspace', {
    headers: authHeaders(accessToken),
  });
  return data as EatsRestaurantWorkspace;
}

export interface EatsOwnerRestaurant extends EatsRestaurant {
  description: string;
}

/** GET /api/restaurant/restaurants (no marketplace param) -- restaurants
 *  reachable in the caller's own scope (personal + any workspace they
 *  belong to), filtered down here to the ones `can_manage` is true for.
 *  Pass workspaceId when the owner's restaurants live under a named
 *  workspace (e.g. "Restaurant workspace") rather than personally. */
export async function listMyRestaurants(
  client: AxiosInstance,
  accessToken: string,
  workspaceId?: string | null
): Promise<EatsOwnerRestaurant[]> {
  const { data } = await client.get('/api/restaurant/restaurants', {
    headers: authHeaders(accessToken),
    params: workspaceId ? { workspace_id: workspaceId } : undefined,
  });
  return (data.restaurants as EatsOwnerRestaurant[]).filter((r) => r.can_manage);
}

/** POST /api/restaurant/restaurants/{id}/marketplace -- opt a restaurant
 *  in or out of the public ADAR Eats marketplace listing. */
export async function setMarketplaceVisibility(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  visible: boolean
): Promise<void> {
  await client.post(
    `/api/restaurant/restaurants/${restaurantId}/marketplace`,
    { visible },
    { headers: authHeaders(accessToken) }
  );
}

export interface EatsAgentRun {
  run_id: string;
  status: string;
  // Shape of `result` varies by stage: the scribe workflow's multi-agent
  // output nests the extracted packet under one of several keys depending
  // on which agent produced it last (see _restaurant_packet_from_result
  // in routes/restaurant.py) -- check review_packet/restaurant_packet/
  // packet/approved_packet in that order, same as the backend does.
  result?: Record<string, any> | null;
  error_message?: string | null;
}

/** Pulls the extracted/edited menu packet out of an agent run's `result`,
 *  mirroring _restaurant_packet_from_result in routes/restaurant.py exactly --
 *  including its one-level nested-result fallback (some workflow result
 *  shapes wrap the real payload under an extra "result" key), which this
 *  function was previously missing: a run whose packet only resolved via
 *  that fallback on the backend (e.g. the restore-on-list-restaurants path
 *  uses the same helper) would come back null here and the owner's review
 *  screen would stay stuck on "Transcribing..." forever with no error. */
function restaurantPacketFromResult(result: unknown): EatsMenuPacket | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, any>;
  for (const key of ['approved_packet', 'review_packet', 'restaurant_packet', 'packet']) {
    const candidate = r[key];
    if (candidate && typeof candidate === 'object' && candidate.restaurant_profile) {
      return normalizeMenuPacket(candidate);
    }
  }
  if (r.restaurant_profile) return normalizeMenuPacket(r);
  if (r.result && typeof r.result === 'object') return restaurantPacketFromResult(r.result);
  return null;
}

/** Guards against a packet whose menu_items came back missing or not an
 *  array (an older/partial run shape, or a quality-review-only partial
 *  result) -- without this, `packet.menu_items.length`/`.map` in
 *  ScribeReviewScreen would throw and blank the whole review screen,
 *  which looks to the owner exactly like "the menu isn't showing up"
 *  with no error at all. Mirrors adar-web's RestaurantPanel.jsx
 *  normalizePacket(). */
function normalizeMenuPacket(packet: Record<string, any>): EatsMenuPacket {
  return {
    ...packet,
    restaurant_profile: packet.restaurant_profile || {},
    menu_items: Array.isArray(packet.menu_items) ? packet.menu_items : [],
  } as EatsMenuPacket;
}

export function extractMenuPacket(run: EatsAgentRun): EatsMenuPacket | null {
  return restaurantPacketFromResult(run.result);
}

export interface EatsMenuPacketItem {
  category?: string;
  item_name: string;
  price?: number | null;
  currency?: string;
  quantity?: string;
  description?: string;
  ingredients?: string[];
  dietary_tags?: string[];
  spice_level?: string;
  availability?: string;
  options?: string[];
  image_gcs_path?: string | null;
}

export interface EatsMenuPacket {
  restaurant_profile: {
    name: string;
    description?: string;
    cuisine_type?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
  };
  menu_items: EatsMenuPacketItem[];
}

/** POST /api/restaurant/scribe-workflow -- upload a recorded menu-walkthrough
 *  clip; the backend transcribes it and runs the restaurant-menu-scribe AI
 *  workflow in the background (see RESTAURANT_WORKFLOW_ID in
 *  routes/restaurant.py). Returns a vertical_agent_runs row (status
 *  'running' at first) to poll via getAgentRun. */
export interface EatsPendingRestaurantRun {
  run_id: string;
  status: string;
  created_at: string | null;
  restaurant_name: string;
  menu_item_count: number;
}

/** GET /api/restaurant/agent-runs -- scribe recordings this owner (or a
 *  workspace co-editor) made that are still awaiting review/approval.
 *  Without this, a run outliving the single in-memory screen session that
 *  created it (app closed/backgrounded mid-transcription, or the owner
 *  just navigated away before the review screen appeared) becomes
 *  permanently unreachable -- the recording and transcript exist on the
 *  server, but the client has no run_id left to resume reviewing it. The
 *  owner's restaurant list screen polls this to always offer a way back. */
export async function listPendingRestaurantRuns(
  client: AxiosInstance,
  accessToken: string,
  workspaceId?: string | null
): Promise<EatsPendingRestaurantRun[]> {
  const { data } = await client.get('/api/restaurant/agent-runs', {
    headers: authHeaders(accessToken),
    params: workspaceId ? { workspace_id: workspaceId } : undefined,
  });
  return (data?.runs as EatsPendingRestaurantRun[]) || [];
}

export async function submitRestaurantScribe(
  client: AxiosInstance,
  accessToken: string,
  recording: { uri: string; mimeType: string; name: string },
  opts: { language?: string; intakeTitle?: string; workspaceId?: string | null } = {}
): Promise<EatsAgentRun> {
  const form = new FormData();
  form.append('audio', { uri: recording.uri, name: recording.name, type: recording.mimeType } as unknown as Blob);
  form.append('authorized_confirmed', 'true');
  if (opts.language) form.append('language', opts.language);
  if (opts.intakeTitle) form.append('intake_title', opts.intakeTitle);
  if (opts.workspaceId) form.append('workspace_id', opts.workspaceId);
  const { data } = await client.post('/api/restaurant/scribe-workflow', form, {
    headers: { ...authHeaders(accessToken), 'Content-Type': 'multipart/form-data' },
  });
  return data as EatsAgentRun;
}

/** GET /api/restaurant/agent-runs/{run_id} -- poll while the scribe
 *  workflow's background task transcribes + extracts the menu packet.
 *  status goes running -> pending_approval (packet ready to review) or
 *  error. */
export async function getAgentRun(
  client: AxiosInstance,
  accessToken: string,
  runId: string
): Promise<EatsAgentRun> {
  const { data } = await client.get(`/api/restaurant/agent-runs/${runId}`, {
    headers: authHeaders(accessToken),
  });
  return data as EatsAgentRun;
}

/** POST /api/restaurant/agent-runs/{run_id}/approve -- owner-reviewed (and
 *  possibly edited) packet is saved: creates/updates the `restaurants` row
 *  and replaces its `restaurant_menu_items` rows, then chunks + embeds the
 *  approved menu for search (server-side, automatic). Returns the saved
 *  restaurant_id so the caller can move straight to the photo-upload step. */
export async function approveRestaurantScribe(
  client: AxiosInstance,
  accessToken: string,
  runId: string,
  approvedPacket: EatsMenuPacket
): Promise<{ restaurant_id: string }> {
  const { data } = await client.post(
    `/api/restaurant/agent-runs/${runId}/approve`,
    { approved_packet: approvedPacket },
    { headers: authHeaders(accessToken) }
  );
  // The endpoint sets restaurant_id at the top level of the response
  // (see approve_restaurant_agent_run in routes/restaurant.py).
  return { restaurant_id: String(data?.restaurant_id || '') };
}

// image_url now lives on EatsMenuItem itself (see above) -- this extends
// alias is kept so existing imports of EatsOwnerMenuItem don't need to change.
export type EatsOwnerMenuItem = EatsMenuItem;

export interface EatsRestaurantDetail {
  restaurant: EatsOwnerRestaurant;
  menu_items: EatsOwnerMenuItem[];
}

/** GET /api/restaurant/restaurants/{id} -- full detail + menu, used after
 *  approval to get the real (now persisted) menu_item ids for the
 *  photo-upload step. */
export async function getRestaurantDetail(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string
): Promise<EatsRestaurantDetail> {
  const { data } = await client.get(`/api/restaurant/restaurants/${restaurantId}`, {
    headers: authHeaders(accessToken),
  });
  return data as EatsRestaurantDetail;
}

/** POST /api/restaurant/restaurants/{id}/menu-items/{item_id}/photo --
 *  upload (or replace) one menu item's food/menu photo. */
export async function uploadMenuItemPhoto(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  itemId: string,
  photo: { uri: string; mimeType: string; name: string }
): Promise<{ item_id: string; image_url: string | null }> {
  const form = new FormData();
  form.append('photo', { uri: photo.uri, name: photo.name, type: photo.mimeType } as unknown as Blob);
  const { data } = await client.post(
    `/api/restaurant/restaurants/${restaurantId}/menu-items/${itemId}/photo`,
    form,
    { headers: { ...authHeaders(accessToken), 'Content-Type': 'multipart/form-data' } }
  );
  return data;
}

/** DELETE /api/restaurant/restaurants/{id}/menu-items/{item_id}/photo --
 *  remove a menu item's photo. */
export async function deleteMenuItemPhoto(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  itemId: string
): Promise<void> {
  await client.delete(`/api/restaurant/restaurants/${restaurantId}/menu-items/${itemId}/photo`, {
    headers: authHeaders(accessToken),
  });
}

/** Fields an owner can edit on an already-saved menu item -- everything
 *  except id/restaurant/photo (photo has its own upload/delete endpoints
 *  above). All optional: only the fields actually changed need to be sent
 *  (PATCH semantics -- see MenuItemUpdateRequest in routes/restaurant.py). */
export interface EatsMenuItemEdits {
  item_name?: string;
  category?: string;
  price?: number | null;
  currency?: string;
  quantity?: string;
  description?: string;
  dietary_tags?: string[];
  spice_level?: string;
  availability?: string;
}

/** PATCH /api/restaurant/restaurants/{id}/menu-items/{item_id} -- edit a
 *  menu item's own details (name, category, price, qty, description,
 *  dietary tags, spice level, availability) after it's already been
 *  recorded/approved -- previously the only way to fix a typo or price
 *  was to re-record the whole menu via voice scribe. Returns the updated
 *  row (including a fresh, possibly-unchanged, signed image_url). */
export async function updateMenuItem(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  itemId: string,
  edits: EatsMenuItemEdits
): Promise<EatsMenuItem> {
  const { data } = await client.patch(
    `/api/restaurant/restaurants/${restaurantId}/menu-items/${itemId}`,
    edits,
    { headers: authHeaders(accessToken) }
  );
  return data as EatsMenuItem;
}

// ── Documents tab: past scribe recordings/transcripts ───────────────────
// Mirrors DocIntel's own Documents screen (GET /api/documents/), but that
// endpoint only lists personal (workspace-less) docs -- restaurant scribe
// recordings usually live under a workspace (e.g. "Restaurant workspace"),
// so GET /api/restaurant/documents exists instead: same `documents` table,
// filtered to doc_domain='restaurant', visible across any workspace the
// caller belongs to (see list_restaurant_documents in routes/restaurant.py).

export interface EatsDocument {
  id: string;
  original_name: string;
  filename: string;
  file_type: string;
  file_size: number;
  status: string; // chunking | pending_approval | approved | error | deleted
  error_message: string | null;
  doc_type: string | null;
  doc_domain: string | null;
  workspace_id: string | null;
  created_at: string;
  updated_at: string;
  // Which of the caller's restaurants this transcript belongs to, when it
  // can be resolved (restaurants.source_run_id chain -- see
  // list_restaurant_documents in routes/restaurant.py). null for a
  // transcript still pending_approval (not yet turned into a restaurant).
  restaurant_name: string | null;
}

/** GET /api/restaurant/documents -- every restaurant-menu-scribe recording
 *  (and its saved transcript) this owner can see, newest first. */
export async function listRestaurantDocuments(
  client: AxiosInstance,
  accessToken: string,
  workspaceId?: string | null
): Promise<EatsDocument[]> {
  const { data } = await client.get('/api/restaurant/documents', {
    headers: authHeaders(accessToken),
    params: workspaceId ? { workspace_id: workspaceId } : undefined,
  });
  return data.documents as EatsDocument[];
}

/** GET /api/documents/{id}/view-url -- the GENERIC DocIntel endpoint (not
 *  restaurant-specific), reused as-is: for a restaurant-menu-scribe
 *  document, `gcs_source_path` IS the saved transcript text file (see
 *  _persist_workflow_transcript in routes/restaurant.py), so this signed
 *  URL points straight at the transcript, not raw audio. Works for any
 *  workspace the caller belongs to, same as the restaurant endpoints
 *  (_get_owned in routes/documents.py already checks workspace
 *  membership, not just personal ownership). */
export async function getDocumentViewUrl(
  client: AxiosInstance,
  accessToken: string,
  docId: string
): Promise<{ url: string }> {
  const { data } = await client.get(`/api/documents/${docId}/view-url`, {
    headers: authHeaders(accessToken),
  });
  return data;
}

/** The view-url above is a plain signed GCS URL (no auth header needed) --
 *  fetch it directly to get the transcript text itself. */
export async function fetchTranscriptText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load transcript (HTTP ${response.status})`);
  return response.text();
}

// ── Customer chat assistant (menu compare/search via conversation) ─────────
// Ports apps/docintel/src/docintelApi.ts's streamSse/streamChat pattern
// verbatim (same backend host, same /api/chat/stream SSE contract) --
// XMLHttpRequest-based because RN's fetch() doesn't reliably expose a
// readable stream across iOS/Android/Hermes. See that file's comments for
// the stall-timeout and split-line-buffering rationale; unchanged here.

export interface ChatStreamHandlers {
  onToken?: (text: string) => void;
  onDone?: (payload: Record<string, unknown>) => void;
  onError?: (message: string) => void;
}

const CHAT_STALL_TIMEOUT_MS = 90000;

function streamSse(
  baseURL: string,
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
  handlers: ChatStreamHandlers
): { cancel: () => void } {
  const xhr = new XMLHttpRequest();
  let lastLength = 0;
  let buffer = '';
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
    }, CHAT_STALL_TIMEOUT_MS);
  };

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
      // incomplete line -- onloadend's last-resort pass handles a truncated final line
    }
  };

  xhr.open('POST', `${baseURL}${path}`, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);

  xhr.onprogress = () => {
    if (settled) return;
    armStallTimer();
    buffer += xhr.responseText.slice(lastLength);
    lastLength = xhr.responseText.length;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
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
    if (settled) return;
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
    if (buffer.trim()) {
      processLine(buffer);
      buffer = '';
    }
    if (!settled) {
      settled = true;
      handlers.onError?.('The response ended unexpectedly -- please try again.');
    }
  };
  armStallTimer();
  xhr.send(JSON.stringify(body));

  return { cancel: () => { clearStallTimer(); settled = true; xhr.abort(); } };
}

/** POST /api/chat/stream with marketplace:true -- the Eats customer-facing
 *  menu assistant. Unlike DocIntel's streamChat, this caller usually has
 *  no documents of their own to select, so document_ids is always [] and
 *  the `marketplace` flag (routes/chat.py's ChatRequest.marketplace) tells
 *  the backend to widen its "Restaurant DB Source" lookup to every
 *  marketplace-visible restaurant instead of just ones the caller owns or
 *  is a workspace member of. */
export function streamRestaurantChat(
  baseURL: string,
  accessToken: string,
  params: {
    question: string;
    history?: { role: string; content: string }[];
    responseLanguage?: string;
  },
  handlers: ChatStreamHandlers
) {
  return streamSse(baseURL, '/api/chat/stream', accessToken, {
    question: params.question,
    document_ids: [],
    history: params.history ?? [],
    marketplace: true,
    response_language: params.responseLanguage,
  }, handlers);
}

// ── Chat sessions (persisted conversations) ─────────────────────────────────
// Thin wrappers over the existing generic /api/chat/sessions CRUD (routes/
// chat_sessions.py) -- already used by DocIntel's web app; no mobile app
// wires it up yet, so this is new plumbing, but no new backend endpoints.
// Sessions here are always workspace_id-less (personal to the diner),
// mirroring how list_sessions/create_session default when no workspace_id
// is passed.

export interface EatsChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface EatsChatSessionSummary {
  id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface EatsChatSessionDetail {
  id: string;
  title: string;
  messages: EatsChatMessage[];
  created_at: string;
  updated_at: string;
}

/** GET /api/chat/sessions/ -- this diner's past conversations, newest first. */
export async function listChatSessions(
  client: AxiosInstance,
  accessToken: string
): Promise<EatsChatSessionSummary[]> {
  const { data } = await client.get('/api/chat/sessions/', {
    headers: authHeaders(accessToken),
  });
  return data as EatsChatSessionSummary[];
}

/** POST /api/chat/sessions/ -- start a new conversation. Title defaults to
 *  "New Chat" and is auto-replaced with the first message's text by the
 *  backend once messages are saved (see save_messages's title=CASE...). */
export async function createChatSession(
  client: AxiosInstance,
  accessToken: string,
  title?: string
): Promise<EatsChatSessionDetail> {
  const { data } = await client.post(
    '/api/chat/sessions/',
    { title: title || 'New Chat', document_ids: [] },
    { headers: authHeaders(accessToken) }
  );
  return data as EatsChatSessionDetail;
}

/** GET /api/chat/sessions/{id} -- full conversation (resuming an earlier chat). */
export async function getChatSession(
  client: AxiosInstance,
  accessToken: string,
  sessionId: string
): Promise<EatsChatSessionDetail> {
  const { data } = await client.get(`/api/chat/sessions/${sessionId}`, {
    headers: authHeaders(accessToken),
  });
  return data as EatsChatSessionDetail;
}

/** PATCH /api/chat/sessions/{id}/messages -- save the full message list
 *  after each completed exchange (the backend replaces the whole array,
 *  there's no append-one-message endpoint). */
export async function saveChatSessionMessages(
  client: AxiosInstance,
  accessToken: string,
  sessionId: string,
  messages: EatsChatMessage[]
): Promise<void> {
  await client.patch(
    `/api/chat/sessions/${sessionId}/messages`,
    { messages },
    { headers: authHeaders(accessToken) }
  );
}

/** DELETE /api/chat/sessions/{id} */
export async function deleteChatSession(
  client: AxiosInstance,
  accessToken: string,
  sessionId: string
): Promise<void> {
  await client.delete(`/api/chat/sessions/${sessionId}`, {
    headers: authHeaders(accessToken),
  });
}

// ── Carryout cart / orders / checkout ──────────────────────────────────────
// Mirrors adar-rag/frontend/src/components/RestaurantPanel.jsx's cart +
// order flow 1:1: the "cart" itself is purely client state (see
// CartContext.tsx) -- there is no cart table on the backend. "Review
// order" turns that local cart into a persisted draft order (POST
// /orders/draft, status='draft'); "Pay & Place Order" then opens a Stripe
// Checkout session for that draft (POST /orders/{id}/checkout) which, on
// payment, the backend's webhook auto-submits to the restaurant (status
// -> 'submitted'). A customer can also submit without paying first via
// POST /orders/{id}/submit, exposed here as submitOrder, matching the
// backend's own allowance (not currently used by the web app's UI, but a
// real endpoint -- wire it in if Eats wants a pay-later/cash option later).

export interface EatsOrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  item_name: string;
  category: string;
  quantity: number;
  unit_price: number | null;
  line_total: number | null;
  currency: string;
  instructions: string;
}

export interface EatsOrder {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_address: string;
  restaurant_phone: string;
  restaurant_email: string;
  customer_user_id: string;
  workspace_id: string | null;
  status: string; // draft | payment_pending | payment_failed | submitted | accepted | rejected | ready_for_pickup | completed
  fulfillment_type: string;
  payment_status: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  pickup_time_request: string;
  // Pre-formatted in the restaurant's own local time by the backend (see
  // routes/restaurant.py's _format_pickup_time_request) -- "ASAP"/blank
  // pass through unchanged. Prefer this over pickup_time_request for
  // display; only present on owner/customer order-listing responses.
  pickup_time_display?: string;
  restaurant_timezone?: string;
  special_instructions: string;
  subtotal: number;
  currency: string;
  item_count?: number;
  order_items?: EatsOrderItem[];
  // Set only for an order placed at an event's stall (reuses this same
  // restaurant_orders row/pipeline unmodified -- see routes/
  // restaurant_events.py's create_event_order_draft) -- null/undefined for
  // an ordinary carryout order.
  event_id?: string | null;
  stall_id?: string | null;
  metadata?: { event_name?: string; stall_name?: string; [key: string]: unknown } | null;
  created_at: string;
  updated_at: string;
}

export interface EatsOrderResponse {
  order: EatsOrder;
  items: EatsOrderItem[];
  events: Record<string, any>[];
}

export interface EatsCartItemInput {
  menu_item_id?: string | null;
  item_name?: string;
  category?: string;
  unit_price?: number | null;
  currency?: string;
  quantity: number;
  instructions?: string;
}

/** POST /api/restaurant/orders/draft -- turn the local cart into a
 *  persisted draft order ("Review order" in the web UI). One restaurant
 *  per cart (the backend rejects a mixed cart with 400). */
export async function createOrderDraft(
  client: AxiosInstance,
  accessToken: string,
  params: {
    restaurantId: string;
    restaurantName?: string;
    workspaceId?: string | null;
    items: EatsCartItemInput[];
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    pickupTimeRequest?: string;
    // Structured alternative -- combined server-side with the
    // restaurant's own timezone (see routes/restaurant.py's
    // _resolve_pickup_time_request). Omit both to keep pickupTimeRequest
    // as freeform text, e.g. the literal "ASAP".
    pickupDate?: string | null;
    pickupTime?: string | null;
    specialInstructions?: string;
    notes?: string;
  }
): Promise<EatsOrderResponse> {
  const { data } = await client.post(
    '/api/restaurant/orders/draft',
    {
      restaurant_id: params.restaurantId,
      restaurant_name: params.restaurantName || '',
      workspace_id: params.workspaceId ?? null,
      items: params.items.map((item) => ({
        menu_item_id: item.menu_item_id ?? null,
        item_name: item.item_name || '',
        category: item.category || '',
        unit_price: item.unit_price ?? null,
        currency: item.currency || 'USD',
        quantity: item.quantity,
        quantity_ordered: item.quantity,
        instructions: item.instructions || '',
      })),
      customer_name: params.customerName || '',
      customer_phone: params.customerPhone || '',
      customer_email: params.customerEmail || '',
      pickup_time_request: params.pickupTimeRequest || '',
      pickup_date: params.pickupDate ?? null,
      pickup_time: params.pickupTime ?? null,
      special_instructions: params.specialInstructions || '',
      notes: params.notes || 'Carryout order created from ADAR Eats mobile',
    },
    { headers: authHeaders(accessToken) }
  );
  return data as EatsOrderResponse;
}

/** POST /api/restaurant/orders/{id}/submit -- submit a draft order to the
 *  restaurant WITHOUT payment (the backend allows this; the web UI just
 *  doesn't currently expose it, always routing through checkout instead). */
export async function submitOrder(
  client: AxiosInstance,
  accessToken: string,
  orderId: string,
  workspaceId?: string | null,
  notes?: string
): Promise<EatsOrderResponse> {
  const { data } = await client.post(
    `/api/restaurant/orders/${orderId}/submit`,
    { workspace_id: workspaceId ?? null, notes: notes || '' },
    { headers: authHeaders(accessToken) }
  );
  return data as EatsOrderResponse;
}

export interface EatsCheckoutResult {
  checkout_url: string;
  session_id: string;
  order: EatsOrderResponse;
}

/** POST /api/restaurant/orders/{id}/checkout -- creates a Stripe Checkout
 *  session for a draft order ("Pay & Place Order"). Open checkout_url with
 *  WebBrowser.openAuthSessionAsync (see CartScreen.tsx's payAndPlace) so
 *  completing/cancelling on Stripe's hosted page redirects straight back
 *  into this app via its adareats:// scheme instead of landing on
 *  APP_URL -- the DocIntel *web app's* login screen -- which is what the
 *  backend's success_url/cancel_url default to when a caller doesn't pass
 *  its own (that default exists for the web app's own carryout cart).
 *  successUrl/cancelUrl should be built from Linking.createURL(...) with
 *  the mobile app's own scheme. The backend's webhook marks the order
 *  paid + submitted once Stripe confirms payment -- refresh the order
 *  after the browser closes to pick that up. */
export async function checkoutOrder(
  client: AxiosInstance,
  accessToken: string,
  orderId: string,
  workspaceId?: string | null,
  successUrl?: string,
  cancelUrl?: string
): Promise<EatsCheckoutResult> {
  const { data } = await client.post(
    `/api/restaurant/orders/${orderId}/checkout`,
    {
      workspace_id: workspaceId ?? null,
      success_url: successUrl ?? null,
      cancel_url: cancelUrl ?? null,
    },
    { headers: authHeaders(accessToken) }
  );
  return data as EatsCheckoutResult;
}

/** GET /api/restaurant/orders -- this diner's own order history + current
 *  status, newest first. */
export async function listMyOrders(
  client: AxiosInstance,
  accessToken: string,
  workspaceId?: string | null
): Promise<EatsOrder[]> {
  const { data } = await client.get('/api/restaurant/orders', {
    headers: authHeaders(accessToken),
    params: workspaceId ? { workspace_id: workspaceId } : undefined,
  });
  return data.orders as EatsOrder[];
}

/** GET /api/restaurant/orders/{id} -- full detail (order + items + event
 *  timeline) for one order. */
export async function getOrder(
  client: AxiosInstance,
  accessToken: string,
  orderId: string,
  workspaceId?: string | null
): Promise<EatsOrderResponse> {
  const { data } = await client.get(`/api/restaurant/orders/${orderId}`, {
    headers: authHeaders(accessToken),
    params: workspaceId ? { workspace_id: workspaceId } : undefined,
  });
  return data as EatsOrderResponse;
}

/** GET /api/restaurant/owner/orders -- every order placed to a restaurant
 *  this user manages (excludes still-in-cart draft/payment_pending/
 *  payment_failed orders, same as the backend's own filter), newest
 *  first. Pass status to narrow to e.g. 'submitted' for an "outstanding
 *  orders" view. */
export async function listOwnerOrders(
  client: AxiosInstance,
  accessToken: string,
  opts: { status?: string; workspaceId?: string | null } = {}
): Promise<EatsOrder[]> {
  const { data } = await client.get('/api/restaurant/owner/orders', {
    headers: authHeaders(accessToken),
    params: { status: opts.status || '', workspace_id: opts.workspaceId ?? undefined },
  });
  return data.orders as EatsOrder[];
}

async function transitionOwnerOrder(
  client: AxiosInstance,
  accessToken: string,
  orderId: string,
  action: 'accept' | 'reject' | 'ready' | 'complete',
  workspaceId?: string | null,
  notes?: string
): Promise<EatsOrderResponse> {
  const { data } = await client.post(
    `/api/restaurant/owner/orders/${orderId}/${action}`,
    { workspace_id: workspaceId ?? null, notes: notes || '' },
    { headers: authHeaders(accessToken) }
  );
  return data as EatsOrderResponse;
}

/** POST /api/restaurant/owner/orders/{id}/accept -- restaurant accepts a
 *  submitted carryout order (required step before it can be prepared). */
export const acceptOrder = (client: AxiosInstance, accessToken: string, orderId: string, workspaceId?: string | null, notes?: string) =>
  transitionOwnerOrder(client, accessToken, orderId, 'accept', workspaceId, notes);

/** POST /api/restaurant/owner/orders/{id}/reject */
export const rejectOrder = (client: AxiosInstance, accessToken: string, orderId: string, workspaceId?: string | null, notes?: string) =>
  transitionOwnerOrder(client, accessToken, orderId, 'reject', workspaceId, notes);

/** POST /api/restaurant/owner/orders/{id}/ready */
export const readyOrder = (client: AxiosInstance, accessToken: string, orderId: string, workspaceId?: string | null, notes?: string) =>
  transitionOwnerOrder(client, accessToken, orderId, 'ready', workspaceId, notes);

/** POST /api/restaurant/owner/orders/{id}/complete */
export const completeOrder = (client: AxiosInstance, accessToken: string, orderId: string, workspaceId?: string | null, notes?: string) =>
  transitionOwnerOrder(client, accessToken, orderId, 'complete', workspaceId, notes);

// ── Feedback / ratings ──────────────────────────────────────────────────────
// Lets a customer rate an order and/or a specific menu item; ratings feed
// straight back into rating_count/avg_rating on menu search, compare, and
// recommend (see the fb subquery joined into those in routes/restaurant.py)
// -- "that get reflected in menu item that other customer can search."

export interface EatsFeedback {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  menu_item_id: string | null;
  menu_item_name: string | null;
  order_id: string | null;
  customer_user_id: string;
  customer_email?: string;
  rating: number;
  feedback_text: string;
  language: string;
  source_type: string;
  tags: string[];
  signals: Record<string, any>;
  verified_order: boolean;
  status: string;
  owner_response: string;
  created_at: string;
  updated_at: string;
}

/** POST /api/restaurant/feedback/analyze -- optional AI-suggested star
 *  rating + topic tags from free-text feedback, before submitting. */
export async function analyzeFeedback(
  client: AxiosInstance,
  accessToken: string,
  params: { feedbackText: string; language?: string; currentRating?: number; restaurantName?: string; menuItemName?: string }
): Promise<Record<string, any>> {
  const { data } = await client.post(
    '/api/restaurant/feedback/analyze',
    {
      feedback_text: params.feedbackText,
      language: params.language || '',
      current_rating: params.currentRating ?? null,
      restaurant_name: params.restaurantName || '',
      menu_item_name: params.menuItemName || '',
    },
    { headers: authHeaders(accessToken) }
  );
  return data.analysis;
}

/** POST /api/restaurant/feedback -- submit a 1-5 star rating, optionally
 *  tied to a specific menu item and/or a past order (marks verified_order
 *  when it is). */
export async function submitFeedback(
  client: AxiosInstance,
  accessToken: string,
  params: {
    restaurantId: string;
    menuItemId?: string | null;
    orderId?: string | null;
    rating: number;
    feedbackText?: string;
    tags?: string[];
  }
): Promise<EatsFeedback> {
  const { data } = await client.post(
    '/api/restaurant/feedback',
    {
      restaurant_id: params.restaurantId,
      menu_item_id: params.menuItemId ?? null,
      order_id: params.orderId ?? null,
      rating: params.rating,
      feedback_text: params.feedbackText || '',
      tags: params.tags || [],
    },
    { headers: authHeaders(accessToken) }
  );
  return data.feedback as EatsFeedback;
}

/** GET /api/restaurant/feedback -- this diner's own submitted feedback. */
export async function listMyFeedback(client: AxiosInstance, accessToken: string): Promise<EatsFeedback[]> {
  const { data } = await client.get('/api/restaurant/feedback', { headers: authHeaders(accessToken) });
  return data.feedback as EatsFeedback[];
}

/** GET /api/restaurant/owner/feedback -- feedback left on restaurants this
 *  user manages, for responding to / triaging. */
export async function listOwnerFeedback(
  client: AxiosInstance,
  accessToken: string,
  status?: string,
  workspaceId?: string | null
): Promise<EatsFeedback[]> {
  const { data } = await client.get('/api/restaurant/owner/feedback', {
    headers: authHeaders(accessToken),
    params: { status: status || undefined, workspace_id: workspaceId ?? undefined },
  });
  return data.feedback as EatsFeedback[];
}

/** POST /api/restaurant/owner/feedback/{id}/status -- owner acknowledges/
 *  responds to/dismisses a piece of feedback. */
export async function updateFeedbackStatus(
  client: AxiosInstance,
  accessToken: string,
  feedbackId: string,
  status: 'acknowledged' | 'responded' | 'resolved' | 'dismissed',
  ownerResponse?: string,
  workspaceId?: string | null
): Promise<EatsFeedback> {
  const { data } = await client.post(
    `/api/restaurant/owner/feedback/${feedbackId}/status`,
    { status, owner_response: ownerResponse || '', workspace_id: workspaceId ?? null },
    { headers: authHeaders(accessToken) }
  );
  return data.feedback as EatsFeedback;
}

// ── Notifications ────────────────────────────────────────────────────────
// Backs the header bell: unread badge + a simple list, polled on an
// interval (see HomeScreen.tsx). New backend endpoints added alongside
// this mobile screen (GET/POST .../notifications...) -- the
// restaurant_notifications table and the writes into it already existed
// (every order transition recorded one), but nothing had ever read it back
// before this.

export interface EatsNotification {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  order_id: string;
  user_id: string;
  channel: string;
  status: string; // unread | read
  message: string;
  metadata: Record<string, any>;
  created_at: string;
  read_at: string | null;
}

export async function listNotifications(
  client: AxiosInstance,
  accessToken: string,
  status?: string
): Promise<{ notifications: EatsNotification[]; unread_count: number }> {
  const { data } = await client.get('/api/restaurant/notifications', {
    headers: authHeaders(accessToken),
    params: status ? { status } : undefined,
  });
  return data as { notifications: EatsNotification[]; unread_count: number };
}

export async function markNotificationRead(client: AxiosInstance, accessToken: string, notificationId: string): Promise<void> {
  await client.post(`/api/restaurant/notifications/${notificationId}/read`, {}, { headers: authHeaders(accessToken) });
}

export async function markAllNotificationsRead(client: AxiosInstance, accessToken: string): Promise<void> {
  await client.post('/api/restaurant/notifications/read-all', {}, { headers: authHeaders(accessToken) });
}

// ── Advanced search: AND/OR term combination + category filter ────────────
// routes/restaurant.py's /menu/search takes one free-text query; the user
// asked for two search boxes combinable with AND/OR plus a category
// filter ("these two searches are and/or category"). Rather than a new
// backend endpoint, this runs the existing search per non-empty term and
// combines client-side -- AND intersects by menu item id, OR unions --
// then narrows by menuCategoryBucket(). Keeps the backend's existing
// ranking/relevance per term instead of trying to replicate ILIKE-OR SQL
// here.

export async function searchMenuAdvanced(
  client: AxiosInstance,
  accessToken: string,
  params: {
    termA: string;
    termB?: string;
    mode?: 'AND' | 'OR';
    category?: MenuCategoryBucket | '';
    marketplace?: boolean;
    workspaceId?: string | null;
    geo?: EatsGeoScope;
  }
): Promise<EatsMenuItem[]> {
  const termA = params.termA.trim();
  const termB = (params.termB || '').trim();
  const mode = params.mode || 'AND';
  const runOne = async (q: string) => {
    const { data } = await client.get('/api/restaurant/menu/search', {
      headers: authHeaders(accessToken),
      params: {
        query: q,
        marketplace: params.marketplace ?? true,
        workspace_id: params.workspaceId ?? undefined,
        ...geoScopeParams(params.geo),
      },
    });
    return data.items as EatsMenuItem[];
  };

  let items: EatsMenuItem[];
  if (!termB) {
    items = termA ? await runOne(termA) : [];
  } else if (mode === 'OR') {
    const [a, b] = await Promise.all([runOne(termA), runOne(termB)]);
    const byId = new Map<string, EatsMenuItem>();
    [...a, ...b].forEach((item) => byId.set(item.id, item));
    items = Array.from(byId.values());
  } else {
    const [a, b] = await Promise.all([runOne(termA), runOne(termB)]);
    const bIds = new Set(b.map((item) => item.id));
    items = a.filter((item) => bIds.has(item.id));
  }

  if (params.category) {
    items = items.filter((item) => menuCategoryBucket(item.category) === params.category);
  }
  return items;
}

// ── Owner: view/edit the restaurant's transcript/menu document ────────────
// The document is what the chat assistant's document-grounded search is
// embedded from (see routes/restaurant.py's _reembed_restaurant_document),
// so keeping it editable -- and auto-resynced whenever a menu item is
// edited -- is what keeps "menu discovery" answers accurate. Distinct
// from fetchTranscriptText/getDocumentViewUrl above (that path is the
// read-only Documents tab, generic across any document type); these are
// restaurant-scoped and support editing + re-embedding in one call.

export interface EatsRestaurantTranscript {
  document_id: string | null;
  text: string;
  status: string | null;
  updated_at: string | null;
  chunk_count?: number | null;
  error_message?: string | null;
  menu_items_updated?: number;
  menu_items_inserted?: number;
}

/** GET /api/restaurant/restaurants/{id}/transcript */
export async function getRestaurantTranscript(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string
): Promise<EatsRestaurantTranscript> {
  const { data } = await client.get(`/api/restaurant/restaurants/${restaurantId}/transcript`, {
    headers: authHeaders(accessToken),
  });
  return data as EatsRestaurantTranscript;
}

/** PATCH /api/restaurant/restaurants/{id}/transcript -- saves the owner's
 *  edited transcript text. The backend both (1) parses the text and
 *  syncs any recognizable price/quantity/description changes -- plus new
 *  items -- back onto the live menu (restaurant_menu_items), and (2)
 *  rebuilds the canonical document text from the now-updated menu and
 *  re-embeds it (same chunk/embed pipeline a menu item edit triggers in
 *  the background -- see _resync_restaurant_document_task in
 *  routes/restaurant.py). The two directions converge: editing a menu
 *  item's price resyncs this transcript, and editing the transcript's
 *  price resyncs the menu item. */
export async function updateRestaurantTranscript(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  text: string
): Promise<EatsRestaurantTranscript> {
  const { data } = await client.patch(
    `/api/restaurant/restaurants/${restaurantId}/transcript`,
    { text },
    { headers: authHeaders(accessToken) }
  );
  return data as EatsRestaurantTranscript;
}

export interface EatsTranscriptChunkSummary {
  index: number;
  word_count: number;
  char_count?: number;
  gcs_path?: string;
}

export interface EatsTranscriptChunksResponse {
  document: {
    status?: string | null;
    chunk_count?: number | null;
    error_message?: string | null;
    filename?: string;
    total_chunks?: number;
    updated_at?: string | null;
  };
  chunks: EatsTranscriptChunkSummary[];
}

/** GET /api/restaurant/restaurants/{id}/transcript/chunks -- the same
 *  chunk breakdown the web Documents tab's ChunksViewer shows (one row
 *  per chunk, with word count), so the owner can see whether chunking
 *  and re-embedding actually happened after a menu or transcript edit,
 *  not just that the save call returned 200. */
export async function getRestaurantTranscriptChunks(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string
): Promise<EatsTranscriptChunksResponse> {
  const { data } = await client.get(`/api/restaurant/restaurants/${restaurantId}/transcript/chunks`, {
    headers: authHeaders(accessToken),
  });
  return data as EatsTranscriptChunksResponse;
}

/** GET /api/restaurant/restaurants/{id}/transcript/chunks/{index} -- a
 *  single chunk's full text, for tapping into a chunk from the list. */
export async function getRestaurantTranscriptChunkContent(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  chunkIndex: number
): Promise<{ chunk_index: number; content: string }> {
  const { data } = await client.get(
    `/api/restaurant/restaurants/${restaurantId}/transcript/chunks/${chunkIndex}`,
    { headers: authHeaders(accessToken) }
  );
  return data as { chunk_index: number; content: string };
}

// ── Voice: speech-to-text input, text-to-speech output ──────────────────────
// Same backend endpoints DocIntel's mobile app already uses (routes/
// voice.py) -- no new backend work needed, just wiring these up from the
// Eats side. See apps/docintel/src/docintelApi.ts's transcribeVoice/
// speakText for the reference implementation this mirrors.

/** POST /api/voice/transcribe -- uploads a recorded clip, gets back the
 *  transcribed text. `language` is a plain-language hint ("Bengali",
 *  "Spanish", ...) from i18n/languages.ts's sttHint -- optional, but
 *  transcription accuracy for non-English audio is noticeably better with
 *  it than letting the backend guess. */
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

/** POST /api/voice/speak -- server-side text-to-speech (Google Cloud TTS)
 *  for languages with a proven, higher-quality voice available there
 *  (routes/voice.py's TTS_VOICE_BY_LANGUAGE) -- used instead of on-device
 *  expo-speech for those languages only (see ListenButton.tsx). Returns
 *  base64 MP3; play it with expo-av's Audio.Sound via a
 *  `data:audio/mpeg;base64,...` URI. */
export async function speakText(
  client: AxiosInstance,
  accessToken: string,
  text: string,
  language: string
): Promise<{ audioBase64: string; mimeType: string }> {
  const { data } = await client.post(
    '/api/voice/speak',
    { text, language },
    { headers: authHeaders(accessToken), timeout: 30000 }
  );
  return { audioBase64: data.audio_base64, mimeType: data.mime_type };
}

// ── Account deletion (App Store Review Guideline 5.1.1(v)) ─────────────────
// ADAR Eats shares its backend (adar-rag/backend) with ADAR DocIntel, so
// this mirrors docintel/src/docintelApi.ts's deleteAccount /
// getAccountDeletionImpact exactly (DELETE /api/auth/account, re-entering
// the password as the confirm step -- see auth/router.py's
// delete_own_account). The one Eats-specific addition is in AccountScreen.tsx:
// the backend's own deletion-impact endpoint only knows about shared
// *workspaces* (DocIntel's concept), not restaurants, so AccountScreen
// separately calls listMyRestaurants to warn an owner that deleting their
// account also pulls their restaurant off the marketplace.
export interface AccountDeletionImpact {
  owned_shared_workspaces: { id: string; name: string; member_count: number }[];
}

export async function getAccountDeletionImpact(client: AxiosInstance, accessToken: string): Promise<AccountDeletionImpact> {
  const { data } = await client.get<AccountDeletionImpact>('/api/auth/account/deletion-impact', {
    headers: authHeaders(accessToken),
  });
  return data;
}

export async function deleteAccount(client: AxiosInstance, accessToken: string, password: string): Promise<void> {
  await client.delete('/api/auth/account', { data: { password }, headers: authHeaders(accessToken) });
}

// ── Push notifications ──────────────────────────────────────────────────
// Registers this device's Expo push token against the signed-in user so
// the backend's order-status notifications (routes/restaurant.py's
// _notify_restaurant_owner/_notify_restaurant_customer) can reach this
// phone even when the app is closed or backgrounded -- unlike the
// existing in-app NotificationsBell, which only shows updates while the
// app is open. See usePushRegistration.ts for the hook that calls these.
export async function registerPushToken(
  client: AxiosInstance,
  accessToken: string,
  pushToken: string,
  platform: string
): Promise<void> {
  await client.post(
    '/api/restaurant/push-token',
    { push_token: pushToken, platform },
    { headers: authHeaders(accessToken) }
  );
}

export async function unregisterPushToken(client: AxiosInstance, accessToken: string, pushToken: string): Promise<void> {
  await client.delete('/api/restaurant/push-token', {
    params: { push_token: pushToken },
    headers: authHeaders(accessToken),
  });
}

// ── Dine-in table reservations ──────────────────────────────────────────────
// Booking engine lives in adar-core's scheduling domain (the same one
// powering ADAR Front Desk) -- see the backend's services/scheduling_client.py.
// A restaurant maps to one scheduling "practice"; each physical table maps
// to one "provider" there. Same-seat tables are grouped into a "tier" only
// as a display label (seats + how many tables of that size are free).

export interface EatsDineInTable {
  id: string;
  name: string;
  seats: number;
  active: boolean;
}

export interface EatsDineInWorkingHour {
  weekday: number; // 0=Monday .. 6=Sunday
  start: string;   // "HH:MM"
  end: string;      // "HH:MM"
}

export interface EatsDineInTier {
  seats: number;
  table_count?: number;
  tables_available?: number;
  slots?: string[];
}

export interface EatsDineInConfig {
  dine_in_enabled: boolean;
  max_advance_days?: number;
  duration_minutes?: number;
  timezone?: string; // IANA zone, e.g. "America/New_York" -- the restaurant's
  // own setting (Manage Dine-In > Time zone), not the customer's device.
  tiers?: EatsDineInTier[];
}

export interface EatsDineInAvailability {
  date: string;
  party_size: number;
  timezone: string; // same IANA zone as EatsDineInConfig.timezone -- slot
  // times below should be displayed in THIS zone, not the device's local one.
  tiers: EatsDineInTier[];
}

export interface EatsDineInReservation {
  reservation: { id: string; start_time: string; end_time: string; status: string; [key: string]: unknown };
  table: { id: string; name: string };
}

/** GET /api/restaurant/restaurants/{id}/dine-in/config -- public-ish read
 *  for the customer booking screen: whether dine-in is on, and the
 *  available table-size tiers. */
export async function getDineInConfig(client: AxiosInstance, accessToken: string, restaurantId: string): Promise<EatsDineInConfig> {
  const { data } = await client.get(`/api/restaurant/restaurants/${restaurantId}/dine-in/config`, {
    headers: authHeaders(accessToken),
  });
  return data as EatsDineInConfig;
}

/** GET /api/restaurant/restaurants/{id}/dine-in/availability -- advisory
 *  per-day availability preview, grouped by table-size tier. The
 *  authoritative check happens server-side when confirming. */
export async function checkDineInAvailability(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  date: string,
  partySize: number
): Promise<EatsDineInAvailability> {
  const { data } = await client.get(`/api/restaurant/restaurants/${restaurantId}/dine-in/availability`, {
    headers: authHeaders(accessToken),
    params: { date, party_size: partySize },
  });
  return data as EatsDineInAvailability;
}

/** POST /api/restaurant/restaurants/{id}/dine-in/reservations -- books the
 *  table immediately (no separate hold step; adar-core's REST surface has
 *  no holdable primitive, only the chat/voice tools do -- see backend
 *  docstring on create_booking in services/scheduling_client.py). */
export async function confirmDineIn(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  body: {
    tableId?: string;
    seats?: number; // the table-tier the customer picked (e.g. "Tables for 4") --
    // lets the backend book from that specific tier instead of auto-picking
    // whichever table happens to be smallest/free.
    partySize: number;
    startTime: string; // ISO 8601
    callerName: string;
    callerPhone?: string;
    callerEmail?: string;
    reason?: string;
  }
): Promise<EatsDineInReservation> {
  const { data } = await client.post(
    `/api/restaurant/restaurants/${restaurantId}/dine-in/reservations`,
    {
      table_id: body.tableId,
      seats: body.seats,
      party_size: body.partySize,
      start_time: body.startTime,
      caller_name: body.callerName,
      caller_phone: body.callerPhone || '',
      caller_email: body.callerEmail || '',
      reason: body.reason || '',
    },
    { headers: authHeaders(accessToken) }
  );
  return data as EatsDineInReservation;
}

export interface EatsMyDineInReservation {
  booking_id: string;
  status: string; // 'confirmed' | 'cancelled'
  table_name: string;
  party_size: number;
  start_time: string; // ISO 8601, UTC
  start_time_formatted: string; // pre-formatted in the restaurant's own timezone
  can_cancel: boolean;
  can_reschedule: boolean;
}

/** GET /api/restaurant/restaurants/{id}/dine-in/my-reservations -- the
 *  signed-in customer's own reservations at this restaurant (past and
 *  upcoming, confirmed and cancelled), for a "My Reservations" screen. */
export async function listMyDineInReservations(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string
): Promise<{ restaurant_id: string; restaurant_name: string; reservations: EatsMyDineInReservation[] }> {
  const { data } = await client.get(`/api/restaurant/restaurants/${restaurantId}/dine-in/my-reservations`, {
    headers: authHeaders(accessToken),
  });
  return data;
}

/** POST /api/restaurant/restaurants/{id}/dine-in/bookings/{bookingId}/cancel
 *  -- usable by the customer who made the reservation OR the restaurant
 *  owner/manager (shared endpoint; the backend checks which one is calling
 *  and notifies the other side accordingly). */
export async function cancelDineInReservation(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  bookingId: string,
  reason?: string
): Promise<{ booking_id: string; status: string }> {
  const { data } = await client.post(
    `/api/restaurant/restaurants/${restaurantId}/dine-in/bookings/${bookingId}/cancel`,
    { reason: reason || '' },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

/** POST /api/restaurant/restaurants/{id}/dine-in/bookings/{bookingId}/reschedule
 *  -- moves the reservation to a new time (cancel-old + create-new under
 *  the hood, since adar-core has no atomic reschedule primitive; the old
 *  slot is only released once the new one is confirmed, so a reschedule
 *  that finds no availability never loses the existing reservation).
 *  Usable by the customer or the restaurant owner/manager, same as cancel. */
export async function rescheduleDineInReservation(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  bookingId: string,
  body: { startTime: string; tableId?: string; seats?: number; reason?: string }
): Promise<EatsDineInReservation & { old_booking_id: string }> {
  const { data } = await client.post(
    `/api/restaurant/restaurants/${restaurantId}/dine-in/bookings/${bookingId}/reschedule`,
    {
      start_time: body.startTime,
      table_id: body.tableId,
      seats: body.seats,
      reason: body.reason || '',
    },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

// ── Owner: dine-in setup ─────────────────────────────────────────────────────

/** POST /api/restaurant/restaurants/{id}/dine-in/enable -- one-time setup,
 *  safe to call again (re-patches rather than duplicating). */
export async function enableDineIn(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  opts: { notificationEmail?: string; timezone?: string; leadTimeMinutes?: number } = {}
): Promise<{ id: string; dine_in_enabled: boolean; scheduling_practice_id: string }> {
  const { data } = await client.post(
    `/api/restaurant/restaurants/${restaurantId}/dine-in/enable`,
    {
      notification_email: opts.notificationEmail || '',
      timezone: opts.timezone || 'UTC',
      lead_time_minutes: opts.leadTimeMinutes ?? 120,
    },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

/** GET /api/restaurant/restaurants/{id}/dine-in/tables -- owner's table list. */
export async function listOwnerTables(client: AxiosInstance, accessToken: string, restaurantId: string): Promise<EatsDineInTable[]> {
  const { data } = await client.get(`/api/restaurant/restaurants/${restaurantId}/dine-in/tables`, {
    headers: authHeaders(accessToken),
  });
  return data.tables as EatsDineInTable[];
}

/** PUT /api/restaurant/restaurants/{id}/dine-in/tables -- full-replace: a
 *  table with an id is updated, one without is created, and any existing
 *  table missing from this list is deactivated (not deleted, so its
 *  booking history stays intact). */
export async function updateOwnerTables(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  tables: { id?: string; name: string; seats: number }[]
): Promise<EatsDineInTable[]> {
  const { data } = await client.put(
    `/api/restaurant/restaurants/${restaurantId}/dine-in/tables`,
    { tables },
    { headers: authHeaders(accessToken) }
  );
  return data.tables as EatsDineInTable[];
}

/** GET /api/restaurant/restaurants/{id}/dine-in/hours -- owner's current
 *  working hours + lead time (applied uniformly to every table). */
export async function getOwnerDineInHours(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string
): Promise<{ working_hours: EatsDineInWorkingHour[]; lead_time_minutes: number; timezone?: string }> {
  const { data } = await client.get(`/api/restaurant/restaurants/${restaurantId}/dine-in/hours`, {
    headers: authHeaders(accessToken),
  });
  return data;
}

/** PUT /api/restaurant/restaurants/{id}/dine-in/hours */
export async function updateOwnerDineInHours(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  workingHours: EatsDineInWorkingHour[],
  leadTimeMinutes?: number,
  timezone?: string
): Promise<{ working_hours: EatsDineInWorkingHour[]; timezone?: string }> {
  const { data } = await client.put(
    `/api/restaurant/restaurants/${restaurantId}/dine-in/hours`,
    { working_hours: workingHours, lead_time_minutes: leadTimeMinutes, timezone },
    { headers: authHeaders(accessToken) }
  );
  return data;
}

export interface EatsDineInBooking {
  id: string;
  start_time: string; // ISO 8601, already in the restaurant's own timezone
  start_label: string; // e.g. "7:30 PM", pre-formatted for display
  table_name: string;
  seats: number;
  caller_name: string;
  caller_phone: string;
}

export interface EatsDineInBookingDay {
  date: string; // YYYY-MM-DD, in the restaurant's own timezone
  label: string; // e.g. "Thursday, October 8"
  bookings: EatsDineInBooking[];
}

/** GET /api/restaurant/restaurants/{id}/dine-in/bookings -- confirmed
 *  reservations grouped by calendar day (owner's Manage screen). The only
 *  other way an owner ever saw a booking before this was the one-time
 *  notification at the moment it was made. */
export async function getOwnerDineInBookings(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  daysAhead = 14
): Promise<{ timezone: string; days: EatsDineInBookingDay[] }> {
  const { data } = await client.get(`/api/restaurant/restaurants/${restaurantId}/dine-in/bookings`, {
    headers: authHeaders(accessToken),
    params: { days_ahead: daysAhead },
  });
  return data;
}

// ── Events & Stalls ──────────────────────────────────────────────────────────
// adar-eats mobile's event food-ordering feature: customers browse live
// events, pick a stall, and order from its (possibly event-only) menu;
// owners request a stall at an event open for onboarding, then manage
// their stall's menu. Backend: routes/restaurant_events.py, mounted
// alongside routes/restaurant.py under the same /api/restaurant prefix --
// see adar-rag/ui/eats/src/services/api.js for the web app's equivalent
// wrapper, which these mirror field-for-field. Admin event creation/
// approval has no mobile screen -- that stays a web-only back-office
// task (AdminEventsPage.jsx), same scoping choice the dine-in feature's
// plan made for its own admin-ish setup work.

export interface EatsEvent {
  id: string;
  name: string;
  venue: string;
  description?: string;
  start_at: string;
  end_at: string;
  status: string; // draft | onboarding | live | closed
  banner_gcs_path?: string | null;
}

export interface EatsEventStall {
  id: string;
  event_id: string;
  restaurant_id: string;
  stall_name: string;
  stall_number: string;
  location_zone: string;
  space_power_needs: string;
  hours: Record<string, unknown>;
  status: string; // requested | approved | rejected | active | closed
  accepting_orders: boolean;
  rejection_reason: string;
  requested_at: string | null;
  approved_at: string | null;
  event_name?: string;
  event_status?: string;
  // Only present on GET .../stalls/{stall_id}/menu's public response (see
  // get_stall_menu_public) -- the stall's own restaurant's IANA timezone.
  restaurant_timezone?: string | null;
  event_start_at?: string | null;
}

export interface EatsEventDetail extends EatsEvent {
  stalls: EatsEventStall[];
}

export interface EatsEventClosed {
  id: string;
  name: string;
  status: 'closed';
  ended: true;
  message: string;
}

export interface EatsEventMenuItem {
  id: string;
  stall_id: string;
  menu_item_id: string | null;
  item_name: string | null;
  category: string;
  description: string;
  price: number | null;
  currency: string;
  image_gcs_path: string | null;
  image_url: string | null;
  has_inherited_photo?: boolean;
  availability: string;
}

export interface EatsEventStallWithMenu extends EatsEventStall {
  menu_items: EatsEventMenuItem[];
}

/** Public stall-menu item shape, as the customer ordering screen and the
 *  event assistant see it -- already resolved to display-ready
 *  name/category/description/price (the regular-menu fallback is applied
 *  server-side) and a signed image_url. */
export interface EatsEventPublicMenuItem {
  id: string;
  item_name: string;
  category: string;
  description: string;
  price: number | null;
  currency: string;
  image_url: string | null;
}

export interface EatsEventStallMenuPublic {
  stall: EatsEventStall;
  menu_items: EatsEventPublicMenuItem[];
}

/** GET /api/restaurant/events/live -- customer-facing event discovery,
 *  guest-accessible. */
export async function listLiveEvents(client: AxiosInstance, accessToken: string): Promise<EatsEvent[]> {
  const { data } = await client.get('/api/restaurant/events/live', {
    headers: authHeaders(accessToken),
  });
  return (data?.events as EatsEvent[]) || [];
}

/** GET /api/restaurant/events/available -- events currently open for
 *  stall onboarding, what an owner picks from to request a stall. */
export async function listAvailableEvents(client: AxiosInstance, accessToken: string): Promise<EatsEvent[]> {
  const { data } = await client.get('/api/restaurant/events/available', {
    headers: authHeaders(accessToken),
  });
  return (data?.events as EatsEvent[]) || [];
}

/** GET /api/restaurant/events/{id} -- full event + its active stalls. A
 *  closed event comes back as {ended: true, message} instead -- callers
 *  should check `ended` before reading `stalls`. */
export async function getEvent(
  client: AxiosInstance,
  accessToken: string,
  eventId: string
): Promise<EatsEventDetail | EatsEventClosed> {
  const { data } = await client.get(`/api/restaurant/events/${eventId}`, {
    headers: authHeaders(accessToken),
  });
  return data;
}

/** GET /api/restaurant/events/{eventId}/stalls/{stallId}/menu -- public,
 *  guest-accessible stall menu for ordering; backs both the customer
 *  ordering screen and the event-scoped assistant's context. */
export async function getStallMenuPublic(
  client: AxiosInstance,
  accessToken: string,
  eventId: string,
  stallId: string
): Promise<EatsEventStallMenuPublic> {
  const { data } = await client.get(`/api/restaurant/events/${eventId}/stalls/${stallId}/menu`, {
    headers: authHeaders(accessToken),
  });
  return data as EatsEventStallMenuPublic;
}

export interface EatsEventOrderItemInput {
  event_menu_item_id: string;
  quantity: number;
  instructions?: string;
}

/** POST /api/restaurant/events/{eventId}/stalls/{stallId}/order-draft --
 *  the event-ordering equivalent of createOrderDraft above: a plain
 *  restaurant_orders row tagged with event_id/stall_id, so the SAME
 *  checkoutOrder/getOrder/listMyOrders calls work on it unmodified once
 *  this draft exists. */
export async function createEventOrderDraft(
  client: AxiosInstance,
  accessToken: string,
  eventId: string,
  stallId: string,
  params: {
    items: EatsEventOrderItemInput[];
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    pickupTimeRequest?: string;
    pickupDate?: string | null;
    pickupTime?: string | null;
    specialInstructions?: string;
  }
): Promise<EatsOrderResponse> {
  const { data } = await client.post(
    `/api/restaurant/events/${eventId}/stalls/${stallId}/order-draft`,
    {
      items: params.items,
      customer_name: params.customerName || '',
      customer_phone: params.customerPhone || '',
      customer_email: params.customerEmail || '',
      pickup_time_request: params.pickupTimeRequest || '',
      pickup_date: params.pickupDate ?? null,
      pickup_time: params.pickupTime ?? null,
      special_instructions: params.specialInstructions || '',
    },
    { headers: authHeaders(accessToken) }
  );
  return data as EatsOrderResponse;
}

// ── Owner: stall request + management ────────────────────────────────────

/** POST /api/restaurant/restaurants/{restaurantId}/stalls -- request a
 *  stall at an event currently open for onboarding. */
export async function requestStall(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  params: { eventId: string; stallName?: string; locationZone?: string; spacePowerNeeds?: string }
): Promise<EatsEventStall> {
  const { data } = await client.post(
    `/api/restaurant/restaurants/${restaurantId}/stalls`,
    {
      event_id: params.eventId,
      stall_name: params.stallName || '',
      location_zone: params.locationZone || '',
      space_power_needs: params.spacePowerNeeds || '',
    },
    { headers: authHeaders(accessToken) }
  );
  return data as EatsEventStall;
}

/** GET /api/restaurant/restaurants/{restaurantId}/stalls -- this
 *  restaurant's own stalls across every event it has requested/been
 *  approved for. */
export async function listMyStalls(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string
): Promise<EatsEventStall[]> {
  const { data } = await client.get(`/api/restaurant/restaurants/${restaurantId}/stalls`, {
    headers: authHeaders(accessToken),
  });
  return (data?.stalls as EatsEventStall[]) || [];
}

/** GET /api/restaurant/restaurants/{restaurantId}/stalls/{stallId} -- one
 *  stall's detail + its event menu items (owner's own view -- unlike the
 *  public shape above, these include image_gcs_path/has_inherited_photo). */
export async function getMyStall(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  stallId: string
): Promise<EatsEventStallWithMenu> {
  const { data } = await client.get(`/api/restaurant/restaurants/${restaurantId}/stalls/${stallId}`, {
    headers: authHeaders(accessToken),
  });
  return data as EatsEventStallWithMenu;
}

/** PUT /api/restaurant/restaurants/{restaurantId}/stalls/{stallId} --
 *  PATCH-style partial update (only sent fields change). Also how an
 *  owner pauses/resumes new orders mid-rush (accepting_orders alone stays
 *  editable even on a rejected stall / after the event closes --
 *  everything else is frozen in those states). */
export async function updateMyStall(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  stallId: string,
  patch: {
    stallName?: string;
    locationZone?: string;
    spacePowerNeeds?: string;
    hours?: Record<string, unknown>;
    acceptingOrders?: boolean;
  }
): Promise<EatsEventStall> {
  const body: Record<string, unknown> = {};
  if (patch.stallName !== undefined) body.stall_name = patch.stallName;
  if (patch.locationZone !== undefined) body.location_zone = patch.locationZone;
  if (patch.spacePowerNeeds !== undefined) body.space_power_needs = patch.spacePowerNeeds;
  if (patch.hours !== undefined) body.hours = patch.hours;
  if (patch.acceptingOrders !== undefined) body.accepting_orders = patch.acceptingOrders;
  const { data } = await client.put(`/api/restaurant/restaurants/${restaurantId}/stalls/${stallId}`, body, {
    headers: authHeaders(accessToken),
  });
  return data as EatsEventStall;
}

/** GET .../stalls/{stallId}/menu-items -- owner's own event menu item list. */
export async function listStallMenuItems(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  stallId: string
): Promise<EatsEventMenuItem[]> {
  const { data } = await client.get(
    `/api/restaurant/restaurants/${restaurantId}/stalls/${stallId}/menu-items`,
    { headers: authHeaders(accessToken) }
  );
  return (data?.menu_items as EatsEventMenuItem[]) || [];
}

export interface EatsEventMenuItemInput {
  menuItemId?: string | null;
  itemName?: string;
  category?: string;
  description?: string;
  price?: number | null;
  currency?: string;
  availability?: string;
}

/** POST .../stalls/{stallId}/menu-items -- link an existing regular menu
 *  item (menuItemId, with an optional price override), or stand up a
 *  net-new event-only item (itemName + price required). A linked item
 *  with no event-specific photo of its own inherits the regular item's
 *  photo -- see image_url/has_inherited_photo on the returned row. */
export async function createStallMenuItem(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  stallId: string,
  input: EatsEventMenuItemInput
): Promise<EatsEventMenuItem> {
  const { data } = await client.post(
    `/api/restaurant/restaurants/${restaurantId}/stalls/${stallId}/menu-items`,
    {
      menu_item_id: input.menuItemId ?? null,
      item_name: input.itemName,
      category: input.category || '',
      description: input.description || '',
      price: input.price ?? null,
      currency: input.currency || 'USD',
      availability: input.availability || 'available',
    },
    { headers: authHeaders(accessToken) }
  );
  return data as EatsEventMenuItem;
}

/** PUT .../stalls/{stallId}/menu-items/{itemId} -- PATCH-style partial update. */
export async function updateStallMenuItem(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  stallId: string,
  itemId: string,
  patch: Partial<{
    itemName: string;
    category: string;
    description: string;
    price: number | null;
    availability: string;
  }>
): Promise<EatsEventMenuItem> {
  const body: Record<string, unknown> = {};
  if (patch.itemName !== undefined) body.item_name = patch.itemName;
  if (patch.category !== undefined) body.category = patch.category;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.price !== undefined) body.price = patch.price;
  if (patch.availability !== undefined) body.availability = patch.availability;
  const { data } = await client.put(
    `/api/restaurant/restaurants/${restaurantId}/stalls/${stallId}/menu-items/${itemId}`,
    body,
    { headers: authHeaders(accessToken) }
  );
  return data as EatsEventMenuItem;
}

/** DELETE .../stalls/{stallId}/menu-items/{itemId} */
export async function deleteStallMenuItem(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  stallId: string,
  itemId: string
): Promise<void> {
  await client.delete(`/api/restaurant/restaurants/${restaurantId}/stalls/${stallId}/menu-items/${itemId}`, {
    headers: authHeaders(accessToken),
  });
}

/** POST .../menu-items/{itemId}/photo -- upload/replace this event item's
 *  OWN photo (overrides an inherited regular-menu photo for this event
 *  only). Mirrors uploadMenuItemPhoto above exactly. */
export async function uploadStallMenuItemPhoto(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  stallId: string,
  itemId: string,
  photo: { uri: string; mimeType: string; name: string }
): Promise<{ item_id: string; image_url: string | null }> {
  const form = new FormData();
  form.append('photo', { uri: photo.uri, name: photo.name, type: photo.mimeType } as unknown as Blob);
  const { data } = await client.post(
    `/api/restaurant/restaurants/${restaurantId}/stalls/${stallId}/menu-items/${itemId}/photo`,
    form,
    { headers: { ...authHeaders(accessToken), 'Content-Type': 'multipart/form-data' } }
  );
  return data;
}

/** DELETE .../menu-items/{itemId}/photo -- removes this item's OWN photo
 *  override; falls back to the linked regular item's photo if any,
 *  otherwise no photo. */
export async function deleteStallMenuItemPhoto(
  client: AxiosInstance,
  accessToken: string,
  restaurantId: string,
  stallId: string,
  itemId: string
): Promise<{ item_id: string; image_url: string | null }> {
  const { data } = await client.delete(
    `/api/restaurant/restaurants/${restaurantId}/stalls/${stallId}/menu-items/${itemId}/photo`,
    { headers: authHeaders(accessToken) }
  );
  return data;
}

/** The event-scoped Order Assistant's tappable menu action -- mirrors the
 *  shape backend's _event_action_row builds (routes/chat.py), which is
 *  every column from _fetch_event_menu_rows plus the overridden
 *  menu_item_id/restaurant_id pair that's internal plumbing only (the
 *  generic cross-mode action-matching code keys on those two names
 *  regardless of mode). Use the EXPLICIT fields below -- event_menu_item_id/
 *  stall_id/stall_name/accepting_orders -- to build the actual
 *  add-to-cart call, never menu_item_id/restaurant_id. */
export interface EatsEventChatMenuAction {
  id: string;
  event_menu_item_id: string;
  stall_id: string;
  event_id: string;
  stall_name: string;
  accepting_orders: boolean;
  restaurant_name: string;
  item_name: string;
  category?: string;
  description?: string;
  price?: number | null;
  currency?: string;
  availability?: string;
}

/** Streams /api/chat/stream scoped to one event (event_id instead of
 *  marketplace: true) -- the event-scoped Order Assistant. Mirrors
 *  streamRestaurantChat exactly, same streamSse plumbing. */
export function streamEventChat(
  baseURL: string,
  accessToken: string,
  params: {
    question: string;
    history?: { role: string; content: string }[];
    eventId: string;
    responseLanguage?: string;
  },
  handlers: ChatStreamHandlers
) {
  return streamSse(baseURL, '/api/chat/stream', accessToken, {
    question: params.question,
    document_ids: [],
    history: params.history ?? [],
    event_id: params.eventId,
    response_language: params.responseLanguage,
  }, handlers);
}
