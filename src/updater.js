// Auto-update from GitHub Releases (electron-updater). Only active in the packaged app.
const { app, Notification } = require('electron');

const CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const state = { status: app.isPackaged ? 'idle' : 'dev', version: null, percent: 0, error: null };
let onChange = () => {};
let autoUpdater = null;

function friendlyError(e) {
  const msg = String(e?.message || e);
  if (/Unable to find latest version|HttpError: 404|No published versions/i.test(msg)) return '아직 배포된 릴리스가 없습니다';
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|net::ERR_/i.test(msg)) return '네트워크에 연결할 수 없습니다';
  return msg.split('\n')[0].slice(0, 160);
}

function set(patch) {
  Object.assign(state, patch);
  onChange({ ...state, current: app.getVersion() });
}

function getState() {
  return { ...state, current: app.getVersion() };
}

function check() {
  if (!autoUpdater) return;
  if (['checking', 'downloading', 'downloaded'].includes(state.status)) return;
  autoUpdater.checkForUpdates().catch((e) => set({ status: 'error', error: friendlyError(e) }));
}

function install() {
  if (autoUpdater && state.status === 'downloaded') {
    // isSilent: no installer UI; isForceRunAfter: relaunch the widget when done.
    autoUpdater.quitAndInstall(true, true);
  }
}

function init(listener) {
  onChange = listener;
  if (!app.isPackaged) return;

  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => set({ status: 'latest' }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    set({ status: 'downloaded', version: info.version, percent: 100 });
    if (Notification.isSupported()) {
      const n = new Notification({
        title: `whenpc ${info.version} 업데이트 준비됨`,
        body: '클릭하면 바로 재시작해 설치합니다. 그냥 두면 다음에 종료할 때 설치됩니다.',
      });
      n.on('click', install);
      n.show();
    }
  });
  autoUpdater.on('error', (e) => set({ status: 'error', error: friendlyError(e) }));

  setTimeout(check, CHECK_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS);
}

module.exports = { init, check, install, getState };
