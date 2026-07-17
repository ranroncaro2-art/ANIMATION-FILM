import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    // PowerShell script to show folder picker System.Windows.Forms.FolderBrowserDialog
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = "Select PC Directory for AI Animation Project"
$f.ShowNewFolderButton = $true
$result = $f.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $f.SelectedPath
}
`;

    // Execute PowerShell with Single-Threaded Apartment (STA) mode
    const { stdout } = await execAsync(`powershell -NoProfile -STA -Command "${psScript.replace(/\n/g, ' ')}"`);
    const selectedPath = stdout.trim();

    if (!selectedPath) {
      return NextResponse.json({ path: "" });
    }

    // Auto create subdirectories
    const subdirs = ["images_shots", "references", "videos"];
    for (const subdir of subdirs) {
      const dirPath = path.join(selectedPath, subdir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }

    return NextResponse.json({ path: selectedPath });
  } catch (err: any) {
    console.error("Error in select-directory:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
