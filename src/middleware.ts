import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware for handling requests
 */
export async function middleware(req: NextRequest) {
  // For now, just pass through all requests
  // You can add authentication logic here later if needed
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*']
};
