using System;
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
            
            // Check for portable node.exe in appDir, fallback to system node
            string nodeExe = Path.Combine(appDir, "node.exe");
            if (!File.Exists(nodeExe))
            {
                nodeExe = "node";
            }

            string frontendDir = Path.Combine(appDir, "frontend");
            string nextScript = Path.Combine(frontendDir, "node_modules", "next", "dist", "bin", "next");

            try
            {
                // Clean up any stale backend instances
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

                // 2. Start Frontend Next.js Server quietly
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

                // 3. Poll server until active (max 30 seconds wait)
                bool serverReady = WaitForServerReady("http://localhost:3001", 30);
                if (!serverReady)
                {
                    // Fallback wait if server takes slightly longer
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
                // Clean up background processes on window close
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
