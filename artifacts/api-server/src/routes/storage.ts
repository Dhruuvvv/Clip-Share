import { Router, type IRouter, type Request, type Response } from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError, CloudinaryResourceType } from "../lib/objectStorage";
import express from "express";
import { db, clipsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 * Returns a presigned URL (our own backend) and an objectPath for the DB.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { contentType } = parsed.data;
    
    // Determine Cloudinary resource type strictly from MIME type at the start
    let resourceType: CloudinaryResourceType = "raw";
    if (contentType.startsWith("image/")) {
      resourceType = "image";
    } else if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
      resourceType = "video";
    }

    const objectId = objectStorageService.generateObjectId(resourceType);
    const uploadURL = `/api/storage/uploads/${resourceType}/${objectId}`;
    const objectPath = objectStorageService.normalizeObjectPath(objectId);

    console.log(`[DEBUG] Generated objectId: "${objectId}"`);
    console.log(`[DEBUG] Generated objectPath: "${objectPath}"`);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        resourceType,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * PUT /storage/uploads/:resourceType/:objectId
 * Handle the actual file upload from the frontend and save to Cloudinary
 */
router.put("/storage/uploads/:resourceType/:objectId", express.raw({ limit: "50mb", type: "*/*" }), async (req: Request, res: Response) => {
  try {
    const { resourceType, objectId } = req.params;
    
    if (!objectId || !resourceType) {
      res.status(400).json({ error: "Invalid upload parameters" });
      return;
    }

    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Invalid file data" });
      return;
    }

    await objectStorageService.saveObject(resourceType as CloudinaryResourceType, objectId, req.body);
    res.sendStatus(200);
  } catch (error) {
    req.log.error({ err: error }, "Error saving uploaded file");
    res.status(500).json({ error: "Failed to save file" });
  }
});

/**
 * GET /storage/objects/:objectId
 * Stream the file from Cloudinary using DB-persisted resourceType
 */
router.get("/storage/objects/:objectId", async (req: Request, res: Response) => {
  try {
    const { objectId } = req.params;
    const { filename: queryFilename } = req.query;

    if (!objectId) {
      res.status(400).json({ error: "Invalid object ID" });
      return;
    }

    console.log(`[DEBUG] Requested download for objectId: "${objectId}"`);
    const searchPath = `/objects/${objectId}`;
    console.log(`[DEBUG] Searching DB for objectPath: "${searchPath}"`);

    // Fetch clip metadata from DB to get resourceType and fileName
    const [clip] = await db
      .select()
      .from(clipsTable)
      .where(eq(clipsTable.objectPath, `/objects/${objectId}`))
      .limit(1);

    if (!clip) {
      res.status(404).json({ error: "Clip record not found" });
      return;
    }

    // Extract resourceType directly from composite objectId
    const { resourceType } = objectStorageService.parseCompositeId(objectId);

    // Fetch Cloudinary metadata and stream using specific resourceType
    const [metadata, stream] = await Promise.all([
      objectStorageService.getObjectMetadata(resourceType, objectId).catch(() => null),
      objectStorageService.getObjectFileStream(resourceType, objectId)
    ]);
    
    // Determine the most reliable MIME type
    let contentType = clip.mimeType || "application/octet-stream";
    
    if (metadata?.contentType) {
      const isDbGeneric = !clip.mimeType || clip.mimeType === "application/octet-stream";
      const format = metadata.format?.toLowerCase() || "";
      const isHighPriority = ["pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt"].includes(format);
      
      if (isDbGeneric || isHighPriority) {
        contentType = metadata.contentType;
      }
    }

    const finalFilename = (queryFilename as string) || clip.fileName || "file";

    // Set response headers
    if (queryFilename || clip.fileName) {
      res.attachment(finalFilename);
    }
    
    res.setHeader("Content-Type", contentType);
    
    if (metadata?.size) {
      res.setHeader("Content-Length", metadata.size);
    }

    (stream as NodeJS.ReadableStream)
      .on("error", (err) => {
        req.log.error({ err, objectId }, "Stream error during piping");
        if (!res.headersSent) {
          res.status(500).json({ error: "Stream failed" });
        }
      })
      .pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found in Cloudinary" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
