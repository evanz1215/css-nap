declare const chrome: any;

// Elements 面板右側加一個 CSSnap 側欄,本體是 cssnap-pane.html
chrome.devtools.panels.elements.createSidebarPane('CSSnap', (pane: any) => {
  pane.setPage('cssnap-pane.html');
});
