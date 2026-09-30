import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from '@adar/shared-auth';
import { DocIntelWorkspace, extractDocIntelError, listWorkspaces } from './docintelApi';

// The app-wide "which workspace am I in" selector. `null` means Personal
// (documents/chat/courses with no workspace_id -- private to this
// account), matching the web app's own personal/workspace split. Every
// screen that lists or creates documents/courses reads `active` from here
// so switching workspaces here changes what the whole app sees --
// that IS the workspace-isolation feature, not a separate settings toggle.
interface WorkspaceContextValue {
  workspaces: DocIntelWorkspace[];
  active: DocIntelWorkspace | null; // null == Personal
  setActive: (ws: DocIntelWorkspace | null) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ baseURL, children }: { baseURL: string; children: React.ReactNode }) {
  const { client, session } = useAuth();
  const [workspaces, setWorkspaces] = useState<DocIntelWorkspace[]>([]);
  const [active, setActive] = useState<DocIntelWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const list = await listWorkspaces(client, session.accessToken);
      setWorkspaces(list);
      setError(null);
      // Keep the active selection in sync if it still exists; otherwise
      // fall back to Personal rather than silently pointing at a
      // workspace the user no longer belongs to.
      setActive((prev) => (prev ? list.find((w) => w.id === prev.id) ?? null : null));
    } catch (err: any) {
      // Previously uncaught: the "app startup" unhandled-promise-rejection
      // warning ("AxiosError: Request failed with status code 401") was
      // this call rejecting with nothing downstream to catch it -- the
      // effect below just calls refresh() and never chains .catch(). A
      // 401 here is almost always a stale/expired token restored from a
      // previous session: shared-auth's response interceptor already
      // clears it and flips `session` to null (App.tsx's Gate then swaps
      // back to the login screen on its own), but the interceptor still
      // re-throws so the *original* caller -- this one -- has to handle
      // it too, or it surfaces as a console warning instead of failing
      // quietly. Any other failure (network blip, cold Cloud Run
      // instance) now also fails quietly instead of crashing this
      // provider, with `error` here for any screen that wants to show it.
      if (err?.response?.status !== 401) {
        setError(extractDocIntelError(err, 'Could not load workspaces.'));
      }
    } finally {
      setLoading(false);
    }
  }, [client, session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <WorkspaceContext.Provider value={{ workspaces, active, setActive, loading, error, refresh }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return ctx;
}
