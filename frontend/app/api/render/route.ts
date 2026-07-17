import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, resolution, shots, keyframes, motion_prompts } = body;

    // Validate
    if (!projectId || !shots) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Map resolution
    let width = 1280;
    let height = 720;
    if (resolution === "1080") {
      width = 1920;
      height = 1080;
    } else if (resolution === "360") {
      width = 640;
      height = 360;
    }

    // Write temp configuration file
    const tempFilename = `render_config_${projectId}_${Date.now()}.json`;
    const tempConfigDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(tempConfigDir)) {
      fs.mkdirSync(tempConfigDir, { recursive: true });
    }
    const tempConfigPath = path.join(tempConfigDir, tempFilename);
    
    const configData = { shots, keyframes, motion_prompts };
    fs.writeFileSync(tempConfigPath, JSON.stringify(configData, null, 2), "utf-8");

    // Output directory
    const outputDir = path.join(process.cwd(), "public", "exports");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputFilename = `${projectId}.mp4`;
    const outputPath = path.join(outputDir, outputFilename);

    // Python script path
    const scriptPath = path.join(process.cwd(), "..", "backend", "video_compiler.py");

    // Spawning Python
    const pythonExe = process.platform === "win32" ? "python" : "python3";
    
    const args = [
      scriptPath,
      "--config", tempConfigPath,
      "--output", outputPath,
      "--width", String(width),
      "--height", String(height)
    ];

    const child = spawn(pythonExe, args, {
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8"
      }
    });

    // Return a ReadableStream
    const stream = new ReadableStream({
      start(controller) {
        let buffer = "";

        child.stdout.on("data", (data) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep the last incomplete line

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("PROGRESS:")) {
              const percent = parseInt(trimmed.substring(9)) || 0;
              const chunk = JSON.stringify({
                percent,
                stage: `Processing frames (${percent}%)`,
                status: "running"
              }) + "\n";
              controller.enqueue(new TextEncoder().encode(chunk));
            } else if (trimmed.startsWith("Starting compilation")) {
              const chunk = JSON.stringify({
                percent: 0,
                stage: trimmed,
                status: "running"
              }) + "\n";
              controller.enqueue(new TextEncoder().encode(chunk));
            } else if (trimmed.includes("GPU Hardware Acceleration")) {
              const chunk = JSON.stringify({
                percent: 2,
                stage: "Using GPU (NVENC) encoding",
                status: "running"
              }) + "\n";
              controller.enqueue(new TextEncoder().encode(chunk));
            } else if (trimmed.includes("GPU NVENC not available")) {
              const chunk = JSON.stringify({
                percent: 2,
                stage: "Using CPU (libx264) encoding",
                status: "running"
              }) + "\n";
              controller.enqueue(new TextEncoder().encode(chunk));
            }
          }
        });

        child.stderr.on("data", (data) => {
          console.error("[Python Compiler Err]:", data.toString());
        });

        child.on("close", (code) => {
          // Clean up temp config file
          try {
            if (fs.existsSync(tempConfigPath)) {
              fs.unlinkSync(tempConfigPath);
            }
          } catch (err) {
            console.error("Temp file deletion error:", err);
          }

          if (code === 0) {
            const chunk = JSON.stringify({
              percent: 100,
              stage: "Export complete!",
              status: "success",
              videoUrl: `/exports/${outputFilename}`
            }) + "\n";
            controller.enqueue(new TextEncoder().encode(chunk));
          } else {
            const chunk = JSON.stringify({
              percent: 100,
              stage: `Failed with exit code ${code}`,
              status: "failed",
              error: `Compiler exited with code ${code}`
            }) + "\n";
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        });

        child.on("error", (err) => {
          // Clean up temp config file
          try {
            if (fs.existsSync(tempConfigPath)) {
              fs.unlinkSync(tempConfigPath);
            }
          } catch (cleanupErr) {
            console.error("Temp file deletion error on crash:", cleanupErr);
          }

          const chunk = JSON.stringify({
            percent: 100,
            stage: "Process error",
            status: "failed",
            error: err.message
          }) + "\n";
          controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        });
      }
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    });
    
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
