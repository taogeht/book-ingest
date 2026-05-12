import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

class R2Client {
  private _client: S3Client | null = null;
  private _bucketName = '';
  private _publicUrl = '';

  private init(): { client: S3Client; bucketName: string; publicUrl: string } {
    if (this._client) {
      return { client: this._client, bucketName: this._bucketName, publicUrl: this._publicUrl };
    }
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    this._bucketName = process.env.R2_BUCKET_NAME || '';
    this._publicUrl = process.env.R2_PUBLIC_URL || '';
    if (!accountId || !accessKeyId || !secretAccessKey || !this._bucketName) {
      throw new Error('Missing required R2 environment variables');
    }
    this._client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    return { client: this._client, bucketName: this._bucketName, publicUrl: this._publicUrl };
  }

  private get client(): S3Client {
    return this.init().client;
  }
  private get bucketName(): string {
    return this.init().bucketName;
  }
  private get publicUrl(): string {
    return this.init().publicUrl;
  }

  async uploadFile(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      if (!res.Body) return null;
      const chunks: Uint8Array[] = [];
      // @ts-expect-error AWS SDK Body is a Web ReadableStream in Node 20+
      for await (const chunk of res.Body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  async deleteFile(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }),
    );
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
      { expiresIn },
    );
  }

  getPublicUrl(key: string): string {
    if (this.publicUrl) return `${this.publicUrl}/${key}`;
    return `https://${this.bucketName}.r2.dev/${key}`;
  }
}

export const r2Client = new R2Client();

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

export function buildSourceKey(projectId: string, filename: string): string {
  return `ingestion-sources/${projectId}/${Date.now()}-${sanitizeFilename(filename)}`;
}

export function buildPageImageKey(
  projectId: string,
  sourceDocId: string,
  pageNumber: number,
): string {
  return `ingestion-pages/${projectId}/${sourceDocId}/page-${pageNumber}.png`;
}

export function buildBundleKey(projectId: string, timestamp: number): string {
  return `ingestion-bundles/${projectId}/${timestamp}.bundle.zip`;
}
