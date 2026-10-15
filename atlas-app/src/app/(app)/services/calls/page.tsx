import { redirect } from 'next/navigation';

/** Renamed to the Visit Scheduler (health check SVC-1) - old links still work. */
export default function OldServiceCallsPage() {
  redirect('/services/visits');
}
