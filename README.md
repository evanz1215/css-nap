# CSSnap

免安裝後端、零第三方執行期依賴的 CSS 檢視瀏覽器擴充功能 — CSS Scan 的開源替代品。以 [WXT](https://wxt.dev/) + TypeScript 建置,Manifest V3。

## 功能

- **Hover 取樣**:按住 `Alt` 移動滑鼠,即時顯示元素外框
- **顯示 CSS**:`Alt + 點擊` 元素,面板顯示 computed style 與實際命中的 CSS 規則(含跨網域樣式表,由 background fetch 解析)
- **鍵盤導覽**:選取後按住 `Alt` + 方向鍵在 DOM 樹移動(↑ 父層、↓ 子層、←→ 兄弟節點),`Esc` 關閉面板
- **一鍵複製**:單一屬性、全部 CSS、HTML、子樹 CSS
- **格式轉換**:CSS → Tailwind class、CSS → styled-components
- **背景圖下載**:擷取 `background-image` 資源並下載
- **頁面右鍵選單**:「複製 CSS」「複製 CSS(含所有子層)」
- **DevTools 側欄**:F12 → Elements 面板右側的 CSSnap 分頁,對選取節點依 selector 分塊顯示命中的 CSS 規則(`element.style` / `.class` / `#id`)與計算後樣式,可一鍵複製(含子層),主題跟隨 DevTools 深/淺色
- **歷史紀錄**:保存最近 20 筆擷取結果(`chrome.storage.local`)
- **多語系**:英文、繁體中文
- **iframe 支援**:跨 frame 元素選取(透過 postMessage 轉發)

## 開發

```bash
npm install
npm run dev      # 開發模式(自動載入擴充功能到瀏覽器)
npm run build    # 產出到 .output/
npm run zip      # 打包成可上架的 zip
```

測試:

```bash
node entrypoints/content/convert.test.mjs
```

## 專案結構

```
cssnap/
├── entrypoints/
│   ├── background.ts        # 圖示點擊、右鍵選單、跨網域 CSS fetch、圖片下載
│   ├── devtools/            # 註冊 Elements 面板側欄
│   ├── cssnap-pane/         # DevTools 側欄本體(對 $0 擷取 CSS)
│   └── content/
│       ├── index.ts         # 核心:hover 監聽、樣式擷取、面板 UI
│       ├── convert.js       # 純函式:Tailwind / styled-components 轉換、selector 產生
│       ├── convert.test.mjs # convert.js 的測試
│       └── style.css        # 面板樣式(Shadow DOM 隔離)
├── public/
│   ├── icon/                # 擴充功能圖示
│   └── _locales/            # en / zh_TW 翻譯
├── plans/ANALYSIS.md        # 功能與技術分析
└── wxt.config.ts            # manifest 設定
```

## 已知限制

- `getComputedStyle` 回傳的是計算後的值(簡寫屬性會被展開),與 CSS Scan 行為一致
- Tailwind 轉換僅涵蓋常見屬性,為近似對照而非完整還原
- 跨網域樣式表中的 `@import` 巢狀匯入尚未展開處理
- DevTools 側欄的規則收集跑在頁面 context,讀不到跨網域樣式表(會跳過);要看完整規則用 Alt+點擊的主面板
- 頁面右鍵選單在 `chrome://` 頁面與安裝前就開著的分頁上無效(重新整理即可)
