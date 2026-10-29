// ==========================================================================
// 好室多膜 Housewrapper 車體工藝 報價系統 Frontend Controller
// ==========================================================================

const app = {
  token: localStorage.getItem('hw_token') || '',
  currentUser: JSON.parse(localStorage.getItem('hw_user') || 'null'),
  currentView: 'home',
  
  catalog: {
    categories: [],
    parts: [],
    materials: [],
    priceRules: [],
    vehicles: [],
    settings: {}
  },

  currentQuote: {
    id: null,
    mode: 'new', // 'new' | 'revise' | 'duplicate'
    parent_quote_id: null,
    quote_number: '',
    version: 1,
    customer_name: '',
    customer_phone: '',
    car_plate: '',
    car_brand: '',
    car_model: '',
    car_size: 'M',
    items: [],
    subtotal: 0,
    discount_type: 'none', // 'none' | 'fixed' | 'percentage'
    discount_value: 0,
    discount_amount: 0,
    discount_note: '',
    total_price: 0,
    valid_date: '',
    notes: '',
    status: 'issued'
  },

  quotesList: [],
  activePdfQuote: null,
  currentTheme: localStorage.getItem('hw_theme') || 'light',

  // ------------------------------------------------------------------------
  // Initialization
  // ------------------------------------------------------------------------
  init() {
    this.initTheme();
    this.initDefaultDates();
    if (!this.token) {
      this.showLoginModal();
    } else {
      this.checkAuth();
    }
  },

  initTheme() {
    this.applyTheme(this.currentTheme);
  },

  toggleTheme() {
    const nextTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.applyTheme(nextTheme);
  },

  applyTheme(theme) {
    this.currentTheme = theme;
    localStorage.setItem('hw_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);

    const icon = document.getElementById('theme-icon');
    const text = document.getElementById('theme-text');
    if (icon && text) {
      if (theme === 'light') {
        icon.textContent = '🌙';
        text.textContent = '深色模式';
      } else {
        icon.textContent = '☀️';
        text.textContent = '淺色模式';
      }
    }
  },

  initDefaultDates() {
    const today = new Date();
    const todayStr = this.formatLocalDate(today);

    const validDays = Number(this.catalog?.settings?.quote_valid_days) || 15;
    const validUntil = new Date();
    validUntil.setDate(today.getDate() + validDays);
    const validUntilStr = this.formatLocalDate(validUntil);

    const createdDateInput = document.getElementById('quote-created-date');
    if (createdDateInput) {
      createdDateInput.value = todayStr;
      this.currentQuote.created_at = todayStr;
    }

    const validDateInput = document.getElementById('quote-valid-date');
    if (validDateInput) {
      validDateInput.value = validUntilStr;
      this.currentQuote.valid_date = validUntilStr;
    }
  },

  onCreatedDateChange() {
    const createdDateInput = document.getElementById('quote-created-date');
    if (!createdDateInput || !createdDateInput.value) return;

    this.currentQuote.created_at = createdDateInput.value;

    // Recalculate valid until date automatically based on store setting
    const validDays = Number(this.catalog?.settings?.quote_valid_days) || 15;
    const baseDate = new Date(createdDateInput.value + 'T12:00:00');
    if (!isNaN(baseDate.getTime())) {
      baseDate.setDate(baseDate.getDate() + validDays);
      const validUntilStr = this.formatLocalDate(baseDate);
      const validDateInput = document.getElementById('quote-valid-date');
      if (validDateInput) {
        validDateInput.value = validUntilStr;
        this.currentQuote.valid_date = validUntilStr;
      }
    }
  },

  formatLocalDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },

  // ------------------------------------------------------------------------
  // Authentication
  // ------------------------------------------------------------------------
  showLoginModal() {
    document.getElementById('login-modal').classList.add('active');
  },

  hideLoginModal() {
    document.getElementById('login-modal').classList.remove('active');
  },

  async handleLoginSubmit(e) {
    e.preventDefault();
    const u = document.getElementById('login-username').value.trim();
    const p = document.getElementById('login-password').value;
    const errBox = document.getElementById('login-error-msg');
    errBox.style.display = 'none';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
      });
      const data = await res.json();
      if (!data.success) {
        errBox.textContent = data.message || '登入失敗';
        errBox.style.display = 'block';
        return;
      }

      this.token = data.token;
      this.currentUser = data.user;
      localStorage.setItem('hw_token', data.token);
      localStorage.setItem('hw_user', JSON.stringify(data.user));

      this.hideLoginModal();
      this.updateUserUI();
      await this.loadCatalog();
      await this.fetchQuotes();
      this.showToast('登入成功，歡迎使用好室多膜報價系統！', 'success');
    } catch (err) {
      errBox.textContent = '連線伺服器失敗，請稍後再試';
      errBox.style.display = 'block';
    }
  },

  async checkAuth() {
    try {
      const res = await this.api('/api/auth/me');
      if (res && res.success) {
        this.currentUser = res.user;
        localStorage.setItem('hw_user', JSON.stringify(res.user));
        this.updateUserUI();
        await this.loadCatalog();
        await this.fetchQuotes();
      } else {
        this.logout();
      }
    } catch (err) {
      this.logout();
    }
  },

  updateUserUI() {
    if (this.currentUser) {
      const label = document.getElementById('user-name-label');
      if (label) label.textContent = this.currentUser.displayName || this.currentUser.username;
    }
  },

  logout() {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` }
    }).catch(() => {});

    this.token = '';
    this.currentUser = null;
    localStorage.removeItem('hw_token');
    localStorage.removeItem('hw_user');
    this.showLoginModal();
  },

  // ------------------------------------------------------------------------
  // API Fetch Helper
  // ------------------------------------------------------------------------
  async api(endpoint, options = {}) {
    const headers = options.headers || {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const res = await fetch(endpoint, { ...options, headers });
      if (res.status === 401) {
        this.logout();
        return null;
      }
      return await res.json();
    } catch (err) {
      console.error('API Error on ' + endpoint, err);
      this.showToast('網路連線失敗，請檢查伺服器狀態', 'error');
      return null;
    }
  },

  // ------------------------------------------------------------------------
  // Navigation & View Routing
  // ------------------------------------------------------------------------
  navigate(viewName) {
    this.currentView = viewName;

    // Toggle active classes on view sections
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    const targetSection = document.getElementById(`view-${viewName}`);
    if (targetSection) targetSection.classList.add('active');

    // Update Header Navigation Buttons
    document.querySelectorAll('.header-nav .nav-link').forEach(btn => btn.classList.remove('active'));
    const activeNav = document.getElementById(`nav-${viewName}`);
    if (activeNav) activeNav.classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (viewName === 'history') {
      this.fetchQuotes();
    } else if (viewName === 'admin') {
      this.renderAdminAll();
    } else if (viewName === 'new-quote') {
      this.populateVehicleSelect();
      this.populateAdderDropdowns();
    } else if (viewName === 'warranty') {
      this.initWarrantyView();
    } else if (viewName === 'deposit') {
      this.initDepositView();
    }
  },

  // ------------------------------------------------------------------------
  // Catalog Loading & Dropdowns
  // ------------------------------------------------------------------------
  async loadCatalog() {
    const res = await this.api('/api/catalog');
    if (!res || !res.success) return;

    this.catalog = res.data;

    // Update Quick Stats on Home Portal
    const statMat = document.getElementById('stat-active-materials');
    const statVeh = document.getElementById('stat-vehicles');
    if (statMat) statMat.textContent = this.catalog.materials.length;
    if (statVeh) statVeh.textContent = this.catalog.vehicles.length;

    this.populateVehicleSelect();
    this.populateAdderDropdowns();
    this.populateAdminStoreSettings();
  },

  populateVehicleSelect() {
    const select = document.getElementById('quote-vehicle-select');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- 請選擇常見車型 (可自動判別尺寸) --</option>';

    // Group by Brand
    const grouped = {};
    for (const v of this.catalog.vehicles) {
      if (!grouped[v.brand]) grouped[v.brand] = [];
      grouped[v.brand].push(v);
    }

    for (const [brand, list] of Object.entries(grouped)) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = brand;
      for (const item of list) {
        const opt = document.createElement('option');
        opt.value = `${item.brand}:::${item.model}:::${item.size_class}`;
        opt.textContent = `${item.brand} - ${item.model} (${item.size_class} 級距)`;
        optgroup.appendChild(opt);
      }
      select.appendChild(optgroup);
    }

    if (currentVal) select.value = currentVal;
  },

  onVehiclePresetChange() {
    const select = document.getElementById('quote-vehicle-select');
    if (!select || !select.value) return;

    const [brand, model, size] = select.value.split(':::');
    document.getElementById('quote-car-brand').value = brand;
    document.getElementById('quote-car-model').value = model;
    this.selectCarSize(size);
  },

  selectCarSize(size) {
    this.currentQuote.car_size = size;
    document.querySelectorAll('.size-chip').forEach(chip => {
      if (chip.getAttribute('data-size') === size) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });

    // Recalculate adder price recommendation
    this.updateAdderPrice();
  },

  populateAdderDropdowns() {
    const catSelect = document.getElementById('adder-category');
    const partSelect = document.getElementById('adder-part');
    const brandSelect = document.getElementById('adder-brand');
    if (!catSelect || !partSelect || !brandSelect) return;

    // 1. 施工類別：犀牛皮、改色膜、隔熱紙、其他
    const defaultCategories = ['犀牛皮', '改色膜', '隔熱紙', '其他'];
    catSelect.innerHTML = '';
    defaultCategories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      catSelect.appendChild(opt);
    });

    // 2. 施工部位：22 個指定部位
    const defaultParts = [
      '全車', '前保桿', '引擎蓋', '左前葉', '右前葉', '左前門', '左後門', '左後葉', '左AC',
      '右前門', '右後門', '右後葉', '右AC', '尾箱上', '尾箱中段', '尾箱上（左）', '尾箱上（右）',
      '尾箱下', '後保桿', '左後保桿', '右後保桿', '其他'
    ];
    partSelect.innerHTML = '';
    defaultParts.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      partSelect.appendChild(opt);
    });

    // 3. 材料品牌：AX、3M、STEK、SUNTEK、其他
    const defaultBrands = ['AX', '3M', 'STEK', 'SUNTEK', '其他'];
    brandSelect.innerHTML = '';
    defaultBrands.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = b;
      brandSelect.appendChild(opt);
    });

    // 4. 膜料系列：清空手動輸入
    const seriesInput = document.getElementById('adder-series');
    if (seriesInput) seriesInput.value = '';

    this.onAdderSelectionChange();
  },

  onAdderCategoryChange() {
    this.onAdderSelectionChange();
  },

  onAdderSelectionChange() {
    this.updateAdderPrice();
  },

  lookupReferencePrice(part, cat, brand, series, size, carBrand, carModel) {
    const pData = window.carPricingData;
    if (!pData) return 0;

    const brandStr = (carBrand || '').toLowerCase();
    const modelStr = (carModel || '').toLowerCase();
    const isTesla = brandStr.includes('tesla') || brandStr.includes('特斯拉') || modelStr.includes('model');

    // 1. Determine material key
    let matKey = 'axColor';
    const isMatte = (series || '').includes('消光') || (series || '').includes('啞光') || (series || '').includes('霧面');

    if (cat === '改色膜') {
      matKey = (brand === '3M') ? 'threeMColor' : 'axColor';
    } else if (cat === '犀牛皮') {
      if (brand === 'AX' || brand === '國產') {
        matKey = isMatte ? 'chinaMatte' : 'chinaGloss';
      } else {
        // 3M, STEK, SUNTEK or other import PPF
        matKey = isMatte ? 'importMatte' : 'importGloss';
      }
    } else if (cat === '隔熱紙') {
      if (part === '全車') {
        const tintMap = { 'S': 22000, 'M': 25000, 'L': 28000, 'XL': 32000, '2XL': 35000 };
        return tintMap[size] || 25000;
      }
      if (part.includes('前') || part.includes('擋')) return 8000;
      if (part.includes('後') || part.includes('側') || part.includes('門')) return 4000;
      return 6000;
    }

    // 2. Full car package price handling from reference packagePrices
    if (part === '全車') {
      const pkg = window.carPackagePrices;
      if (cat === '改色膜') {
        if (brand === '3M') {
          const mKey = (series || '').includes('HG') ? 'threeMHG' : ((series || '').includes('GP') || (series || '').includes('SP') ? 'threeMGP' : 'threeMGMS');
          if (pkg && pkg[mKey] && pkg[mKey][size]) return pkg[mKey][size];
          return size === 'S' ? 70000 : (size === 'L' ? 80000 : (size === 'XL' ? 85000 : (size === '2XL' ? 90000 : 75000)));
        } else {
          // AX color
          const aKey = (series || '').includes('T') ? 'axT' : ((series || '').includes('G') ? 'axG' : ((series || '').includes('V') ? 'axV' : 'axE'));
          if (pkg && pkg[aKey] && pkg[aKey][size]) return pkg[aKey][size];
          return size === 'S' ? 60000 : (size === 'L' ? 70000 : (size === 'XL' ? 75000 : (size === '2XL' ? 80000 : 65000)));
        }
      } else if (cat === '犀牛皮') {
        if (brand === 'AX' || brand === '國產') {
          const ppfChina = { 'S': 90000, 'M': 98000, 'L': 108000, 'XL': 118000, '2XL': 128000 };
          return ppfChina[size] || 98000;
        } else {
          const ppfImport = { 'S': 120000, 'M': 130000, 'L': 145000, 'XL': 160000, '2XL': 175000 };
          return ppfImport[size] || 130000;
        }
      }
    }

    // 3. Mapping of 22 parts to reference database part names
    const partMap = {
      '前保桿': '前保桿',
      '引擎蓋': '引擎蓋',
      '左前葉': '前葉子版',
      '右前葉': '前葉子版',
      '左前門': '前門',
      '右前門': '前門',
      '左後門': '後門',
      '右後門': '後門',
      '左後葉': '後葉',
      '右後葉': '後葉',
      '左AC': isTesla ? 'AC' : 'AC(不含後葉)',
      '右AC': isTesla ? 'AC' : 'AC(不含後葉)',
      '尾箱上': '尾箱上',
      '尾箱中段': '尾箱下',
      '尾箱上（左）': '尾箱上左右（單邊）',
      '尾箱上（右）': '尾箱上左右（單邊）',
      '尾箱下': '尾箱下',
      '後保桿': '後保桿',
      '左後保桿': '後保桿（單邊）',
      '右後保桿': '後保桿（單邊）'
    };

    const mappedKey = partMap[part] || part;
    const table = isTesla ? pData.tesla[matKey] : pData.others[matKey];

    // Determine model or size key
    let sizeKey = size || 'M';
    if (isTesla) {
      if (modelStr.includes('新款') || modelStr.includes('new')) {
        sizeKey = '新款Model Y';
      } else if (modelStr.includes('3')) {
        sizeKey = 'Model 3';
      } else if (modelStr.includes('y')) {
        sizeKey = 'Model Y';
      } else if (modelStr.includes('s')) {
        sizeKey = 'Model S';
      } else if (modelStr.includes('x')) {
        sizeKey = 'Model X';
      } else {
        sizeKey = 'Model Y'; // Tesla standard
      }
    }

    if (table && table[mappedKey] && table[mappedKey][sizeKey]) {
      return table[mappedKey][sizeKey];
    }

    // Fallback if not found directly
    if (table && table[mappedKey]) {
      const vals = Object.values(table[mappedKey]);
      if (vals.length > 0) return vals[0];
    }

    // Single side calculation fallback for non-Tesla
    if (!isTesla && pData.others && pData.others[matKey]) {
      if (mappedKey === '後保桿（單邊）' && pData.others[matKey]['後保桿']) {
        return Math.round(pData.others[matKey]['後保桿'][sizeKey || 'M'] / 2);
      }
      if (mappedKey === '尾箱上左右（單邊）' && pData.others[matKey]['尾箱上']) {
        return Math.round(pData.others[matKey]['尾箱上'][sizeKey || 'M'] / 2);
      }
    }

    return 0;
  },

  updateAdderPrice() {
    const part = document.getElementById('adder-part')?.value;
    const cat = document.getElementById('adder-category')?.value;
    const brand = document.getElementById('adder-brand')?.value;
    const series = document.getElementById('adder-series')?.value || '';
    const carBrand = document.getElementById('quote-car-brand')?.value || '';
    const carModel = document.getElementById('quote-car-model')?.value || '';
    const size = this.currentQuote.car_size || 'M';
    const priceInput = document.getElementById('adder-price');

    if (!priceInput) return;

    const refPrice = this.lookupReferencePrice(part, cat, brand, series, size, carBrand, carModel);
    if (refPrice > 0) {
      priceInput.value = refPrice;
    } else {
      if (!priceInput.value) {
        priceInput.placeholder = '請手動輸入';
      }
    }
  },

  // ------------------------------------------------------------------------
  // Quotation Item Operations
  // ------------------------------------------------------------------------
  addItemFromAdder() {
    const catSelect = document.getElementById('adder-category');
    const partSelect = document.getElementById('adder-part');
    const brandSelect = document.getElementById('adder-brand');
    const seriesInput = document.getElementById('adder-series');
    const priceInput = document.getElementById('adder-price');

    const catName = catSelect.value || '施工項目';
    const partName = partSelect.value || '全車';
    const brandName = brandSelect.value || '其他';
    const seriesName = seriesInput.value.trim();
    const price = Number(priceInput.value);

    if (isNaN(price) || price < 0) {
      this.showToast('請輸入施工單價金額', 'warning');
      priceInput.focus();
      return;
    }

    const fullMatName = seriesName ? `${brandName} · ${seriesName}` : brandName;

    const item = {
      id: Date.now() + Math.random().toString(36).substr(2, 4),
      category_name: catName,
      part_name: partName,
      material_brand: brandName,
      material_series: seriesName,
      material_name: fullMatName,
      warranty_years: 5,
      unit_price: price,
      quantity: 1,
      subtotal: price,
      note: ''
    };

    this.currentQuote.items.push(item);
    this.renderQuoteItems();
    this.calculateTotals();

    // Reset series & price for next entry
    seriesInput.value = '';
    priceInput.value = '';

    this.showToast(`已加入「${catName} - ${partName} (${fullMatName})」`, 'success');
  },

  openCustomItemModal() {
    document.getElementById('custom-name').value = '';
    document.getElementById('custom-mat').value = '好室精緻工藝 / 專車施工';
    document.getElementById('custom-price').value = '';
    document.getElementById('custom-qty').value = '1';
    document.getElementById('custom-note').value = '';
    document.getElementById('custom-item-modal').classList.add('active');
    setTimeout(() => document.getElementById('custom-name').focus(), 100);
  },

  closeCustomItemModal() {
    document.getElementById('custom-item-modal').classList.remove('active');
  },

  addCustomItem() {
    const name = document.getElementById('custom-name').value.trim();
    const mat = document.getElementById('custom-mat').value.trim() || '客製規格';
    const price = Number(document.getElementById('custom-price').value);
    const qty = Math.max(1, Number(document.getElementById('custom-qty').value) || 1);
    const note = document.getElementById('custom-note').value.trim();

    if (!name) {
      this.showToast('請填寫施工項目名稱', 'warning');
      return;
    }

    if (isNaN(price) || price < 0) {
      this.showToast('請輸入有效單價', 'warning');
      return;
    }

    const item = {
      id: Date.now() + Math.random().toString(36).substr(2, 4),
      category_id: null,
      category_name: '特殊客製項目',
      part_id: null,
      part_name: name,
      material_name: mat,
      warranty_years: 1,
      unit_price: price,
      quantity: qty,
      subtotal: price * qty,
      note: note || '客製工藝'
    };

    this.currentQuote.items.push(item);
    this.closeCustomItemModal();
    this.renderQuoteItems();
    this.calculateTotals();
    this.showToast(`已新增自訂項目「${name}」`, 'success');
  },

  renderQuoteItems() {
    const tbody = document.getElementById('quote-items-tbody');
    const emptyState = document.getElementById('items-empty-state');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (this.currentQuote.items.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    this.currentQuote.items.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="color: var(--text-muted); font-family: var(--font-mono);">${idx + 1}</td>
        <td>
          <div class="item-title-text">${this.escapeHtml(item.part_name)}</div>
          <div class="item-sub-desc">
            <span class="badge-tag">${this.escapeHtml(item.category_name)}</span>
          </div>
        </td>
        <td>
          <div style="font-weight: 700; color: var(--text-heading); font-size: 14px;">${this.escapeHtml(item.material_name)}</div>
          <div class="item-sub-desc">材料品牌與規格</div>
        </td>
        <td style="text-align: right;">
          <input type="number" class="price-input-compact" value="${item.unit_price}" min="0" step="500"
            onchange="app.updateItemPrice('${item.id}', this.value)">
        </td>
        <td style="text-align: center;">
          <input type="number" class="qty-input-compact" value="${item.quantity}" min="1"
            onchange="app.updateItemQty('${item.id}', this.value)">
        </td>
        <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; color: var(--text-heading);">
          NT$ ${this.formatNumber(item.unit_price * item.quantity)}
        </td>
        <td>
          <input type="text" class="note-input-inline" value="${this.escapeHtml(item.note || '')}" placeholder="填寫細節備註..."
            onchange="app.updateItemNote('${item.id}', this.value)">
        </td>
        <td style="text-align: center;">
          <button class="btn-icon" style="color: #f87171;" title="刪除此項目" onclick="app.removeItem('${item.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  },

  updateItemPrice(id, newPrice) {
    const item = this.currentQuote.items.find(x => x.id === id);
    if (!item) return;
    item.unit_price = Math.max(0, Number(newPrice) || 0);
    item.subtotal = item.unit_price * item.quantity;
    this.renderQuoteItems();
    this.calculateTotals();
  },

  updateItemQty(id, newQty) {
    const item = this.currentQuote.items.find(x => x.id === id);
    if (!item) return;
    item.quantity = Math.max(1, Number(newQty) || 1);
    item.subtotal = item.unit_price * item.quantity;
    this.renderQuoteItems();
    this.calculateTotals();
  },

  updateItemNote(id, newNote) {
    const item = this.currentQuote.items.find(x => x.id === id);
    if (!item) return;
    item.note = newNote;
  },

  removeItem(id) {
    this.currentQuote.items = this.currentQuote.items.filter(x => x.id !== id);
    this.renderQuoteItems();
    this.calculateTotals();
  },

  // ------------------------------------------------------------------------
  // Extra Discount Calculations (額外折扣)
  // ------------------------------------------------------------------------
  toggleDiscountPanel(show) {
    const panel = document.getElementById('discount-panel');
    const trigger = document.getElementById('discount-trigger-container');
    if (show) {
      panel.style.display = 'block';
      trigger.style.display = 'none';
      if (this.currentQuote.discount_type === 'none') {
        this.setDiscountType('fixed');
      }
    } else {
      panel.style.display = 'none';
      trigger.style.display = 'flex';
    }
  },

  setDiscountType(type) {
    this.currentQuote.discount_type = type;
    const btnFixed = document.getElementById('btn-discount-fixed');
    const btnPct = document.getElementById('btn-discount-pct');
    const valLabel = document.getElementById('discount-val-label');
    const valInput = document.getElementById('discount-value-input');

    if (type === 'fixed') {
      btnFixed.classList.add('active');
      btnPct.classList.remove('active');
      valLabel.textContent = '固定折讓金額 (NT$)';
      valInput.placeholder = '例：5000';
    } else {
      btnPct.classList.add('active');
      btnFixed.classList.remove('active');
      valLabel.textContent = '百分比折讓 (%) - 例如輸入 5 代表 95 折扣除 5%';
      valInput.placeholder = '例：5 (即 95 折)';
    }

    this.calculateTotals();
  },

  quickDiscount(type, val) {
    this.setDiscountType(type === 'pct' ? 'percentage' : 'fixed');
    document.getElementById('discount-value-input').value = val;
    if (type === 'pct') {
      document.getElementById('discount-note-input').value = `${100 - val} 折專屬優惠`;
    } else {
      document.getElementById('discount-note-input').value = `門市特惠折抵 NT$ ${this.formatNumber(val)}`;
    }
    this.calculateTotals();
  },

  removeDiscount() {
    this.currentQuote.discount_type = 'none';
    this.currentQuote.discount_value = 0;
    this.currentQuote.discount_amount = 0;
    this.currentQuote.discount_note = '';
    document.getElementById('discount-value-input').value = '';
    document.getElementById('discount-note-input').value = '';
    this.toggleDiscountPanel(false);
    this.calculateTotals();
  },

  calculateTotals() {
    // 1. Calculate subtotal
    let subtotal = 0;
    for (const item of this.currentQuote.items) {
      subtotal += (item.unit_price * item.quantity);
    }
    this.currentQuote.subtotal = subtotal;

    // 2. Calculate discount
    const valInput = Number(document.getElementById('discount-value-input')?.value) || 0;
    const noteInput = document.getElementById('discount-note-input')?.value.trim() || '';
    this.currentQuote.discount_value = valInput;
    this.currentQuote.discount_note = noteInput;

    let discountAmount = 0;
    if (this.currentQuote.discount_type === 'fixed') {
      discountAmount = Math.min(valInput, subtotal);
    } else if (this.currentQuote.discount_type === 'percentage') {
      discountAmount = Math.round(subtotal * (Math.min(100, Math.max(0, valInput)) / 100));
    }
    this.currentQuote.discount_amount = discountAmount;

    // 3. Grand total
    this.currentQuote.total_price = Math.max(0, subtotal - discountAmount);

    // Update Form UI
    document.getElementById('summary-subtotal').textContent = `NT$ ${this.formatNumber(subtotal)}`;
    
    const discRow = document.getElementById('summary-discount-row');
    const discText = document.getElementById('summary-discount-text');
    const discAmt = document.getElementById('summary-discount-amount');

    if (discountAmount > 0 && this.currentQuote.discount_type !== 'none') {
      discRow.style.display = 'flex';
      const label = this.currentQuote.discount_type === 'percentage' ? `-${valInput}%` : '定額折抵';
      const notePart = noteInput ? ` [${noteInput}]` : '';
      discText.textContent = `額外折扣 (${label}${notePart})`;
      discAmt.textContent = `- NT$ ${this.formatNumber(discountAmount)}`;
    } else {
      discRow.style.display = 'none';
    }

    document.getElementById('summary-grand-total').textContent = this.formatNumber(this.currentQuote.total_price);
  },

  // ------------------------------------------------------------------------
  // Quotation Submission & Saving
  // ------------------------------------------------------------------------
  syncFormToState() {
    this.currentQuote.customer_name = document.getElementById('quote-cust-name').value.trim();
    this.currentQuote.customer_phone = document.getElementById('quote-cust-phone').value.trim();
    this.currentQuote.car_plate = document.getElementById('quote-car-plate').value.trim().toUpperCase();
    this.currentQuote.car_brand = document.getElementById('quote-car-brand').value.trim();
    this.currentQuote.car_model = document.getElementById('quote-car-model').value.trim();
    this.currentQuote.created_at = document.getElementById('quote-created-date')?.value || this.formatLocalDate(new Date());
    this.currentQuote.valid_date = document.getElementById('quote-valid-date').value;
    this.currentQuote.notes = document.getElementById('quote-notes').value.trim();
  },

  validateQuote() {
    this.syncFormToState();
    if (!this.currentQuote.customer_name) {
      this.showToast('請填寫客戶姓名', 'warning');
      document.getElementById('quote-cust-name').focus();
      return false;
    }
    if (!this.currentQuote.customer_phone) {
      this.showToast('請填寫客戶聯絡電話', 'warning');
      document.getElementById('quote-cust-phone').focus();
      return false;
    }
    if (!this.currentQuote.car_plate) {
      this.showToast('請填寫車牌號碼', 'warning');
      document.getElementById('quote-car-plate').focus();
      return false;
    }
    if (this.currentQuote.items.length === 0) {
      this.showToast('報價單至少需包含一個施工項目', 'warning');
      return false;
    }
    return true;
  },

  async saveCurrentQuote() {
    if (!this.validateQuote()) return;

    const payload = {
      ...this.currentQuote,
      status: 'issued'
    };

    const saveBtn = document.getElementById('btn-save-quote');
    saveBtn.disabled = true;
    saveBtn.textContent = '存檔開單中...';

    try {
      let res;
      if (this.currentQuote.mode === 'revise' && this.currentQuote.id) {
        // Revision endpoint: creates new version preserving the old record
        res = await this.api(`/api/quotes/${this.currentQuote.id}/version`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      } else {
        // Brand new quote
        res = await this.api('/api/quotes', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      saveBtn.disabled = false;
      saveBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        正式開單並存檔
      `;

      if (!res || !res.success) {
        this.showToast(res?.message || '開單失敗', 'error');
        return;
      }

      this.showToast(res.message || '報價單已成功開立！', 'success');
      this.openPdfModal(res.data);
      this.fetchQuotes();
    } catch (err) {
      saveBtn.disabled = false;
      this.showToast('開單發生錯誤：' + err.message, 'error');
    }
  },

  resetForm() {
    this.currentQuote = {
      id: null,
      mode: 'new',
      parent_quote_id: null,
      quote_number: '',
      version: 1,
      customer_name: '',
      customer_phone: '',
      car_plate: '',
      car_brand: '',
      car_model: '',
      car_size: 'M',
      items: [],
      subtotal: 0,
      discount_type: 'none',
      discount_value: 0,
      discount_amount: 0,
      discount_note: '',
      total_price: 0,
      valid_date: '',
      notes: '',
      status: 'issued'
    };

    document.getElementById('quote-cust-name').value = '';
    document.getElementById('quote-cust-phone').value = '';
    document.getElementById('quote-car-plate').value = '';
    document.getElementById('quote-car-brand').value = '';
    document.getElementById('quote-car-model').value = '';
    document.getElementById('quote-vehicle-select').value = '';
    document.getElementById('quote-notes').value = '';
    document.getElementById('quote-mode-badge').textContent = '全新單據';
    document.getElementById('form-heading-text').querySelector('span:first-child').textContent = '新增施工報價單';

    this.selectCarSize('M');
    this.removeDiscount();
    this.initDefaultDates();
    this.renderQuoteItems();
    this.calculateTotals();
    this.showToast('已重設報價單表單', 'info');
  },

  // ------------------------------------------------------------------------
  // PDF Sheet Rendering & Export
  // ------------------------------------------------------------------------
  previewCurrentQuote() {
    if (!this.validateQuote()) return;
    const tempQuote = {
      ...this.currentQuote,
      quote_number: this.currentQuote.quote_number || 'HW-預覽暫存單',
      created_at: this.currentQuote.created_at ? (this.currentQuote.created_at + 'T12:00:00') : new Date().toISOString()
    };
    this.openPdfModal(tempQuote);
  },

  openPdfModal(quote) {
    this.activePdfQuote = quote;
    this.renderPdfSheet(quote);
    document.getElementById('pdf-modal').classList.add('active');
    const modalBody = document.querySelector('#pdf-modal .modal-body');
    if (modalBody) modalBody.scrollTop = 0;
  },

  closePdfModal() {
    document.getElementById('pdf-modal').classList.remove('active');
  },

  renderPdfSheet(q) {
    const s = this.catalog.settings || {};

    // Header info
    document.getElementById('pdf-store-name').textContent = s.company_name || '好室多膜 HOUSEWRAPPER';
    document.getElementById('pdf-store-address').textContent = s.company_address || '台北市內湖區行愛路111號';
    document.getElementById('pdf-store-phone').textContent = s.company_phone || '02-2794-0710';
    document.getElementById('pdf-store-line').textContent = s.company_line || '@housewrapper';

    // Meta
    document.getElementById('pdf-quote-no').textContent = q.quote_number + (q.version > 1 ? ` (v${q.version})` : '');
    document.getElementById('pdf-created-date').textContent = (q.created_at || '').slice(0, 10).replace(/-/g, '/');
    document.getElementById('pdf-valid-date').textContent = (q.valid_date || '').replace(/-/g, '/');

    // Client & Vehicle
    document.getElementById('pdf-client-name').textContent = q.customer_name;
    document.getElementById('pdf-client-phone').textContent = q.customer_phone;
    document.getElementById('pdf-car-plate').textContent = q.car_plate;
    document.getElementById('pdf-car-brand').textContent = q.car_brand || '未指定廠牌';
    document.getElementById('pdf-car-model-size').textContent = `${q.car_model || '標準車型'} (${q.car_size || 'M'} 級距)`;

    // Status Badge
    const statusBadge = document.getElementById('pdf-modal-status-badge');
    statusBadge.textContent = this.formatStatus(q.status);

    // Items Table
    const tbody = document.getElementById('pdf-items-tbody');
    tbody.innerHTML = '';
    const items = q.items || [];

    items.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="text-center" style="font-family: var(--font-mono); color: #6b7280;">${idx + 1}</td>
        <td>
          <div style="font-weight: 700; color: #111827;">${this.escapeHtml(item.part_name)}</div>
          <div style="font-size: 11px; color: #6b7280;">${this.escapeHtml(item.category_name)}</div>
          ${item.note ? `<div style="font-size: 11px; color: #4b5563; font-style: italic; margin-top: 2px;">備註：${this.escapeHtml(item.note)}</div>` : ''}
        </td>
        <td>
          <div style="font-weight: 600; color: #1f2937;">${this.escapeHtml(item.material_name)}</div>
          <div style="font-size: 11px; color: #4b5563;">官方保固：${item.warranty_years || 5} 年自體修復防護責任</div>
        </td>
        <td class="text-right" style="font-family: var(--font-mono);">NT$ ${this.formatNumber(item.unit_price)}</td>
        <td class="text-center" style="font-family: var(--font-mono);">${item.quantity}</td>
        <td class="text-right" style="font-family: var(--font-mono); font-weight: 700;">NT$ ${this.formatNumber(item.unit_price * item.quantity)}</td>
      `;
      tbody.appendChild(tr);
    });

    // Subtotal & Discounts
    document.getElementById('pdf-subtotal-val').textContent = `NT$ ${this.formatNumber(q.subtotal)}`;
    
    const discRow = document.getElementById('pdf-discount-row');
    if (q.discount_amount > 0) {
      discRow.style.display = 'table-row';
      const label = q.discount_type === 'percentage' ? `${q.discount_value}% 專案折讓` : '折抵';
      const notePart = q.discount_note ? ` - ${q.discount_note}` : '';
      document.getElementById('pdf-discount-label').textContent = `${label}${notePart}`;
      document.getElementById('pdf-discount-val').textContent = `- NT$ ${this.formatNumber(q.discount_amount)}`;
    } else {
      discRow.style.display = 'none';
    }

    document.getElementById('pdf-grand-val').textContent = `NT$ ${this.formatNumber(q.total_price)}`;

    // Terms
    let termsText = s.quote_terms || '';
    if (q.notes) {
      termsText = `【本單特別約定】：${q.notes}\n\n` + termsText;
    }
    document.getElementById('pdf-terms-content').textContent = termsText;

    // Staff
    document.getElementById('pdf-rep-name').textContent = q.created_by || this.currentUser?.displayName || '店長 Kevin';
  },

  downloadPdf() {
    const originalTarget = document.getElementById('pdf-render-target');
    if (!originalTarget) return;

    const modalBody = document.querySelector('#pdf-modal .modal-body');
    const originalScrollTop = modalBody ? modalBody.scrollTop : 0;
    if (modalBody) modalBody.scrollTop = 0;

    // Build an isolated clean export container directly in document.body
    // This completely eliminates:
    // 1. Any scrollTop offset from creating huge blank space at top of page 1
    // 2. Mobile/tablet responsive squishing
    // 3. Text wrapping of "汽車施工報價單"
    const exportWrapper = document.createElement('div');
    exportWrapper.id = 'pdf-export-temp-wrapper';
    exportWrapper.style.position = 'fixed';
    exportWrapper.style.top = '0';
    exportWrapper.style.left = '0';
    exportWrapper.style.width = '794px'; // Standard A4 width in px at 96 DPI
    exportWrapper.style.background = '#ffffff';
    exportWrapper.style.zIndex = '999999';
    exportWrapper.style.overflow = 'visible';
    exportWrapper.style.pointerEvents = 'none';

    // Clone the sheet with exact standard A4 printable width
    const clone = originalTarget.cloneNode(true);
    clone.style.boxShadow = 'none';
    clone.style.margin = '0';
    clone.style.width = '794px';
    clone.style.maxWidth = '794px';
    clone.style.minWidth = '794px';
    clone.style.boxSizing = 'border-box';
    clone.style.padding = '22px 26px';

    exportWrapper.appendChild(clone);
    document.body.appendChild(exportWrapper);

    const filename = `${this.activePdfQuote?.quote_number || 'Housewrapper_Quote'}.pdf`;

    const opt = {
      margin: [6, 6, 6, 6],
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        scrollY: 0,
        scrollX: 0,
        windowWidth: 800
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    this.showToast('正在產生標準 A4 PDF，請稍候...', 'info');

    html2pdf().set(opt).from(clone).save().then(() => {
      if (document.body.contains(exportWrapper)) {
        document.body.removeChild(exportWrapper);
      }
      if (modalBody) modalBody.scrollTop = originalScrollTop;
      this.showToast('PDF 報價單已下載完成！', 'success');
    }).catch(err => {
      console.error('PDF export failed', err);
      if (document.body.contains(exportWrapper)) {
        document.body.removeChild(exportWrapper);
      }
      if (modalBody) modalBody.scrollTop = originalScrollTop;
      this.showToast('下載失敗，改為呼叫系統列印/另存 PDF', 'warning');
      window.print();
    });
  },

  downloadJpg() {
    const originalTarget = document.getElementById('pdf-render-target');
    if (!originalTarget) return;

    const modalBody = document.querySelector('#pdf-modal .modal-body');
    const originalScrollTop = modalBody ? modalBody.scrollTop : 0;
    if (modalBody) modalBody.scrollTop = 0;

    this.showToast('正在產生高解析 JPG 圖片（適合 LINE 發送）...', 'info');

    // Build an isolated clean export container directly in document.body
    const exportWrapper = document.createElement('div');
    exportWrapper.id = 'jpg-export-temp-wrapper';
    exportWrapper.style.position = 'fixed';
    exportWrapper.style.top = '0';
    exportWrapper.style.left = '0';
    exportWrapper.style.width = '794px';
    exportWrapper.style.background = '#ffffff';
    exportWrapper.style.zIndex = '999999';
    exportWrapper.style.overflow = 'visible';
    exportWrapper.style.pointerEvents = 'none';

    // Clone the sheet with exact standard A4 width
    const clone = originalTarget.cloneNode(true);
    clone.style.boxShadow = 'none';
    clone.style.margin = '0';
    clone.style.width = '794px';
    clone.style.maxWidth = '794px';
    clone.style.minWidth = '794px';
    clone.style.boxSizing = 'border-box';
    clone.style.padding = '24px 28px';
    clone.style.background = '#ffffff';
    clone.style.borderRadius = '0';

    exportWrapper.appendChild(clone);
    document.body.appendChild(exportWrapper);

    const filename = `${this.activePdfQuote?.quote_number || 'Housewrapper_Quote'}.jpg`;

    const h2c = window.html2canvas || (window.html2pdf && window.html2pdf().worker?.html2canvas);
    if (!h2c) {
      if (document.body.contains(exportWrapper)) document.body.removeChild(exportWrapper);
      if (modalBody) modalBody.scrollTop = originalScrollTop;
      this.showToast('圖片模組載入中，請稍候重試', 'warning');
      return;
    }

    h2c(clone, {
      scale: 2, // 2x Retina resolution for crisp text
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      scrollY: 0,
      scrollX: 0,
      windowWidth: 800
    }).then(canvas => {
      // Export as high quality JPEG
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      
      const link = document.createElement('a');
      link.download = filename;
      link.href = imgData;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (document.body.contains(exportWrapper)) {
        document.body.removeChild(exportWrapper);
      }
      if (modalBody) modalBody.scrollTop = originalScrollTop;
      this.showToast('🖼️ JPG 報價單圖片已成功下載！可直接傳送給客戶', 'success');
    }).catch(err => {
      console.error('JPG export failed', err);
      if (document.body.contains(exportWrapper)) {
        document.body.removeChild(exportWrapper);
      }
      if (modalBody) modalBody.scrollTop = originalScrollTop;
      this.showToast('JPG 圖片產生失敗，請稍候重試', 'error');
    });
  },

  copyQuoteText() {
    if (!this.activePdfQuote) return;
    const q = this.activePdfQuote;
    const s = this.catalog.settings || {};

    let text = `【好室多膜 Housewrapper 車體工藝 報價單】\n`;
    text += `單據編號：${q.quote_number}\n`;
    text += `客戶姓名：${q.customer_name}\n`;
    text += `車牌號碼：${q.car_plate} (${q.car_brand} ${q.car_model})\n`;
    text += `有效期限：${q.valid_date}\n`;
    text += `------------------------------------\n`;
    text += `【施工項目清單】：\n`;
    (q.items || []).forEach((item, i) => {
      text += `${i + 1}. ${item.part_name} | ${item.material_name} x${item.quantity} = NT$ ${this.formatNumber(item.unit_price * item.quantity)}\n`;
    });
    text += `------------------------------------\n`;
    text += `施工小計：NT$ ${this.formatNumber(q.subtotal)}\n`;
    if (q.discount_amount > 0) {
      text += `額外折讓：-NT$ ${this.formatNumber(q.discount_amount)} (${q.discount_note || '活動優惠'})\n`;
    }
    text += `最終總計：NT$ ${this.formatNumber(q.total_price)}\n`;
    text += `門市電話：${s.company_phone || '02-2794-0710'} ｜ LINE: ${s.company_line || '@housewrapper'}\n`;
    if (q.notes) text += `備註說明：${q.notes}\n`;

    navigator.clipboard.writeText(text).then(() => {
      this.showToast('報價摘要已複製至剪貼簿，可直接貼至 LINE 分享！', 'success');
    }).catch(() => {
      this.showToast('複製失敗，請手動複製', 'error');
    });
  },

  // ------------------------------------------------------------------------
  // Quotation History (歷史報價單)
  // ------------------------------------------------------------------------
  debouncedFetchQuotes() {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.fetchQuotes(), 300);
  },

  async fetchQuotes() {
    const search = document.getElementById('history-search-input')?.value || '';
    const startDate = document.getElementById('history-start-date')?.value || '';
    const endDate = document.getElementById('history-end-date')?.value || '';
    const status = document.getElementById('history-status-select')?.value || 'all';

    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (status) params.append('status', status);

    const res = await this.api(`/api/quotes?${params.toString()}`);
    if (!res || !res.success) return;

    this.quotesList = res.data;
    this.renderHistoryTable();

    // Update portal stat
    const statQuotes = document.getElementById('stat-total-quotes');
    if (statQuotes) statQuotes.textContent = this.quotesList.length;
  },

  clearHistoryFilters() {
    document.getElementById('history-search-input').value = '';
    document.getElementById('history-start-date').value = '';
    document.getElementById('history-end-date').value = '';
    document.getElementById('history-status-select').value = 'all';
    this.fetchQuotes();
  },

  renderHistoryTable() {
    const tbody = document.getElementById('history-tbody');
    const emptyState = document.getElementById('history-empty');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (this.quotesList.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      return;
    }
    if (emptyState) emptyState.style.display = 'none';

    this.quotesList.forEach(q => {
      const tr = document.createElement('tr');
      const items = q.items || [];
      const itemSummary = items.map(i => i.part_name).slice(0, 2).join('、 ') + (items.length > 2 ? ` 等 ${items.length} 項` : '');

      tr.innerHTML = `
        <td>
          <span class="quote-number-pill">${q.quote_number}</span>
          ${q.version > 1 ? `<span class="version-badge">v${q.version}</span>` : ''}
        </td>
        <td style="color: var(--text-muted); font-size: 13px;">${(q.created_at || '').slice(0, 10)}</td>
        <td style="font-weight: 700; color: var(--text-heading); font-size: 14px;">${this.escapeHtml(q.customer_name)}</td>
        <td style="font-family: var(--font-mono);">${this.escapeHtml(q.customer_phone)}</td>
        <td>
          <span class="badge-tag" style="font-family: var(--font-mono); font-weight: 600;">${this.escapeHtml(q.car_plate)}</span>
        </td>
        <td>
          <div>${this.escapeHtml(q.car_brand || '')} ${this.escapeHtml(q.car_model || '')}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${q.car_size || 'M'} 級距</div>
        </td>
        <td style="font-size: 13px; color: var(--text-secondary); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${this.escapeHtml(itemSummary || '無項目')}
        </td>
        <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; color: var(--text-heading); font-size: 15px;">
          NT$ ${this.formatNumber(q.total_price)}
        </td>
        <td>
          <span class="status-badge ${q.status}">${this.formatStatus(q.status)}</span>
        </td>
        <td style="text-align: center;">
          <div style="display: flex; gap: 6px; justify-content: center;">
            <button class="btn btn-primary btn-sm" onclick="app.viewQuoteById(${q.id})" title="檢視報價單並匯出 JPG 圖片或 PDF">
              檢視 / 匯出
            </button>
            <button class="btn btn-secondary btn-sm" onclick="app.duplicateQuote(${q.id})" title="以此單資料開立新報價">
              複製
            </button>
            <button class="btn btn-secondary btn-sm" onclick="app.reviseQuote(${q.id})" title="修訂新版本 (保留原單)" style="background: rgba(56, 189, 248, 0.1); border-color: rgba(56, 189, 248, 0.3); color: #38bdf8;">
              修訂
            </button>
            <select style="background: var(--bg-input); color: var(--text-secondary); border: 1px solid var(--border-subtle); border-radius: 4px; font-size: 12px; padding: 3px 6px;"
              onchange="app.updateQuoteStatus(${q.id}, this.value)">
              <option value="issued" ${q.status === 'issued' ? 'selected' : ''}>已開立</option>
              <option value="accepted" ${q.status === 'accepted' ? 'selected' : ''}>已成交</option>
              <option value="completed" ${q.status === 'completed' ? 'selected' : ''}>已完工</option>
              <option value="cancelled" ${q.status === 'cancelled' ? 'selected' : ''}>已作廢</option>
            </select>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  },

  async viewQuoteById(id) {
    const res = await this.api(`/api/quotes/${id}`);
    if (!res || !res.success) return;
    this.openPdfModal(res.data);
  },

  async duplicateQuote(id) {
    const res = await this.api(`/api/quotes/${id}`);
    if (!res || !res.success) return;
    const q = res.data;

    this.currentQuote = {
      id: null,
      mode: 'new',
      parent_quote_id: null,
      quote_number: '',
      version: 1,
      customer_name: q.customer_name,
      customer_phone: q.customer_phone,
      car_plate: q.car_plate,
      car_brand: q.car_brand,
      car_model: q.car_model,
      car_size: q.car_size || 'M',
      items: JSON.parse(JSON.stringify(q.items || [])),
      subtotal: q.subtotal,
      discount_type: q.discount_type,
      discount_value: q.discount_value,
      discount_amount: q.discount_amount,
      discount_note: q.discount_note,
      total_price: q.total_price,
      valid_date: '',
      notes: q.notes,
      status: 'issued'
    };

    this.initDefaultDates();
    this.navigate('new-quote');
    this.loadStateToForm();
    document.getElementById('quote-mode-badge').textContent = `複製自 ${q.quote_number}`;
    this.showToast(`已複製單據 ${q.quote_number} 之車輛與項目資料，可編輯後重新開單`, 'info');
  },

  async reviseQuote(id) {
    const res = await this.api(`/api/quotes/${id}`);
    if (!res || !res.success) return;
    const q = res.data;

    this.currentQuote = {
      id: q.id,
      mode: 'revise',
      parent_quote_id: q.id,
      quote_number: q.quote_number,
      version: q.version || 1,
      customer_name: q.customer_name,
      customer_phone: q.customer_phone,
      car_plate: q.car_plate,
      car_brand: q.car_brand,
      car_model: q.car_model,
      car_size: q.car_size || 'M',
      items: JSON.parse(JSON.stringify(q.items || [])),
      subtotal: q.subtotal,
      discount_type: q.discount_type,
      discount_value: q.discount_value,
      discount_amount: q.discount_amount,
      discount_note: q.discount_note,
      total_price: q.total_price,
      valid_date: q.valid_date,
      created_at: q.created_at,
      notes: q.notes,
      status: 'issued'
    };

    this.navigate('new-quote');
    this.loadStateToForm();
    document.getElementById('quote-mode-badge').textContent = `修訂版本 (原單 ${q.quote_number})`;
    document.getElementById('form-heading-text').querySelector('span:first-child').textContent = `修訂報價單 (存檔將產生新版本)`;
    this.showToast(`正在修訂 ${q.quote_number}。存檔時將自動建立新版本，原始版本將完整保留！`, 'info');
  },

  loadStateToForm() {
    const q = this.currentQuote;
    document.getElementById('quote-cust-name').value = q.customer_name || '';
    document.getElementById('quote-cust-phone').value = q.customer_phone || '';
    document.getElementById('quote-car-plate').value = q.car_plate || '';
    document.getElementById('quote-car-brand').value = q.car_brand || '';
    document.getElementById('quote-car-model').value = q.car_model || '';
    document.getElementById('quote-notes').value = q.notes || '';
    if (q.created_at) {
      document.getElementById('quote-created-date').value = q.created_at.slice(0, 10);
    }
    if (q.valid_date) document.getElementById('quote-valid-date').value = q.valid_date;

    this.selectCarSize(q.car_size || 'M');

    if (q.discount_type && q.discount_type !== 'none' && q.discount_amount > 0) {
      this.toggleDiscountPanel(true);
      this.setDiscountType(q.discount_type);
      document.getElementById('discount-value-input').value = q.discount_value;
      document.getElementById('discount-note-input').value = q.discount_note || '';
    } else {
      this.removeDiscount();
    }

    this.renderQuoteItems();
    this.calculateTotals();
  },

  async updateQuoteStatus(id, newStatus) {
    const res = await this.api(`/api/quotes/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus })
    });
    if (res && res.success) {
      this.showToast('報價單狀態已更新', 'success');
      this.fetchQuotes();
    }
  },

  exportHistoryCsv() {
    window.location.href = `/api/backup/quotes-csv?token=${this.token}`;
  },

  // ------------------------------------------------------------------------
  // Management & Settings View (價格與項目設定)
  // ------------------------------------------------------------------------
  switchAdminTab(tabName) {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.admin-sub-view').forEach(view => view.classList.remove('active'));

    const activeBtn = Array.from(document.querySelectorAll('.admin-tab-btn')).find(b => b.getAttribute('onclick').includes(tabName));
    if (activeBtn) activeBtn.classList.add('active');

    const activeView = document.getElementById(`admin-tab-${tabName}`);
    if (activeView) activeView.classList.add('active');

    if (tabName === 'matrix') {
      this.renderPriceMatrix();
    }
  },

  renderAdminAll() {
    this.renderAdminParts();
    this.renderAdminMaterials();
    this.renderAdminVehicles();
    this.renderPriceMatrix();
    this.populateAdminStoreSettings();
  },

  renderAdminParts() {
    const catSelect = document.getElementById('new-part-cat');
    if (catSelect) {
      catSelect.innerHTML = '';
      this.catalog.categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        catSelect.appendChild(opt);
      });
    }

    const tbody = document.getElementById('admin-parts-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    this.catalog.parts.forEach(p => {
      const cat = this.catalog.categories.find(c => c.id === p.category_id);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge-tag">${this.escapeHtml(cat ? cat.name : '未分類')}</span></td>
        <td style="font-weight: 600; color: var(--text-heading);">${this.escapeHtml(p.name)}</td>
        <td style="color: var(--text-muted); font-size: 13px;">${this.escapeHtml(p.description || '')}</td>
        <td>
          <button class="btn btn-outline btn-sm" style="color: #f87171;" onclick="app.deletePart(${p.id})">停用</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  },

  async createPart() {
    const catId = Number(document.getElementById('new-part-cat').value);
    const name = document.getElementById('new-part-name').value.trim();
    const desc = document.getElementById('new-part-desc').value.trim();

    if (!name) {
      this.showToast('請輸入施工部位名稱', 'warning');
      return;
    }

    const res = await this.api('/api/catalog/parts', {
      method: 'POST',
      body: JSON.stringify({ category_id: catId, name, description: desc })
    });

    if (res && res.success) {
      this.showToast('施工部位已新增！', 'success');
      document.getElementById('new-part-name').value = '';
      document.getElementById('new-part-desc').value = '';
      await this.loadCatalog();
      this.renderAdminParts();
    }
  },

  async deletePart(id) {
    if (!confirm('確定要停用此施工部位嗎？')) return;
    const res = await this.api(`/api/catalog/parts/${id}`, { method: 'DELETE' });
    if (res && res.success) {
      this.showToast('已停用此施工部位', 'success');
      await this.loadCatalog();
      this.renderAdminParts();
    }
  },

  renderAdminMaterials() {
    const catSelect = document.getElementById('new-mat-cat');
    if (catSelect) {
      catSelect.innerHTML = '';
      this.catalog.categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        catSelect.appendChild(opt);
      });
    }

    const tbody = document.getElementById('admin-materials-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    this.catalog.materials.forEach(m => {
      const cat = this.catalog.categories.find(c => c.id === m.category_id);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge-tag">${this.escapeHtml(cat ? cat.name : '未分類')}</span></td>
        <td style="font-weight: 700; color: var(--text-heading);">${this.escapeHtml(m.brand)}</td>
        <td style="color: var(--silver-accent); font-weight: 500;">${this.escapeHtml(m.series)}</td>
        <td>${m.warranty_years} 年原廠責任</td>
        <td>
          <button class="btn btn-outline btn-sm" style="color: #f87171;" onclick="app.deleteMaterial(${m.id})">停用</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  },

  async createMaterial() {
    const catId = Number(document.getElementById('new-mat-cat').value);
    const brand = document.getElementById('new-mat-brand').value.trim();
    const series = document.getElementById('new-mat-series').value.trim();
    const warranty = Number(document.getElementById('new-mat-warranty').value) || 5;

    if (!brand || !series) {
      this.showToast('請輸入品牌與系列名稱', 'warning');
      return;
    }

    const res = await this.api('/api/catalog/materials', {
      method: 'POST',
      body: JSON.stringify({ category_id: catId, brand, series, warranty_years: warranty })
    });

    if (res && res.success) {
      this.showToast('膜料規格已新增！', 'success');
      document.getElementById('new-mat-brand').value = '';
      document.getElementById('new-mat-series').value = '';
      await this.loadCatalog();
      this.renderAdminMaterials();
    }
  },

  async deleteMaterial(id) {
    if (!confirm('確定要停用此膜料規格嗎？')) return;
    const res = await this.api(`/api/catalog/materials/${id}`, { method: 'DELETE' });
    if (res && res.success) {
      this.showToast('已停用此膜料規格', 'success');
      await this.loadCatalog();
      this.renderAdminMaterials();
    }
  },

  renderAdminVehicles() {
    const tbody = document.getElementById('admin-vehicles-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    this.catalog.vehicles.forEach(v => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600; color: var(--text-heading);">${this.escapeHtml(v.brand)}</td>
        <td>${this.escapeHtml(v.model)}</td>
        <td>
          <span class="badge-tag" style="font-weight: 700; color: var(--text-heading);">${v.size_class} 級距</span>
        </td>
        <td>
          <button class="btn btn-outline btn-sm" style="color: #f87171;" onclick="app.deleteVehicle(${v.id})">刪除</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  },

  async createVehicle() {
    const brand = document.getElementById('new-veh-brand').value.trim();
    const model = document.getElementById('new-veh-model').value.trim();
    const size = document.getElementById('new-veh-size').value;

    if (!brand || !model) {
      this.showToast('請輸入廠牌與車型', 'warning');
      return;
    }

    const res = await this.api('/api/catalog/vehicles', {
      method: 'POST',
      body: JSON.stringify({ brand, model, size_class: size })
    });

    if (res && res.success) {
      this.showToast('車型分類已新增！', 'success');
      document.getElementById('new-veh-brand').value = '';
      document.getElementById('new-veh-model').value = '';
      await this.loadCatalog();
      this.renderAdminVehicles();
    }
  },

  async deleteVehicle(id) {
    if (!confirm('確定要刪除此車型嗎？')) return;
    const res = await this.api(`/api/catalog/vehicles/${id}`, { method: 'DELETE' });
    if (res && res.success) {
      this.showToast('車型已刪除', 'success');
      await this.loadCatalog();
      this.renderAdminVehicles();
    }
  },

  // Price Matrix
  renderPriceMatrix() {
    const tbody = document.getElementById('admin-matrix-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Map existing price rules
    const priceMap = {};
    for (const r of this.catalog.priceRules) {
      priceMap[`${r.part_id}_${r.material_id}_${r.size_class}`] = r.price;
    }

    // List active parts
    for (const p of this.catalog.parts) {
      // Find matching materials in same category
      const matchedMats = this.catalog.materials.filter(m => m.category_id === p.category_id);
      for (const m of matchedMats) {
        const tr = document.createElement('tr');
        const sPrice = priceMap[`${p.id}_${m.id}_S`] || '';
        const mPrice = priceMap[`${p.id}_${m.id}_M`] || '';
        const lPrice = priceMap[`${p.id}_${m.id}_L`] || '';
        const xlPrice = priceMap[`${p.id}_${m.id}_XL`] || '';

        tr.innerHTML = `
          <td>
            <div style="font-weight: 600; color: var(--text-heading);">${this.escapeHtml(p.name)}</div>
          </td>
          <td>
            <div style="color: var(--text-secondary); font-size: 13px;">${this.escapeHtml(m.brand)} - ${this.escapeHtml(m.series)}</div>
          </td>
          <td>
            <input type="number" class="matrix-input" data-part="${p.id}" data-mat="${m.id}" data-size="S" value="${sPrice}" placeholder="未定價">
          </td>
          <td>
            <input type="number" class="matrix-input" data-part="${p.id}" data-mat="${m.id}" data-size="M" value="${mPrice}" placeholder="未定價">
          </td>
          <td>
            <input type="number" class="matrix-input" data-part="${p.id}" data-mat="${m.id}" data-size="L" value="${lPrice}" placeholder="未定價">
          </td>
          <td>
            <input type="number" class="matrix-input" data-part="${p.id}" data-mat="${m.id}" data-size="XL" value="${xlPrice}" placeholder="未定價">
          </td>
        `;
        tbody.appendChild(tr);
      }
    }
  },

  async savePriceMatrix() {
    const inputs = document.querySelectorAll('.matrix-input');
    const rules = [];

    inputs.forEach(input => {
      const partId = Number(input.getAttribute('data-part'));
      const matId = Number(input.getAttribute('data-mat'));
      const sizeClass = input.getAttribute('data-size');
      const price = Number(input.value);

      if (!isNaN(price) && price > 0) {
        rules.push({ part_id: partId, material_id: matId, size_class: sizeClass, price });
      }
    });

    const res = await this.api('/api/catalog/prices', {
      method: 'POST',
      body: JSON.stringify({ rules })
    });

    if (res && res.success) {
      this.showToast(res.message || '價格矩陣已更新儲存！', 'success');
      await this.loadCatalog();
    }
  },

  populateAdminStoreSettings() {
    const s = this.catalog.settings || {};
    if (document.getElementById('setting-company-name')) {
      document.getElementById('setting-company-name').value = s.company_name || '';
      document.getElementById('setting-company-phone').value = s.company_phone || '';
      document.getElementById('setting-company-address').value = s.company_address || '';
      document.getElementById('setting-company-line').value = s.company_line || '';
      document.getElementById('setting-company-tax-id').value = s.company_tax_id || '';
      document.getElementById('setting-valid-days').value = s.quote_valid_days || '15';
      document.getElementById('setting-quote-terms').value = s.quote_terms || '';
    }
  },

  async saveSettings() {
    const payload = {
      company_name: document.getElementById('setting-company-name').value.trim(),
      company_phone: document.getElementById('setting-company-phone').value.trim(),
      company_address: document.getElementById('setting-company-address').value.trim(),
      company_line: document.getElementById('setting-company-line').value.trim(),
      company_tax_id: document.getElementById('setting-company-tax-id').value.trim(),
      quote_valid_days: document.getElementById('setting-valid-days').value.trim(),
      quote_terms: document.getElementById('setting-quote-terms').value.trim()
    };

    const res = await this.api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    if (res && res.success) {
      this.showToast('門市資訊與條款已成功儲存！', 'success');
      await this.loadCatalog();
    }
  },

  // Backup & Restore
  exportJsonBackup() {
    window.location.href = `/api/backup/export?token=${this.token}`;
  },

  async importJsonBackup() {
    const fileInput = document.getElementById('backup-file-input');
    if (!fileInput.files || fileInput.files.length === 0) {
      this.showToast('請選取要還原的 JSON 備份檔', 'warning');
      return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target.result);
        if (!confirm('執行還原將覆蓋現有項目與價格設定，確定要繼續嗎？')) return;

        const res = await this.api('/api/backup/import', {
          method: 'POST',
          body: JSON.stringify(json)
        });

        if (res && res.success) {
          this.showToast('資料庫已成功還原！', 'success');
          await this.loadCatalog();
          await this.fetchQuotes();
          this.renderAdminAll();
        } else {
          this.showToast(res?.message || '還原失敗', 'error');
        }
      } catch (err) {
        this.showToast('備份檔案解析失敗，非有效 JSON 格式', 'error');
      }
    };

    reader.readAsText(file);
  },

  // ------------------------------------------------------------------------
  // Utilities & Helpers
  // ------------------------------------------------------------------------
  formatNumber(num) {
    if (isNaN(num)) return '0';
    return Number(num).toLocaleString('zh-TW');
  },

  formatStatus(status) {
    const map = {
      issued: '已開立',
      accepted: '已成交',
      completed: '已完工',
      cancelled: '已作廢',
      draft: '草稿'
    };
    return map[status] || status;
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.style.padding = '12px 18px';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '14px';
    toast.style.fontWeight = '500';
    toast.style.color = '#fff';
    toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.6)';
    toast.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '10px';
    toast.style.zIndex = '99999';

    if (type === 'success') {
      toast.style.background = '#10b981';
      toast.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> ${message}`;
    } else if (type === 'warning') {
      toast.style.background = '#f59e0b';
      toast.style.color = '#000';
      toast.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> ${message}`;
    } else if (type === 'error') {
      toast.style.background = '#ef4444';
      toast.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> ${message}`;
    } else {
      toast.style.background = '#1e2430';
      toast.style.border = '1px solid #333d4e';
      toast.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg> ${message}`;
    }

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  },

  // ------------------------------------------------------------------------
  // Warranty Card System Integration
  // ------------------------------------------------------------------------
  warrantyPresets: { brands: [], models: [] },
  editingWarrantyId: null,
  warrantySearchTimer: null,

  initWarrantyView() {
    this.initWarrantyDates();
    this.loadWarrantyPresets();
    this.loadWarrantyRecords();
    this.updateWarrantyLivePreview();
  },

  initWarrantyDates() {
    const today = new Date().toISOString().slice(0, 10);
    const dateInput = document.getElementById('w-completion-date');
    if (dateInput && !dateInput.value) {
      dateInput.value = today;
    }
  },

  switchWarrantyTab(tabName) {
    document.querySelectorAll('.warranty-subtab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.warranty-subview').forEach(v => v.classList.remove('active'));

    const tabBtn = document.getElementById(`wtab-btn-${tabName}`);
    const subview = document.getElementById(`wsub-${tabName}`);
    if (tabBtn) tabBtn.classList.add('active');
    if (subview) subview.classList.add('active');

    if (tabName === 'history') {
      this.loadWarrantyRecords();
    } else if (tabName === 'presets') {
      this.loadWarrantyPresets();
    }
  },

  async loadWarrantyPresets() {
    const res = await this.api('/api/warranty/presets');
    if (res && res.success) {
      this.warrantyPresets = res;
      this.renderWarrantyPresetPills();
      this.renderWarrantyPresetAdmin();
    }
  },

  renderWarrantyPresetPills() {
    const brandContainer = document.getElementById('w-brand-pills');
    const modelContainer = document.getElementById('w-model-pills');

    if (brandContainer) {
      brandContainer.innerHTML = (this.warrantyPresets.brands || []).map(b => `
        <span class="w-pill" onclick="app.setWarrantyField('w-service-brand', '${this.escapeHtml(b.name)}')">${this.escapeHtml(b.name)}</span>
      `).join('');
    }

    if (modelContainer) {
      modelContainer.innerHTML = (this.warrantyPresets.models || []).map(m => `
        <span class="w-pill" onclick="app.setWarrantyField('w-service-model', '${this.escapeHtml(m.name)}')">${this.escapeHtml(m.name)}</span>
      `).join('');
    }
  },

  renderWarrantyPresetAdmin() {
    const brandList = document.getElementById('w-preset-brands-list');
    const modelList = document.getElementById('w-preset-models-list');

    if (brandList) {
      brandList.innerHTML = (this.warrantyPresets.brands || []).map(b => `
        <li class="w-preset-item">
          <span>${this.escapeHtml(b.name)}</span>
          <button type="button" class="btn-del-w-preset" onclick="app.deleteWarrantyPreset(${b.id}, '${this.escapeHtml(b.name)}')">✕</button>
        </li>
      `).join('') || '<li style="color: var(--text-muted); font-size: 13px;">尚無品牌選項</li>';
    }

    if (modelList) {
      modelList.innerHTML = (this.warrantyPresets.models || []).map(m => `
        <li class="w-preset-item">
          <span>${this.escapeHtml(m.name)}</span>
          <button type="button" class="btn-del-w-preset" onclick="app.deleteWarrantyPreset(${m.id}, '${this.escapeHtml(m.name)}')">✕</button>
        </li>
      `).join('') || '<li style="color: var(--text-muted); font-size: 13px;">尚無型號選項</li>';
    }
  },

  async addWarrantyPreset(type) {
    const inputId = type === 'brand' ? 'w-new-brand-input' : 'w-new-model-input';
    const input = document.getElementById(inputId);
    const name = input ? input.value.trim() : '';
    if (!name) return;

    const res = await this.api('/api/warranty/presets', {
      method: 'POST',
      body: { type, name }
    });

    if (res && res.success) {
      input.value = '';
      this.showToast(`已新增常用選項：${name}`, 'success');
      await this.loadWarrantyPresets();
    } else {
      this.showToast(res?.message || '新增失敗', 'error');
    }
  },

  async deleteWarrantyPreset(id, name) {
    if (!confirm(`確定要刪除「${name}」常用選項嗎？`)) return;
    const res = await this.api(`/api/warranty/presets/${id}`, { method: 'DELETE' });
    if (res && res.success) {
      this.showToast(`已刪除選項：${name}`);
      await this.loadWarrantyPresets();
    }
  },

  setWarrantyField(fieldId, val) {
    const el = document.getElementById(fieldId);
    if (el) {
      el.value = val;
      this.updateWarrantyLivePreview();
      el.focus();
    }
  },

  getWarrantyFormData() {
    return {
      quote_id: document.getElementById('w-linked-quote-id')?.value || null,
      customer_name: (document.getElementById('w-customer-name')?.value || '').trim(),
      customer_phone: (document.getElementById('w-customer-phone')?.value || '').trim(),
      car_model: (document.getElementById('w-car-model')?.value || '').trim(),
      completion_date: (document.getElementById('w-completion-date')?.value || '').trim(),
      license_plate: (document.getElementById('w-license-plate')?.value || '').toUpperCase().trim(),
      original_color: (document.getElementById('w-original-color')?.value || '').trim(),
      service_brand: (document.getElementById('w-service-brand')?.value || '').trim(),
      service_model: (document.getElementById('w-service-model')?.value || '').trim(),
      notes: (document.getElementById('w-notes')?.value || '').trim()
    };
  },

  updateWarrantyLivePreview() {
    const data = this.getWarrantyFormData();
    const formattedDate = (data.completion_date || '').replace(/-/g, '/');

    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val || '';
    };

    setText('w-render-customer-name', data.customer_name);
    setText('w-render-license-plate', data.license_plate);
    setText('w-render-customer-phone', data.customer_phone);
    setText('w-render-original-color', data.original_color);
    setText('w-render-car-model', data.car_model);
    setText('w-render-service-brand', data.service_brand);
    setText('w-render-completion-date', formattedDate);
    setText('w-render-service-model', data.service_model);
  },

  fillWarrantyDemoData() {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    setVal('w-customer-name', '郭書豪');
    setVal('w-license-plate', 'EBK-1505');
    setVal('w-customer-phone', '0900000000');
    setVal('w-original-color', '白');
    setVal('w-car-model', 'Tesla Model Y');
    setVal('w-completion-date', '2025-11-19');
    setVal('w-service-brand', 'AX Film');
    setVal('w-service-model', '超啞灰藍');
    setVal('w-notes', '全車消光保護膜＋迎風面防護');
    this.updateWarrantyLivePreview();
    this.showToast('已帶入保固卡示範資料');
  },

  resetWarrantyForm() {
    this.editingWarrantyId = null;
    document.getElementById('w-editing-record-id').value = '';
    document.getElementById('w-linked-quote-id').value = '';
    document.getElementById('w-form-mode-title').textContent = '填寫車主與施工資訊';
    document.getElementById('w-btn-save-text').textContent = '儲存保固卡紀錄';
    document.getElementById('w-cancel-edit-box').style.display = 'none';

    const fields = [
      'w-customer-name', 'w-license-plate', 'w-customer-phone',
      'w-original-color', 'w-car-model', 'w-service-brand',
      'w-service-model', 'w-notes'
    ];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    this.initWarrantyDates();
    this.updateWarrantyLivePreview();
  },

  async saveWarrantyRecord() {
    const data = this.getWarrantyFormData();
    if (!data.customer_name) {
      alert('請填寫車主姓名');
      document.getElementById('w-customer-name')?.focus();
      return;
    }
    if (!data.license_plate) {
      alert('請填寫車主車牌');
      document.getElementById('w-license-plate')?.focus();
      return;
    }

    const saveBtn = document.getElementById('w-btn-save-record');
    const oldText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span>⏳ 儲存中...</span>';

    try {
      let res;
      if (this.editingWarrantyId) {
        res = await this.api(`/api/warranty/records/${this.editingWarrantyId}`, {
          method: 'PUT',
          body: data
        });
      } else {
        res = await this.api('/api/warranty/records', {
          method: 'POST',
          body: data
        });
      }

      if (res && res.success) {
        this.showToast(this.editingWarrantyId ? '保固卡資料已更新！' : `保固卡建立成功！編號：${res.record.record_no}`, 'success');
        this.loadWarrantyRecords();
      } else {
        this.showToast(res?.message || '儲存失敗', 'error');
      }
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = oldText;
    }
  },

  async downloadWarrantyFormPDF() {
    const data = this.getWarrantyFormData();
    if (!data.customer_name || !data.license_plate) {
      if (!confirm('車主姓名或車牌尚未填寫，確定要直接下載未填完的保固卡嗎？')) return;
    }

    try {
      this.showToast('正在產生高解析向量 PDF...');
      const res = await fetch('/api/warranty/pdf/download-form', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify(data)
      });

      if (!res.ok) throw new Error('下載 PDF 失敗');
      const blob = await res.blob();
      const name = data.customer_name || '車主';
      const plate = (data.license_plate || '車牌').toUpperCase();
      const date = (data.completion_date || '').replace(/\//g, '-');
      const filename = `保固卡_${name}_${plate}_${date}.pdf`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
      this.showToast('保固卡向量 PDF 下載完成！', 'success');
    } catch (err) {
      this.showToast(err.message || '下載失敗', 'error');
    }
  },

  async printWarrantyCard() {
    const data = this.getWarrantyFormData();
    try {
      this.showToast('正在開啟列印視窗...');
      const res = await fetch('/api/warranty/pdf/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('產生列印檔失敗');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.focus();
      }
    } catch (err) {
      this.showToast(err.message || '開啟列印失敗', 'error');
    }
  },

  async openWarrantyFullPdf() {
    const data = this.getWarrantyFormData();
    try {
      this.showToast('正在產生全尺寸 PDF 預覽...');
      const res = await fetch('/api/warranty/pdf/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('預覽失敗');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      this.showToast(err.message || '預覽失敗', 'error');
    }
  },

  onWarrantySearchInput() {
    const input = document.getElementById('w-search-input');
    const clearBtn = document.getElementById('w-clear-search-btn');
    if (clearBtn) clearBtn.style.display = input.value ? 'block' : 'none';

    clearTimeout(this.warrantySearchTimer);
    this.warrantySearchTimer = setTimeout(() => {
      this.loadWarrantyRecords(input.value);
    }, 250);
  },

  clearWarrantySearch() {
    const input = document.getElementById('w-search-input');
    const clearBtn = document.getElementById('w-clear-search-btn');
    if (input) input.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    this.loadWarrantyRecords();
  },

  async loadWarrantyRecords(query = '') {
    const tbody = document.getElementById('w-records-tbody');
    const countBadge = document.getElementById('w-badge-record-count');
    if (!tbody) return;

    const endpoint = query ? `/api/warranty/records?q=${encodeURIComponent(query)}` : '/api/warranty/records';
    const res = await this.api(endpoint);

    if (!res || !res.success) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #ef4444; padding: 30px;">載入保固卡失敗</td></tr>`;
      return;
    }

    if (countBadge) countBadge.textContent = res.count;

    if (!res.records || res.records.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 40px;">
            ${query ? `找不到與「${this.escapeHtml(query)}」相關的保固卡紀錄` : '目前尚無保固卡紀錄，點選上方「新增保固卡」開始開立'}
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = res.records.map(r => `
      <tr>
        <td><code style="font-size: 11px;">${this.escapeHtml(r.record_no)}</code></td>
        <td><span class="w-plate-badge">${this.escapeHtml(r.license_plate)}</span></td>
        <td><strong>${this.escapeHtml(r.customer_name)}</strong></td>
        <td>${this.escapeHtml(r.customer_phone || '-')}</td>
        <td>${this.escapeHtml(r.car_model || '-')}</td>
        <td>
          <span style="font-size: 12px; font-weight: 600;">${this.escapeHtml(r.service_brand || '-')}</span>
          <div style="font-size: 11px; color: var(--text-muted);">${this.escapeHtml(r.service_model || '-')}</div>
        </td>
        <td>${this.escapeHtml((r.completion_date || '').replace(/-/g, '/'))}</td>
        <td><span style="font-size: 11px; color: var(--text-muted);">${this.escapeHtml(r.created_by)}</span></td>
        <td>
          <div style="display: flex; gap: 4px; justify-content: center;">
            <button type="button" class="btn btn-sm w-reprint-btn" title="一鍵重印原始保固卡 PDF" onclick="app.reprintWarrantyRecord(${r.id}, '${this.escapeHtml(r.customer_name)}', '${this.escapeHtml(r.license_plate)}', '${this.escapeHtml(r.completion_date)}')">
              🖨️ 重印
            </button>
            <button type="button" class="btn btn-secondary btn-sm" title="編輯修改資料" onclick="app.editWarrantyRecord(${r.id})">
              ✏️ 編輯
            </button>
            <button type="button" class="btn btn-secondary btn-sm" title="查看修改紀錄與履歷" onclick="app.viewWarrantyAudit(${r.id})">
              🕒 履歷
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="color: #ef4444;" title="刪除" onclick="app.deleteWarrantyRecord(${r.id}, '${this.escapeHtml(r.record_no)}')">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  },

  async reprintWarrantyRecord(id, name, plate, date) {
    try {
      this.showToast(`正在產生【${plate}】保固卡 PDF...`);
      const res = await fetch(`/api/warranty/pdf/download/${id}`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (!res.ok) throw new Error('下載保固卡失敗');
      const blob = await res.blob();
      const filename = `保固卡_${name}_${plate}_${(date || '').replace(/\//g, '-')}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
      this.showToast(`已成功下載並重印【${plate}】保固卡！`, 'success');
      this.loadWarrantyRecords(document.getElementById('w-search-input')?.value || '');
    } catch (err) {
      this.showToast(err.message || '重印失敗', 'error');
    }
  },

  async editWarrantyRecord(id) {
    const res = await this.api(`/api/warranty/records/${id}`);
    if (!res || !res.success) {
      this.showToast('讀取保固卡失敗', 'error');
      return;
    }

    const r = res.record;
    this.editingWarrantyId = r.id;
    document.getElementById('w-editing-record-id').value = r.id;
    document.getElementById('w-linked-quote-id').value = r.quote_id || '';
    document.getElementById('w-form-mode-title').textContent = `修改保固卡資料（編號：${r.record_no}）`;
    document.getElementById('w-btn-save-text').textContent = '儲存修改資料';
    document.getElementById('w-cancel-edit-box').style.display = 'block';

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };

    setVal('w-customer-name', r.customer_name);
    setVal('w-license-plate', r.license_plate);
    setVal('w-customer-phone', r.customer_phone);
    setVal('w-original-color', r.original_color);
    setVal('w-car-model', r.car_model);
    setVal('w-completion-date', (r.completion_date || '').replace(/\//g, '-'));
    setVal('w-service-brand', r.service_brand);
    setVal('w-service-model', r.service_model);
    setVal('w-notes', r.notes);

    this.updateWarrantyLivePreview();
    this.switchWarrantyTab('create');
    this.showToast(`已載入【${r.license_plate}】保固卡資料至編輯區`);
  },

  async viewWarrantyAudit(id) {
    const res = await this.api(`/api/warranty/records/${id}`);
    if (!res || !res.success) {
      this.showToast('讀取異動履歷失敗', 'error');
      return;
    }

    const modal = document.getElementById('w-audit-modal');
    const title = document.getElementById('w-audit-modal-title');
    const badge = document.getElementById('w-audit-modal-badge');
    const timeline = document.getElementById('w-audit-timeline');

    title.textContent = `保固卡履歷：${res.record.license_plate}（${res.record.customer_name}）`;
    badge.textContent = res.record.record_no;

    const fieldLabels = {
      customer_name: '車主姓名',
      customer_phone: '車主電話',
      car_model: '車型車種',
      completion_date: '完工日期',
      license_plate: '車主車牌',
      original_color: '原始車色',
      service_brand: '施工品牌',
      service_model: '施工型號',
      notes: '廠內備註'
    };

    if (!res.logs || res.logs.length === 0) {
      timeline.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">尚無異動紀錄</div>';
    } else {
      timeline.innerHTML = res.logs.map(log => {
        let diffHtml = '';
        try {
          const parsed = JSON.parse(log.changes_json || '{}');
          if (log.action === 'UPDATE') {
            const lines = Object.entries(parsed).map(([key, val]) => `
              <div class="diff-line">
                <span class="diff-field-name">${fieldLabels[key] || key}</span>
                <span class="diff-from">${this.escapeHtml(val.from || '（空白）')}</span>
                <span class="diff-arrow">➔</span>
                <span class="diff-to">${this.escapeHtml(val.to || '（空白）')}</span>
              </div>
            `).join('');
            diffHtml = `<div class="w-timeline-diffs">${lines}</div>`;
          } else if (log.action === 'REPRINT') {
            diffHtml = `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">門市人員重新產出並下載/列印 PDF</div>`;
          }
        } catch (e) {}

        const actionText = log.action === 'CREATE' ? '✨ 建立新保固卡' : log.action === 'UPDATE' ? '✏️ 修改客戶資料' : '🖨️ 重新列印保固卡';

        return `
          <div class="w-timeline-item">
            <div class="w-timeline-dot"></div>
            <div class="w-timeline-header">
              <span class="w-action-tag">${actionText}</span>
              <span>經辦人：${this.escapeHtml(log.changed_by)}</span>
            </div>
            <div class="w-timeline-time">${new Date(log.changed_at).toLocaleString('zh-TW', { hour12: false })}</div>
            ${diffHtml}
          </div>
        `;
      }).join('');
    }

    modal.style.display = 'block';
  },

  closeWarrantyAuditModal() {
    const modal = document.getElementById('w-audit-modal');
    if (modal) modal.style.display = 'none';
  },

  async deleteWarrantyRecord(id, recordNo) {
    if (!confirm(`確定要刪除保固卡【${recordNo}】嗎？此操作無法復原！`)) return;
    const res = await this.api(`/api/warranty/records/${id}`, { method: 'DELETE' });
    if (res && res.success) {
      this.showToast(`已刪除保固卡 ${recordNo}`);
      this.loadWarrantyRecords(document.getElementById('w-search-input')?.value || '');
    } else {
      this.showToast(res?.message || '刪除失敗', 'error');
    }
  },

  convertCurrentQuoteToWarranty() {
    this.closePdfModal();
    const q = this.previewQuoteData || this.currentQuote;
    if (!q) {
      this.showToast('無法取得目前報價單資料', 'error');
      return;
    }

    this.navigate('warranty');
    this.switchWarrantyTab('create');
    this.resetWarrantyForm();

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };

    setVal('w-linked-quote-id', q.id || '');
    setVal('w-customer-name', q.customer_name);
    setVal('w-customer-phone', q.customer_phone);
    setVal('w-license-plate', q.car_plate);
    setVal('w-car-model', `${q.car_brand || ''} ${q.car_model || ''}`.trim());

    let items = [];
    if (Array.isArray(q.items)) {
      items = q.items;
    } else if (q.items_json) {
      try { items = JSON.parse(q.items_json); } catch (e) {}
    }

    if (items.length > 0) {
      const firstItem = items[0];
      const matName = firstItem.material_name || '';
      if (matName.includes(' - ')) {
        const parts = matName.split(' - ');
        setVal('w-service-brand', parts[0].trim());
        setVal('w-service-model', parts[1].trim());
      } else {
        setVal('w-service-brand', matName);
        setVal('w-service-model', firstItem.note || firstItem.part_name || '');
      }
    }

    this.updateWarrantyLivePreview();
    this.showToast(`已將報價單【${q.quote_number || ''}】資料帶入保固卡！`, 'success');
  },

  // ========================================================================
  // VIEW 5: DEPOSIT RECEIPT MODULE LOGIC (定金收據)
  // ========================================================================
  initDepositView() {
    const dateEl = document.getElementById('d-receipt-date');
    if (dateEl && !dateEl.value) {
      dateEl.value = new Date().toISOString().split('T')[0];
    }
    this.onDepositPaymentChange();
    this.updateDepositLivePreview();
    this.loadDepositRecordsCount();
  },

  switchDepositTab(tab) {
    const btnCreate = document.getElementById('dtab-btn-create');
    const btnHist = document.getElementById('dtab-btn-history');
    const viewCreate = document.getElementById('dsub-create');
    const viewHist = document.getElementById('dsub-history');

    if (tab === 'create') {
      if (btnCreate) btnCreate.classList.add('active');
      if (btnHist) btnHist.classList.remove('active');
      if (viewCreate) viewCreate.classList.add('active');
      if (viewHist) viewHist.classList.remove('active');
    } else {
      if (btnCreate) btnCreate.classList.remove('active');
      if (btnHist) btnHist.classList.add('active');
      if (viewCreate) viewCreate.classList.remove('active');
      if (viewHist) viewHist.classList.add('active');
      this.loadDepositRecords();
    }
  },

  onDepositPaymentChange() {
    const radio = document.querySelector('input[name="d-payment-type"]:checked');
    const isTransfer = radio && radio.value === '匯款';
    
    const optCash = document.getElementById('pay-opt-cash');
    const optTransfer = document.getElementById('pay-opt-transfer');
    if (optCash) optCash.classList.toggle('active', !isTransfer);
    if (optTransfer) optTransfer.classList.toggle('active', isTransfer);

    const transferGrp = document.getElementById('transfer-last5-group');
    if (transferGrp) {
      transferGrp.style.display = isTransfer ? 'block' : 'none';
    }

    this.updateDepositLivePreview();
  },

  setDepositAmount(amount) {
    const el = document.getElementById('d-deposit-amount');
    if (el) {
      el.value = amount;
      this.updateDepositLivePreview();
    }
  },

  setDepositField(id, val) {
    const el = document.getElementById(id);
    if (el) {
      el.value = val;
      this.updateDepositLivePreview();
    }
  },

  numberToChineseCurrency(num) {
    const n = Math.floor(Math.abs(Number(num) || 0));
    if (n === 0) return '新台幣 零元整';

    const digits = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
    const units = ['', '拾', '佰', '仟'];
    const bigUnits = ['', '萬', '億'];

    let numStr = n.toString();
    let result = '';
    let zeroFlag = false;

    // Split into 4-digit groups from right
    const chunks = [];
    while (numStr.length > 0) {
      chunks.push(numStr.slice(-4));
      numStr = numStr.slice(0, -4);
    }

    for (let i = chunks.length - 1; i >= 0; i--) {
      const chunk = chunks[i];
      let chunkStr = '';
      let chunkHasNonZero = false;

      for (let j = 0; j < chunk.length; j++) {
        const digit = parseInt(chunk[j], 10);
        const unitPos = chunk.length - 1 - j;

        if (digit !== 0) {
          if (zeroFlag) {
            chunkStr += '零';
            zeroFlag = false;
          }
          chunkStr += digits[digit] + units[unitPos];
          chunkHasNonZero = true;
        } else {
          if (chunkHasNonZero) {
            zeroFlag = true;
          }
        }
      }

      if (chunkHasNonZero) {
        result += chunkStr + bigUnits[i];
      }
    }

    return `新台幣 ${result}元整`;
  },

  updateDepositLivePreview() {
    const name = document.getElementById('d-customer-name')?.value.trim() || '客戶姓名';
    const phone = document.getElementById('d-customer-phone')?.value.trim() || '0900-000-000';
    const plate = document.getElementById('d-car-plate')?.value.trim() || '未填寫車牌';
    const model = document.getElementById('d-car-model')?.value.trim() || '依合約預約車款';
    const rawAmt = parseInt(document.getElementById('d-deposit-amount')?.value, 10);
    const amount = isNaN(rawAmt) ? 0 : rawAmt;
    const radio = document.querySelector('input[name="d-payment-type"]:checked');
    const paymentMethod = radio ? radio.value : '現金';
    const transferLast5 = document.getElementById('d-transfer-last5')?.value.trim() || '';
    const dateVal = document.getElementById('d-receipt-date')?.value || new Date().toISOString().split('T')[0];
    const service = document.getElementById('d-service-item')?.value.trim() || '全車施工保護服務';
    const notes = document.getElementById('d-notes')?.value.trim() || '';
    const cashier = document.getElementById('d-created-by')?.value.trim() || '好室多膜 台北店';
    const terms = document.getElementById('d-terms-text')?.value.trim() || 
      '依民法第249條及雙方施工合約協議約定，本定金用於為貴車保留專屬施作檔期與材料備料。除因不可歸責於雙方當事人之事由致不能履行外，定金收訖後依照合約規定無法隨意退回，特此開立收據憑證。';

    // Chinese currency words
    const chineseWords = this.numberToChineseCurrency(amount);
    const chineseHint = document.getElementById('d-chinese-amount-preview');
    if (chineseHint) chineseHint.textContent = chineseWords;

    // Update Live Preview DOM
    const setNodeText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setNodeText('d-prev-customer-name', name);
    setNodeText('d-prev-customer-phone', phone);
    setNodeText('d-prev-car-plate', plate);
    setNodeText('d-prev-car-model', model);
    setNodeText('d-prev-service-item', service);
    setNodeText('d-prev-amount-digits', `NT$ ${amount.toLocaleString()}`);
    setNodeText('d-prev-amount-chinese', chineseWords);
    setNodeText('d-prev-receipt-date', dateVal.replace(/-/g, '/'));
    setNodeText('d-prev-cashier-sign', cashier);

    // Payment method presentation
    const badgeEl = document.getElementById('d-prev-payment-badge');
    const transferInfoBox = document.getElementById('d-prev-transfer-info');
    const transferText = document.getElementById('d-prev-transfer-text');

    if (paymentMethod === '現金') {
      if (badgeEl) badgeEl.textContent = '💵 門市現金收款 CASH';
      if (transferInfoBox) transferInfoBox.style.display = 'none';
    } else {
      if (badgeEl) badgeEl.textContent = '🏦 銀行匯款 / 轉帳 TRANSFER';
      if (transferInfoBox) {
        transferInfoBox.style.display = 'block';
        if (transferText) {
          transferText.textContent = transferLast5 ? `轉帳核對資訊：${transferLast5}` : '銀行線上匯款／無摺存款';
        }
      }
    }

    // Terms with bold emphasis on non-refundable contract rule
    const termsBody = document.getElementById('d-prev-terms-body');
    if (termsBody) {
      if (terms.includes('定金收訖後依照合約規定無法隨意退回')) {
        termsBody.innerHTML = terms.replace(
          '定金收訖後依照合約規定無法隨意退回',
          '<strong>定金收訖後依照合約規定無法隨意退回</strong>'
        );
      } else if (terms.includes('無法隨意退回')) {
        termsBody.innerHTML = terms.replace(
          '無法隨意退回',
          '<strong>無法隨意退回</strong>'
        );
      } else {
        termsBody.textContent = terms;
      }
    }

    // Notes line
    const notesLine = document.getElementById('d-prev-notes-line');
    const notesText = document.getElementById('d-prev-notes-text');
    if (notesLine && notesText) {
      if (notes) {
        notesLine.style.display = 'block';
        notesText.textContent = notes;
      } else {
        notesLine.style.display = 'none';
      }
    }
  },

  fillDepositDemoData() {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };

    setVal('d-customer-name', '郭書豪');
    setVal('d-customer-phone', '0912-345-678');
    setVal('d-car-plate', 'EBK-1505');
    setVal('d-car-model', 'Tesla Model Y');
    setVal('d-deposit-amount', 20000);
    setVal('d-service-item', '全車消光透明犀牛皮包膜 (PPF) + 車頂全景隔熱紙');
    setVal('d-receipt-date', new Date().toISOString().split('T')[0]);
    setVal('d-created-by', '好室多膜 台北旗艦店');
    setVal('d-notes', '預計下週二上午10:00進場施工，工期約3天');

    const cashRadio = document.querySelector('input[name="d-payment-type"][value="現金"]');
    if (cashRadio) {
      cashRadio.checked = true;
      this.onDepositPaymentChange();
    }

    this.updateDepositLivePreview();
    this.showToast('已填入示範定金收據資料！', 'success');
  },

  resetDepositForm() {
    const form = document.getElementById('depositReceiptForm');
    if (form) form.reset();

    const editIdEl = document.getElementById('d-editing-record-id');
    if (editIdEl) editIdEl.value = '';

    const quoteIdEl = document.getElementById('d-linked-quote-id');
    if (quoteIdEl) quoteIdEl.value = '';

    const modeTitle = document.getElementById('d-form-mode-title');
    if (modeTitle) modeTitle.textContent = '填寫定金收據資訊';

    const dateEl = document.getElementById('d-receipt-date');
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];

    const termsEl = document.getElementById('d-terms-text');
    if (termsEl) {
      termsEl.value = '依民法第249條及雙方施工合約協議約定，本定金用於為貴車保留專屬施作檔期與材料備料。除因不可歸責於雙方當事人之事由致不能履行外，定金收訖後依照合約規定無法隨意退回，特此開立收據憑證。';
    }

    const receiptNoPreview = document.getElementById('d-prev-receipt-no');
    if (receiptNoPreview) {
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      receiptNoPreview.textContent = `HW-DEP-${todayStr}-PREVIEW`;
    }

    this.onDepositPaymentChange();
    this.updateDepositLivePreview();
  },

  async saveDepositReceipt() {
    const name = document.getElementById('d-customer-name')?.value.trim();
    const phone = document.getElementById('d-customer-phone')?.value.trim();
    const amount = parseInt(document.getElementById('d-deposit-amount')?.value, 10);

    if (!name) {
      this.showToast('請填寫客戶姓名', 'warning');
      document.getElementById('d-customer-name')?.focus();
      return;
    }
    if (!phone) {
      this.showToast('請填寫客戶聯絡電話', 'warning');
      document.getElementById('d-customer-phone')?.focus();
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      this.showToast('請填寫正確的定金金額', 'warning');
      document.getElementById('d-deposit-amount')?.focus();
      return;
    }

    const editingId = document.getElementById('d-editing-record-id')?.value;
    const radio = document.querySelector('input[name="d-payment-type"]:checked');
    const paymentMethod = radio ? radio.value : '現金';

    const payload = {
      quote_id: document.getElementById('d-linked-quote-id')?.value || null,
      customer_name: name,
      customer_phone: phone,
      car_plate: document.getElementById('d-car-plate')?.value.trim() || '',
      car_model: document.getElementById('d-car-model')?.value.trim() || '',
      deposit_amount: amount,
      payment_method: paymentMethod,
      transfer_last5: document.getElementById('d-transfer-last5')?.value.trim() || '',
      receipt_date: document.getElementById('d-receipt-date')?.value || new Date().toISOString().split('T')[0],
      appointment_date: document.getElementById('d-appointment-date')?.value || '',
      service_item: document.getElementById('d-service-item')?.value.trim() || '',
      notes: document.getElementById('d-notes')?.value.trim() || '',
      terms_text: document.getElementById('d-terms-text')?.value.trim() || '',
      created_by: document.getElementById('d-created-by')?.value.trim() || '好室多膜 台北店'
    };

    let res;
    if (editingId) {
      res = await this.api(`/api/deposits/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    } else {
      res = await this.api('/api/deposits', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }

    if (res && res.success) {
      const receiptNo = res.receipt_no || (res.deposit ? res.deposit.receipt_no : '');
      const setNodeText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      if (receiptNo) setNodeText('d-prev-receipt-no', receiptNo);

      this.showToast(`定金收據【${receiptNo}】儲存成功！`, 'success');
      this.loadDepositRecordsCount();
      
      // Auto offer JPG download
      setTimeout(() => {
        if (confirm(`定金收據【${receiptNo}】已儲存！是否立即下載 JPG 圖片傳送給 LINE 客戶？`)) {
          this.downloadDepositJpg();
        }
      }, 350);
    } else {
      this.showToast(res?.message || '儲存失敗，請檢查網路連線', 'error');
    }
  },

  async downloadDepositJpg() {
    const target = document.getElementById('deposit-receipt-render');
    if (!target) return;

    if (!window.html2canvas) {
      this.showToast('JPG 產製引擎載入中，請稍候重試...', 'warning');
      return;
    }

    const name = document.getElementById('d-customer-name')?.value.trim() || '客戶';
    const plate = document.getElementById('d-car-plate')?.value.trim() || '';
    const dateVal = document.getElementById('d-receipt-date')?.value || new Date().toISOString().split('T')[0];
    const filename = `好室多膜_定金收據_${name}_${plate ? plate + '_' : ''}${dateVal}.jpg`;

    this.showToast('正在產生高畫質收據圖片（傳 LINE 首選）...', 'info');

    try {
      const canvas = await window.html2canvas(target, {
        scale: 2.5,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      });

      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      this.showToast(`已成功下載【${filename}】！可直接拖曳至 LINE 傳送給客戶。`, 'success');
    } catch (err) {
      console.error('Download deposit JPG error:', err);
      this.showToast('產生圖片失敗，請嘗試使用列印或截圖功能', 'error');
    }
  },

  async downloadDepositPdf() {
    const target = document.getElementById('deposit-receipt-render');
    if (!target) return;

    const name = document.getElementById('d-customer-name')?.value.trim() || '客戶';
    const plate = document.getElementById('d-car-plate')?.value.trim() || '';
    const dateVal = document.getElementById('d-receipt-date')?.value || new Date().toISOString().split('T')[0];
    const filename = `好室多膜_定金收據_${name}_${plate ? plate + '_' : ''}${dateVal}.pdf`;

    if (window.html2pdf) {
      const opt = {
        margin: [10, 10, 10, 10],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      this.showToast('正在產生定金收據 PDF...', 'info');
      try {
        await window.html2pdf().set(opt).from(target).save();
        this.showToast(`已成功下載 PDF【${filename}】`, 'success');
      } catch (err) {
        console.error('PDF error:', err);
        window.print();
      }
    } else {
      window.print();
    }
  },

  printDepositReceipt() {
    document.body.classList.add('printing-deposit');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-deposit');
    }, 1000);
  },

  copyDepositLineText() {
    const name = document.getElementById('d-customer-name')?.value.trim() || '貴賓';
    const phone = document.getElementById('d-customer-phone')?.value.trim() || '';
    const plate = document.getElementById('d-car-plate')?.value.trim() || '';
    const model = document.getElementById('d-car-model')?.value.trim() || '';
    const rawAmt = parseInt(document.getElementById('d-deposit-amount')?.value, 10);
    const amount = isNaN(rawAmt) ? 0 : rawAmt;
    const radio = document.querySelector('input[name="d-payment-type"]:checked');
    const paymentMethod = radio ? radio.value : '現金';
    const transferLast5 = document.getElementById('d-transfer-last5')?.value.trim() || '';
    const receiptNo = document.getElementById('d-prev-receipt-no')?.textContent || 'HW-DEP';
    const dateVal = document.getElementById('d-receipt-date')?.value || new Date().toISOString().split('T')[0];
    const service = document.getElementById('d-service-item')?.value.trim() || '汽車專業施工';
    const chineseWords = this.numberToChineseCurrency(amount);

    let payText = paymentMethod === '現金' ? '門市現場現金收訖' : `銀行匯款 / 轉帳 (核對末五碼：${transferLast5 || '已確認入帳'})`;

    const lineMsg = `【好室多膜 HOUSE WRAPPER｜預約定金收訖憑證】

親愛的 ${name} 您好：
感謝您選擇好室多膜頂級汽車貼膜服務，我們已確認收到您的施作定金，詳細收據資訊如下：

📋 收據單號：${receiptNo}
💰 定金金額：NT$ ${amount.toLocaleString()} (${chineseWords})
💳 付款方式：${payText}
🚗 預約車輛：${model}${plate ? ` (${plate})` : ''}
🛠️ 預約項目：${service}
📅 收訖日期：${dateVal.replace(/-/g, '/')}

⚠️ 合約定金特別聲明：
依民法第249條及雙方施工合約約定，本定金用於為貴車保留專屬施作檔期與材料備料。除因不可歸責於雙方事由致不能履行外，定金收訖後依照合約規定無法隨意退回，餘款將於完工查驗交車時結清。

完整高畫質電子收據圖檔已同步開立，如有任何疑問或需微調施作細節，歡迎隨時與我們聯繫！

好室多膜 台北旗艦店
門市電話：02-2794-0710
官方LINE：@housewrapper
門市地址：台北市內湖區行愛路111號`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lineMsg).then(() => {
        this.showToast('已複製定金收據 LINE 文字！可直接貼上傳給客戶。', 'success');
      }).catch(() => {
        prompt('請手動複製以下訊息傳送至 LINE：', lineMsg);
      });
    } else {
      prompt('請手動複製以下訊息傳送至 LINE：', lineMsg);
    }
  },

  async loadDepositRecords(searchQuery = '') {
    const tbody = document.getElementById('d-records-tbody');
    const emptyState = document.getElementById('d-empty-state');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 24px; color: var(--text-muted);">載入收據紀錄中...</td></tr>';

    const url = searchQuery ? `/api/deposits?q=${encodeURIComponent(searchQuery)}` : '/api/deposits';
    const res = await this.api(url);

    if (!res || !res.success) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 24px; color: #ef4444;">載入失敗</td></tr>';
      return;
    }

    const deposits = res.deposits || [];
    this.updateDepositCountBadge(deposits.length);

    if (deposits.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    tbody.innerHTML = deposits.map(d => {
      const amtFormatted = (d.deposit_amount || 0).toLocaleString();
      const isCash = (d.payment_method || '現金') === '現金';
      const payBadge = isCash
        ? '<span class="status-badge" style="background: rgba(34, 197, 94, 0.15); color: #22c55e;">💵 現金</span>'
        : `<span class="status-badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6;">🏦 匯款${d.transfer_last5 ? ` (${d.transfer_last5})` : ''}</span>`;

      return `
        <tr>
          <td><strong style="color: #eab308; font-family: monospace;">${d.receipt_no}</strong></td>
          <td>${(d.receipt_date || '').slice(0, 10)}</td>
          <td><strong>${d.customer_name}</strong></td>
          <td>${d.customer_phone}</td>
          <td>
            ${d.car_plate ? `<span class="status-badge" style="background: #111827; color: #fff; font-weight: 700;">${d.car_plate}</span>` : '-'}
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${d.car_model || ''}</div>
          </td>
          <td class="text-right"><strong style="color: #ca8a04; font-size: 14px;">NT$ ${amtFormatted}</strong></td>
          <td class="text-center">${payBadge}</td>
          <td style="font-size: 12px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${d.service_item || ''}">${d.service_item || '-'}</td>
          <td class="text-center">
            <div style="display: flex; gap: 6px; justify-content: center;">
              <button class="btn btn-secondary btn-sm" onclick="app.editDepositRecord(${d.id})" title="載入編輯">編輯</button>
              <button class="btn btn-secondary btn-sm" onclick="app.quickExportDepositJpg(${d.id})" title="下載 JPG 傳 LINE">🖼️ LINE</button>
              <button class="btn btn-outline btn-sm" style="color: #ef4444; border-color: rgba(239,68,68,0.3);" onclick="app.deleteDepositRecord(${d.id}, '${d.receipt_no}')" title="刪除">✕</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  async loadDepositRecordsCount() {
    const res = await this.api('/api/deposits');
    if (res && res.success) {
      this.updateDepositCountBadge(res.count || (res.deposits ? res.deposits.length : 0));
    }
  },

  updateDepositCountBadge(count) {
    const badge = document.getElementById('d-badge-record-count');
    if (badge) badge.textContent = count;
  },

  onDepositSearchInput(val) {
    clearTimeout(this._depSearchTimer);
    this._depSearchTimer = setTimeout(() => {
      this.loadDepositRecords(val.trim());
    }, 250);
  },

  clearDepositSearch() {
    const searchInput = document.getElementById('d-history-search');
    if (searchInput) searchInput.value = '';
    this.loadDepositRecords();
  },

  async editDepositRecord(id) {
    const res = await this.api(`/api/deposits/${id}`);
    if (!res || !res.success || !res.deposit) {
      this.showToast('無法取得定金收據資料', 'error');
      return;
    }

    const d = res.deposit;
    this.switchDepositTab('create');

    const setVal = (elemId, val) => {
      const el = document.getElementById(elemId);
      if (el) el.value = val || '';
    };

    setVal('d-editing-record-id', d.id);
    setVal('d-linked-quote-id', d.quote_id || '');
    setVal('d-customer-name', d.customer_name);
    setVal('d-customer-phone', d.customer_phone);
    setVal('d-car-plate', d.car_plate);
    setVal('d-car-model', d.car_model);
    setVal('d-deposit-amount', d.deposit_amount);
    setVal('d-transfer-last5', d.transfer_last5);
    setVal('d-receipt-date', d.receipt_date ? d.receipt_date.slice(0, 10) : '');
    setVal('d-appointment-date', d.appointment_date ? d.appointment_date.slice(0, 10) : '');
    setVal('d-service-item', d.service_item);
    setVal('d-notes', d.notes);
    setVal('d-created-by', d.created_by);
    if (d.terms_text) setVal('d-terms-text', d.terms_text);

    const payMethod = d.payment_method || '現金';
    const radio = document.querySelector(`input[name="d-payment-type"][value="${payMethod}"]`);
    if (radio) {
      radio.checked = true;
      this.onDepositPaymentChange();
    }

    const modeTitle = document.getElementById('d-form-mode-title');
    if (modeTitle) modeTitle.textContent = `編輯收據：${d.receipt_no}`;

    const receiptNoPreview = document.getElementById('d-prev-receipt-no');
    if (receiptNoPreview) receiptNoPreview.textContent = d.receipt_no;

    this.updateDepositLivePreview();
    this.showToast(`已載入收據【${d.receipt_no}】！`, 'info');
  },

  async quickExportDepositJpg(id) {
    await this.editDepositRecord(id);
    setTimeout(() => {
      this.downloadDepositJpg();
    }, 400);
  },

  async deleteDepositRecord(id, receiptNo) {
    if (!confirm(`確定要刪除定金收據【${receiptNo}】嗎？\n此動作無法復原！`)) {
      return;
    }

    const res = await this.api(`/api/deposits/${id}`, { method: 'DELETE' });
    if (res && res.success) {
      this.showToast(`已刪除收據【${receiptNo}】`, 'success');
      this.loadDepositRecords();
      this.loadDepositRecordsCount();
    } else {
      this.showToast(res?.message || '刪除失敗', 'error');
    }
  },

  convertCurrentQuoteToDeposit() {
    this.closePdfModal();
    const q = this.previewQuoteData || this.currentQuote;
    if (!q) {
      this.showToast('無法取得目前報價單資料', 'error');
      return;
    }

    this.navigate('deposit');
    this.switchDepositTab('create');
    this.resetDepositForm();

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };

    setVal('d-linked-quote-id', q.id || '');
    setVal('d-customer-name', q.customer_name);
    setVal('d-customer-phone', q.customer_phone);
    setVal('d-car-plate', q.car_plate);
    setVal('d-car-model', `${q.car_brand || ''} ${q.car_model || ''}`.trim());

    // Calculate suggested 30% deposit rounded to nearest 1,000
    const total = q.grand_total || q.final_total || 0;
    if (total > 0) {
      const depositSuggest = Math.round((total * 0.3) / 1000) * 1000;
      setVal('d-deposit-amount', depositSuggest);
    }

    // Extract service items summary
    let items = [];
    if (Array.isArray(q.items)) {
      items = q.items;
    } else if (q.items_json) {
      try { items = JSON.parse(q.items_json); } catch (e) {}
    }

    if (items.length > 0) {
      const itemNames = items.slice(0, 3).map(it => it.part_name || it.material_name || '').filter(Boolean);
      setVal('d-service-item', itemNames.join(' + '));
    }

    this.updateDepositLivePreview();
    this.showToast(`已將報價單【${q.quote_number || ''}】客戶資料轉入定金收據！`, 'success');
  }
};

// Start application upon DOM load
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
