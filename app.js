// ConstruDrone app: manual WiFi camera + manual Bluetooth (BLE) sensors.
'use strict';
 
const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // board -> app (notify)
const $ = id => document.getElementById(id);
 
/* ---------- saved settings (only remembers values, never auto-connects) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
};
 
const fields = ['camIp', 'camPort', 'distWarn', 'distDanger', 'gasWarn', 'gasDanger'];
fields.forEach(id => {
  const el = $(id);
  el.value = store.get(id, el.value);
  el.addEventListener('change', () => { store.set(id, el.value.trim()); refresh(); });
});
const num = id => Number($(id).value);
 
/* ---------- small helpers ---------- */
function setChip(id, state) { $(id).dataset.state = state; }
function setMsg(id, text, isError) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}
 
/* ---------- camera (WiFi, manual) ---------- */
let camState = 'off';   // off | connecting | on
let camTimer = null;
const img = $('stream');
 
function camSet(state) {
  camState = state;
  setChip('camChip', state === 'off' ? 'off' : state);
  $('camBtn').textContent = state === 'off' ? 'Connect camera' : 'Disconnect camera';
  $('camBtn').classList.toggle('active', state !== 'off');
  document.querySelector('.screen').classList.toggle('live', state === 'on');
}
 
function camStop(message, isError) {
  clearTimeout(camTimer);
  camState = 'off';
  img.removeAttribute('src');
  camSet('off');
  if (isError) setChip('camChip', 'error');
  if (message) setMsg('camMsg', message, isError);
}
 
function camStart() {
  const ip = $('camIp').value.trim();
  const port = $('camPort').value.trim() || '81';
  if (!/^[A-Za-z0-9.\-]+$/.test(ip)) {
    setMsg('camMsg', 'Enter the camera IP address, for example 192.168.4.1.', true);
    $('camIp').focus();
    return;
  }
  store.set('camIp', ip);
  camSet('connecting');
  setMsg('camMsg', 'Connecting to ' + ip + '...');
  img.src = 'http://' + ip + ':' + port + '/stream';
  camTimer = setTimeout(() => {
    if (camState === 'connecting') {
      camStop('Could not reach the camera. Check that your device is on the camera\'s WiFi and the IP is right.', true);
    }
  }, 10000);
}
 
img.addEventListener('load', () => {
  if (camState !== 'connecting') return;
  clearTimeout(camTimer);
  camSet('on');
  setMsg('camMsg', 'Camera connected.');
});
img.addEventListener('error', () => {
  if (camState === 'off') return;
  camStop('Camera connection failed. Check the WiFi, the IP and the port, then connect again.', true);
});
 
$('camBtn').addEventListener('click', () => {
  if (camState === 'off') camStart();
  else camStop('Camera disconnected.');
});
 
/* ---------- sensors (Bluetooth LE, manual) ---------- */
let bleDevice = null;
let bleBuf = '';
let userDisconnect = false;
let lastData = 0;
const decoder = new TextDecoder();
 
function bleUi(state) {
  setChip('bleChip', state);
  const connected = state === 'on';
  $('bleBtn').textContent = connected ? 'Disconnect sensors' : 'Connect sensors';
  $('bleBtn').classList.toggle('active', connected);
  $('bleBtn').disabled = state === 'connecting';
}
 
async function bleConnect() {
  if (!navigator.bluetooth) {
    setChip('bleChip', 'error');
    setMsg('bleMsg', 'This browser has no Bluetooth support. Use Chrome or Edge on Android or desktop.', true);
    return;
  }
  userDisconnect = false;
  try {
    bleUi('connecting');
    setMsg('bleMsg', 'Choose ConstruDrone in the Bluetooth window...');
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'ConstruDrone' }],
      optionalServices: [NUS_SERVICE]
    });
    bleDevice.addEventListener('gattserverdisconnected', onBleLost);
    setMsg('bleMsg', 'Connecting to ' + (bleDevice.name || 'sensor board') + '...');
    const server = await bleDevice.gatt.connect();
    const service = await server.getPrimaryService(NUS_SERVICE);
    const tx = await service.getCharacteristic(NUS_TX);
    tx.addEventListener('characteristicvaluechanged', onBleData);
    await tx.startNotifications();
    bleBuf = '';
    bleUi('on');
    setMsg('bleMsg', 'Sensors connected. Waiting for data...');
  } catch (err) {
    bleUi('off');
    if (err && err.name === 'NotFoundError') {
      setMsg('bleMsg', 'No sensor board selected. Tap Connect sensors to try again.');
    } else {
      setChip('bleChip', 'error');
      setMsg('bleMsg', 'Could not connect: ' + (err && err.message ? err.message : err), true);
    }
  }
}
 
function bleDisconnect() {
  userDisconnect = true;
  if (bleDevice && bleDevice.gatt.connected) bleDevice.gatt.disconnect();
  else onBleLost();
}
 
function onBleLost() {
  bleUi('off');
  lastData = 0;
  readings.d = null; readings.g = null;
  refresh();
  if (userDisconnect) setMsg('bleMsg', 'Sensors disconnected.');
  else {
    setChip('bleChip', 'error');
    setMsg('bleMsg', 'Sensor connection lost. Tap Connect sensors to reconnect.', true);
  }
}
 
function onBleData(event) {
  bleBuf += decoder.decode(event.target.value);
  const lines = bleBuf.split('\n');
  bleBuf = lines.pop();                       // keep the unfinished part
  lines.forEach(parseLine);
}
 
// Expected line: D:25.4,G:340
function parseLine(line) {
  const d = line.match(/D:\s*(-?\d+(?:\.\d+)?)/);
  const g = line.match(/G:\s*(-?\d+(?:\.\d+)?)/);
  if (!d && !g) return;
  if (d) readings.d = Number(d[1]);
  if (g) readings.g = Number(g[1]);
  lastData = Date.now();
  setMsg('bleMsg', 'Sensors connected. Receiving live data.');
  refresh();
}
 
$('bleBtn').addEventListener('click', () => {
  if (bleDevice && bleDevice.gatt.connected) bleDisconnect();
  else bleConnect();
});
 
// If the board stops sending, show it instead of freezing on old numbers.
setInterval(() => {
  if (lastData && Date.now() - lastData > 3000) {
    lastData = 0;
    readings.d = null; readings.g = null;
    setMsg('bleMsg', 'Connected, but no data for 3 seconds. Check the sensor board.', true);
    refresh();
  }
}, 1000);
 
/* ---------- show readings ---------- */
const readings = { d: null, g: null };
 
function distState(d) {
  if (d === null || d <= 0 || d > 400) return 'none';   // 0 or >400 = no echo / out of range
  if (d <= num('distDanger')) return 'danger';
  if (d <= num('distWarn')) return 'warn';
  return 'ok';
}
function gasState(g) {
  if (g === null) return 'none';
  if (g >= num('gasDanger')) return 'danger';
  if (g >= num('gasWarn')) return 'warn';
  return 'ok';
}
 
const distText = { none: 'No data', ok: 'Clear', warn: 'Getting close', danger: 'Too close' };
const gasText  = { none: 'No data', ok: 'Air normal', warn: 'Gas rising', danger: 'High gas' };
 
function refresh() {
  const ds = distState(readings.d);
  const gs = gasState(readings.g);
 
  $('distVal').textContent = ds === 'none' ? '--' : readings.d.toFixed(1);
  $('distStatus').textContent = distText[ds];
  $('distCard').dataset.state = ds;
  const near = ds === 'none' ? 0 : Math.max(0, Math.min(100, (1 - readings.d / 200) * 100));
  $('distBar').style.width = near + '%';
 
  $('gasVal').textContent = gs === 'none' ? '--' : Math.round(readings.g);
  $('gasStatus').textContent = gasText[gs];
  $('gasCard').dataset.state = gs;
  const gasPct = gs === 'none' ? 0 : Math.max(0, Math.min(100, readings.g / 4095 * 100));
  $('gasBar').style.width = gasPct + '%';
 
  const box = $('alert');
  const parts = [];
  if (ds === 'danger') parts.push('Obstacle too close');
  if (gs === 'danger') parts.push('High gas level');
  const warns = [];
  if (ds === 'warn') warns.push('Obstacle getting close');
  if (gs === 'warn') warns.push('Gas level rising');
 
  if (parts.length) {
    box.dataset.level = 'danger';
    box.textContent = 'Danger: ' + parts.join(' and ');
    box.hidden = false;
  } else if (warns.length) {
    box.dataset.level = 'warn';
    box.textContent = 'Warning: ' + warns.join(' and ');
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}
refresh();
 
/* ---------- make it installable ---------- */
if ('serviceWorker' in navigator &&
    (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}