# 好室多膜 Housewrapper ｜ 頂級汽車貼膜報價系統

專為汽車貼膜品牌「好室多膜 Housewrapper」量身打造的繁體中文網頁報價單系統。

## 🌟 核心特色

- **極速開單**：輸入車主姓名、電話、車牌與車型，自訂選取 4 大施工類別、22 項精準施工部位、各大品牌與系列，單價隨點隨改。
- **額外折扣折讓**：支援固定金額折讓或百分比折扣（例如 95 折、9 折），即時連動試算。
- **高解析 JPG 圖片匯出（傳 LINE 首選）**：一鍵將完整報價單產出為 2x 視網膜超高畫質 JPG 圖檔，車主手機在 LINE 中點開即看，完全無跑版、切邊或 PDF 歪斜問題。
- **標準 A4 繁體中文 PDF 匯出與列印**：精準單頁滿版排版，含完整門市抬頭、條款與簽章區。
- **歷史單據管理與版本追蹤 (v1, v2)**：支援以車主、電話、車牌快速搜尋調閱歷史單據，保留開單當下的歷史價格快照，支援修訂新版本與一鍵複製開單。
- **後台管理**：自主維護施工部位、膜料品牌、車型資料庫與門市條款資訊。

---

## 🚀 本地快速啟動

```bash
# 1. 下載專案後進入目錄
cd housewrapper-quote

# 2. 安裝相依套件 (Express)
npm install

# 3. 啟動伺服器
npm start
```

伺服器將在 `http://localhost:3000` 啟動。
- **門市登入**：請使用指定門市人員帳號密碼登入。

---

## 🌐 公開上線部署指南 (Deploy to Cloud)

本系統採用 Node.js (Express) 搭配 Node 原生 SQLite 資料庫，可免費部署至各大雲端平台：

### 推薦部署方式：Render (推薦，免費且完全相容)
1. 前往 [Render.com](https://render.com) 註冊/登入。
2. 點擊 **New +** $\rightarrow$ **Web Service**。
3. 連結你的 GitHub 儲存庫（Select Repository）。
4. 設定參數：
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. 點擊 **Create Web Service**，1 分鐘內即可獲得公開的專屬網址（例如 `https://housewrapper-quote.onrender.com`）！

### 台灣常用部署方式：Zeabur
1. 前往 [Zeabur](https://zeabur.com) 連結 GitHub。
2. 匯入此儲存庫，系統會自動辨識 Node.js 並一鍵上線。

---

## 📍 門市資訊
- **門市地址**：台北市內湖區行愛路111號
- **門市電話**：02-2794-0710
- **官方 LINE**：@housewrapper
