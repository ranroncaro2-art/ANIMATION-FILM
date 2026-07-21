import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const { path: selectedPath } = await req.json();
    if (!selectedPath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    // Verify it is a valid-looking path format
    // On Windows, absolute path starts with a drive letter, e.g. D:\ or C:\
    const cleanPath = selectedPath.trim();
    
    // Auto create subdirectories
    const subdirs = ["references", "images", "videos"];
    for (const subdir of subdirs) {
      const dirPath = path.join(cleanPath, subdir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }

    return NextResponse.json({ success: true, path: cleanPath });
  } catch (err: any) {
    console.error("Error in init-directory:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
