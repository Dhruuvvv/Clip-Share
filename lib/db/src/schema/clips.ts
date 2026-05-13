import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clipsTable = pgTable("clips", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  type: text("type", { enum: ["text", "link", "file"] }).notNull().default("text"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  objectPath: text("object_path"),
  iv: text("iv"),
  encrypted: boolean("encrypted").default(false),
  resourceType: text("resource_type"),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertClipSchema = createInsertSchema(clipsTable).omit({ id: true, createdAt: true });
export type InsertClip = z.infer<typeof insertClipSchema>;
export type Clip = typeof clipsTable.$inferSelect;
