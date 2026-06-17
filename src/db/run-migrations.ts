/**
 * Applies pending Drizzle migrations using Neon's HTTP driver (plain HTTPS,
 * not WebSocket — works through restrictive networks and on Vercel's builder).
 * Idempotent: Drizzle records applied migrations and skips them next time.
 */
export async function runMigrations(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }

  const { neon } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-http");
  const { migrate } = await import("drizzle-orm/neon-http/migrator");

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "drizzle" });
}
