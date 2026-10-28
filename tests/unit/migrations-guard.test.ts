import { describe, expect, it } from "vitest";
import { refusalReason, type SchemaSnapshot } from "@/lib/db/migrations";

const empty: SchemaSnapshot = {
  appliedVersions: [],
  publicLedgerExists: false,
  publicCanaryExists: false,
  publicNonTableObjects: [],
  otherSchemaRelations: [],
};

describe("migration refusal rules", () => {
  it("proceeds on a fresh database", () => {
    expect(refusalReason(empty, false)).toBeNull();
  });

  it("proceeds when the ledger and public.users agree the schema is in place", () => {
    const applied: SchemaSnapshot = { ...empty, appliedVersions: ["0001_init.sql"], publicLedgerExists: true, publicCanaryExists: true };
    expect(refusalReason(applied, false)).toBeNull();
  });

  it("refuses when the ledger says 0001 is applied but public.users is missing", () => {
    const inconsistent: SchemaSnapshot = { ...empty, appliedVersions: ["0001_init.sql"], publicLedgerExists: true };
    expect(refusalReason(inconsistent, false)).toContain("public.users is missing");
    expect(refusalReason(inconsistent, true)).toContain("public.users is missing");
  });

  it("refuses when public.users exists but the ledger does not list 0001", () => {
    const unknown: SchemaSnapshot = { ...empty, publicCanaryExists: true };
    expect(refusalReason(unknown, false)).toContain("does not list 0001_init.sql");
  });

  it("refuses when public.users is a view, even if the ledger lists 0001", () => {
    const viewCanary: SchemaSnapshot = {
      ...empty,
      appliedVersions: ["0001_init.sql"],
      publicLedgerExists: true,
      publicNonTableObjects: ["public.users (view)"],
    };
    const reason = refusalReason(viewCanary, false);
    expect(reason).toContain("public has objects that are not tables: public.users (view)");
    expect(reason).toContain("nothing was changed");
    expect(refusalReason(viewCanary, true)).toContain("objects that are not tables: public.users (view)");
  });

  it("refuses when public.schema_migrations is not a table, even with no users table", () => {
    const viewLedger: SchemaSnapshot = { ...empty, publicNonTableObjects: ["public.schema_migrations (view)"] };
    expect(refusalReason(viewLedger, false)).toContain("public.schema_migrations (view)");
  });

  it("refuses to create a second copy when application tables exist outside public", () => {
    const elsewhere: SchemaSnapshot = { ...empty, otherSchemaRelations: ["owner_schema.users", "owner_schema.schema_migrations"] };
    const reason = refusalReason(elsewhere, false);
    expect(reason).toContain("owner_schema.users");
    expect(reason).toContain("MIGRATION_ALLOW_OTHER_SCHEMAS=1");
  });

  it("names the kind of a non-table object outside public", () => {
    const elsewhere: SchemaSnapshot = { ...empty, otherSchemaRelations: ["neondb_owner.users (view)"] };
    expect(refusalReason(elsewhere, false)).toContain("neondb_owner.users (view)");
  });

  it("proceeds past the other-schema rule only with explicit operator approval", () => {
    const elsewhere: SchemaSnapshot = { ...empty, otherSchemaRelations: ["owner_schema.users"] };
    expect(refusalReason(elsewhere, true)).toBeNull();
  });

  it("does not block a schema that already has public.users, even with tables elsewhere", () => {
    const both: SchemaSnapshot = {
      ...empty,
      appliedVersions: ["0001_init.sql"],
      publicLedgerExists: true,
      publicCanaryExists: true,
      otherSchemaRelations: ["owner_schema.users"],
    };
    expect(refusalReason(both, false)).toBeNull();
  });
});
