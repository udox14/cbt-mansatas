export function getDeviceId(): string {
  let id = localStorage.getItem('cbt_device_id');
  if (!id) {
    const nav = navigator;
    const raw = [nav.userAgent, nav.language, screen.width, screen.height,
      screen.colorDepth, new Date().getTimezoneOffset()].join('|');
    id = 'dev_' + hashSimple(raw) + '_' + Date.now().toString(36);
    localStorage.setItem('cbt_device_id', id);
  }
  return id;
}

function hashSimple(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return Math.abs(h).toString(36);
}
