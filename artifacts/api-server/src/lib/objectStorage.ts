//objectStorage.ts
import { v2 as cloudinary, ConfigOptions } from "cloudinary";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import https from "https";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    } as ConfigOptions);
  }

  /**
   * Encodes the resource type into the objectId to ensure correct URL generation later.
   * Format: resourceType:uuid
   */
  async getObjectEntityUploadURL(resourceType: string = "raw"): Promise<string> {
    const objectId = `${resourceType}:${randomUUID()}`;
    return `/api/storage/uploads/${objectId}`;
  }

  normalizeObjectEntityPath(uploadURL: string): string {
    try {
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

  private parseObjectId(compositeId: string): { resourceType: "image" | "video" | "raw"; actualId: string } {
    if (compositeId.includes(":")) {
      const [resourceType, ...idParts] = compositeId.split(":");
      return { 
        resourceType: (resourceType as any) || "raw", 
        actualId: idParts.join(":") 
      };
    }
    // Fallback for legacy IDs - assume raw as it's safer for binary preservation
    return { resourceType: "raw", actualId: compositeId };
  }

  async saveObject(compositeId: string, buffer: Buffer): Promise<void> {
    const { resourceType, actualId } = this.parseObjectId(compositeId);
    
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: actualId,
          resource_type: resourceType,
          folder: "clipshare",
        },
        (error) => {
          if (error) {
            console.error("Cloudinary upload error:", error);
            reject(error);
          } else {
            resolve();
          }
        }
      );

      const readableStream = new Readable();
      readableStream.push(buffer);
      readableStream.push(null);
      readableStream.pipe(uploadStream);
    });
  }

  /**
   * Returns the secure URL for the given compositeId.
   */
  async getObjectURL(compositeId: string): Promise<string> {
    const { resourceType, actualId } = this.parseObjectId(compositeId);
    
    return cloudinary.url(`clipshare/${actualId}`, {
      secure: true,
      resource_type: resourceType,
    });
  }

  async getObjectFileStream(compositeId: string): Promise<NodeJS.ReadableStream> {
    const url = await this.getObjectURL(compositeId);
    console.log(`[ObjectStorage] Fetching stream for ${compositeId} from: ${url}`);
    
    const fetchWithRedirects = (targetUrl: string): Promise<NodeJS.ReadableStream> => {
      return new Promise((resolve, reject) => {
        https.get(targetUrl, (res) => {
          console.log(`[ObjectStorage] Cloudinary response: ${res.statusCode} for ${targetUrl}`);
          
          if (res.statusCode === 200) {
            resolve(res);
          } else if (res.statusCode === 301 || res.statusCode === 302) {
            if (res.headers.location) {
              console.log(`[ObjectStorage] Following redirect to: ${res.headers.location}`);
              fetchWithRedirects(res.headers.location).then(resolve).catch(reject);
            } else {
              reject(new Error("Redirect location missing"));
            }
          } else if (res.statusCode === 404) {
            reject(new ObjectNotFoundError());
          } else {
            reject(new Error(`Failed to fetch from Cloudinary: ${res.statusCode}`));
          }
        }).on("error", (err) => {
          console.error(`[ObjectStorage] HTTPS error: ${err.message}`);
          reject(err);
        });
      });
    };

    return fetchWithRedirects(url);
  }

  async getObjectMetadata(compositeId: string) {
    const { resourceType, actualId } = this.parseObjectId(compositeId);
    console.log(`[ObjectStorage] Fetching metadata for ${compositeId} (${resourceType})`);
    
    try {
      const result = await cloudinary.api.resource(`clipshare/${actualId}`, {
        resource_type: resourceType,
      });
      
      console.log(`[ObjectStorage] Cloudinary metadata result: format=${result.format}, bytes=${result.bytes}`);
      
      const format = result.format?.toLowerCase?.() || "";
      let contentType = "application/octet-stream";

      if (result.resource_type === "image") {
        let imageFormat = format || "jpeg";
        if (imageFormat === "jpg") imageFormat = "jpeg";
        contentType = `image/${imageFormat}`;
      } else if (result.resource_type === "video") {
        contentType = `video/${format || "mp4"}`;
      } else {
        // Resource type is "raw" or others
        const mimeMap: Record<string, string> = {
          'pdf': 'application/pdf',
          'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'doc': 'application/msword',
          'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'xls': 'application/vnd.ms-excel',
          'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'ppt': 'application/ms-powerpoint',
          'csv': 'text/csv',
          'txt': 'text/plain',
          'zip': 'application/zip',
          'rar': 'application/x-rar-compressed',
          '7z': 'application/x-7z-compressed',
          'json': 'application/json',
          'mp3': 'audio/mpeg',
          'wav': 'audio/wav',
          'ogg': 'audio/ogg',
          'png': 'image/png',
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'gif': 'image/gif',
          'webp': 'image/webp',
          'svg': 'image/svg+xml',
          'mp4': 'video/mp4',
          'webm': 'video/webm',
        };
        
        if (format && mimeMap[format]) {
          contentType = mimeMap[format];
        }
      }

      return {
        size: result.bytes,
        contentType,
        format,
      };
    } catch (error) {
      console.error("Cloudinary metadata error:", error);
      throw new ObjectNotFoundError();
    }
  }
}
