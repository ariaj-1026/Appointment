import type { ReactNode } from 'react';

export default function EmptyState({
  mark = '📋',
  title,
  children,
  action,
}: {
  mark?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">
        {mark}
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
