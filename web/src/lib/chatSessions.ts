import { t } from '@/lib/i18n';

const UNTITLED_TASK_TITLE = 'Untitled Task';

export function formatChatSessionTitle(title: string) {
  const normalized = title.trim();
  if (!normalized || normalized === UNTITLED_TASK_TITLE) {
    return t('sidebar.untitled_task');
  }
  return title;
}
