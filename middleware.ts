import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { signToken, verifyToken } from '@/lib/auth/session';
import { getStaffForUser } from '@/lib/moderation/permissions';

const protectedRoutes = '/dashboard';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get('session');
  const isProtectedRoute = pathname.startsWith(protectedRoutes);

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    let allowed = false;
    try {
      const session = sessionCookie
        ? await verifyToken(sessionCookie.value)
        : null;
      allowed =
        !!session &&
        new Date(session.expires) > new Date() &&
        !!(await getStaffForUser(session.user.id));
    } catch {
      /* Access denied for invalid sessions or unavailable authorization. */
    }
    if (!allowed)
      return new NextResponse(
        '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Access denied · Mimi</title><body><main><h1>Access denied</h1><p>Staff authorization is required for this space.</p><a href="/">Return to Mimi</a></main></body></html>',
        {
          status: 403,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-store',
          },
        },
      );
  }

  if (isProtectedRoute && !sessionCookie) {
    return NextResponse.redirect(new URL('/sign-in', request.url));
  }

  let res = NextResponse.next();

  if (sessionCookie && request.method === 'GET') {
    try {
      const parsed = await verifyToken(sessionCookie.value);
      const expiresInOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);

      res.cookies.set({
        name: 'session',
        value: await signToken({
          ...parsed,
          expires: expiresInOneDay.toISOString(),
        }),
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        expires: expiresInOneDay,
      });
    } catch (error) {
      console.error('Error updating session:', error);
      res.cookies.delete('session');
      if (isProtectedRoute) {
        return NextResponse.redirect(new URL('/sign-in', request.url));
      }
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
  runtime: 'nodejs',
};
