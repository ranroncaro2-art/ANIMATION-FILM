import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const { parentPath, folderName } = await req.json();
    if (!parentPath || !folderName) {
      return NextResponse.json({ error: "Parent path and folder name are required" }, { status: 400 });
    }

    const cleanFolderName = folderName.trim().replace(/[\/\\:\*\?"<>\|]/g, "");
    if (!cleanFolderName) {
      return NextResponse.json({ error: "Invalid folder name" }, { status: 400 });
    }

    const newDirPath = path.join(parentPath, cleanFolderName);
    if (fs.existsSync(newDirPath)) {
      return NextResponse.json({ error: "Folder already exists" }, { status: 400 });
    }

    fs.mkdirSync(newDirPath, { recursive: true });

    return NextResponse.json({ success: true, path: newDirPath });
  } catch (err: any) {
    console.error("Error creating directory:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
