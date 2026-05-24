import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '@/components/layout/Sidebar';
import WorkspacePanel from '@/components/layout/WorkspacePanel';

const DEFAULT_WORKSPACE_PANEL_WIDTH = 680;

type WorkspacePanelContextValue = {
  open: boolean;
  available: boolean;
  toggle: () => void;
  close: () => void;
};

const WorkspacePanelContext = createContext<WorkspacePanelContextValue>({
  open: false,
  available: false,
  toggle: () => {},
  close: () => {},
});

export function useWorkspacePanel() {
  return useContext(WorkspacePanelContext);
}

export default function Layout() {
  const location = useLocation();
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const [workspacePanelWidth, setWorkspacePanelWidth] = useState(DEFAULT_WORKSPACE_PANEL_WIDTH);
  const activeTaskSessionId = useMemo(() => {
    if (location.pathname !== '/agent') {
      return null;
    }
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session');
    return sessionId?.startsWith('task:') ? sessionId : null;
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!activeTaskSessionId) {
      setWorkspacePanelOpen(false);
    }
  }, [activeTaskSessionId]);

  const panelVisible = Boolean(activeTaskSessionId && workspacePanelOpen);
  const contextValue = useMemo(
    () => ({
      open: panelVisible,
      available: Boolean(activeTaskSessionId),
      toggle: () => {
        if (!activeTaskSessionId) {
          return;
        }
        setWorkspacePanelOpen((open) => !open);
      },
      close: () => setWorkspacePanelOpen(false),
    }),
    [activeTaskSessionId, panelVisible],
  );

  return (
    <WorkspacePanelContext.Provider value={contextValue}>
      <div className="h-screen overflow-hidden bg-gray-950 text-white">
        <Sidebar />
        {activeTaskSessionId && (
          <WorkspacePanel
            sessionId={activeTaskSessionId}
            open={panelVisible}
            width={workspacePanelWidth}
            onWidthChange={setWorkspacePanelWidth}
            onClose={() => setWorkspacePanelOpen(false)}
          />
        )}

        <div
          className="ml-60 h-screen overflow-hidden transition-[margin]"
          style={panelVisible ? { marginRight: `${workspacePanelWidth}px` } : undefined}
        >
          <main className="h-full overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </WorkspacePanelContext.Provider>
  );
}
