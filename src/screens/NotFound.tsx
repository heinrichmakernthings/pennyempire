import { Link } from 'react-router-dom';
import { EmptyState } from '@/ui/States';

export function NotFound() {
  return <div className="pe-screen"><EmptyState title="Page not found" action={<Link className="pe-btn pe-btn--primary" to="/city">Back to the city</Link>}>That address doesn't exist in Penny Empire.</EmptyState></div>;
}
