const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, initDatabase, generateRecordNo } = require('./db');
const { generateWarrantyPDF } = require('./pdf-service');

// Ensure database is initialized
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Simple in-memory token session storage (suitable for single-server deployment)
const activeSessions = new Map();

// Helper to authenticate requests
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : req.query.token;

  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({ success: false, message: '尚未登入或登入已過期，請重新登入' });
  }

  req.user = activeSessions.get(token);
  next();
}

// --------------------------------------------------------------------------
// Auth APIs
// --------------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '請輸入帳號與密碼' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, message: '帳號或密碼不正確' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const sessionUser = {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role
  };
  activeSessions.set(token, sessionUser);

  res.json({
    success: true,
    token,
    user: sessionUser
  });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  if (token) {
    activeSessions.delete(token);
  }
  res.json({ success: true, message: '已成功登出' });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const s of settingsRows) {
    settings[s.key] = s.value;
  }

  res.json({
    success: true,
    user: req.user,
    settings
  });
});

app.post('/api/auth/change-password', authenticate, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ success: false, message: '新密碼長度至少需 4 碼' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || user.password !== oldPassword) {
    return res.status(400).json({ success: false, message: '舊密碼驗證失敗' });
  }

  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newPassword, req.user.id);
  res.json({ success: true, message: '密碼已成功更新' });
});

// --------------------------------------------------------------------------
// Catalog & Pricing APIs
// --------------------------------------------------------------------------
app.get('/api/catalog', authenticate, (req, res) => {
  const categories = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, id ASC').all();
  const parts = db.prepare('SELECT * FROM parts WHERE is_active = 1 ORDER BY sort_order ASC, id ASC').all();
  const materials = db.prepare('SELECT * FROM materials WHERE is_active = 1 ORDER BY sort_order ASC, id ASC').all();
  const priceRules = db.prepare('SELECT * FROM price_rules').all();
  const vehicles = db.prepare('SELECT * FROM vehicles WHERE is_active = 1 ORDER BY sort_order ASC, brand ASC, model ASC').all();

  // Settings
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const s of settingsRows) {
    settings[s.key] = s.value;
  }

  res.json({
    success: true,
    data: {
      categories,
      parts,
      materials,
      priceRules,
      vehicles,
      settings
    }
  });
});

// Settings APIs
app.get('/api/settings', authenticate, (req, res) => {
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const s of settingsRows) {
    settings[s.key] = s.value;
  }
  res.json({ success: true, data: settings });
});

app.put('/api/settings', authenticate, (req, res) => {
  const updates = req.body;
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(updates)) {
    upsert.run(key, String(value));
  }
  res.json({ success: true, message: '門市資訊與設定已儲存' });
});

// Parts CRUD
app.post('/api/catalog/parts', authenticate, (req, res) => {
  const { category_id, name, description, sort_order } = req.body;
  if (!category_id || !name) {
    return res.status(400).json({ success: false, message: '類別與部位名稱為必填' });
  }
  const result = db.prepare(`
    INSERT INTO parts (category_id, name, description, sort_order, is_active)
    VALUES (?, ?, ?, ?, 1)
  `).run(category_id, name.trim(), description || '', sort_order || 0);

  res.json({ success: true, id: result.lastInsertRowid, message: '施工部位已新增' });
});

app.put('/api/catalog/parts/:id', authenticate, (req, res) => {
  const id = req.params.id;
  const { category_id, name, description, sort_order, is_active } = req.body;
  db.prepare(`
    UPDATE parts
    SET category_id = COALESCE(?, category_id),
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        sort_order = COALESCE(?, sort_order),
        is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(category_id, name, description, sort_order, is_active, id);

  res.json({ success: true, message: '施工部位已更新' });
});

app.delete('/api/catalog/parts/:id', authenticate, (req, res) => {
  const id = req.params.id;
  db.prepare('UPDATE parts SET is_active = 0 WHERE id = ?').run(id);
  res.json({ success: true, message: '施工部位已停用' });
});

// Materials CRUD
app.post('/api/catalog/materials', authenticate, (req, res) => {
  const { category_id, brand, series, warranty_years, description, sort_order } = req.body;
  if (!category_id || !brand || !series) {
    return res.status(400).json({ success: false, message: '類別、品牌與系列名稱為必填' });
  }
  const result = db.prepare(`
    INSERT INTO materials (category_id, brand, series, warranty_years, description, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(category_id, brand.trim(), series.trim(), warranty_years || 5, description || '', sort_order || 0);

  res.json({ success: true, id: result.lastInsertRowid, message: '膜料品牌已新增' });
});

app.put('/api/catalog/materials/:id', authenticate, (req, res) => {
  const id = req.params.id;
  const { category_id, brand, series, warranty_years, description, sort_order, is_active } = req.body;
  db.prepare(`
    UPDATE materials
    SET category_id = COALESCE(?, category_id),
        brand = COALESCE(?, brand),
        series = COALESCE(?, series),
        warranty_years = COALESCE(?, warranty_years),
        description = COALESCE(?, description),
        sort_order = COALESCE(?, sort_order),
        is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(category_id, brand, series, warranty_years, description, sort_order, is_active, id);

  res.json({ success: true, message: '膜料品牌已更新' });
});

app.delete('/api/catalog/materials/:id', authenticate, (req, res) => {
  const id = req.params.id;
  db.prepare('UPDATE materials SET is_active = 0 WHERE id = ?').run(id);
  res.json({ success: true, message: '膜料品牌已停用' });
});

// Vehicles CRUD
app.post('/api/catalog/vehicles', authenticate, (req, res) => {
  const { brand, model, size_class } = req.body;
  if (!brand || !model) {
    return res.status(400).json({ success: false, message: '汽車品牌與車型為必填' });
  }
  const result = db.prepare(`
    INSERT INTO vehicles (brand, model, size_class, is_active)
    VALUES (?, ?, ?, 1)
  `).run(brand.trim(), model.trim(), size_class || 'M');

  res.json({ success: true, id: result.lastInsertRowid, message: '車型已新增' });
});

app.put('/api/catalog/vehicles/:id', authenticate, (req, res) => {
  const id = req.params.id;
  const { brand, model, size_class, is_active } = req.body;
  db.prepare(`
    UPDATE vehicles
    SET brand = COALESCE(?, brand),
        model = COALESCE(?, model),
        size_class = COALESCE(?, size_class),
        is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(brand, model, size_class, is_active, id);

  res.json({ success: true, message: '車型已更新' });
});

app.delete('/api/catalog/vehicles/:id', authenticate, (req, res) => {
  const id = req.params.id;
  db.prepare('UPDATE vehicles SET is_active = 0 WHERE id = ?').run(id);
  res.json({ success: true, message: '車型已刪除' });
});

// Batch update Price Rules
app.post('/api/catalog/prices', authenticate, (req, res) => {
  const { rules } = req.body; // array of { part_id, material_id, size_class, price }
  if (!Array.isArray(rules)) {
    return res.status(400).json({ success: false, message: '價格規則格式錯誤' });
  }

  const upsert = db.prepare(`
    INSERT INTO price_rules (part_id, material_id, size_class, price)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(part_id, material_id, size_class)
    DO UPDATE SET price = excluded.price
  `);

  for (const r of rules) {
    upsert.run(Number(r.part_id), Number(r.material_id), r.size_class, Math.round(Number(r.price) || 0));
  }

  res.json({ success: true, message: `已成功儲存 ${rules.length} 筆價格規則` });
});

// --------------------------------------------------------------------------
// Quotes APIs
// --------------------------------------------------------------------------

// Helper to generate unique quote number: HW-YYYYMMDD-XXX
function generateQuoteNumber(customDate) {
  let now = new Date();
  if (customDate) {
    const parsed = new Date(customDate.length === 10 ? customDate + 'T12:00:00' : customDate);
    if (!isNaN(parsed.getTime())) {
      now = parsed;
    }
  }
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePrefix = `HW-${yyyy}${mm}${dd}`;

  // Find max sequence today
  const existing = db.prepare(`
    SELECT quote_number FROM quotes
    WHERE quote_number LIKE ?
    ORDER BY id DESC LIMIT 1
  `).get(`${datePrefix}%`);

  let seq = 1;
  if (existing && existing.quote_number) {
    const parts = existing.quote_number.split('-');
    if (parts.length >= 3) {
      const lastSeq = parseInt(parts[2], 10);
      if (!isNaN(lastSeq)) {
        seq = lastSeq + 1;
      }
    }
  }

  return `${datePrefix}-${String(seq).padStart(3, '0')}`;
}

// List quotes with search and filters
app.get('/api/quotes', authenticate, (req, res) => {
  const { search, startDate, endDate, status } = req.query;

  let query = 'SELECT * FROM quotes WHERE 1=1';
  const params = [];

  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    query += ` AND (quote_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? OR car_plate LIKE ? OR car_model LIKE ?)`;
    params.push(s, s, s, s, s);
  }

  if (startDate) {
    query += ` AND date(created_at) >= date(?)`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND date(created_at) <= date(?)`;
    params.push(endDate);
  }

  if (status && status !== 'all') {
    query += ` AND status = ?`;
    params.push(status);
  }

  query += ' ORDER BY created_at DESC, id DESC';

  const rows = db.prepare(query).all(...params);
  const quotes = rows.map(r => {
    let items = [];
    try {
      items = JSON.parse(r.items_json);
    } catch (e) {
      items = [];
    }
    return {
      ...r,
      items
    };
  });

  res.json({ success: true, data: quotes });
});

// Get single quote by ID + version history
app.get('/api/quotes/:id', authenticate, (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!quote) {
    return res.status(404).json({ success: false, message: '找不到此報價單' });
  }

  let items = [];
  try {
    items = JSON.parse(quote.items_json);
  } catch (e) {
    items = [];
  }

  // Find related versions
  const baseNumber = quote.quote_number.replace(/-v\d+$/, '');
  const versions = db.prepare(`
    SELECT id, quote_number, version, total_price, status, created_at
    FROM quotes
    WHERE quote_number = ? OR quote_number LIKE ?
    ORDER BY version ASC, id ASC
  `).all(baseNumber, `${baseNumber}-v%`);

  res.json({
    success: true,
    data: {
      ...quote,
      items,
      versions
    }
  });
});

// Create new quotation
app.post('/api/quotes', authenticate, (req, res) => {
  const {
    customer_name,
    customer_phone,
    car_plate,
    car_brand,
    car_model,
    car_size,
    items,
    subtotal,
    discount_type,
    discount_value,
    discount_amount,
    discount_note,
    total_price,
    created_at,
    valid_date,
    notes,
    status
  } = req.body;

  if (!customer_name || !customer_phone || !car_plate) {
    return res.status(400).json({ success: false, message: '客戶姓名、電話與車牌為必填' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: '報價單必須包含至少一項施工項目' });
  }

  const quote_number = generateQuoteNumber(created_at);
  const issueDateStr = created_at ? (created_at.slice(0, 10) + ' ' + new Date().toTimeString().slice(0, 8)) : new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO quotes (
      quote_number, version, parent_quote_id, customer_name, customer_phone, car_plate,
      car_brand, car_model, car_size, items_json, subtotal, discount_type, discount_value,
      discount_amount, discount_note, total_price, valid_date, notes, status, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    quote_number,
    1,
    null,
    customer_name.trim(),
    customer_phone.trim(),
    car_plate.trim().toUpperCase(),
    car_brand || '',
    car_model || '',
    car_size || 'M',
    JSON.stringify(items),
    Number(subtotal) || 0,
    discount_type || 'none',
    Number(discount_value) || 0,
    Number(discount_amount) || 0,
    discount_note || '',
    Number(total_price) || 0,
    valid_date || new Date().toISOString().slice(0, 10),
    notes || '',
    status || 'issued',
    req.user.displayName || '好室多膜',
    issueDateStr
  );

  const newQuote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(result.lastInsertRowid);
  newQuote.items = items;

  res.json({
    success: true,
    data: newQuote,
    message: `報價單 ${quote_number} 已成功開立並保存！`
  });
});

// Revise and create new version (Preserve original history!)
app.post('/api/quotes/:id/version', authenticate, (req, res) => {
  const original = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!original) {
    return res.status(404).json({ success: false, message: '找不到原始報價單' });
  }

  const {
    customer_name,
    customer_phone,
    car_plate,
    car_brand,
    car_model,
    car_size,
    items,
    subtotal,
    discount_type,
    discount_value,
    discount_amount,
    discount_note,
    total_price,
    created_at,
    valid_date,
    notes,
    status
  } = req.body;

  // Determine root quote number and next version number
  const baseNumber = original.quote_number.replace(/-v\d+$/, '');
  const existingVersions = db.prepare(`
    SELECT max(version) as max_version FROM quotes
    WHERE quote_number = ? OR quote_number LIKE ?
  `).get(baseNumber, `${baseNumber}-v%`);

  const nextVersion = (existingVersions?.max_version || original.version || 1) + 1;
  const newQuoteNumber = `${baseNumber}-v${nextVersion}`;
  const issueDateStr = created_at ? (created_at.slice(0, 10) + ' ' + new Date().toTimeString().slice(0, 8)) : (original.created_at || new Date().toISOString());

  const insert = db.prepare(`
    INSERT INTO quotes (
      quote_number, version, parent_quote_id, customer_name, customer_phone, car_plate,
      car_brand, car_model, car_size, items_json, subtotal, discount_type, discount_value,
      discount_amount, discount_note, total_price, valid_date, notes, status, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    newQuoteNumber,
    nextVersion,
    original.id,
    customer_name ? customer_name.trim() : original.customer_name,
    customer_phone ? customer_phone.trim() : original.customer_phone,
    car_plate ? car_plate.trim().toUpperCase() : original.car_plate,
    car_brand !== undefined ? car_brand : original.car_brand,
    car_model !== undefined ? car_model : original.car_model,
    car_size || original.car_size,
    JSON.stringify(items || JSON.parse(original.items_json)),
    subtotal !== undefined ? Number(subtotal) : original.subtotal,
    discount_type || original.discount_type,
    discount_value !== undefined ? Number(discount_value) : original.discount_value,
    discount_amount !== undefined ? Number(discount_amount) : original.discount_amount,
    discount_note !== undefined ? discount_note : original.discount_note,
    total_price !== undefined ? Number(total_price) : original.total_price,
    valid_date || original.valid_date,
    notes !== undefined ? notes : original.notes,
    status || 'issued',
    req.user.displayName || '好室多膜',
    issueDateStr
  );

  const newQuote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(result.lastInsertRowid);
  newQuote.items = items;

  res.json({
    success: true,
    data: newQuote,
    message: `已建立新修訂版本：${newQuoteNumber}（原始紀錄 v${original.version} 完整保留）`
  });
});

// Update Quote Status
app.patch('/api/quotes/:id/status', authenticate, (req, res) => {
  const { status } = req.body;
  if (!['draft', 'issued', 'accepted', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ success: false, message: '無效的狀態值' });
  }

  db.prepare('UPDATE quotes SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, req.params.id);
  res.json({ success: true, message: '狀態已更新' });
});

// --------------------------------------------------------------------------
// Backup & Export APIs
// --------------------------------------------------------------------------
app.get('/api/backup/export', authenticate, (req, res) => {
  const users = db.prepare('SELECT id, username, display_name, role, created_at FROM users').all();
  const settings = db.prepare('SELECT * FROM settings').all();
  const categories = db.prepare('SELECT * FROM categories').all();
  const parts = db.prepare('SELECT * FROM parts').all();
  const materials = db.prepare('SELECT * FROM materials').all();
  const priceRules = db.prepare('SELECT * FROM price_rules').all();
  const vehicles = db.prepare('SELECT * FROM vehicles').all();
  const quotes = db.prepare('SELECT * FROM quotes').all();
  const warrantyRecords = db.prepare('SELECT * FROM warranty_records').all();
  const recordLogs = db.prepare('SELECT * FROM record_logs').all();
  const presetOptions = db.prepare('SELECT * FROM preset_options').all();

  const backupData = {
    version: '1.0.0',
    exported_at: new Date().toISOString(),
    store: 'Housewrapper 好室多膜',
    data: {
      settings,
      categories,
      parts,
      materials,
      priceRules,
      vehicles,
      quotes,
      warrantyRecords,
      recordLogs,
      presetOptions
    }
  };

  const filename = `housewrapper_backup_${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(backupData, null, 2));
});

// Export CSV for Excel
app.get('/api/backup/quotes-csv', authenticate, (req, res) => {
  const quotes = db.prepare('SELECT * FROM quotes ORDER BY created_at DESC').all();

  // UTF-8 BOM for Excel Chinese display
  let csv = '\uFEFF報價單號,版本,開單日期,客戶姓名,聯絡電話,車牌號碼,汽車廠牌,車型,尺寸級距,施工項目數,施工小計,折扣折讓,最終總金額,有效期限,狀態,開單人員\n';

  for (const q of quotes) {
    let itemCount = 0;
    try {
      itemCount = JSON.parse(q.items_json).length;
    } catch (e) {}

    const statusMap = {
      issued: '已開立',
      accepted: '已成交',
      draft: '草稿',
      completed: '已完工',
      cancelled: '已作廢'
    };

    const row = [
      `"${q.quote_number}"`,
      `"v${q.version}"`,
      `"${q.created_at.slice(0, 10)}"`,
      `"${(q.customer_name || '').replace(/"/g, '""')}"`,
      `"${q.customer_phone}"`,
      `"${q.car_plate}"`,
      `"${(q.car_brand || '').replace(/"/g, '""')}"`,
      `"${(q.car_model || '').replace(/"/g, '""')}"`,
      `"${q.car_size}"`,
      itemCount,
      q.subtotal,
      q.discount_amount,
      q.total_price,
      `"${q.valid_date}"`,
      `"${statusMap[q.status] || q.status}"`,
      `"${q.created_by}"`
    ];
    csv += row.join(',') + '\n';
  }

  const filename = `housewrapper_quotes_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// Import / Restore Database
app.post('/api/backup/import', authenticate, (req, res) => {
  const { data } = req.body;
  if (!data || !data.quotes) {
    return res.status(400).json({ success: false, message: '匯入檔案格式錯誤' });
  }

  try {
    if (Array.isArray(data.settings)) {
      const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      for (const s of data.settings) upsert.run(s.key, s.value);
    }
    if (Array.isArray(data.parts)) {
      for (const p of data.parts) {
        db.prepare(`
          INSERT INTO parts (id, category_id, name, description, sort_order, is_active)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            category_id = excluded.category_id,
            name = excluded.name,
            description = excluded.description,
            sort_order = excluded.sort_order,
            is_active = excluded.is_active
        `).run(p.id, p.category_id, p.name, p.description || '', p.sort_order || 0, p.is_active ?? 1);
      }
    }
    if (Array.isArray(data.materials)) {
      for (const m of data.materials) {
        db.prepare(`
          INSERT INTO materials (id, category_id, brand, series, warranty_years, description, sort_order, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            category_id = excluded.category_id,
            brand = excluded.brand,
            series = excluded.series,
            warranty_years = excluded.warranty_years,
            description = excluded.description,
            sort_order = excluded.sort_order,
            is_active = excluded.is_active
        `).run(m.id, m.category_id, m.brand, m.series, m.warranty_years || 5, m.description || '', m.sort_order || 0, m.is_active ?? 1);
      }
    }
    if (Array.isArray(data.priceRules)) {
      for (const r of data.priceRules) {
        db.prepare(`
          INSERT INTO price_rules (part_id, material_id, size_class, price)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(part_id, material_id, size_class) DO UPDATE SET price = excluded.price
        `).run(r.part_id, r.material_id, r.size_class, r.price);
      }
    }
    if (Array.isArray(data.vehicles)) {
      for (const v of data.vehicles) {
        db.prepare(`
          INSERT INTO vehicles (id, brand, model, size_class, sort_order, is_active)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            brand = excluded.brand,
            model = excluded.model,
            size_class = excluded.size_class,
            sort_order = excluded.sort_order,
            is_active = excluded.is_active
        `).run(v.id, v.brand, v.model, v.size_class, v.sort_order || 0, v.is_active ?? 1);
      }
    }
    if (Array.isArray(data.quotes)) {
      for (const q of data.quotes) {
        db.prepare(`
          INSERT INTO quotes (
            id, quote_number, version, parent_quote_id, customer_name, customer_phone,
            car_plate, car_brand, car_model, car_size, items_json, subtotal, discount_type,
            discount_value, discount_amount, discount_note, total_price, valid_date,
            notes, status, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            quote_number = excluded.quote_number,
            version = excluded.version,
            customer_name = excluded.customer_name,
            customer_phone = excluded.customer_phone,
            car_plate = excluded.car_plate,
            car_brand = excluded.car_brand,
            car_model = excluded.car_model,
            car_size = excluded.car_size,
            items_json = excluded.items_json,
            subtotal = excluded.subtotal,
            discount_type = excluded.discount_type,
            discount_value = excluded.discount_value,
            discount_amount = excluded.discount_amount,
            discount_note = excluded.discount_note,
            total_price = excluded.total_price,
            valid_date = excluded.valid_date,
            notes = excluded.notes,
            status = excluded.status
        `).run(
          q.id, q.quote_number, q.version || 1, q.parent_quote_id, q.customer_name, q.customer_phone,
          q.car_plate, q.car_brand, q.car_model, q.car_size, q.items_json, q.subtotal,
          q.discount_type, q.discount_value, q.discount_amount, q.discount_note, q.total_price,
          q.valid_date, q.notes, q.status, q.created_by, q.created_at, q.updated_at
        );
      }
    }
    if (Array.isArray(data.warrantyRecords)) {
      for (const w of data.warrantyRecords) {
        db.prepare(`
          INSERT INTO warranty_records (
            id, record_no, quote_id, customer_name, customer_phone, car_model, completion_date,
            license_plate, original_color, service_brand, service_model, notes,
            template_version, created_by, created_at, updated_by, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            record_no = excluded.record_no,
            quote_id = excluded.quote_id,
            customer_name = excluded.customer_name,
            customer_phone = excluded.customer_phone,
            car_model = excluded.car_model,
            completion_date = excluded.completion_date,
            license_plate = excluded.license_plate,
            original_color = excluded.original_color,
            service_brand = excluded.service_brand,
            service_model = excluded.service_model,
            notes = excluded.notes,
            template_version = excluded.template_version,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
        `).run(
          w.id, w.record_no, w.quote_id || null, w.customer_name, w.customer_phone, w.car_model,
          w.completion_date, w.license_plate, w.original_color, w.service_brand, w.service_model,
          w.notes || '', w.template_version || 'v1.0', w.created_by, w.created_at, w.updated_by, w.updated_at
        );
      }
    }

    res.json({ success: true, message: '資料庫還原成功！' });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ success: false, message: '還原失敗：' + err.message });
  }
});

// --------------------------------------------------------------------------
// Warranty Presets APIs
// --------------------------------------------------------------------------
app.get('/api/warranty/presets', authenticate, (req, res) => {
  const brands = db.prepare("SELECT * FROM preset_options WHERE type = 'brand' ORDER BY sort_order ASC, id ASC").all();
  const models = db.prepare("SELECT * FROM preset_options WHERE type = 'model' ORDER BY sort_order ASC, id ASC").all();
  res.json({ success: true, brands, models });
});

app.post('/api/warranty/presets', authenticate, (req, res) => {
  const { type, name } = req.body;
  if (!type || !name || !['brand', 'model'].includes(type)) {
    return res.status(400).json({ success: false, message: '類型與名稱為必填項目' });
  }

  const maxOrderRow = db.prepare('SELECT MAX(sort_order) as max_order FROM preset_options WHERE type = ?').get(type);
  const nextOrder = (maxOrderRow.max_order || 0) + 1;

  const insert = db.prepare('INSERT INTO preset_options (type, name, sort_order) VALUES (?, ?, ?)');
  const result = insert.run(type, name.trim(), nextOrder);

  res.json({ success: true, id: result.lastInsertRowid, type, name: name.trim() });
});

app.delete('/api/warranty/presets/:id', authenticate, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM preset_options WHERE id = ?').run(id);
  res.json({ success: true, message: '已成功刪除選項' });
});

// --------------------------------------------------------------------------
// Warranty Records APIs
// --------------------------------------------------------------------------
app.get('/api/warranty/records', authenticate, (req, res) => {
  const { q } = req.query;
  let sql = 'SELECT * FROM warranty_records';
  const params = [];

  if (q && q.trim()) {
    const searchTerm = `%${q.trim()}%`;
    sql += ` WHERE (license_plate LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? OR car_model LIKE ?)`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm);
  }

  sql += ' ORDER BY id DESC';

  const records = db.prepare(sql).all(...params);
  res.json({ success: true, count: records.length, records });
});

app.get('/api/warranty/records/:id', authenticate, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const record = db.prepare('SELECT * FROM warranty_records WHERE id = ?').get(id);

  if (!record) {
    return res.status(404).json({ success: false, message: '找不到此保固卡紀錄' });
  }

  const logs = db.prepare('SELECT * FROM record_logs WHERE record_id = ? ORDER BY id DESC').all(id);
  res.json({ success: true, record, logs });
});

app.post('/api/warranty/records', authenticate, (req, res) => {
  const {
    quote_id,
    customer_name,
    customer_phone,
    car_model,
    completion_date,
    license_plate,
    original_color,
    service_brand,
    service_model,
    notes
  } = req.body;

  if (!customer_name || !license_plate) {
    return res.status(400).json({ success: false, message: '車主姓名與車牌為必填欄位' });
  }

  const record_no = generateRecordNo();
  const now = new Date().toISOString();
  const formattedPlate = (license_plate || '').toUpperCase().trim();
  const operator = req.user.displayName || req.user.username;

  const insert = db.prepare(`
    INSERT INTO warranty_records (
      record_no, quote_id, customer_name, customer_phone, car_model, completion_date,
      license_plate, original_color, service_brand, service_model, notes,
      template_version, created_by, created_at, updated_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    record_no,
    quote_id || null,
    customer_name.trim(),
    (customer_phone || '').trim(),
    (car_model || '').trim(),
    (completion_date || '').trim(),
    formattedPlate,
    (original_color || '').trim(),
    (service_brand || '').trim(),
    (service_model || '').trim(),
    (notes || '').trim(),
    'v1.0',
    operator,
    now,
    operator,
    now
  );

  const newRecordId = result.lastInsertRowid;

  // Record audit log
  db.prepare(`
    INSERT INTO record_logs (record_id, action, changed_by, changed_at, changes_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(newRecordId, 'CREATE', operator, now, JSON.stringify({ summary: '建立保固卡' }));

  const createdRecord = db.prepare('SELECT * FROM warranty_records WHERE id = ?').get(newRecordId);

  res.json({ success: true, message: '保固卡已成功建立並儲存', record: createdRecord });
});

app.put('/api/warranty/records/:id', authenticate, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const oldRecord = db.prepare('SELECT * FROM warranty_records WHERE id = ?').get(id);

  if (!oldRecord) {
    return res.status(404).json({ success: false, message: '找不到此保固卡紀錄' });
  }

  const {
    customer_name,
    customer_phone,
    car_model,
    completion_date,
    license_plate,
    original_color,
    service_brand,
    service_model,
    notes
  } = req.body;

  const formattedPlate = (license_plate || '').toUpperCase().trim();
  const now = new Date().toISOString();
  const operator = req.user.displayName || req.user.username;

  // Track differences for audit log
  const changes = {};
  const fields = [
    ['customer_name', customer_name?.trim()],
    ['customer_phone', customer_phone?.trim()],
    ['car_model', car_model?.trim()],
    ['completion_date', completion_date?.trim()],
    ['license_plate', formattedPlate],
    ['original_color', original_color?.trim()],
    ['service_brand', service_brand?.trim()],
    ['service_model', service_model?.trim()],
    ['notes', notes?.trim()]
  ];

  fields.forEach(([field, newVal]) => {
    if (newVal !== undefined && newVal !== oldRecord[field]) {
      changes[field] = { from: oldRecord[field], to: newVal };
    }
  });

  const update = db.prepare(`
    UPDATE warranty_records SET
      customer_name = ?,
      customer_phone = ?,
      car_model = ?,
      completion_date = ?,
      license_plate = ?,
      original_color = ?,
      service_brand = ?,
      service_model = ?,
      notes = ?,
      updated_by = ?,
      updated_at = ?
    WHERE id = ?
  `);

  update.run(
    customer_name?.trim() ?? oldRecord.customer_name,
    customer_phone?.trim() ?? oldRecord.customer_phone,
    car_model?.trim() ?? oldRecord.car_model,
    completion_date?.trim() ?? oldRecord.completion_date,
    formattedPlate || oldRecord.license_plate,
    original_color?.trim() ?? oldRecord.original_color,
    service_brand?.trim() ?? oldRecord.service_brand,
    service_model?.trim() ?? oldRecord.service_model,
    notes?.trim() ?? oldRecord.notes,
    operator,
    now,
    id
  );

  if (Object.keys(changes).length > 0) {
    db.prepare(`
      INSERT INTO record_logs (record_id, action, changed_by, changed_at, changes_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, 'UPDATE', operator, now, JSON.stringify(changes));
  }

  const updatedRecord = db.prepare('SELECT * FROM warranty_records WHERE id = ?').get(id);
  res.json({ success: true, message: '保固卡資料已成功更新', record: updatedRecord, changes });
});

app.delete('/api/warranty/records/:id', authenticate, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const record = db.prepare('SELECT * FROM warranty_records WHERE id = ?').get(id);
  if (!record) {
    return res.status(404).json({ success: false, message: '找不到此保固卡紀錄' });
  }

  db.prepare('DELETE FROM warranty_records WHERE id = ?').run(id);
  res.json({ success: true, message: '已成功刪除該保固卡紀錄' });
});

// --------------------------------------------------------------------------
// Warranty PDF APIs
// --------------------------------------------------------------------------
app.post('/api/warranty/pdf/preview', authenticate, async (req, res) => {
  try {
    const pdfBuffer = await generateWarrantyPDF(req.body);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ success: false, message: 'PDF 產生失敗: ' + err.message });
  }
});

app.get('/api/warranty/pdf/record/:id', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const record = db.prepare('SELECT * FROM warranty_records WHERE id = ?').get(id);
    if (!record) {
      return res.status(404).json({ success: false, message: '找不到此保固卡紀錄' });
    }

    const operator = req.user.displayName || req.user.username;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO record_logs (record_id, action, changed_by, changed_at, changes_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, 'REPRINT', operator, now, JSON.stringify({ info: '員工列印/查看保固卡' }));

    const pdfBuffer = await generateWarrantyPDF(record);
    const filename = `保固卡_${record.customer_name}_${record.license_plate}_${(record.completion_date || '').replace(/\//g, '-')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF error:', err);
    res.status(500).json({ success: false, message: 'PDF 讀取失敗: ' + err.message });
  }
});

app.get('/api/warranty/pdf/download/:id', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const record = db.prepare('SELECT * FROM warranty_records WHERE id = ?').get(id);
    if (!record) {
      return res.status(404).json({ success: false, message: '找不到此保固卡紀錄' });
    }

    const pdfBuffer = await generateWarrantyPDF(record);
    const filename = `保固卡_${record.customer_name}_${record.license_plate}_${(record.completion_date || '').replace(/\//g, '-')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ success: false, message: '下載失敗: ' + err.message });
  }
});

app.post('/api/warranty/pdf/download-form', authenticate, async (req, res) => {
  try {
    const pdfBuffer = await generateWarrantyPDF(req.body);
    const name = req.body.customer_name || '車主';
    const plate = (req.body.license_plate || '車牌').toUpperCase();
    const date = (req.body.completion_date || '').replace(/\//g, '-');
    const filename = `保固卡_${name}_${plate}_${date}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Form download error:', err);
    res.status(500).json({ success: false, message: '下載失敗: ' + err.message });
  }
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for SPA routing
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API 路由不存在' });
  }
  res.sendFile(path.resolve(__dirname, 'public', 'index.html'), (err) => {
    if (err && !res.headersSent) {
      res.status(err.status || 500).end();
    }
  });
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Housewrapper 好室多膜 報價單系統已啟動`);
  console.log(` 服務網址: http://localhost:${PORT}`);
  console.log(` 門市人員身分驗證已啟用`);
  console.log(`====================================================`);
});
