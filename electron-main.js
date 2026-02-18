const { app, BrowserWindow } = require("electron");
const path = require("path");
const { startServer } = require("./server");

let mainWindow = null;
let httpServer = null;

async function createWindow() {
  const { server, port } = await startServer(0);
  httpServer = server;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "이미지 선택 다운로드",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      devTools: true,
    },
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow).catch((error) => {
  console.error("Electron app failed to start:", error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => {
      console.error("Failed to reopen window:", error);
    });
  }
});
