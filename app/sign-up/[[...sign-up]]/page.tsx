import { SignUp } from "@clerk/nextjs";
import { AuthShell, CLERK_IN_SHELL } from "@/components/app/auth-shell";

export const metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <AuthShell title="Create your account" subtitle="Free during beta. No card needed." swap={{ text: "Already have an account?", href: "/sign-in", label: "Sign in" }}>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/app" appearance={CLERK_IN_SHELL} />
    </AuthShell>
  );
}
