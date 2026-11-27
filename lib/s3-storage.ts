import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const REGION = process.env.AWS_REGION || "eu-central-1";
const BUCKET = "uploads";

let client: S3Client | undefined;

function getClient(): S3Client {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey)
    throw new Error("S3 object storage is not configured.");
  if (!client) {
    client = new S3Client({
      endpoint,
      region: REGION,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  }
  return client;
}

export async function putImageObject(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );
}

export async function getImageObject(
  key: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const response = await getClient().send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    if (!response.Body) return null;
    const received = await response.Body.transformToByteArray();
    const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(received.byteLength);
    bytes.set(received);
    return bytes;
  } catch (error) {
    if (
      error instanceof Error &&
      (("$metadata" in error &&
        (error as Error & { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404) ||
        error.name === "NoSuchKey")
    )
      return null;
    throw error;
  }
}

export async function deleteImageObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
