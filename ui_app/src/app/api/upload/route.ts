import { Storage } from "@google-cloud/storage";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const storage = new Storage({
  projectId: process.env?.GCP_PROJECT_ID,
  credentials: {
    client_email: process.env?.GCP_CLIENT_EMAIL!,
    private_key: process.env?.GCP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
});

const bucket = storage.bucket(process.env.GCS_BUCKET_NAME!);

export async function POST(req: NextRequest) {
  try {
    const filename = `${randomUUID()}.gz`;
    const file = bucket.file(filename);

    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 60 * 60 * 1000, // 60 minutes
      contentType: "application/gzip",
    });

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;

    return NextResponse.json({ url, publicUrl });
  } catch (error) {
    console.error("Error generating signed URL:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
