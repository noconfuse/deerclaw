import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  PanelRightClose,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  openChatWorkspaceFolder,
  getChatWorkspace,
  getChatWorkspacePreview,
  type ChatWorkspaceFile,
  type ChatWorkspacePreview,
} from '@/lib/api';
import { dispatchWorkspaceAttachment } from '@/lib/workspace';

const MIN_WORKSPACE_PANEL_WIDTH = 560;
const MAX_WORKSPACE_PANEL_WIDTH = 1120;

type WorkspaceNode = ChatWorkspaceFile & {
  children: WorkspaceNode[];
};

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function buildWorkspaceTree(files: ChatWorkspaceFile[]) {
  const byPath = new Map<string, WorkspaceNode>();
  const roots: WorkspaceNode[] = [];

  const sorted = [...files].sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  for (const file of sorted) {
    byPath.set(file.relative_path, { ...file, children: [] });
  }

  for (const file of sorted) {
    const node = byPath.get(file.relative_path);
    if (!node) continue;
    const parentPath = file.relative_path.includes('/')
      ? file.relative_path.slice(0, file.relative_path.lastIndexOf('/'))
      : '';
    const parent = parentPath ? byPath.get(parentPath) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: WorkspaceNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind === 'directory' && b.kind !== 'directory') return -1;
      if (a.kind !== 'directory' && b.kind === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);

  return { roots, byPath };
}

function flattenNodes(nodes: WorkspaceNode[]): WorkspaceNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

function WorkspaceTreeItem({
  node,
  depth,
  selectedPath,
  expandedPaths,
  onToggleExpand,
  onSelect,
  onContextMenu,
}: {
  node: WorkspaceNode;
  depth: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onSelect: (path: string) => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>, node: WorkspaceNode) => void;
}) {
  const isDirectory = node.kind === 'directory';
  const isExpanded = expandedPaths.has(node.relative_path);
  const isSelected = selectedPath === node.relative_path;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={`flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
          isSelected
            ? 'bg-blue-500/10 text-white'
            : 'text-gray-300 hover:bg-gray-800/80 hover:text-white'
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {isDirectory ? (
          <button
            type="button"
            onClick={() => hasChildren && onToggleExpand(node.relative_path)}
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-gray-500 transition-colors ${
              hasChildren ? 'hover:bg-gray-700/80 hover:text-white' : 'cursor-default opacity-40'
            }`}
            aria-label={isExpanded ? 'Collapse directory' : 'Expand directory'}
          >
            {hasChildren ? (
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
            ) : (
              <span className="h-3.5 w-3.5" />
            )}
          </button>
        ) : node.kind === 'image' ? (
          <span className="h-4 w-4 shrink-0" />
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.relative_path)}
          onDoubleClick={() => {
            if (isDirectory && hasChildren) {
              onToggleExpand(node.relative_path);
            }
          }}
          onContextMenu={(event) => onContextMenu(event, node)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-emerald-300" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-emerald-300" />
            )
          ) : node.kind === 'image' ? (
            <ImageIcon className="h-4 w-4 shrink-0 text-blue-300" />
          ) : (
            <FileIcon className="h-4 w-4 shrink-0 text-gray-400" />
          )}
          <span className="min-w-0 truncate">{node.name}</span>
        </button>
      </div>

      {isDirectory && isExpanded && node.children.length > 0 && (
        <div className="space-y-0.5">
          {node.children.map((child) => (
            <WorkspaceTreeItem
              key={child.relative_path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function WorkspacePanel({
  sessionId,
  open,
  width,
  onWidthChange,
  onClose,
}: {
  sessionId: string;
  open: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [scopePath, setScopePath] = useState('');
  const [files, setFiles] = useState<ChatWorkspaceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChatWorkspacePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [resizing, setResizing] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: WorkspaceNode;
  } | null>(null);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const loadWorkspace = async () => {
    setLoading(true);
    try {
      const response = await getChatWorkspace(sessionId);
      setScopePath(response.scope_path);
      setFiles(response.files);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('agent.workspace_load_failed'));
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadWorkspace();
  }, [open, sessionId]);

  const { roots, byPath } = useMemo(() => buildWorkspaceTree(files), [files]);
  const allNodes = useMemo(() => flattenNodes(roots), [roots]);

  useEffect(() => {
    if (!open) return;
    setExpandedPaths(
      new Set(
        roots
          .filter((node) => node.kind === 'directory')
          .map((node) => node.relative_path),
      ),
    );
  }, [open, roots]);

  useEffect(() => {
    if (!open) return;
    if (selectedPath && byPath.has(selectedPath)) {
      return;
    }
    const nextTarget = allNodes[0] ?? null;
    setSelectedPath(nextTarget?.relative_path ?? null);
  }, [allNodes, byPath, open, selectedPath]);

  useEffect(() => {
    if (!selectedPath) {
      return;
    }
    const segments = selectedPath.split('/').filter(Boolean);
    if (segments.length <= 1) {
      return;
    }
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      let current = '';
      for (let index = 0; index < segments.length - 1; index += 1) {
        current = current ? `${current}/${segments[index]}` : segments[index]!;
        next.add(current);
      }
      return next;
    });
  }, [selectedPath]);

  useEffect(() => {
    const current = selectedPath ? byPath.get(selectedPath) : null;
    if (!open || !current) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    if (current.kind === 'directory') {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    const loadPreview = async () => {
      setPreviewLoading(true);
      try {
        const response = await getChatWorkspacePreview(sessionId, current.relative_path);
        if (!cancelled) {
          setPreview(response);
          setPreviewError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(
            err instanceof Error ? err.message : t('agent.workspace_load_failed'),
          );
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    };

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [byPath, open, selectedPath, sessionId, t]);

  const selectedNode = selectedPath ? byPath.get(selectedPath) ?? null : null;
  const directoryChildren = useMemo(() => {
    if (!selectedNode || selectedNode.kind !== 'directory') {
      return [];
    }
    return selectedNode.children;
  }, [selectedNode]);
  useEffect(() => {
    if (!open) {
      setResizing(false);
      resizeStateRef.current = null;
      setContextMenu(null);
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const current = resizeStateRef.current;
      if (!current) {
        return;
      }
      const maxWidth = Math.min(MAX_WORKSPACE_PANEL_WIDTH, window.innerWidth - 320);
      const nextWidth = Math.min(
        Math.max(current.startWidth + (current.startX - event.clientX), MIN_WORKSPACE_PANEL_WIDTH),
        Math.max(MIN_WORKSPACE_PANEL_WIDTH, maxWidth),
      );
      onWidthChange(nextWidth);
    };

    const handlePointerUp = () => {
      resizeStateRef.current = null;
      setResizing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [onWidthChange, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = () => {
      setContextMenu(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handleSelectPath = (path: string) => {
    setSelectedPath(path);
  };

  const handleItemContextMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    node: WorkspaceNode,
  ) => {
    if (node.kind === 'directory') {
      return;
    }
    event.preventDefault();
    handleSelectPath(node.relative_path);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      node,
    });
  };

  const contextMenuLocalPath =
    contextMenu?.node.relative_path === preview?.relative_path
      ? preview?.local_path ?? ''
      : contextMenu?.node.local_path ?? '';

  const handleContextOpenFolder = async () => {
    const currentMenu = contextMenu;
    if (!currentMenu || !contextMenuLocalPath) {
      return;
    }
    try {
      await openChatWorkspaceFolder(sessionId, currentMenu.node.relative_path);
    } catch (_err) {
      // The API helper already forwards the error to the global toast.
    } finally {
      setContextMenu(null);
    }
  };

  const handleContextAttachToComposer = () => {
    if (!contextMenu || !contextMenuLocalPath) {
      return;
    }
    dispatchWorkspaceAttachment({
      name: contextMenu.node.name,
      mimeType: contextMenu.node.mime_type,
      size: contextMenu.node.size,
      localPath: contextMenuLocalPath,
      kind: contextMenu.node.kind === 'image' ? 'image' : 'file',
    });
    setContextMenu(null);
  };

  if (!open) {
    return null;
  }

  return (
    <aside
      className={`fixed top-0 right-0 z-40 flex h-screen shrink-0 flex-col border-l border-gray-800 bg-gray-950 ${
        resizing ? 'select-none' : ''
      }`}
      style={{ width: `${width}px` }}
    >
      <div
        className="absolute top-0 left-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-blue-500/40"
        onPointerDown={(event) => {
          resizeStateRef.current = { startX: event.clientX, startWidth: width };
          setResizing(true);
        }}
      />
      <div className="flex h-16 items-center justify-between gap-3 border-b border-gray-800 px-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">{t('agent.workspace_title')}</div>
          <div className="truncate text-xs text-gray-500">
            {scopePath || t('agent.workspace_scope_empty')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadWorkspace()}
            className="text-gray-500 transition-colors hover:text-white"
            title={t('agent.workspace_refresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 transition-colors hover:text-white"
            title={t('agent.workspace_close')}
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: `minmax(220px, 32%) minmax(0, 1fr)` }}
      >
        <div className="min-h-0 overflow-y-auto border-r border-gray-800 px-2 py-3">
          {loading && files.length === 0 ? (
            <div className="flex items-center gap-2 px-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('agent.workspace_loading')}</span>
            </div>
          ) : error ? (
            <div className="px-2 text-sm text-red-300">{error}</div>
          ) : files.length === 0 ? (
            <div className="px-2 text-sm text-gray-500">{t('agent.workspace_empty')}</div>
          ) : (
            <div className="space-y-0.5">
              {roots.map((node) => (
                <WorkspaceTreeItem
                  key={node.relative_path}
                  node={node}
                  depth={0}
                  selectedPath={selectedPath}
                  expandedPaths={expandedPaths}
                  onToggleExpand={(path) =>
                    setExpandedPaths((prev) => {
                      const next = new Set(prev);
                      if (next.has(path)) {
                        next.delete(path);
                      } else {
                        next.add(path);
                      }
                      return next;
                    })
                  }
                  onSelect={handleSelectPath}
                  onContextMenu={handleItemContextMenu}
                />
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto px-4 py-4">
          {!selectedNode ? (
            <div className="text-sm text-gray-500">{t('agent.workspace_empty')}</div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 text-sm text-white">
                  {selectedNode.kind === 'directory' ? (
                    <FolderOpen className="h-4 w-4 text-emerald-300" />
                  ) : selectedNode.kind === 'image' ? (
                    <ImageIcon className="h-4 w-4 text-blue-300" />
                  ) : (
                    <FileIcon className="h-4 w-4 text-gray-400" />
                  )}
                  <span className="truncate font-medium">{selectedNode.name}</span>
                </div>
                <p className="mt-1 break-all text-xs text-gray-500">
                  {selectedNode.workspace_path}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  {selectedNode.mime_type} · {formatFileSize(selectedNode.size)}
                </p>
              </div>

              {selectedNode.kind === 'directory' ? (
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-gray-500">
                    {t('agent.workspace_files')}
                  </p>
                  {directoryChildren.length === 0 ? (
                    <div className="text-sm text-gray-500">{t('agent.workspace_empty')}</div>
                  ) : (
                    <div className="space-y-1">
                      {directoryChildren.map((child) => (
                        <button
                          key={child.relative_path}
                          type="button"
                          onClick={() => handleSelectPath(child.relative_path)}
                          onContextMenu={(event) => handleItemContextMenu(event, child)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-800/80 hover:text-white"
                        >
                          {child.kind === 'directory' ? (
                            <Folder className="h-4 w-4 shrink-0 text-emerald-300" />
                          ) : child.kind === 'image' ? (
                            <ImageIcon className="h-4 w-4 shrink-0 text-blue-300" />
                          ) : (
                            <FileIcon className="h-4 w-4 shrink-0 text-gray-400" />
                          )}
                          <span className="truncate">{child.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : previewLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{t('agent.workspace_loading')}</span>
                </div>
              ) : previewError ? (
                <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                  {previewError}
                </div>
              ) : preview?.image_data_url ? (
                <img
                  src={preview.image_data_url}
                  alt={preview.name}
                  className="max-h-[70vh] w-full rounded-xl border border-gray-800 object-contain"
                />
              ) : (
                <div className="space-y-4">
                  {preview?.html_preview && preview.preview_source === 'officecli' ? (
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gray-500">
                        <span>{t('agent.workspace_office_preview')}</span>
                        <span className="rounded-full border border-gray-800 px-2 py-0.5 normal-case tracking-normal text-gray-400">
                          OfficeCLI
                        </span>
                      </div>
                      <div className="overflow-hidden rounded-xl border border-gray-800 bg-white">
                        <iframe
                          title={preview.name}
                          srcDoc={preview.html_preview}
                          sandbox=""
                          className="h-[65vh] w-full"
                        />
                      </div>
                    </div>
                  ) : null}

                  {preview?.outline_preview ? (
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-[0.18em] text-gray-500">
                        {t('agent.workspace_outline')}
                      </p>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-l border-gray-800 pl-3 text-[11px] leading-6 text-gray-400">
                        {preview.outline_preview}
                      </pre>
                    </div>
                  ) : null}

                  {preview?.text_preview ? (
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gray-500">
                        <span>{t('agent.workspace_text_preview')}</span>
                        {preview.preview_source === 'officecli' ? (
                          <span className="rounded-full border border-gray-800 px-2 py-0.5 normal-case tracking-normal text-gray-400">
                            OfficeCLI
                          </span>
                        ) : null}
                      </div>
                      <pre className="whitespace-pre-wrap wrap-break-word text-[12px] leading-7 text-gray-200">
                        {preview.text_preview}
                      </pre>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">
                      {t('agent.workspace_no_preview')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {contextMenu && (
        <div
          className="fixed z-60 min-w-[180px] overflow-hidden rounded-xl border border-gray-800 bg-gray-900/98 p-1 shadow-2xl shadow-black/50"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 200),
            top: Math.min(contextMenu.y, window.innerHeight - 120),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void handleContextOpenFolder()}
            className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-800"
          >
            {t('agent.workspace_open_folder')}
          </button>
          <button
            type="button"
            onClick={handleContextAttachToComposer}
            className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-800"
          >
            {t('agent.workspace_attach_to_chat')}
          </button>
        </div>
      )}
    </aside>
  );
}
