/**
 * main.js - Electron 主进程
 * 无边框悬浮窗 + always-on-top + 系统托盘 + 后台运行
 * 两种模式：island（灵动岛小窗）/ panel（展开面板）
 */

const { app, BrowserWindow, Tray, Menu, screen, ipcMain, desktopCapturer, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// 固定 userData 路径，防止改名后数据丢失
app.setPath('userData', path.join(app.getPath('appData'), 'sudoku-2048'));

let mainWindow = null;
let tray = null;

// 窗口尺寸定义
const SIZES = {
  onboarding: { width: 440, height: 640 },   // 引导向导
  island:     { width: 400, height: 220 },    // 灵动岛（悬浮球模式）+ 气泡空间
  panel:      { width: 420, height: 560 },    // 展开面板（设置/联系人/聊天）
  phone:      { width: 390, height: 750 }     // 手机模式（全功能）
};

function createWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: SIZES.onboarding.width,
    height: SIZES.onboarding.height,
    x: screenW - SIZES.onboarding.width - 30,
    y: 40,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: true,
    roundedCorners: true,
    backgroundColor: '#0c0c14',
    minWidth: 300,
    minHeight: 80,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    app.dock.hide();
  }

  mainWindow.loadFile('index.html');

  // 启动后5秒自动检查更新
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const raw = await new Promise((resolve, reject) => {
          const url = 'https://raw.githubusercontent.com/m64606104/sudoku2048/main/package.json';
          https.get(url, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve(d));
          }).on('error', reject);
        });
        const remote = JSON.parse(raw);
        const localPkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
        if (remote.version !== localPkg.version) {
          mainWindow.webContents.send('update-available', {
            remoteVersion: remote.version,
            localVersion: localPkg.version
          });
        }
      } catch (e) {
        // 静默失败，不打扰用户
      }
    }, 5000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // 创建托盘图标（16x16 简单图标）
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA' +
    'dElEQVQ4T2NkoBAwUqifYdAY8B8E/v//z4DP1UwMDAyMYAOI8QIDEwMDIwsDww8GBobf' +
    'DAwMP4D0fwaG/0DxH2Ax4lzAxMjI+IuBgeEfAwPDXwYGht8MDAy/GBgYfgHpv0BxEE2c' +
    'C0AOYGFk/M/AwEBZOgYAGt8cEWlFgNkAAAAASUVORK5CYII='
  );

  tray = new Tray(icon);
  tray.setToolTip('数独2048');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Reset Position',
      click: () => {
        if (mainWindow) {
          const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
          mainWindow.setPosition(sw - WINDOW_WIDTH - 20, 40);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ========== 截屏 IPC ==========
ipcMain.handle('capture-screen', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 800, height: 500 }
    });

    if (sources.length > 0) {
      const thumbnail = sources[0].thumbnail;
      return thumbnail.toDataURL();
    }
    return null;
  } catch (err) {
    console.error('Screen capture error:', err);
    return null;
  }
});

// ========== 窗口控制 IPC ==========
ipcMain.on('window-move', (event, { x, y }) => {
  if (mainWindow) {
    const [wx, wy] = mainWindow.getPosition();
    mainWindow.setPosition(wx + x, wy + y);
  }
});

// 模式切换：island / panel / onboarding / phone
ipcMain.on('resize-window', (event, mode) => {
  if (!mainWindow) return;
  const size = SIZES[mode] || SIZES.island;
  const [currentW, currentH] = mainWindow.getSize();
  const [currentX, currentY] = mainWindow.getPosition();

  // 居中缩放：保持窗口中心位置不变
  const newX = Math.max(0, currentX + Math.round((currentW - size.width) / 2));
  const newY = Math.max(0, currentY);

  mainWindow.setResizable(true);
  mainWindow.setBounds({ x: newX, y: newY, width: size.width, height: size.height }, true);

  // 手机模式取消 alwaysOnTop，其他模式恢复
  if (mode === 'phone') {
    mainWindow.setAlwaysOnTop(false);
  } else {
    mainWindow.setAlwaysOnTop(true);
  }
});

// 自定义大小（渲染进程指定精确像素）
ipcMain.on('resize-window-exact', (event, { width, height }) => {
  if (!mainWindow) return;
  mainWindow.setSize(width, height, true);
});

// ========== 退出应用 IPC ==========
ipcMain.on('quit-app', () => {
  app.isQuitting = true;
  app.quit();
});

// ========== App Lifecycle ==========
app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// 防止窗口关闭时退出（缩到托盘）
app.on('before-quit', () => {
  app.isQuitting = true;
});

// ========== 检查更新 IPC ==========
// GitHub 仓库地址（需要用户填写）
const GITHUB_REPO = 'm64606104/sudoku2048';

const UPDATE_FILES = ['main.js', 'preload.js', 'index.html', 'style.css', 'store.js', 'vision.js', 'api.js', 'ui.js', 'start.bat'];

function followRedirects(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'sudoku2048-updater' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        followRedirects(res.headers.location).then(resolve).catch(reject);
      } else if (res.statusCode === 200) {
        resolve(res);
      } else {
        reject(new Error('HTTP ' + res.statusCode));
      }
    }).on('error', reject);
  });
}

ipcMain.handle('check-update', async () => {
  try {
    // 1. 获取远程 package.json 的版本号
    const raw = await new Promise((resolve, reject) => {
      const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`;
      https.get(url, { headers: { 'User-Agent': 'sudoku2048-updater' } }, (res) => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    const remote = JSON.parse(raw);
    const localPkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    
    if (remote.version === localPkg.version) {
      return { ok: true, upToDate: true, version: localPkg.version };
    }
    return { ok: true, upToDate: false, remoteVersion: remote.version, localVersion: localPkg.version };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('do-update', async () => {
  try {
    // 逐个下载最新文件覆盖本地
    let updated = 0;
    for (const file of UPDATE_FILES) {
      try {
        const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${file}`;
        const res = await followRedirects(url);
        const filePath = path.join(__dirname, file);
        const content = await new Promise((resolve, reject) => {
          let data = [];
          res.on('data', d => data.push(d));
          res.on('end', () => resolve(Buffer.concat(data)));
          res.on('error', reject);
        });
        fs.writeFileSync(filePath, content);
        updated++;
      } catch (e) {
        // 跳过不存在的文件
        console.log('Skip update for:', file, e.message);
      }
    }
    // 更新 package.json
    try {
      const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`;
      const res = await followRedirects(url);
      const content = await new Promise((resolve, reject) => {
        let data = [];
        res.on('data', d => data.push(d));
        res.on('end', () => resolve(Buffer.concat(data)));
        res.on('error', reject);
      });
      fs.writeFileSync(path.join(__dirname, 'package.json'), content);
    } catch (e) { /* ignore */ }

    return { ok: true, updated };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
