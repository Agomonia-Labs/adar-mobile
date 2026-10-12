import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from '@adar/shared-auth';
import { getRestaurantWorkspace } from './eatsApi';

// Which workspace the signed-in owner/user's restaurant/scribe/order
// actions act on. adar-eats mobile has exactly one answer: the single
// shared restaurant workspace, same as the desktop app -- there is no
// personal (workspace_id=null) mode here and no picker. Before this
// existed, every owner-side call on mobile defaulted to workspace_id=null,
// a personal space scoped to just that one device's account, completely
// separate from the shared workspace the same person already belongs to
// on desktop -- so a menu recorded from the phone was invisible to
// everyone else on the team. Then, briefly, mobile auto-joined "the one
// workspace you're already in" with a personal fallback and a picker for
// 2+ -- replaced by this simpler rule per product decision: every owner
// and user is always connected to the one restaurant workspace, full
// stop. GET /api/restaurant/workspace resolves it server-side and
// auto-grants editor membership the first time a given account hits it,
// so a brand-new mobile sign-up ends up connected without anyone having
// to invite them by hand.
interface WorkspaceContextValue {
  workspaceId: string | null;
  workspaceName: string;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const ws = await getRestaurantWorkspace(client, accessToken);
      setWorkspaceId(ws.workspace_id);
      setWorkspaceName(ws.workspace_name);
    } catch (err: any) {
      // Bootstrap case (HTTP 409): no restaurant workspace exists in the
      // system yet -- an owner needs to create one from the desktop app
      // first. Any other failure (network, auth) gets the same generic
      // message; either way we deliberately do NOT fall back to a
      // personal workspace_id=null context on mobile.
      if (err?.response?.status === 409) {
        setError('No restaurant workspace set up yet. Ask an owner to create one from the desktop app.');
      } else {
        setError('Could not connect to your restaurant workspace.');
      }
      setWorkspaceId(null);
      setWorkspaceName('');
    } finally {
      setLoading(false);
    }
  }, [client, accessToken]);

  useEffect(() => {
    if (accessToken) refresh();
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <WorkspaceContext.Provider value={{ workspaceId, workspaceName, loading, error, refresh }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return ctx;
}
