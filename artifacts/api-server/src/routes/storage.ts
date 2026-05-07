import { Router, type IRouter, type Request, type Response } from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import express from "express";

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
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
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
 * GET /storage/objects/*
 */
router.get("/storage/objects/:objectId", async (req: Request, res: Response) => {
  try {
    const { objectId } = req.params;
    const stream = await objectStorageService.getObjectFileStream(objectId);
    const metadata = await objectStorageService.getObjectMetadata(objectId);

    res.setHeader("Content-Type", metadata.contentType);
    res.setHeader("Content-Length", metadata.size);
    (stream as any).pipe(res);
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

