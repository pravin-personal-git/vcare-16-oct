import { redirect } from 'next/navigation';
import { getContext } from '@/server/context';

export default async function RootPage() {
  const ctx = await getContext();
  redirect(ctx ? '/dashboard' : '/login');
}
