const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, desktopCapturer } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let tray;
let nutMouse, nutKeyboard, nutButton, nutPoint;

try {
  const nut = require('@nut-tree-fork/nut-js');
  nutMouse = nut.mouse;
  nutKeyboard = nut.keyboard;
  nutButton = nut.Button;
  nutPoint = nut.Point;
} catch (err) {
  console.error('nut-js failed to load:', err.message);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setToolTip('GUIShell Boilerplate');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow?.show());
}

ipcMain.handle('simulate-input', async (_event, data) => {
  if (!nutMouse || !nutKeyboard) {
    console.error('simulate-input: nut-js not available');
    return { success: false, error: 'nut-js not available - input simulation disabled' };
  }
  try {
    const { type, x, y, button, char } = data;
    switch (type) {
      case 'mouse_move':
        await nutMouse.move(new nutPoint(x, y));
        break;
      case 'mouse_click':
        await nutMouse.move(new nutPoint(x, y));
        const btn = button === 'right' ? nutButton.RIGHT : nutButton.LEFT;
        await nutMouse.click(btn);
        break;
      case 'key':
        if (char) await nutKeyboard.type(char);
        break;
    }
    return { success: true };
  } catch (err) {
    console.error('simulate-input error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-desktop-sources', async (_event, opts) => {
  const sources = await desktopCapturer.getSources(opts);
  return sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
});

app.whenReady().then(() => {
  createMainWindow();
  createTray();

  autoUpdater.autoDownload = true;
  autoUpdater.checkForUpdatesAndNotify();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
