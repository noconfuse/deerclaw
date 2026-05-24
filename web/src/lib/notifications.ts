export const GLOBAL_NOTIFICATION_EVENT = 'zeroclaw-global-notification';

export type NotificationKind = 'error' | 'success' | 'info';

export type NotificationOptions = {
  key?: string;
};

export type GlobalNotificationDetail = {
  message: string;
  kind: NotificationKind;
  key?: string;
};

export function notify(
  message: string,
  kind: NotificationKind = 'info',
  options?: NotificationOptions,
) {
  window.dispatchEvent(
    new CustomEvent<GlobalNotificationDetail>(GLOBAL_NOTIFICATION_EVENT, {
      detail: { message, kind, key: options?.key },
    }),
  );
}

export function notifyError(message: string, options?: NotificationOptions) {
  notify(message, 'error', options);
}

export function notifySuccess(message: string, options?: NotificationOptions) {
  notify(message, 'success', options);
}

export function notifyInfo(message: string, options?: NotificationOptions) {
  notify(message, 'info', options);
}
