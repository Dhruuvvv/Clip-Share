import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const settingsRouter = Router();

const SALT_KEY = "encryption_salt";

function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

settingsRouter.get("/salt", async (req, res) => {
  const rows = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, SALT_KEY));

  if (rows.length > 0) {
    res.json({ salt: rows[0].value });
    return;
  }

  const salt = generateSalt();
  await db.insert(settingsTable).values({ key: SALT_KEY, value: salt });
  res.json({ salt });
});

export default settingsRouter;
