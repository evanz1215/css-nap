export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({ id: 'copy-css', title: browser.i18n.getMessage('contextCopyCss'), contexts: ['all'] });
    browser.contextMenus.create({ id: 'copy-css-subtree', title: browser.i18n.getMessage('contextCopyCssSubtree'), contexts: ['all'] });
  });

  // 右鍵選單 → 轉發給「被右鍵的那個 frame」的 content script 處理複製
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id || (info.menuItemId !== 'copy-css' && info.menuItemId !== 'copy-css-subtree')) return;
    browser.tabs
      .sendMessage(tab.id, { type: 'copy-css', subtree: info.menuItemId === 'copy-css-subtree' }, { frameId: info.frameId ?? 0 })
      .catch(() => {
        // 該 frame 沒有 content script（chrome:// 或安裝前就開著的頁面）— 忽略
      });
  });

  // 點工具列圖示 → 請當前分頁的 content script 顯示操作說明
  browser.action.onClicked.addListener((tab) => {
    if (tab.id) browser.tabs.sendMessage(tab.id, { type: 'show-help' }).catch(() => {
      // 分頁沒有 content script（chrome:// 或安裝前就開著的頁面）— 忽略
    });
  });

  browser.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
    if (message?.type === 'download-image' && typeof message.url === 'string') {
      browser.downloads.download({ url: message.url });
    }
    // content script 受 CORS 限制讀不到跨網域樣式表，改由 service worker 抓純文字回去解析
    if (message?.type === 'fetch-css' && typeof message.url === 'string') {
      fetch(message.url)
        .then((r) => (r.ok ? r.text() : ''))
        .then(sendResponse, () => sendResponse(''));
      return true; // 非同步 sendResponse
    }
  });
});
