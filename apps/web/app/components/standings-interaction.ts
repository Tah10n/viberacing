export interface DialogControl {
  readonly close: () => void;
  readonly open: boolean;
  readonly showModal: () => void;
}

export function syncProfileDialog(dialog: DialogControl, hasSelectedRow: boolean): void {
  if (!hasSelectedRow) {
    if (dialog.open) dialog.close();
    return;
  }
  if (!dialog.open) dialog.showModal();
}

export function isProfileShortcut(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function shouldOpenProfile(isInteractiveTarget: boolean): boolean {
  return !isInteractiveTarget;
}
