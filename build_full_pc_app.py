import os
import shutil
import subprocess
import sys

def main():
    root_dir = os.path.abspath(os.path.dirname(__file__))
    dist_dir = os.path.join(root_dir, "dist")
    app_dir = os.path.join(dist_dir, "AI_Kids_Studio_App")
    
    print("=========================================================")
    print("  BUILDING STANDALONE ZERO-DEPENDENCY WINDOWS APP (EXE)")
    print("=========================================================")
    
    # 1. Clean build directory
    if os.path.exists(app_dir):
        print(f"[1/6] Cleaning existing app directory: {app_dir}")
        shutil.rmtree(app_dir, ignore_errors=True)
    os.makedirs(app_dir, exist_ok=True)
    
    # 2. Build Python Backend using PyInstaller
    print("[2/6] Packaging Python Backend into standalone executable...")
    backend_src = os.path.join(root_dir, "backend")
    backend_dist_src = os.path.join(backend_src, "dist", "backend")
    pyinstaller_cmd = [
        "pyinstaller",
        "--noconfirm",
        "--onedir",
        "--name", "backend",
        "--clean",
        "main.py"
    ]
    subprocess.run(pyinstaller_cmd, cwd=backend_src, check=True)
    
    backend_dist_dest = os.path.join(app_dir, "backend")
    print(f"Copying backend executable from {backend_dist_src} -> {backend_dist_dest}")
    shutil.copytree(backend_dist_src, backend_dist_dest)
    
    # 3. Copy Portable node.exe
    print("[3/6] Copying Portable Node.js runtime...")
    node_src = "C:\\Program Files\\nodejs\\node.exe"
    node_dest = os.path.join(app_dir, "node.exe")
    if os.path.exists(node_src):
        shutil.copy2(node_src, node_dest)
        print(f"Copied {node_src} -> {node_dest}")
    else:
        print("[WARNING] node.exe not found at standard path! Please check Node.js installation.")
        
    # 4. Copy Frontend Next.js build & node_modules
    print("[4/6] Copying Next.js production web app...")
    frontend_src = os.path.join(root_dir, "frontend")
    frontend_dest = os.path.join(app_dir, "frontend")
    os.makedirs(frontend_dest, exist_ok=True)
    
    # Build Next.js if not built
    subprocess.run("npm run build", shell=True, cwd=frontend_src, check=True)
    
    folders_to_copy = [".next", "node_modules", "public"]
    files_to_copy = ["package.json", "next.config.ts"]
    
    for folder in folders_to_copy:
        src_path = os.path.join(frontend_src, folder)
        dest_path = os.path.join(frontend_dest, folder)
        if os.path.exists(src_path):
            print(f"Copying {folder}...")
            shutil.copytree(src_path, dest_path, dirs_exist_ok=True)
            
    for file in files_to_copy:
        src_path = os.path.join(frontend_src, file)
        dest_path = os.path.join(frontend_dest, file)
        if os.path.exists(src_path):
            shutil.copy2(src_path, dest_path)
            
    # 5. Compile C# Native Windows Launcher
    print("[5/6] Compiling C# Native Windows Launcher EXE...")
    cs_file = os.path.join(dist_dir, "Launcher.cs")
    exe_file = os.path.join(app_dir, "AI_Kids_Studio.exe")
    
    cs_code = r"""using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace AIKidsStudio
{
    static class Program
    {
        private static Process backendProcess;
        private static Process frontendProcess;
        private static Process browserProcess;

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string backendExe = Path.Combine(appDir, "backend", "backend.exe");
            
            string nodeExe = Path.Combine(appDir, "node.exe");
            if (!File.Exists(nodeExe))
            {
                nodeExe = "node";
            }

            string frontendDir = Path.Combine(appDir, "frontend");
            string nextScript = Path.Combine(frontendDir, "node_modules", "next", "dist", "bin", "next");

            try
            {
                KillProcessByName("backend");

                // 1. Start Backend FastAPI Server quietly
                string backendPy = Path.Combine(appDir, "backend", "main.py");
                string venvPython = Path.Combine(appDir, "backend", "venv", "Scripts", "python.exe");

                if (File.Exists(backendExe))
                {
                    ProcessStartInfo backendInfo = new ProcessStartInfo
                    {
                        FileName = backendExe,
                        WorkingDirectory = Path.Combine(appDir, "backend"),
                        CreateNoWindow = true,
                        UseShellExecute = false
                    };
                    backendProcess = Process.Start(backendInfo);
                }
                else if (File.Exists(backendPy))
                {
                    string pythonBin = File.Exists(venvPython) ? venvPython : "python";
                    ProcessStartInfo backendInfo = new ProcessStartInfo
                    {
                        FileName = pythonBin,
                        Arguments = string.Format("\"{0}\"", backendPy),
                        WorkingDirectory = Path.Combine(appDir, "backend"),
                        CreateNoWindow = true,
                        UseShellExecute = false
                    };
                    backendProcess = Process.Start(backendInfo);
                }

                // 2. Start Frontend Server quietly
                if (Directory.Exists(frontendDir))
                {
                    ProcessStartInfo frontendInfo = new ProcessStartInfo
                    {
                        FileName = nodeExe,
                        Arguments = string.Format("\"{0}\" start -p 3001", nextScript),
                        WorkingDirectory = frontendDir,
                        CreateNoWindow = true,
                        UseShellExecute = false
                    };
                    frontendInfo.EnvironmentVariables["NODE_ENV"] = "production";
                    frontendProcess = Process.Start(frontendInfo);
                }

                // 3. Poll server until ready (up to 30s)
                bool serverReady = WaitForServerReady("http://localhost:3001", 30);
                if (!serverReady)
                {
                    Thread.Sleep(2000);
                }

                // 4. Open Edge in App Mode (or default browser)
                string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
                if (!File.Exists(edgePath))
                {
                    edgePath = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
                }

                if (File.Exists(edgePath))
                {
                    ProcessStartInfo edgeInfo = new ProcessStartInfo
                    {
                        FileName = edgePath,
                        Arguments = "--app=http://localhost:3001 --name=\"AI Kids Animation Studio\"",
                        UseShellExecute = false
                    };
                    browserProcess = Process.Start(edgeInfo);
                    browserProcess.WaitForExit();
                }
                else
                {
                    Process.Start("http://localhost:3001");
                    MessageBox.Show("AI Kids Animation Studio is running at http://localhost:3001.\n\nClick OK when you are done to exit.", "AI Kids Animation Studio", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Error starting application: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                KillProcess(browserProcess);
                KillProcess(frontendProcess);
                KillProcess(backendProcess);
                KillProcessByName("backend");
            }
        }

        private static bool WaitForServerReady(string url, int timeoutSeconds)
        {
            DateTime startTime = DateTime.Now;
            while ((DateTime.Now - startTime).TotalSeconds < timeoutSeconds)
            {
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                    request.Timeout = 1000;
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    {
                        if (response.StatusCode == HttpStatusCode.OK)
                        {
                            return true;
                        }
                    }
                }
                catch
                {
                    // Server starting up...
                }
                Thread.Sleep(300);
            }
            return false;
        }

        private static void KillProcess(Process p)
        {
            try
            {
                if (p != null && !p.HasExited)
                {
                    p.Kill();
                }
            }
            catch { }
        }

        private static void KillProcessByName(string name)
        {
            try
            {
                foreach (var p in Process.GetProcessesByName(name))
                {
                    p.Kill();
                }
            }
            catch { }
        }
    }
}
"""
    with open(cs_file, "w", encoding="utf-8") as f:
        f.write(cs_code)
        
    csc_compiler = r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    csc_cmd = [
        csc_compiler,
        "/target:winexe",
        f"/out:{exe_file}",
        "/r:System.Windows.Forms.dll",
        "/r:System.Drawing.dll",
        cs_file
    ]
    subprocess.run(csc_cmd, check=True)
    print(f"Compiled standalone launcher: {exe_file}")

    # 6. Create Zip Setup Package
    print("[6/6] Packaging full Portable App into ZIP distribution...")
    zip_path = os.path.join(dist_dir, "AI_Kids_Studio_Setup_v1.0.1")
    shutil.make_archive(zip_path, 'zip', app_dir)
    print(f"CREATED ZIP SETUP PACKAGE: {zip_path}.zip")

    print("\n=========================================================")
    print("  BUILD COMPLETED SUCCESSFULLY!")
    print(f"  Standalone App Location: {app_dir}")
    print(f"  Executable File: {exe_file}")
    print(f"  Package Zip: {zip_path}.zip")
    print("=========================================================")

if __name__ == "__main__":
    main()
