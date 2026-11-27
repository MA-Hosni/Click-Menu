import { config } from "dotenv";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  sanitizeTransferFailureId,
  transferLegacyImages,
} from "../lib/legacy-image-transfer.mjs";

config({ path: path.resolve(process.cwd(), ".env.local") });

const connectionString = process.env.DATABASE_URL_POOLED;
const endpoint = process.env.AWS_ENDPOINT_URL_S3;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

function report({ sourceCount, verifiedCount, failures }) {
  process.stdout.write(`Source images: ${sourceCount}\n`);
  process.stdout.write(`Verified destination objects: ${verifiedCount}\n`);
  process.stdout.write(`Failures: ${failures.length}\n`);
  for (const failure of failures)
    process.stderr.write(
      `Image ${sanitizeTransferFailureId(failure.id)}: ${failure.reason}\n`,
    );
  if (failures.length) process.exitCode = 1;
}

async function main() {
  if (!connectionString || !endpoint || !accessKeyId || !secretAccessKey) {
    report({
      sourceCount: "unknown",
      verifiedCount: 0,
      failures: [{ id: "configuration", reason: "required_configuration_missing" }],
    });
    return;
  }

  const sql = neon(connectionString);
  const s3 = new S3Client({
    endpoint,
    region: process.env.AWS_REGION || "eu-central-1",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  let ids;
  try {
    ids = (await sql`SELECT id FROM menu_images ORDER BY id`).map((row) => row.id);
  } catch {
    report({
      sourceCount: "unknown",
      verifiedCount: 0,
      failures: [{ id: "database", reason: "source_listing_failed" }],
    });
    return;
  }

  const result = await transferLegacyImages({
    ids,
    async readSource(id) {
      const [row] = await sql`
        SELECT id, content_type, byte_length, data
        FROM menu_images WHERE id = ${id} LIMIT 1
      `;
      return row ?? null;
    },
    async getObject(key) {
      try {
        const head = await s3.send(
          new HeadObjectCommand({ Bucket: "uploads", Key: key }),
        );
        const response = await s3.send(
          new GetObjectCommand({ Bucket: "uploads", Key: key }),
        );
        if (!response.Body) return null;
        const received = await response.Body.transformToByteArray();
        const bytes = Buffer.from(received);
        return {
          bytes,
          contentLength: head.ContentLength,
          contentType: head.ContentType,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          (("$metadata" in error &&
            error.$metadata?.httpStatusCode === 404) ||
            error.name === "NoSuchKey" ||
            error.name === "NotFound")
        )
          return null;
        throw error;
      }
    },
    async putObject(key, bytes, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: "uploads",
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
    },
  });
  report(result);
}

main().catch(() => {
  report({
    sourceCount: "unknown",
    verifiedCount: 0,
    failures: [{ id: "transfer", reason: "transfer_setup_failed" }],
  });
});
