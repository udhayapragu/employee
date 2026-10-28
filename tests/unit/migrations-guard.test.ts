import { describe, expect, it } from "vitest";
import { refusalReason, type SchemaSnapshot } from "@/lib/db/migrations";

const empty: SchemaSnapshot = {
  appliedVersions: [],
  publicLedgerExists: false,
  publicCanaryExists: false,
  otherSchemaTables: [],
};

describe("migration refusal rules", () => {
  it("proceeds on a fresh database", () => {
    expect(refusalReason(empty, false)).toBeNull();
  });

  it("proceeds when the ledger and public.users agree the schema is in place", () => {
    const applied: SchemaSnapshot = { appliedVersions: ["0001_init.sql"], publicLedgerExists: true, publicCanaryExists: true, otherSchemaTables: [] };
    expect(refusalReason(applied, false)).toBeNull();
  });

  it("refuses when the ledger says 0001 is applied but public.users is missing", () => {
    const inconsistent: SchemaSnapshot = { appliedVersions: ["0001_init.sql"], publicLedgerExists: true, publicCanaryExists: false, otherSchemaTables: [] };
    expect(refusalReason(inconsistent, false)).toContain("public.users is missing");
    expect(refusalReason(inconsistent, true)).toContain("public.users is missing");
  });

  it("refuses when public.users exists but the ledger does not list 0001", () => {
    const unknown: SchemaSnapshot = { appliedVersions: [], publicLedgerExists: false, publicCanaryExists: true, otherSchemaTables: [] };
    expect(refusalReason(unknown, false)).toContain("does not list 0001_init.sql");
  });

  it("refuses to create a second copy when application tables exist outside public", () => {
    const elsewhere: SchemaSnapshot = { ...empty, otherSchemaTables: ["owner_schema.users", "owner_schema.schema_migrations"] };
    const reason = refusalReason(elsewhere, false);
    expect(reason).toContain("owner_schema.users");
    expect(reason).toContain("MIGRATION_ALLOW_OTHER_SCHEMAS=1");
  });

  it("proceeds past the other-schema rule only with explicit operator approval", () => {
    const elsewhere: SchemaSnapshot = { ...empty, otherSchemaTables: ["owner_schema.users"] };
    expect(refusalReason(elsewhere, true)).toBeNull();
  });

  it("does not block a schema that already has public.users, even with tables elsewhere", () => {
    const both: SchemaSnapshot = { appliedVersions: ["0001_init.sql"], publicLedgerExists: true, publicCanaryExists: true, otherSchemaTables: ["owner_schema.users"] };
    expect(refusalReason(both, false)).toBeNull();
  });
});
