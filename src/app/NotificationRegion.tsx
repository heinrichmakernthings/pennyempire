import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';

/** Command outcomes are announced politely; market ticks are never announced. */
export function NotificationRegion() {
  const notices = useUi((s) => s.notices);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div className="pe-toasts" role="log" aria-live="polite" aria-relevant="additions" aria-label="Notifications">
      {notices.map((n) => (
        <div key={n.id} className={`pe-toast pe-toast--${n.tone}`}>
          <div><strong>{n.title}</strong>{n.message && <p>{n.message}</p>}</div>
          <button type="button" className="pe-icon-btn" aria-label={`Dismiss: ${n.title}`} onClick={() => dismiss(n.id)}><Icon name="close" size={16} /></button>
        </div>
      ))}
    </div>
  );
}
