import { Card, PageHeader } from "./ui";

/** Shown when the database is not configured. Lists setup steps only, never configuration values. */
export function SetupRequired() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <PageHeader eyebrow="Setup" title="Database not configured" description="This server is missing the database connection needed to run Bulkskart AI." />
      <Card>
        <ol className="list-decimal space-y-3 pl-5 text-sm text-muted">
          <li>Create a Neon PostgreSQL project and copy its connection string.</li>
          <li>Set DATABASE_URL in the server environment (.env.local for local development). Never commit it.</li>
          <li>Run npm run db:migrate to create the schema.</li>
          <li>Run npm run admin:create to create the first super administrator.</li>
          <li>Restart the server and sign in.</li>
        </ol>
      </Card>
    </div>
  );
}
