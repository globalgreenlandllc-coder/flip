import { test } from "node:test";
import assert from "node:assert/strict";
import { adminEmails, isAdmin } from "./access.ts";

const verified = (emailAddress: string) => ({ emailAddress, verification: { status: "verified" } });

test("the admins are the setting's emails, however they are written down", () => {
  assert.deepEqual([...adminEmails({ FLIP_ADMIN_EMAILS: " Owner@Example.com, partner@example.com;third@example.com  fourth@example.com " })], ["owner@example.com", "partner@example.com", "third@example.com", "fourth@example.com"]);
  assert.equal(adminEmails({ FLIP_ADMIN_EMAILS: "not-an-email, @x, a@b" }).size, 0);
  assert.equal(adminEmails({}).size, 0);
});

test("an admin is someone with a verified address on the list", () => {
  const admins = adminEmails({ FLIP_ADMIN_EMAILS: "owner@example.com" });
  assert.equal(isAdmin({ emailAddresses: [verified("OWNER@example.com")] }, admins), true);
  assert.equal(isAdmin({ emailAddresses: [verified("someone@example.com"), verified("owner@example.com")] }, admins), true);
});

test("an address that is not verified does not open the page", () => {
  const admins = adminEmails({ FLIP_ADMIN_EMAILS: "owner@example.com" });
  assert.equal(isAdmin({ emailAddresses: [{ emailAddress: "owner@example.com", verification: { status: "unverified" } }] }, admins), false);
  assert.equal(isAdmin({ emailAddresses: [{ emailAddress: "owner@example.com", verification: null }] }, admins), false);
  assert.equal(isAdmin({ emailAddresses: [{ emailAddress: "owner@example.com" }] }, admins), false);
});

test("nobody is an admin when the setting is empty, or when nobody is signed in", () => {
  assert.equal(isAdmin({ emailAddresses: [verified("owner@example.com")] }, adminEmails({})), false);
  const admins = adminEmails({ FLIP_ADMIN_EMAILS: "owner@example.com" });
  assert.equal(isAdmin(null, admins), false);
  assert.equal(isAdmin(undefined, admins), false);
  assert.equal(isAdmin({}, admins), false);
  assert.equal(isAdmin({ emailAddresses: [verified("other@example.com")] }, admins), false);
});
