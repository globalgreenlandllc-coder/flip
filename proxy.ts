import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Route protection. The landing page, auth pages and static files are
 * public. The app and the API need a signed-in user; API calls get a JSON
 * 401 instead of a redirect so partner integrations see a clean error.
 */
const isAppPath = (p: string) => p === "/app" || p.startsWith("/app/");
const isApiPath = (p: string) => p === "/api/v1" || p.startsWith("/api/v1/");

export default clerkMiddleware(async (auth, req) => {
  const path = req.nextUrl.pathname;
  if (isApiPath(path)) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in to use the API." }, { status: 401 });
    return;
  }
  if (isAppPath(path)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
