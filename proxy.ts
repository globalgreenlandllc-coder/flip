import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Route protection. The landing page, auth pages and static files are
 * public. The app and the API need a signed-in user; API calls get a JSON
 * 401 instead of a redirect so partner integrations see a clean error.
 */
const isAppRoute = createRouteMatcher(["/app(.*)"]);
const isApiRoute = createRouteMatcher(["/api/v1(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isApiRoute(req)) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in to use the API." }, { status: 401 });
    return;
  }
  if (isAppRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
