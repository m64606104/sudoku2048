/**
 * preload.js - 安全桥接
 * 暴露 Electron 能力给渲染进程（截屏、窗口控制）
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 截取屏幕，返回 base64 data URL
  captureScreen: () => ipcRenderer.invoke('capture-screen'),

  // 移动窗口（拖拽用）
  moveWindow: (deltaX, deltaY) => ipcRenderer.send('window-move', { x: deltaX, y: deltaY }),

  // 切换窗口模式: 'island' | 'panel' | 'onboarding'
  resizeWindow: (mode) => ipcRenderer.send('resize-window', mode),

  // 精确调整窗口大小（像素）
  resizeWindowExact: (width, height) => ipcRenderer.send('resize-window-exact', { width, height }),

  // 退出应用
  quitApp: () => ipcRenderer.send('quit-app'),

  // 检查更新
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  doUpdate: () => ipcRenderer.invoke('do-update'),

  // 启动时自动更新通知
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, data) => callback(data)),

  // 判断是否在 Electron 环境
  isElectron: true
});
