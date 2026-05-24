import { useMemo } from 'react';
import {
  notify,
  notifyError,
  notifyInfo,
  notifySuccess,
  type NotificationOptions,
} from '@/lib/notifications';

export function useNotify() {
  return useMemo(
    () => ({
      notify: (message: string, options?: NotificationOptions) => notify(message, 'info', options),
      error: (message: string, options?: NotificationOptions) => notifyError(message, options),
      success: (message: string, options?: NotificationOptions) => notifySuccess(message, options),
      info: (message: string, options?: NotificationOptions) => notifyInfo(message, options),
    }),
    [],
  );
}
