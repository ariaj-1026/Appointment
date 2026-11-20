import type { AppointmentStatus } from '../api/types';
import { STATUS_LABELS } from '../lib/datetime';

export default function StatusBadge({ status }: { status: AppointmentStatus | string }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status as AppointmentStatus] || status}</span>;
}
