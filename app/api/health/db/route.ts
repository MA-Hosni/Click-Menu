import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export async function GET() {
  try {
    await getDb().execute(sql`SELECT 1`);

    return Response.json({
      success: true,
      database: "Neon PostgreSQL",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    return Response.json(
      { success: false },
      { status: 500 },
    );
  }
}