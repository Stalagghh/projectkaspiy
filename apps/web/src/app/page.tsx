import { Dashboard } from '@/features/dashboard/Dashboard';

// Rendered at request time; the dashboard loads its data in the browser and stays live via SSE.
export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  return <Dashboard />;
}
