import os
import shutil
import subprocess
import sys
import struct

def main():
    root_dir = os.path.abspath(os.path.dirname(__file__))
    dist_dir = os.path.join(root_dir, "dist")
    app_dir = os.path.join(dist_dir, "AI_Kids_Studio_App")
    zip_path = os.path.join(dist_dir, "AI_Kids_Studio_Setup_v1.0.1.zip")
    output_setup_exe = os.path.join(dist_dir, "AI_Kids_Studio_Setup_v1.0.1.exe")
    
    print("=========================================================")
    print("  BUILDING 1-FILE STANDALONE INSTALLER EXE FOR PC")
    print("=========================================================")

    # Ensure app directory & zip package exist
    if not os.path.exists(zip_path):
        print(f"[1/3] Creating Zip payload archive from {app_dir}...")
        shutil.make_archive(os.path.join(dist_dir, "AI_Kids_Studio_Setup_v1.0.1"), 'zip', app_dir)

    print(f"[2/3] Compiling C# Installer Stub Executable...")
    cs_file = os.path.join(dist_dir, "SetupInstaller.cs")
    stub_exe = os.path.join(dist_dir, "InstallerStub.exe")

    cs_code = r"""using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Threading;
using System.Windows.Forms;

namespace AIKidsStudioInstaller
{
    public class SetupForm : Form
    {
        private ProgressBar progressBar;
        private Label lblStatus;
        private Button btnFinish;

        public SetupForm()
        {
            this.Text = "AI Kids Animation Studio - Cài Đặt";
            this.Size = new System.Drawing.Size(500, 230);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.BackColor = System.Drawing.Color.FromArgb(15, 23, 42);
            this.ForeColor = System.Drawing.Color.White;

            Label lblTitle = new Label();
            lblTitle.Text = "AI Kids Animation Studio Setup";
            lblTitle.Font = new System.Drawing.Font("Segoe UI", 12, System.Drawing.FontStyle.Bold);
            lblTitle.Location = new System.Drawing.Point(20, 20);
            lblTitle.Size = new System.Drawing.Size(440, 30);
            lblTitle.ForeColor = System.Drawing.Color.FromArgb(167, 139, 250);
            this.Controls.Add(lblTitle);

            lblStatus = new Label();
            lblStatus.Text = "Đang chuẩn bị dải nén dữ liệu cài đặt...";
            lblStatus.Font = new System.Drawing.Font("Segoe UI", 9, System.Drawing.FontStyle.Regular);
            lblStatus.Location = new System.Drawing.Point(20, 55);
            lblStatus.Size = new System.Drawing.Size(440, 25);
            lblStatus.ForeColor = System.Drawing.Color.FromArgb(203, 213, 225);
            this.Controls.Add(lblStatus);

            progressBar = new ProgressBar();
            progressBar.Location = new System.Drawing.Point(20, 85);
            progressBar.Size = new System.Drawing.Size(440, 24);
            progressBar.Style = ProgressBarStyle.Marquee;
            this.Controls.Add(progressBar);

            btnFinish = new Button();
            btnFinish.Text = "Đang cài đặt...";
            btnFinish.Enabled = false;
            btnFinish.Location = new System.Drawing.Point(340, 130);
            btnFinish.Size = new System.Drawing.Size(120, 38);
            btnFinish.BackColor = System.Drawing.Color.FromArgb(139, 92, 246);
            btnFinish.ForeColor = System.Drawing.Color.White;
            btnFinish.FlatStyle = FlatStyle.Flat;
            btnFinish.Cursor = Cursors.Hand;
            btnFinish.Click += (s, e) => {
                string exePath = Path.Combine(GetInstallDir(), "AI_Kids_Studio.exe");
                if (File.Exists(exePath)) {
                    Process.Start(exePath);
                }
                Application.Exit();
            };
            this.Controls.Add(btnFinish);

            this.Load += (s, e) => {
                Thread t = new Thread(InstallProcess);
                t.IsBackground = true;
                t.Start();
            };
        }

        private string GetInstallDir()
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return Path.Combine(localAppData, "Programs", "AI_Kids_Studio");
        }

        private void InstallProcess()
        {
            try
            {
                UpdateStatus("Đang giải nén tập tin ứng dụng...");
                string installDir = GetInstallDir();
                if (Directory.Exists(installDir))
                {
                    try { Directory.Delete(installDir, true); } catch { }
                }
                Directory.CreateDirectory(installDir);

                // Extract Zip payload appended at the tail of executable
                string currentExe = Application.ExecutablePath;
                using (FileStream fs = new FileStream(currentExe, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    fs.Seek(-8, SeekOrigin.End);
                    byte[] lenBytes = new byte[8];
                    fs.Read(lenBytes, 0, 8);
                    long zipLen = BitConverter.ToInt64(lenBytes, 0);

                    long zipOffset = fs.Length - 8 - zipLen;
                    fs.Seek(zipOffset, SeekOrigin.Begin);

                    using (MemoryStream ms = new MemoryStream())
                    {
                        byte[] buffer = new byte[65536];
                        long remaining = zipLen;
                        while (remaining > 0)
                        {
                            int read = fs.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                            if (read <= 0) break;
                            ms.Write(buffer, 0, read);
                            remaining -= read;
                        }
                        ms.Seek(0, SeekOrigin.Begin);
                        using (ZipArchive archive = new ZipArchive(ms))
                        {
                            archive.ExtractToDirectory(installDir);
                        }
                    }
                }

                UpdateStatus("Đang tạo Shortcut trên Desktop...");
                CreateShortcuts(installDir);

                this.Invoke((MethodInvoker)delegate {
                    progressBar.Style = ProgressBarStyle.Blocks;
                    progressBar.Value = 100;
                    lblStatus.Text = "Cài đặt thành công! Bấm Mở Ứng Dụng để chạy.";
                    btnFinish.Text = "Mở Ứng Dụng";
                    btnFinish.Enabled = true;
                });
            }
            catch (Exception ex)
            {
                this.Invoke((MethodInvoker)delegate {
                    MessageBox.Show("Lỗi cài đặt: " + ex.Message, "Cài đặt thất bại", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    Application.Exit();
                });
            }
        }

        private void UpdateStatus(string msg)
        {
            this.Invoke((MethodInvoker)delegate {
                lblStatus.Text = msg;
            });
        }

        private void CreateShortcuts(string installDir)
        {
            try
            {
                string targetExe = Path.Combine(installDir, "AI_Kids_Studio.exe");
                string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string shortcutPath = Path.Combine(desktopPath, "AI Kids Animation Studio.lnk");

                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetExe;
                shortcut.WorkingDirectory = installDir;
                shortcut.Description = "AI Kids Animation Studio";
                shortcut.Save();
            }
            catch { }
        }
    }

    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
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
        f"/out:{stub_exe}",
        "/r:System.Windows.Forms.dll",
        "/r:System.Drawing.dll",
        "/r:System.IO.Compression.dll",
        "/r:System.IO.Compression.FileSystem.dll",
        cs_file
    ]
    subprocess.run(csc_cmd, check=True)
    print(f"Compiled Installer Stub: {stub_exe}")

    print(f"[3/3] Merging Installer Stub + ZIP payload -> {output_setup_exe}...")
    with open(output_setup_exe, "wb") as f_out:
        with open(stub_exe, "rb") as f_stub:
            f_out.write(f_stub.read())
        
        with open(zip_path, "rb") as f_zip:
            zip_bytes = f_zip.read()
            zip_len = len(zip_bytes)
            f_out.write(zip_bytes)
            f_out.write(struct.pack("<q", zip_len)) # 8-byte little-endian int64 length header

    print("\n=========================================================")
    print("  1-FILE SETUP EXE BUILT SUCCESSFULLY!")
    print(f"  Setup Executable: {output_setup_exe}")
    print(f"  Size: {os.path.getsize(output_setup_exe) / (1024*1024):.2f} MB")
    print("=========================================================")

if __name__ == "__main__":
    main()
