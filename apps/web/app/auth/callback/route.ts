import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/env';
import { createSupabaseServer } from '@/lib/supabase/server';

/** Supabase OAuth code exchange (tech-spec §6.1 step 2). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));
  const providerError = searchParams.get('error_description') ?? searchParams.get('error');

  if (providerError) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(providerError)}`);
  }
  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent('Sign-in was not completed.')}`,
  );
}
