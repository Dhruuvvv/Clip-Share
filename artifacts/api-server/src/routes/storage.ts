import { Router, type IRouter, type Request, type Response } from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import express from "express";
import { db, clipsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    // Determine Cloudinary resource type
    let resourceType = "raw";
    if (contentType.startsWith("image/")) {
      resourceType = "image";
    } else if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
      resourceType = "video";
    }

    const uploadURL = await objectStorageService.getObjectEntityUploadURL(resourceType);
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * PUT /storage/uploads/:objectId
 * Handle the actual file upload from the frontend
 */
router.put("/storage/uploads/:objectId", express.raw({ limit: "50mb", type: "*/*" }), async (req: Request, res: Response) => {
  try {
    const { objectId } = req.params;
    if (typeof objectId !== "string") {
      res.status(400).json({ error: "Invalid object ID" });
      return;
    }
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Invalid file data" });
      return;
    }
    await objectStorageService.saveObject(objectId, req.body);
    res.sendStatus(200);
  } catch (error) {
    req.log.error({ err: error }, "Error saving uploaded file");
    res.status(500).json({ error: "Failed to save file" });
  }
});

/**
 * GET /storage/objects/:objectId
 * Stream the file from Cloudinary with correct metadata
 */
router.get("/storage/objects/:objectId", async (req: Request, res: Response) => {
  try {
    const { objectId } = req.params;
    const { filename: queryFilename } = req.query;

    if (typeof objectId !== "string") {
      res.status(400).json({ error: "Invalid object ID" });
      return;
    }

    // Try to find the clip in the DB to get original filename and initial MIME type
    const [clip] = await db
      .select()
      .from(clipsTable)
      .where(eq(clipsTable.objectPath, `/objects/${objectId}`))
      .limit(1);

    // Fetch Cloudinary metadata and the file stream in parallel
    const [metadata, stream] = await Promise.all([
      objectStorageService.getObjectMetadata(objectId).catch(() => null),
      objectStorageService.getObjectFileStream(objectId)
    ]);

    // MIME Type Resolution Logic:
    // 1. Start with database value
    // 2. If DB is missing or generic (octet-stream), trust Cloudinary's detection
    // 3. For critical formats (PDF, Office docs), always prefer Cloudinary's detected format
    let contentType = clip?.mimeType || "application/octet-stream";

    if (metadata?.contentType) {
      const isDbGeneric = !clip?.mimeType || clip.mimeType === "application/octet-stream";
      const format = metadata?.format?.toLowerCase?.() || "";
      const isHighPriority = ["pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt",].includes(format);


      if (isDbGeneric || isHighPriority) {
        contentType = metadata.contentType;
      }
    }

    const finalFilename = (queryFilename as string) || clip?.fileName || "file";

    // Use Express helper for Content-Disposition (handles UTF-8 and quoting)
    if (queryFilename || clip?.fileName) {
      res.attachment(finalFilename);
    }

    res.setHeader("Content-Type", contentType);

    (stream as NodeJS.ReadableStream)
      .on("error", (err) => {
        req.log.error({ err }, "Stream error");
        if (!res.headersSent) {
          res.status(500).json({ error: "Stream failed" });
        }
      })
      .pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
