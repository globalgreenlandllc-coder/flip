import { headers } from "next/headers";
import { SignUp } from "@clerk/nextjs";
import { AuthShell, CLERK_IN_SHELL } from "@/components/app/auth-shell";
import { returnTo, withReturn } from "@/lib/auth/return-to";

export const metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, h] = await Promise.all([searchParams, headers()]);
  // Where the visitor was going: "Sign in" keeps it too (lib/auth/return-to.ts).
  const to = returnTo(Array.isArray(params.redirect_url) ? params.redirect_url[0] : params.redirect_url, h.get("host"));
  return (
    <AuthShell title="Create your account" subtitle="Free during beta. No card needed." swap={{ text: "Already have an account?", href: withReturn("/sign-in", to), label: "Sign in" }}>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/app" appearance={CLERK_IN_SHELL} />
    </AuthShell>
  );
}
