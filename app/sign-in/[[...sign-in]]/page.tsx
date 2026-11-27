import { headers } from "next/headers";
import { SignIn } from "@clerk/nextjs";
import { AuthShell, CLERK_IN_SHELL } from "@/components/app/auth-shell";
import { returnTo, withReturn } from "@/lib/auth/return-to";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, h] = await Promise.all([searchParams, headers()]);
  // Where the visitor was going (a pasted link, say): "Create an account" keeps it, so a new visitor gets there too.
  const to = returnTo(Array.isArray(params.redirect_url) ? params.redirect_url[0] : params.redirect_url, h.get("host"));
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your workspace and your deals." swap={{ text: "New to RenoFlip?", href: withReturn("/sign-up", to), label: "Create an account" }}>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/app" appearance={CLERK_IN_SHELL} />
    </AuthShell>
  );
}
