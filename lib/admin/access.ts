/**
 * Who may open the admin page: the people whose email is in the project's FLIP_ADMIN_EMAILS setting (several may be
 * given, separated by commas or spaces), and only through an address the sign-in service has verified as theirs.
 * The emails live in the setting, never in this public code. With the setting empty nobody is an admin, and the page
 * answers "not found" to everyone.
 */

export function adminEmails(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.FLIP_ADMIN_EMAILS ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
  );
}

/** The part of a signed-in person this needs (Clerk's User has it). */
export interface EmailHolder {
  emailAddresses?: { emailAddress: string; verification?: { status?: string | null } | null }[] | null;
}

export function isAdmin(user: EmailHolder | null | undefined, admins: Set<string>): boolean {
  if (!user || admins.size === 0) return false;
  return (user.emailAddresses ?? []).some((e) => e.verification?.status === "verified" && admins.has(e.emailAddress.trim().toLowerCase()));
}
