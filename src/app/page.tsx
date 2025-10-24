import { createServerClient } from '@/lib/supabase';
import { redirect } from 'next/navigation';

export default async function Page() {
  const supabase = await createServerClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session) {
    return redirect('/auth/sign-in');
  }
  return redirect('/dashboard/overview');
}
