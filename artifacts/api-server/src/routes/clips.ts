import { Router } from "express";
import { db } from "@workspace/db";
import { clipsTable } from "@workspace/db";
import { desc, eq, count, sql, asc } from "drizzle-orm";
import {
  CreateClipBody,
  DeleteClipParams,
  ListClipsQueryParams,
  UpdateClipBody,
} from "@workspace/api-zod";

const clipsRouter = Router();

// GET /clips — list all clips, most recent first
clipsRouter.get("/clips", async (req, res) => {
  const parsed = ListClipsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params", details: parsed.error.issues });
    return;
  }
  const { limit, offset } = parsed.data;

  const [items, totalResult] = await Promise.all([
    db
      .select()
      .from(clipsTable)
      .orderBy(desc(clipsTable.pinned), desc(clipsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(clipsTable),
  ]);

  res.json({ items, total: totalResult[0]?.value ?? 0 });
});

// POST /clips — create a new clip
clipsRouter.post("/clips", async (req, res) => {
  const parsed = CreateClipBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }

  const [clip] = await db
    .insert(clipsTable)
    .values(parsed.data)
    .returning();

  res.status(201).json(clip);
});

// PATCH /clips/:id — update a clip (e.g. toggle pin)
clipsRouter.patch("/clips/:id", async (req, res) => {
  const idParsed = DeleteClipParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const bodyParsed = UpdateClipBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid body", details: bodyParsed.error.issues });
    return;
  }

  const [updated] = await db
    .update(clipsTable)
    .set(bodyParsed.data)
    .where(eq(clipsTable.id, idParsed.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Clip not found" });
    return;
  }

  res.json(updated);
});

// DELETE /clips/:id — delete a clip
clipsRouter.delete("/clips/:id", async (req, res) => {
  const parsed = DeleteClipParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  await db.delete(clipsTable).where(eq(clipsTable.id, parsed.data.id));
  res.status(204).send();
});

// GET /clips/summary — usage stats
clipsRouter.get("/clips/summary", async (req, res) => {
  const [totals, recentClips] = await Promise.all([
    db
      .select({
        totalClips: count(),
        textCount: sql<number>`cast(sum(case when ${clipsTable.type} = 'text' then 1 else 0 end) as int)`,
        linkCount: sql<number>`cast(sum(case when ${clipsTable.type} = 'link' then 1 else 0 end) as int)`,
        fileCount: sql<number>`cast(sum(case when ${clipsTable.type} = 'file' then 1 else 0 end) as int)`,
      })
      .from(clipsTable),
    db
      .select()
      .from(clipsTable)
      .orderBy(desc(clipsTable.createdAt))
      .limit(5),
  ]);

  const row = totals[0];
  res.json({
    totalClips: row?.totalClips ?? 0,
    textCount: row?.textCount ?? 0,
    linkCount: row?.linkCount ?? 0,
    fileCount: row?.fileCount ?? 0,
    recentClips,
  });
});

export default clipsRouter;
