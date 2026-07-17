import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const { currentPath } = await req.json();

    // If path is empty, list Windows logical drives
    if (!currentPath) {
      const drives: string[] = [];
      for (let i = 65; i <= 90; i++) {
        const drive = String.fromCharCode(i) + ":\\";
        try {
          // Check if drive exists and is accessible
          fs.accessSync(drive, fs.constants.F_OK);
          drives.push(drive);
        } catch {
          // Ignore inaccessible drives
        }
      }
      return NextResponse.json({ isRoot: true, parent: null, currentPath: "", folders: drives.map(d => ({ name: d, path: d })) });
    }

    // Resolve path and read contents
    const targetPath = path.resolve(currentPath);
    if (!fs.existsSync(targetPath)) {
      return NextResponse.json({ error: "Directory does not exist" }, { status: 404 });
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }

    // Read only subdirectories
    let files: fs.Dirent[] = [];
    try {
      files = fs.readdirSync(targetPath, { withFileTypes: true });
    } catch (err: any) {
      return NextResponse.json({ error: `Permission denied or folder inaccessible: ${err.message}` }, { status: 403 });
    }

    const folders = files
      .filter(f => f.isDirectory() && !f.name.startsWith(".") && !f.name.startsWith("$"))
      .map(f => ({
        name: f.name,
        path: path.join(targetPath, f.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(targetPath);
    // On Windows root, dirname("D:\\") is "D:\\", check if we are at drive root
    const isDriveRoot = targetPath.endsWith(":\\") || targetPath.endsWith(":/") || targetPath === parent;

    return NextResponse.json({
      isRoot: false,
      parent: isDriveRoot ? null : parent,
      currentPath: targetPath,
      folders
    });
  } catch (err: any) {
    console.error("Error exploring directory:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
