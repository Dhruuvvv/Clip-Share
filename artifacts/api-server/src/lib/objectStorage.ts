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

  private parseObjectId(compositeId: string): { resourceType: any; actualId: string } {
    if (compositeId.includes(":")) {
      const [resourceType, ...idParts] = compositeId.split(":");
      return { resourceType, actualId: idParts.join(":") };
    }
    // Fallback for legacy IDs
    return { resourceType: "image", actualId: compositeId };
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
        (error, result) => {
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
   * Supports optional forced download with a specific filename.
   */
  async getObjectURL(compositeId: string, filename?: string): Promise<string> {
    const { resourceType, actualId } = this.parseObjectId(compositeId);
    
    const options: any = {
      secure: true,
      resource_type: resourceType,
    };

    if (filename) {
      // Use fl_attachment to force download and set filename
      options.flags = "attachment";
      // Note: Cloudinary doesn't directly support setting the download filename 
      // via the URL generation helper in all SDK versions easily without custom transformations,
      // but fl_attachment with a public_id that includes the filename works,
      // or using the 'dpr_auto' etc. 
      // Actually, appending the filename to the URL is the most reliable way.
    }

    let url = cloudinary.url(`clipshare/${actualId}`, options);
    
    if (filename) {
      // Add the filename as a suffix to the URL path to help the browser
      // Cloudinary ignores trailing path segments after the public_id
      const cleanFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
      url = `${url}/${cleanFilename}`;
    }

    return url;
  }

  async getObjectFileStream(compositeId: string): Promise<NodeJS.ReadableStream> {
    const url = await this.getObjectURL(compositeId);
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode === 200) {
          resolve(res);
        } else if (res.statusCode === 404) {
          reject(new ObjectNotFoundError());
        } else {
          reject(new Error(`Failed to fetch from Cloudinary: ${res.statusCode}`));
        }
      }).on("error", reject);
    });
  }

  async getObjectMetadata(compositeId: string) {
    const { resourceType, actualId } = this.parseObjectId(compositeId);
    try {
      const result = await cloudinary.api.resource(`clipshare/${actualId}`, {
        resource_type: resourceType,
      });
      return {
        size: result.bytes,
        contentType: result.format ? `${resourceType}/${result.format}` : "application/octet-stream",
      };
    } catch (error) {
      throw new ObjectNotFoundError();
    }
  }
}
