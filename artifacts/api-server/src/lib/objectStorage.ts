import { v2 as cloudinary } from "cloudinary";
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
    });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const objectId = randomUUID();
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

  async saveObject(objectId: string, buffer: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: objectId,
          resource_type: "auto", // Automatically detect if it's an image, video, or raw file
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
   * Returns the secure URL for the given objectId.
   * Since we store files in the 'clipshare' folder, we prepend it.
   */
  async getObjectURL(objectId: string): Promise<string> {
    // We use 'resource_type: auto' during upload, but Cloudinary usually needs to know 
    // the resource type for URL generation if it's not an image.
    // However, the secure_url returned during upload is the best way to get it.
    // For simplicity, we can use the 'search' API or just assume the URL structure.
    // A better way is to store the full URL in the database when the file is saved.
    
    // For now, let's use the explicit URL construction or the 'v2.url' helper.
    // Note: Cloudinary URLs for 'raw' files have a slightly different structure.
    return cloudinary.url(`clipshare/${objectId}`, {
      secure: true,
      resource_type: "auto",
    });
  }

  async getObjectFileStream(objectId: string): Promise<NodeJS.ReadableStream> {
    const url = await this.getObjectURL(objectId);
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

  async getObjectMetadata(objectId: string) {
    try {
      const result = await cloudinary.api.resource(`clipshare/${objectId}`, {
        resource_type: "auto",
      });
      return {
        size: result.bytes,
        contentType: result.format ? `image/${result.format}` : "application/octet-stream",
      };
    } catch (error) {
      throw new ObjectNotFoundError();
    }
  }
}
