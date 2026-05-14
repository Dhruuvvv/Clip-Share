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

export type CloudinaryResourceType = "image" | "video" | "raw";

export class ObjectStorageService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    } as ConfigOptions);
  }

  /**
   * Generates a new unique object ID, optionally with a resource type prefix.
   */
  generateObjectId(resourceType?: CloudinaryResourceType): string {
    const uuid = randomUUID();
    return resourceType ? `${resourceType}__${uuid}` : uuid;
  }

  /**
   * Parses a composite object ID (resourceType:uuid) into its components.
   * Falls back to "raw" for legacy IDs.
   */
  parseCompositeId(objectId: string): { resourceType: CloudinaryResourceType; uuid: string } {
    if (objectId.includes("__")) {
      const [resourceType, uuid] = objectId.split("__");
      return { resourceType: resourceType as CloudinaryResourceType, uuid };
    }
    return { resourceType: "raw", uuid: objectId };
  }

  /**
   * Normalizes the object path for DB storage.
   */
  normalizeObjectPath(objectId: string): string {
    return `/objects/${objectId}`;
  }

  /**
   * Saves a file to Cloudinary.
   */
  async saveObject(resourceType: CloudinaryResourceType, objectId: string, buffer: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: objectId,
          resource_type: resourceType,
          folder: "clipshare",
        },
        (error) => {
          if (error) {
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
   * Returns the secure delivery URL from Cloudinary.
   */
  async getObjectURL(resourceType: CloudinaryResourceType, objectId: string): Promise<string> {
    return cloudinary.url(`clipshare/${objectId}`, {
      secure: true,
      resource_type: resourceType,
    });
  }

  /**
   * Streams the file from Cloudinary.
   */
  async getObjectFileStream(resourceType: CloudinaryResourceType, objectId: string): Promise<NodeJS.ReadableStream> {
    const url = await this.getObjectURL(resourceType, objectId);
    
    const fetchWithRedirects = (targetUrl: string): Promise<NodeJS.ReadableStream> => {
      return new Promise((resolve, reject) => {
        https.get(targetUrl, (res) => {
          if (res.statusCode === 200) {
            resolve(res);
          } else if (res.statusCode === 301 || res.statusCode === 302) {
            if (res.headers.location) {
              fetchWithRedirects(res.headers.location).then(resolve).catch(reject);
            } else {
              reject(new Error("Redirect location missing"));
            }
          } else if (res.statusCode === 404) {
            reject(new ObjectNotFoundError());
          } else {
            reject(new Error(`Failed to fetch from Cloudinary: ${res.statusCode}`));
          }
        }).on("error", reject);
      });
    };

    return fetchWithRedirects(url);
  }

  /**
   * Fetches metadata for the object from Cloudinary Admin API.
   */
  async getObjectMetadata(resourceType: CloudinaryResourceType, objectId: string) {
    try {
      const result = await cloudinary.api.resource(`clipshare/${objectId}`, {
        resource_type: resourceType,
      });
      
      const format = result.format?.toLowerCase?.() || "";
      let contentType = "application/octet-stream";

      if (result.resource_type === "image") {
        let imageFormat = format || "jpeg";
        if (imageFormat === "jpg") imageFormat = "jpeg";
        contentType = `image/${imageFormat}`;
      } else if (result.resource_type === "video") {
        contentType = `video/${format || "mp4"}`;
      } else {
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
      throw new ObjectNotFoundError();
    }
  }
}
