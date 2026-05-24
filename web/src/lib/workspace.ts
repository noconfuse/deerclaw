export const WORKSPACE_ATTACH_EVENT = 'zeroclaw-workspace-attach';

export type WorkspaceAttachmentEventDetail = {
  name: string;
  mimeType: string;
  size: number;
  localPath: string;
  kind: 'image' | 'file';
};

export function dispatchWorkspaceAttachment(detail: WorkspaceAttachmentEventDetail) {
  window.dispatchEvent(new CustomEvent<WorkspaceAttachmentEventDetail>(WORKSPACE_ATTACH_EVENT, { detail }));
}
