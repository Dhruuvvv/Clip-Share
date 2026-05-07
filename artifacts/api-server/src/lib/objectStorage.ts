import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  private storageDir: string;

  constructor() {
    const rootDir = process.cwd();
    const configDir = process.env.LOCAL_STORAGE_DIR || "./uploads";
    this.storageDir = path.isAbsolute(configDir) 
      ? configDir 
      : path.resolve(rootDir, configDir);
  }

  private async ensureDir(dir: string) {
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
  }



  async getObjectEntityUploadURL(): Promise<string> {
    const objectId = randomUUID();
    return `/api/storage/uploads/${objectId}`;
  }


  normalizeObjectEntityPath(uploadURL: string): string {
    try {
      // Handle both absolute and relative URLs
      const url = uploadURL.startsWith("http") 
        ? new URL(uploadURL) 
        : new URL(uploadURL, "http://localhost");
      
      const parts = url.pathname.split("/");
      const objectId = parts[parts.length - 1];
      return `/objects/${objectId}`;
    } catch {
      return uploadURL;
    }
  }


  async saveObject(objectId: string, buffer: Buffer): Promise<void> {
    const filePath = path.join(this.storageDir, objectId);
    await this.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, buffer);
  }

  async getObjectFileStream(objectId: string): Promise<NodeJS.ReadableStream> {
    const filePath = path.join(this.storageDir, objectId);
    try {
      await fs.access(filePath);
      const { createReadStream } = await import("fs");
      return createReadStream(filePath);
    } catch {
      throw new ObjectNotFoundError();
    }
  }

  async getObjectMetadata(objectId: string) {
    const filePath = path.join(this.storageDir, objectId);
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      contentType: "application/octet-stream", // In a real app, you might store this in a DB
    };
  }
}
