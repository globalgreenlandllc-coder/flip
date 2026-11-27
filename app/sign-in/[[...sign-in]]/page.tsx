import { SignIn } from "@clerk/nextjs";
import { AuthShell, CLERK_IN_SHELL } from "@/components/app/auth-shell";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your workspace and your deals." swap={{ text: "New to Renoflip?", href: "/sign-up", label: "Create an account" }}>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/app" appearance={CLERK_IN_SHELL} />
    </AuthShell>
  );
}
