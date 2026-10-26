const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'housewrapper.db');
const db = new DatabaseSync(DB_PATH);

// Initialize Tables
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      brand TEXT NOT NULL,
      series TEXT NOT NULL,
      warranty_years INTEGER DEFAULT 5,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS price_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL,
      material_id INTEGER NOT NULL,
      size_class TEXT NOT NULL, -- S, M, L, XL
      price INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (part_id) REFERENCES parts(id),
      FOREIGN KEY (material_id) REFERENCES materials(id),
      UNIQUE(part_id, material_id, size_class)
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      size_class TEXT NOT NULL DEFAULT 'M', -- S, M, L, XL
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_number TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      parent_quote_id INTEGER DEFAULT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      car_plate TEXT NOT NULL,
      car_brand TEXT NOT NULL,
      car_model TEXT NOT NULL,
      car_size TEXT NOT NULL DEFAULT 'M',
      items_json TEXT NOT NULL,
      subtotal INTEGER NOT NULL DEFAULT 0,
      discount_type TEXT DEFAULT 'none', -- 'fixed', 'percentage', 'none'
      discount_value REAL DEFAULT 0,
      discount_amount INTEGER DEFAULT 0,
      discount_note TEXT DEFAULT '',
      total_price INTEGER NOT NULL DEFAULT 0,
      valid_date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'issued', -- draft, issued, accepted, cancelled
      created_by TEXT DEFAULT '店長',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_quotes_number ON quotes(quote_number);
    CREATE INDEX IF NOT EXISTS idx_quotes_phone ON quotes(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_quotes_plate ON quotes(car_plate);
    CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes(created_at);
  `);

  // Seed users and synchronize accounts
  const initialUsers = [
    { username: 'chenden7', password: 'q120591', display_name: 'chenden7', role: 'admin' },
    { username: 'chenden8', password: '00000000', display_name: 'chenden8', role: 'admin' },
    { username: 'in', password: '00000000', display_name: 'in', role: 'admin' },
    { username: 'admin', password: 'housewrapper888', display_name: '好室多膜 門市總管', role: 'admin' }
  ];

  for (const u of initialUsers) {
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(u.username);
    if (!existing) {
      db.prepare(`
        INSERT INTO users (username, password, display_name, role)
        VALUES (?, ?, ?, ?)
      `).run(u.username, u.password, u.display_name, u.role);
    } else {
      db.prepare(`
        UPDATE users SET password = ?, display_name = ?, role = ? WHERE username = ?
      `).run(u.password, u.display_name, u.role, u.username);
    }
  }

  // Seed default settings
  const defaultSettings = [
    { key: 'company_name', value: '好室多膜 Housewrapper 車體工藝' },
    { key: 'company_phone', value: '02-2794-0710' },
    { key: 'company_address', value: '台北市內湖區行愛路111號' },
    { key: 'company_line', value: '@housewrapper' },
    { key: 'company_tax_id', value: '90887766' },
    { key: 'company_hours', value: '週一至週六 10:00 - 19:30（週日採預約制）' },
    { key: 'quote_valid_days', value: '15' },
    { key: 'quote_terms', value: `1. 本報價單自開立日起 15 天內有效，逾期需重新評估報價。\n2. 施工前需先行清潔檢查並確認原車漆狀態（原漆或重新烤漆）。\n3. 膜料均享有原廠保固卡，非人為因素提供翹邊與起泡免費復原。\n4. 施工需預約安排 2~4 個工作天，敬請提前確認交車日程。\n5. 確認施作需預付 30% 訂金，餘款於完工檢驗驗收後付清。` }
  ];

  for (const s of defaultSettings) {
    const existing = db.prepare("SELECT count(*) as count FROM settings WHERE key = ?").get(s.key);
    if (existing.count === 0) {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(s.key, s.value);
    } else if (s.key === 'company_address' || s.key === 'company_phone') {
      db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(s.value, s.key);
    }
  }

  db.exec("PRAGMA foreign_keys = OFF;");

  // Sync exact categories, parts, and brands
  const existingCats = db.prepare("SELECT name FROM categories").all().map(c => c.name);
  if (!existingCats.includes('犀牛皮') || existingCats.length > 4) {
    db.exec("DELETE FROM categories;");
    const categories = [
      { name: '犀牛皮', code: 'ppf', sort: 1 },
      { name: '改色膜', code: 'wrap', sort: 2 },
      { name: '隔熱紙', code: 'tint', sort: 3 },
      { name: '其他', code: 'other', sort: 4 }
    ];
    for (const c of categories) {
      db.prepare("INSERT INTO categories (name, code, sort_order) VALUES (?, ?, ?)").run(c.name, c.code, c.sort);
    }
  }

  // Sync 22 parts specified by user
  const existingParts = db.prepare("SELECT name FROM parts").all().map(p => p.name);
  if (!existingParts.includes('左AC') || !existingParts.includes('尾箱中段')) {
    db.exec("DELETE FROM parts;");
    const catFirst = db.prepare("SELECT id FROM categories ORDER BY id ASC LIMIT 1").get();
    const catId = catFirst ? catFirst.id : 1;
    const partNames = [
      '全車', '前保桿', '引擎蓋', '左前葉', '右前葉', '左前門', '左後門', '左後葉', '左AC',
      '右前門', '右後門', '右後葉', '右AC', '尾箱上', '尾箱中段', '尾箱上（左）', '尾箱上（右）',
      '尾箱下', '後保桿', '左後保桿', '右後保桿', '其他'
    ];
    for (let i = 0; i < partNames.length; i++) {
      db.prepare("INSERT INTO parts (category_id, name, description, sort_order) VALUES (?, ?, ?, ?)").run(catId, partNames[i], '', i + 1);
    }
  }

  // Sync brands specified by user (AX, 3M, STEK, SUNTEK, 其他)
  const existingMats = db.prepare("SELECT brand FROM materials").all().map(m => m.brand);
  if (!existingMats.includes('AX') || !existingMats.includes('SUNTEK')) {
    db.exec("DELETE FROM materials;");
    const catFirst = db.prepare("SELECT id FROM categories ORDER BY id ASC LIMIT 1").get();
    const catId = catFirst ? catFirst.id : 1;
    const brands = ['AX', '3M', 'STEK', 'SUNTEK', '其他'];
    for (let i = 0; i < brands.length; i++) {
      db.prepare("INSERT INTO materials (category_id, brand, series, warranty_years, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)").run(catId, brands[i], '', 5, '', i + 1);
    }
  }

  db.exec("PRAGMA foreign_keys = ON;");

  // Seed vehicles
  const vehCheck = db.prepare("SELECT count(*) as count FROM vehicles").get();
  if (vehCheck.count === 0) {
    const vehicles = [
      { brand: 'Tesla 特斯拉', model: 'Model 3', size: 'S' },
      { brand: 'Tesla 特斯拉', model: 'Model Y', size: 'L' },
      { brand: 'Tesla 特斯拉', model: 'Model S', size: 'M' },
      { brand: 'Tesla 特斯拉', model: 'Model X', size: 'XL' },
      { brand: 'Porsche 保時捷', model: 'Macan', size: 'L' },
      { brand: 'Porsche 保時捷', model: 'Cayenne', size: 'XL' },
      { brand: 'Porsche 保時捷', model: '911 Carrera', size: 'M' },
      { brand: 'Porsche 保時捷', model: '718 Boxster / Cayman', size: 'S' },
      { brand: 'Porsche 保時捷', model: 'Taycan', size: 'M' },
      { brand: 'Mercedes-Benz 賓士', model: 'A-Class / CLA', size: 'S' },
      { brand: 'Mercedes-Benz 賓士', model: 'C-Class Sedan/Estate', size: 'M' },
      { brand: 'Mercedes-Benz 賓士', model: 'E-Class', size: 'M' },
      { brand: 'Mercedes-Benz 賓士', model: 'GLC SUV / Coupe', size: 'L' },
      { brand: 'Mercedes-Benz 賓士', model: 'GLE / GLS', size: 'XL' },
      { brand: 'BMW 寶馬', model: '1 / 2 系列', size: 'S' },
      { brand: 'BMW 寶馬', model: '3 / 4 系列 Sedan/Touring', size: 'M' },
      { brand: 'BMW 寶馬', model: '5 系列', size: 'M' },
      { brand: 'BMW 寶馬', model: 'X3 / X4', size: 'L' },
      { brand: 'BMW 寶馬', model: 'X5 / X6', size: 'L' },
      { brand: 'BMW 寶馬', model: 'X7', size: 'XL' },
      { brand: 'Lexus 凌志', model: 'LBX / UX', size: 'S' },
      { brand: 'Lexus 凌志', model: 'NX 200/350', size: 'L' },
      { brand: 'Lexus 凌志', model: 'RX 350/500h', size: 'XL' },
      { brand: 'Toyota 豐田', model: 'RAV4', size: 'L' },
      { brand: 'Toyota 豐田', model: 'Camry / Crown', size: 'M' },
      { brand: 'Toyota 豐田', model: 'Alphard / LM', size: 'XL' }
    ];

    for (const v of vehicles) {
      db.prepare("INSERT INTO vehicles (brand, model, size_class) VALUES (?, ?, ?)").run(v.brand, v.model, v.size);
    }
  }

  // Seed default pricing rules
  const priceCheck = db.prepare("SELECT count(*) as count FROM price_rules").get();
  if (priceCheck.count === 0) {
    const allParts = db.prepare("SELECT id, name, category_id FROM parts").all();
    const allMaterials = db.prepare("SELECT id, brand, series, category_id FROM materials").all();

    const insertPrice = db.prepare(`
      INSERT OR REPLACE INTO price_rules (part_id, material_id, size_class, price)
      VALUES (?, ?, ?, ?)
    `);

    // Helper to batch set sizes
    function setRates(partKeyword, matKeyword, sPrice, mPrice, lPrice, xlPrice) {
      const p = allParts.find(x => x.name.includes(partKeyword));
      const m = allMaterials.find(x => (x.brand + ' ' + x.series).includes(matKeyword));
      if (p && m) {
        insertPrice.run(p.id, m.id, 'S', sPrice);
        insertPrice.run(p.id, m.id, 'M', mPrice);
        insertPrice.run(p.id, m.id, 'L', lPrice);
        insertPrice.run(p.id, m.id, 'XL', xlPrice);
      }
    }

    // PPF 全車
    setRates('全車包膜', 'XPEL LUX', 120000, 130000, 145000, 160000);
    setRates('全車包膜', 'XPEL STEALTH', 130000, 140000, 155000, 170000);
    setRates('全車包膜', 'STEK DYNOshield', 115000, 125000, 138000, 155000);
    setRates('全車包膜', 'STEK DYNOmatte', 125000, 135000, 148000, 165000);
    setRates('全車包膜', '3M Scotchgard', 105000, 115000, 128000, 142000);

    // PPF 車頭迎風面
    setRates('車頭迎風面', 'XPEL LUX', 38000, 42000, 46000, 52000);
    setRates('車頭迎風面', 'STEK DYNOshield', 36000, 40000, 44000, 50000);
    setRates('車頭迎風面', '3M Scotchgard', 34000, 38000, 42000, 48000);

    // 引擎蓋
    setRates('引擎蓋', 'XPEL LUX', 13000, 15000, 17000, 19000);
    setRates('引擎蓋', 'STEK DYNOshield', 12000, 14000, 16000, 18000);

    // 前保險桿
    setRates('前保險桿', 'XPEL LUX', 15000, 16500, 18000, 20000);
    setRates('前保險桿', 'STEK DYNOshield', 14000, 15500, 17000, 19000);

    // 大燈/尾燈
    setRates('大燈', 'STEK DYNOshield', 4500, 5000, 5500, 6000);
    setRates('大燈', 'XPEL LUX', 5000, 5500, 6000, 6500);

    // 門碗邊緣
    setRates('開門防碰', 'XPEL LUX', 2500, 2500, 2800, 3000);

    // 改色 Wrap 全車
    setRates('全車改色包膜', '3M 2080', 68000, 75000, 85000, 98000);
    setRates('全車改色包膜', 'Avery', 66000, 72000, 82000, 95000);
    setRates('全車改色包膜', 'TeckWrap', 58000, 65000, 75000, 88000);

    // 懸浮雙色車頂
    setRates('懸浮雙色車頂', '3M 2080', 9500, 11000, 13000, 15000);
    setRates('懸浮雙色車頂', 'Avery', 9000, 10500, 12500, 14500);

    // 鍍鉻黑化
    setRates('全車鍍鉻黑化', '3M 2080', 12000, 14000, 16000, 18000);

    // 隔熱紙
    setRates('全車頂級隔熱紙 (含前擋與天窗)', 'LX 鑽石', 38000, 42000, 46000, 52000);
    setRates('全車頂級隔熱紙 (含前擋與天窗)', 'Ti 奈米陶瓷', 26000, 29000, 33000, 37000);
    setRates('全車頂級隔熱紙 (含前擋與天窗)', 'V-KOOL', 35000, 39000, 43000, 49000);

    setRates('全車頂級隔熱紙 (不含天窗)', 'LX 鑽石', 32000, 35000, 39000, 44000);
    setRates('全車頂級隔熱紙 (不含天窗)', 'Ti 奈米陶瓷', 22000, 25000, 28000, 32000);

    setRates('前擋風玻璃隔熱紙', 'LX 鑽石', 14000, 15000, 16000, 18000);
    setRates('前擋風玻璃隔熱紙', 'Ti 奈米陶瓷', 9000, 10000, 11000, 12000);

    // 內裝防護
    setRates('全車室內裝螢幕＋中控鋼琴烤漆飾板', 'XPEL', 11000, 12500, 14000, 16000);
    setRates('中控主螢幕鋼琴保護貼', '鋼化玻璃', 2500, 2500, 2800, 3000);
  }

  // Seed 2 realistic sample quotes to make history page immediately demonstrable
  const quotesCount = db.prepare("SELECT count(*) as count FROM quotes").get();
  if (quotesCount.count === 0) {
    const sampleItems1 = [
      {
        category_name: '漆面保護膜 (PPF 犀牛皮)',
        part_name: '全車包膜 (Full Body PPF)',
        material_name: 'XPEL - LUX PLUS 頂級亮面自體修復 (10年保固)',
        warranty_years: 10,
        unit_price: 145000,
        quantity: 1,
        subtotal: 145000,
        note: '包含全車手工精修收邊、專車專用版型無痕貼合'
      },
      {
        category_name: '車室內裝防護 (Interior PPF)',
        part_name: '中控主螢幕鋼琴保護貼',
        material_name: '好室客製 - 日本抗眩高透光鋼化玻璃保護貼 (2年保固)',
        warranty_years: 2,
        unit_price: 2800,
        quantity: 1,
        subtotal: 2800,
        note: '交車好禮特惠'
      }
    ];

    const sampleItems2 = [
      {
        category_name: '車身改色包膜 (Vinyl Wrap)',
        part_name: '全車改色包膜 (Full Car Wrap)',
        material_name: '3M - 2080 系列雙層鑄造級改色膜 (3年保固)',
        warranty_years: 3,
        unit_price: 75000,
        quantity: 1,
        subtotal: 75000,
        note: '車色選擇：消光星空黑 (Satin Black)'
      },
      {
        category_name: '車身改色包膜 (Vinyl Wrap)',
        part_name: '全車鍍鉻黑化 (Chrome Delete)',
        material_name: '3M - 2080 系列雙層鑄造級改色膜 (3年保固)',
        warranty_years: 3,
        unit_price: 14000,
        quantity: 1,
        subtotal: 14000,
        note: '全車窗框飾條＋後視鏡黑化'
      }
    ];

    // Quote 1: Model Y XPEL
    db.prepare(`
      INSERT INTO quotes (
        quote_number, version, parent_quote_id, customer_name, customer_phone, car_plate,
        car_brand, car_model, car_size, items_json, subtotal, discount_type, discount_value,
        discount_amount, discount_note, total_price, valid_date, notes, status, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 days'))
    `).run(
      'HW-20261022-001', 1, null, '林志偉 先生', '0912-345-678', 'BTQ-8899',
      'Tesla 特斯拉', 'Model Y (珍珠白)', 'L',
      JSON.stringify(sampleItems1),
      147800, 'fixed', 7800, 7800, '交車季特惠折抵', 140000,
      '2026-11-06', '客戶希望交車當週進場，預計施工 3.5 天。贈送門碗防護膜與後廂上下防踏膜。',
      'issued', '店長 Kevin'
    );

    // Quote 2: Model 3 Wrap
    db.prepare(`
      INSERT INTO quotes (
        quote_number, version, parent_quote_id, customer_name, customer_phone, car_plate,
        car_brand, car_model, car_size, items_json, subtotal, discount_type, discount_value,
        discount_amount, discount_note, total_price, valid_date, notes, status, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-1 days'))
    `).run(
      'HW-20261023-002', 1, null, '張美惠 小姐', '0928-888-999', 'RCK-1688',
      'Tesla 特斯拉', 'Model 3 (夜銀)', 'S',
      JSON.stringify(sampleItems2),
      89000, 'percentage', 5, 4450, '老客戶推薦 95 折優惠', 84550,
      '2026-11-07', '確認選色為 2080-M12 啞光黑。施作前將全車精緻深層去鐵粉洗淨。',
      'issued', '店長 Kevin'
    );
  }

  console.log("Database initialized and verified successfully at " + DB_PATH);
}

module.exports = {
  db,
  initDatabase
};
