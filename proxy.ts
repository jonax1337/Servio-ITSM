import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { requiredRoleFor, roleAtLeast, isPublicPath } from "@/lib/route-guard";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const path = nextUrl.pathname;
  const isLoggedIn = !!req.auth;
  const role = req.auth?.user?.role ?? "USER";

  // Public routes — always allowed
  if (isPublicPath(path)) {
    // Redirect logged-in users away from the login page
    if (isLoggedIn && (path === "/login" || path.startsWith("/login/"))) {
      return NextResponse.redirect(new URL("/", nextUrl));
    }
    return NextResponse.next();
  }

  // Everything else requires auth
  if (!isLoggedIn) {
    const url = new URL("/login", nextUrl);
    url.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(url);
  }

  // Plain end users live in the self-service portal, not the agent console.
  // (Account settings is a dialog in the topbar user-menu, available in both.)
  const isPortal = path.startsWith("/portal");
  if (role === "USER" && !isPortal) {
    return NextResponse.redirect(new URL("/portal", nextUrl));
  }

  // Per-route RBAC for the console: an AGENT/MANAGER who is below the role a
  // route requires (e.g. an AGENT hitting MANAGER-only /settings, /syncs,
  // /automations, /catalog) gets a friendly 403 rather than the page. Pages &
  // server actions still enforce their own RBAC — this is defence in depth so
  // hidden nav links can't simply be typed into the address bar.
  // NOTE: the role read here comes from the JWT; the /no-access page and the
  // page/action-level guards re-check against the live DB user.
  if (!isPortal && !path.startsWith("/no-access")) {
    const required = requiredRoleFor(path);
    if (!roleAtLeast(role, required)) {
      const url = new URL("/no-access", nextUrl);
      url.searchParams.set("from", path);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
});

export const config = {
  // Skip Next internals & static assets. The asset exemption is constrained to
  // SHALLOW paths — the file itself is the last segment (root, or one folder
  // deep, e.g. /favicon.ico, /img/logo.svg). Deep routes merely ENDING in an
  // image/media extension (e.g. /reports/export/123.png) still run middleware.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|(?:[^/]+/)?[^/]+\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
