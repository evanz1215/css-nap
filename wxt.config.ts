import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'CSSnap',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['clipboardWrite', 'storage', 'downloads', 'contextMenus'],
    // background fetch 跨網域 CSS 需要 host 權限（同原版 CSS Scan 的做法）
    host_permissions: ['<all_urls>'],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: { default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' } },
  },
});
