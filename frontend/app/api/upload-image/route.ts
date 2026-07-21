import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let fileBuffer: Buffer | null = null;
    let fileName = "upload.jpg";
    let accountId = "default_account";

    if (contentType.includes("application/json")) {
      const body = await req.json();
      const { imagePath, accountId: accId } = body;
      if (accId) accountId = accId;

      if (!imagePath) {
        return NextResponse.json({ error: "Missing imagePath parameter" }, { status: 400 });
      }

      // Handle relative or decoded media path
      let cleanPath = imagePath;
      if (cleanPath.startsWith("/api/media?path=")) {
        cleanPath = decodeURIComponent(cleanPath.replace("/api/media?path=", ""));
      }

      const resolvedPath = path.resolve(cleanPath);
      if (!fs.existsSync(resolvedPath)) {
        return NextResponse.json({ error: `File not found at path: ${resolvedPath}` }, { status: 404 });
      }

      fileBuffer = fs.readFileSync(resolvedPath);
      fileName = path.basename(resolvedPath);
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const accId = formData.get("accountId") as string | null;
      if (accId) accountId = accId;

      if (!file) {
        return NextResponse.json({ error: "Missing file in form data" }, { status: 400 });
      }

      const arrayBuffer = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
      fileName = file.name || "upload.jpg";
    } else {
      return NextResponse.json({ error: "Unsupported Content-Type" }, { status: 400 });
    }

    if (!fileBuffer) {
      return NextResponse.json({ error: "Unable to read image file" }, { status: 400 });
    }

    // Build FormData to send to local server http://127.0.0.1:5000/api/upload_image
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: "image/jpeg" });
    const localFormData = new FormData();
    localFormData.append("file", blob, fileName);
    if (accountId) {
      localFormData.append("account_id", accountId);
    }

    const localApiUrl = "http://127.0.0.1:5000/api/upload_image";
    const uploadRes = await fetch(localApiUrl, {
      method: "POST",
      body: localFormData
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Local upload_image API error (${uploadRes.status}): ${errText}`);
    }

    const uploadData = await uploadRes.json();
    if (!uploadData.success || !uploadData.media_id) {
      throw new Error(uploadData.error || "Failed to obtain media_id from local upload_image API");
    }

    return NextResponse.json({
      success: true,
      media_id: uploadData.media_id,
      account_id: accountId
    });
  } catch (err: any) {
    console.error("Error in upload-image API:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
