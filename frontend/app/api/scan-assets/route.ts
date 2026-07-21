import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const { pcDirectory } = await req.json();

    if (!pcDirectory) {
      return NextResponse.json({ error: "Missing pcDirectory parameter" }, { status: 400 });
    }

    const targetPath = path.resolve(pcDirectory);
    if (!fs.existsSync(targetPath)) {
      return NextResponse.json({ error: "Directory does not exist" }, { status: 404 });
    }

    const getFiles = (dirName: string) => {
      const dirPath = path.join(targetPath, dirName);
      if (!fs.existsSync(dirPath)) return [];
      try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        return items
          .filter(item => item.isFile())
          .map(item => ({
            name: item.name,
            path: path.join(dirPath, item.name)
          }));
      } catch (err) {
        console.error(`Error reading ${dirName}:`, err);
        return [];
      }
    };

    const references = getFiles("references");
    const imagesNew = getFiles("images");
    const imagesShotsLegacy = getFiles("images_shots");
    
    // Combine images folder and legacy images_shots folder (avoiding duplicate paths)
    const existingPaths = new Set(imagesNew.map(f => f.path));
    const combinedImages = [...imagesNew];
    for (const item of imagesShotsLegacy) {
      if (!existingPaths.has(item.path)) {
        combinedImages.push(item);
      }
    }

    const videos = getFiles("videos");

    return NextResponse.json({
      success: true,
      references,
      images: combinedImages,
      images_shots: combinedImages,
      videos
    });
  } catch (err: any) {
    console.error("Error scanning assets:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
