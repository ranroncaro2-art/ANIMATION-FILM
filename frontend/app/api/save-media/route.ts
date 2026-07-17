import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const { pcDirectory, subFolder, filename, url } = await req.json();
    if (!pcDirectory || !subFolder || !filename || !url) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    // Verify target directory exists
    const targetDir = path.join(pcDirectory, subFolder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetPath = path.join(targetDir, filename);

    // Download content
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch media from ${url}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(targetPath, buffer);

    return NextResponse.json({ success: true, savedPath: targetPath });
  } catch (err: any) {
    console.error("Error in save-media:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
