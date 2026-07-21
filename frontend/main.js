const { spawn } = require('child_process');
const path = require('path');
const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const os = require('os');
const http = require('http');
const fs = require('fs');

let nextProcess = null;
let backendProcess = null;
let mainWindow = null;
const PORT = 3001;

function startBackendServer() {
  const appPath = app.getAppPath();
  const backendExe = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'backend.exe')
    : path.join(appPath, '..', 'backend', 'dist', 'backend', 'backend.exe');

  if (fs.existsSync(backendExe)) {
    console.log('[Electron] Starting Backend FastAPI Server:', backendExe);
    backendProcess = spawn(backendExe, [], {
      cwd: path.dirname(backendExe),
      shell: false
    });

    backendProcess.stdout?.on('data', (data) => {
      console.log(`[Backend Server]: ${data.toString().trim()}`);
    });

    backendProcess.stderr?.on('data', (data) => {
      console.error(`[Backend Error]: ${data.toString().trim()}`);
    });
  } else {
    console.log('[Electron Warning] Backend executable not found at:', backendExe);
  }
}

function startNextServer() {
  const appPath = app.getAppPath();
  const nextBin = path.join(appPath, 'node_modules', 'next', 'dist', 'bin', 'next');
  
  const hasNextBuild = fs.existsSync(path.join(appPath, '.next'));
  const isDev = !app.isPackaged && !hasNextBuild;
  const command = isDev ? 'dev' : 'start';

  const nodeExe = 'node';

  console.log(`[Electron Launcher] Launching Next.js server in "${command}" mode on port ${PORT}...`);
  nextProcess = spawn(nodeExe, [nextBin, command, '-p', PORT.toString()], {
    cwd: appPath,
    env: { 
      ...process.env, 
      NODE_ENV: isDev ? 'development' : 'production',
      ELECTRON_PACKAGED: app.isPackaged ? 'true' : 'false'
    },
    shell: false
  });

  nextProcess.stdout?.on('data', (data) => {
    console.log(`[Next.js Server]: ${data.toString().trim()}`);
  });

  nextProcess.stderr?.on('data', (data) => {
    console.error(`[Next.js Server Error]: ${data.toString().trim()}`);
  });
}

function checkServerReady(callback) {
  const req = http.get(`http://localhost:${PORT}`, (res) => {
    console.log(`[Electron Launcher] Next.js server ready (HTTP status: ${res.statusCode})`);
    callback();
  });

  req.on('error', () => {
    setTimeout(() => checkServerReady(callback), 300);
  });

  req.end();
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'AI KIDS ANIMATION STUDIO',
    icon: path.join(__dirname, 'public', 'favicon.ico'),
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.setMenu(null);

  checkServerReady(() => {
    if (mainWindow) {
      mainWindow.loadURL(`http://localhost:${PORT}`);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function killProcesses() {
  if (nextProcess) {
    try { nextProcess.kill('SIGINT'); } catch (e) {}
    nextProcess = null;
  }
  if (backendProcess) {
    try { backendProcess.kill('SIGINT'); } catch (e) {}
    backendProcess = null;
  }
}

app.whenReady().then(() => {
  startBackendServer();
  startNextServer();
  createWindow();
});

app.on('will-quit', () => {
  killProcesses();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-mac-address', () => {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          return iface.mac.toUpperCase();
        }
      }
    }
  } catch (err) {
    console.error('Error fetching MAC address:', err);
  }
  return 'MAC-NOT-FOUND';
});

ipcMain.on('window-action', (event, action) => {
  if (action === 'reload' && mainWindow) {
    mainWindow.reload();
  }
});
