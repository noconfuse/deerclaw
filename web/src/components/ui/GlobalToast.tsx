import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import {
  GLOBAL_NOTIFICATION_EVENT,
  type GlobalNotificationDetail,
  type NotificationKind,
} from '@/lib/notifications';

type ToastItem = {
  id: string;
  message: string;
  kind: NotificationKind;
  count: number;
  dedupeKey: string;
};

const TOAST_MAX_ITEMS = 4;

function toastLifetime(kind: NotificationKind) {
  switch (kind) {
    case 'success':
      return 2600;
    case 'info':
      return 4000;
    case 'error':
    default:
      return 6000;
  }
}

function toastStyles(kind: NotificationKind) {
  switch (kind) {
    case 'success':
      return {
        icon: CheckCircle2,
        container:
          'border-green-900/70 bg-gray-950/95 text-green-100 shadow-black/50',
        iconClass: 'text-green-300',
        buttonClass: 'text-green-200/70 hover:bg-green-500/10 hover:text-green-100',
      };
    case 'info':
      return {
        icon: Info,
        container:
          'border-blue-900/70 bg-gray-950/95 text-blue-100 shadow-black/50',
        iconClass: 'text-blue-300',
        buttonClass: 'text-blue-200/70 hover:bg-blue-500/10 hover:text-blue-100',
      };
    case 'error':
    default:
      return {
        icon: AlertCircle,
        container:
          'border-red-900/70 bg-gray-950/95 text-red-100 shadow-black/50',
        iconClass: 'text-red-300',
        buttonClass: 'text-red-200/70 hover:bg-red-500/10 hover:text-red-100',
      };
  }
}

export default function GlobalToast() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timeoutIdsRef = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timeoutId = timeoutIdsRef.current.get(id);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      timeoutIdsRef.current.delete(id);
    }
    setItems((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const scheduleDismiss = useCallback(
    (id: string, kind: NotificationKind) => {
      const existingTimeout = timeoutIdsRef.current.get(id);
      if (existingTimeout !== undefined) {
        window.clearTimeout(existingTimeout);
      }
      const timeoutId = window.setTimeout(() => {
        dismissToast(id);
      }, toastLifetime(kind));
      timeoutIdsRef.current.set(id, timeoutId);
    },
    [dismissToast],
  );

  useEffect(() => {
    const handleNotification = (event: Event) => {
      const detail = (event as CustomEvent<GlobalNotificationDetail>).detail;
      if (!detail?.message) {
        return;
      }
      setItems((current) => {
        const duplicate = current.find(
          (item) =>
            item.dedupeKey ===
            (detail.key?.trim() || `${detail.kind}:${detail.message}`),
        );
        if (duplicate) {
          const nextItem = { ...duplicate, count: duplicate.count + 1 };
          scheduleDismiss(duplicate.id, detail.kind);
          return [
            ...current.filter((item) => item.id !== duplicate.id),
            nextItem,
          ];
        }

        const nextItem = {
          id: crypto.randomUUID(),
          message: detail.message,
          kind: detail.kind,
          count: 1,
          dedupeKey: detail.key?.trim() || `${detail.kind}:${detail.message}`,
        };
        scheduleDismiss(nextItem.id, detail.kind);
        const nextItems = [...current, nextItem];
        if (nextItems.length <= TOAST_MAX_ITEMS) {
          return nextItems;
        }

        const overflow = nextItems.length - TOAST_MAX_ITEMS;
        const removed = nextItems.slice(0, overflow);
        removed.forEach((item) => {
          const timeoutId = timeoutIdsRef.current.get(item.id);
          if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
            timeoutIdsRef.current.delete(item.id);
          }
        });
        return nextItems.slice(overflow);
      });
    };

    window.addEventListener(GLOBAL_NOTIFICATION_EVENT, handleNotification);
    return () => {
      window.removeEventListener(GLOBAL_NOTIFICATION_EVENT, handleNotification);
      timeoutIdsRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      timeoutIdsRef.current.clear();
    };
  }, [dismissToast, scheduleDismiss]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-220 flex max-w-[420px] flex-col gap-3">
      {items.map((item) => {
        const styles = toastStyles(item.kind);
        const Icon = styles.icon;
        return (
          <div
            key={item.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur ${styles.container}`}
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${styles.iconClass}`} />
            <div className="min-w-0 flex-1 text-sm leading-6">
              {item.message}
              {item.count > 1 ? (
                <span className="ml-2 inline-flex rounded-full border border-white/10 px-2 py-0.5 text-[11px] leading-4 text-white/70">
                  x{item.count}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(item.id)}
              className={`rounded-md p-1 transition-colors ${styles.buttonClass}`}
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
