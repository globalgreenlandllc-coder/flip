import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/app/auth-shell";

export const metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <AuthShell title="Create your account" subtitle="Free during beta. No card needed.">
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/app" appearance={{ elements: { rootBox: "w-full", cardBox: "w-full shadow-none", headerTitle: "hidden", headerSubtitle: "hidden" } }} />
    </AuthShell>
  );
}
