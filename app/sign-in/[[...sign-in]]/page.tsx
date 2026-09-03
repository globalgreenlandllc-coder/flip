import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/app/auth-shell";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your deals.">
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/app" appearance={{ elements: { rootBox: "w-full", cardBox: "w-full shadow-none", headerTitle: "hidden", headerSubtitle: "hidden" } }} />
    </AuthShell>
  );
}
