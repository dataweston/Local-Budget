import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { withAuth } from "next-auth/middleware";

const BOT_USER_AGENT_PATTERN =
  /(?:bot|crawler|spider|crawl|slurp|googlebot|bingbot|duckduckbot|baiduspider|yandex|semrush|ahrefs|mj12|dotbot|petalbot|applebot|facebookexternalhit|headlesschrome|phantomjs|selenium|playwright|puppeteer|python-requests|curl|wget|httpclient|scrapy)/i;
const PUBLIC_PATHS = new Set(["/login", "/register"]);

function isBlockedAgent(userAgent: string | null): boolean {
  // Treat missing user-agent as automated/non-browser traffic.
  if (!userAgent || !userAgent.trim()) {
    return true;
  }

  return BOT_USER_AGENT_PATTERN.test(userAgent);
}

const authMiddleware = withAuth({
  pages: {
    signIn: "/login",
  },
});

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (isBlockedAgent(req.headers.get("user-agent"))) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag":
          "noindex, nofollow, noarchive, nosnippet, noimageindex",
      },
    });
  }

  if (PUBLIC_PATHS.has(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  return authMiddleware(req, event);
}

// Run bot blocking across app routes; keep framework/static/auth internals excluded.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (auth API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - robots.txt (crawler directives)
     * - sitemap.xml (crawler index hints)
     * - public folder
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|public).*)",
  ],
};
