/**
 * NPC Portrait Switcher
 * Mirrors ST's zoomed_avatar panel on the right side of the screen.
 * Supports per-character expression overrides: if a character keyword matches
 * AND an expression keyword matches, the expression image is shown instead of the default.
 *
 * Data shape per entry:
 * {
 *   keyword:    string,           // comma-separated trigger words for this character
 *   label:      string,           // display name (optional)
 *   imageData:  base64string,     // default portrait
 *   expressions: [                // optional expression overrides
 *     { keyword: string, imageData: base64string, label: string }
 *   ]
 * }
 */

const MODULE_NAME = 'npc_portrait_switcher';

const defaultSettings = Object.freeze({
    enabled: true,
    entries: [],
    stickySeconds: 0,
    caseSensitive: false,
    autoClose: true,
});

let stickyTimer = null;

// Tracks the currently displayed character so arrows can cycle its images
// { entryIdx: number, imageIdx: number }  imageIdx 0 = default, 1+ = expressions
let currentPortraitState = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();

    // Initialise with defaults only if the key doesn't exist yet
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    // Fill in any missing top-level keys from defaults (e.g. new settings added in updates)
    const stored = extensionSettings[MODULE_NAME];
    for (const key of Object.keys(defaultSettings)) {
        if (stored[key] === undefined) {
            stored[key] = structuredClone(defaultSettings[key]);
        }
    }

    // Always return the live reference — never a clone
    return extensionSettings[MODULE_NAME];
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

// ── Crop helper ───────────────────────────────────────────────────────────────

async function cropImage(dataUrl) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const dlg = new Popup(
        'Crop portrait image (2:3)',
        POPUP_TYPE.CROP,
        '',
        { cropImage: dataUrl, cropAspect: 2 / 3 }
    );
    const result = await dlg.show();
    return result ? String(result) : null;
}

async function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = ev => resolve(ev.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ── Portrait panel ────────────────────────────────────────────────────────────

function getOrCreatePortraitPanel() {
    let panel = document.getElementById('npc-ps-portrait-panel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'npc-ps-portrait-panel';

    // Close button
    const controlBar = document.createElement('div');
    controlBar.className = 'panelControlBar';

    const closeBtn = document.createElement('div');
    closeBtn.id = 'npc-ps-close';
    closeBtn.className = 'dragClose';
    closeBtn.title = 'Close portrait';
    closeBtn.innerHTML = '✕';
    closeBtn.addEventListener('click', () => clearPortrait());
    controlBar.appendChild(closeBtn);
    panel.appendChild(controlBar);

    // Portrait image
    const container = document.createElement('div');
    container.id = 'npc-ps-portrait-container';
    container.className = 'zoomed_avatar_container';

    const img = document.createElement('img');
    img.id = 'npc-ps-portrait-img';
    container.appendChild(img);
    panel.appendChild(container);

    // Navigation arrows (bottom corners, always visible on hover)
    const navBar = document.createElement('div');
    navBar.id = 'npc-ps-nav';
    navBar.classList.add('npc-ps-nav-hidden');

    const prevBtn = document.createElement('button');
    prevBtn.id = 'npc-ps-prev';
    prevBtn.title = 'Previous portrait';
    prevBtn.innerHTML = '&#8249;'; // ‹
    prevBtn.addEventListener('click', () => stepPortrait(-1));

    const navLabel = document.createElement('span');
    navLabel.id = 'npc-ps-nav-label';

    const nextBtn = document.createElement('button');
    nextBtn.id = 'npc-ps-next';
    nextBtn.title = 'Next portrait';
    nextBtn.innerHTML = '&#8250;'; // ›
    nextBtn.addEventListener('click', () => stepPortrait(1));

    navBar.appendChild(prevBtn);
    navBar.appendChild(navLabel);
    navBar.appendChild(nextBtn);
    panel.appendChild(navBar);

    document.body.appendChild(panel);
    return panel;
}

// Returns ordered list of images for the currently active entry: [default, ...expressions]
function getPortraitImages(entryIdx) {
    const settings = getSettings();
    const entry = settings.entries[entryIdx];
    if (!entry) return [];
    const images = [];
    if (entry.imageData) images.push({ src: entry.imageData, label: entry.label || 'Default' });
    for (const expr of (entry.expressions || [])) {
        if (expr.imageData) images.push({ src: expr.imageData, label: expr.label || expr.keyword || 'Expression' });
    }
    return images;
}

function updateNavLabel() {
    const nav = document.getElementById('npc-ps-nav');
    const label = document.getElementById('npc-ps-nav-label');
    if (!nav || !label) return;

    if (!currentPortraitState) {
        nav.classList.add('npc-ps-nav-hidden');
        return;
    }

    const images = getPortraitImages(currentPortraitState.entryIdx);

    if (images.length <= 1) {
        nav.classList.add('npc-ps-nav-hidden');
        label.textContent = '';
    } else {
        nav.classList.remove('npc-ps-nav-hidden');
        label.textContent = `${currentPortraitState.imageIdx + 1} / ${images.length}`;
    }
}

function stepPortrait(direction) {
    if (!currentPortraitState) return;
    const images = getPortraitImages(currentPortraitState.entryIdx);
    if (images.length <= 1) return;

    currentPortraitState.imageIdx =
        (currentPortraitState.imageIdx + direction + images.length) % images.length;

    const img = document.getElementById('npc-ps-portrait-img');
    if (img) img.src = images[currentPortraitState.imageIdx].src;
    updateNavLabel();
}

function showPortrait(imageData, entryIdx = null, imageIdx = 0) {
    if (stickyTimer) {
        clearTimeout(stickyTimer);
        stickyTimer = null;
    }

    const panel = getOrCreatePortraitPanel();
    const img = document.getElementById('npc-ps-portrait-img');
    if (!img) return;

    img.src = imageData;
    panel.classList.add('visible');

    // Track state for arrow navigation
    if (entryIdx !== null) {
        currentPortraitState = { entryIdx, imageIdx };
    }
    updateNavLabel();

    const settings = getSettings();
    if (settings.stickySeconds > 0) {
        stickyTimer = setTimeout(() => clearPortrait(), settings.stickySeconds * 1000);
    }
}

function clearPortrait() {
    if (stickyTimer) {
        clearTimeout(stickyTimer);
        stickyTimer = null;
    }
    currentPortraitState = null;
    const panel = document.getElementById('npc-ps-portrait-panel');
    if (panel) panel.classList.remove('visible');
}

// ── Keyword scanning ──────────────────────────────────────────────────────────

function splitKeywords(str) {
    return (str || '')
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0);
}

function matchesAny(rawText, keywords, caseSensitive) {
    for (const kw of keywords) {
        if (!kw) continue;

        // Escape regex special chars in the keyword
        const escaped = kw.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const flags = caseSensitive ? '' : 'i';

        // Use word boundaries — \b works for standard word chars (letters, digits, _)
        // For NPC names this is always sufficient
        let regex = null;
        try {
            regex = new RegExp('\\b' + escaped + '\\b', flags);
        } catch (e) {
            // If regex construction fails for any reason, fall back to plain includes
            console.warn('[NPC Portrait Switcher] Regex failed for keyword "' + kw + '", using plain match');
        }

        if (regex) {
            if (regex.test(rawText)) return true;
        } else {
            const needle = caseSensitive ? kw : kw.toLowerCase();
            const hay    = caseSensitive ? rawText : rawText.toLowerCase();
            if (hay.includes(needle)) return true;
        }
    }
    return false;
}


function scanAndDisplay(messageText) {
    const settings = getSettings();
    if (!settings.enabled || !settings.entries.length) return;

    // Pass the raw message text — matchesAny handles case via regex flags
    const text = messageText;

    for (let entryIdx = 0; entryIdx < settings.entries.length; entryIdx++) {
        const entry = settings.entries[entryIdx];
        if (!entry.imageData) continue;

        const charKeywords = splitKeywords(entry.keyword);
        // Skip entries with no valid keywords — prevents an empty keyword matching everything
        if (charKeywords.length === 0) continue;
        if (!matchesAny(text, charKeywords, settings.caseSensitive)) continue;

        // Character matched — now check expressions
        let imageToShow = entry.imageData;
        let imageIdx = 0;

        if (Array.isArray(entry.expressions) && entry.expressions.length > 0) {
            for (let exprIdx = 0; exprIdx < entry.expressions.length; exprIdx++) {
                const expr = entry.expressions[exprIdx];
                if (!expr.imageData) continue;

                const exprKeywords = splitKeywords(expr.keyword);
                // Skip expressions with no valid keywords — prevents blank expression
                // firing on every message that matches the character
                if (exprKeywords.length === 0) continue;

                if (matchesAny(text, exprKeywords, settings.caseSensitive)) {
                    imageToShow = expr.imageData;
                    imageIdx = exprIdx + 1; // 0 = default, 1+ = expressions
                    console.log(`[NPC Portrait Switcher] Expression matched: "${expr.keyword}"`);
                    break; // first expression match wins
                }
            }
        }

        console.log(`[NPC Portrait Switcher] Character matched: "${entry.keyword}" entryIdx=${entryIdx} imageIdx=${imageIdx}`);
        showPortrait(imageToShow, entryIdx, imageIdx);
        return;
    }

    // No character matched
    if (settings.autoClose && !stickyTimer) {
        clearPortrait();
    }
}

// ── Settings UI ───────────────────────────────────────────────────────────────

function buildSettingsHTML() {
    return `
<div id="npc-portrait-panel" style="margin-bottom:10px;">
  <div id="npc-portrait-header" class="npc-ps-header">
    <b>NPC Portrait Switcher</b>
    <span id="npc-portrait-chevron" class="npc-ps-chevron">▼</span>
  </div>
  <div id="npc-portrait-body" class="npc-ps-body" style="display:none;">

    <div class="npc-ps-row">
      <label class="npc-ps-label">
        <input type="checkbox" id="npc_ps_enabled" />
        Enabled
      </label>
    </div>

    <div class="npc-ps-row">
      <label class="npc-ps-label">
        <input type="checkbox" id="npc_ps_autoclose" />
        Auto-close when next message has no keyword match
      </label>
    </div>

    <div class="npc-ps-row">
      <label class="npc-ps-label" for="npc_ps_sticky">
        Sticky duration (seconds — 0 = instant, only applies when auto-close is on)
      </label>
      <input type="number" id="npc_ps_sticky" min="0" max="300" step="1" class="text_pole" style="width:80px;display:inline-block;" />
    </div>

    <div class="npc-ps-row">
      <label class="npc-ps-label">
        <input type="checkbox" id="npc_ps_case" />
        Case-sensitive matching
      </label>
    </div>

    <hr style="margin:10px 0;opacity:0.2;" />

    <div style="margin-bottom:4px;"><b>NPC Entries</b></div>
    <div style="margin-bottom:8px;font-size:0.85em;opacity:0.6;">Separate multiple keywords with commas. Expressions override the default portrait when their keyword also appears.</div>
    <div id="npc_ps_entries"></div>

    <div class="npc-ps-row" style="margin-top:10px;">
      <button id="npc_ps_add" class="menu_button">+ Add NPC</button>
    </div>

  </div>
</div>`;
}

// ── Render a single expression row ───────────────────────────────────────────

function renderExpressionRow(expr, exprIdx, entryIdx, settings) {
    const row = document.createElement('div');
    row.className = 'npc-ps-expr-row';
    row.dataset.entryIndex = String(entryIdx);
    row.dataset.exprIndex = String(exprIdx);

    row.innerHTML = `
        <div class="npc-ps-entry-preview">
            ${expr.imageData
                ? `<img src="${expr.imageData}" class="npc-ps-thumb" alt="expression" />`
                : `<div class="npc-ps-thumb npc-ps-thumb-empty">?</div>`}
        </div>
        <div class="npc-ps-entry-fields">
            <input type="text" class="npc-ps-expr-keyword text_pole"
                placeholder="Expression keywords, e.g. smiles, laughs, happy"
                value="${escapeHtml(expr.keyword)}" />
            <input type="text" class="npc-ps-expr-label text_pole"
                placeholder="Expression label (optional)"
                value="${escapeHtml(expr.label ?? '')}" />
            <label class="npc-ps-upload-btn menu_button" style="cursor:pointer;">
                📁 Upload Expression
                <input type="file" accept="image/*" style="display:none;" />
            </label>
        </div>
        <button class="npc-ps-expr-delete menu_button" title="Remove expression">✕</button>
    `;

    row.querySelector('.npc-ps-expr-keyword').addEventListener('input', e => {
        settings.entries[entryIdx].expressions[exprIdx].keyword = e.target.value;
        saveSettings();
    });

    row.querySelector('.npc-ps-expr-label').addEventListener('input', e => {
        settings.entries[entryIdx].expressions[exprIdx].label = e.target.value;
        saveSettings();
    });

    row.querySelector('input[type="file"]').addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        const cropped = await cropImage(dataUrl);
        if (!cropped) return;
        settings.entries[entryIdx].expressions[exprIdx].imageData = cropped;
        saveSettings();
        renderEntries();
    });

    return row;
}

// ── Render all NPC entries ────────────────────────────────────────────────────

function renderEntries() {
    const settings = getSettings();
    const container = document.getElementById('npc_ps_entries');
    if (!container) return;
    container.innerHTML = '';

    settings.entries.forEach((entry, idx) => {
        // Ensure expressions array exists
        if (!Array.isArray(entry.expressions)) entry.expressions = [];

        const card = document.createElement('div');
        card.className = 'npc-ps-entry-card';
        card.dataset.index = String(idx);

        // ── Character header row ──
        const headerRow = document.createElement('div');
        headerRow.className = 'npc-ps-entry-row';
        headerRow.dataset.index = String(idx);
        headerRow.innerHTML = `
            <div class="npc-ps-entry-preview">
                ${entry.imageData
                    ? `<img src="${entry.imageData}" class="npc-ps-thumb" alt="portrait" />`
                    : `<div class="npc-ps-thumb npc-ps-thumb-empty">?</div>`}
            </div>
            <div class="npc-ps-entry-fields">
                <input type="text" class="npc-ps-keyword text_pole"
                    placeholder="Keywords, comma separated (e.g. Vexis, Vex)"
                    value="${escapeHtml(entry.keyword)}" />
                <input type="text" class="npc-ps-label-field text_pole"
                    placeholder="Label (optional)"
                    value="${escapeHtml(entry.label ?? '')}" />
                <label class="npc-ps-upload-btn menu_button" style="cursor:pointer;">
                    📁 Default Portrait
                    <input type="file" accept="image/*" style="display:none;" />
                </label>
            </div>
            <button class="npc-ps-delete menu_button" title="Remove NPC">✕</button>
        `;

        headerRow.querySelector('.npc-ps-keyword').addEventListener('input', e => {
            settings.entries[idx].keyword = e.target.value;
            saveSettings();
        });

        headerRow.querySelector('.npc-ps-label-field').addEventListener('input', e => {
            settings.entries[idx].label = e.target.value;
            saveSettings();
        });

        headerRow.querySelector('input[type="file"]').addEventListener('change', async e => {
            const file = e.target.files[0];
            if (!file) return;
            const dataUrl = await readFileAsDataUrl(file);
            const cropped = await cropImage(dataUrl);
            if (!cropped) return;
            settings.entries[idx].imageData = cropped;
            saveSettings();
            renderEntries();
        });

        card.appendChild(headerRow);

        // ── Expressions section ──
        const exprSection = document.createElement('div');
        exprSection.className = 'npc-ps-expr-section';

        // Collapsible header for expressions
        const exprCount = entry.expressions.length;
        const exprToggle = document.createElement('div');
        exprToggle.className = 'npc-ps-expr-toggle';
        exprToggle.innerHTML = `
            <span class="npc-ps-expr-chevron">${exprCount > 0 ? '▼' : '▶'}</span>
            <span>Expressions <span class="npc-ps-expr-count">(${exprCount})</span></span>
            <button class="npc-ps-expr-add menu_button" data-entry="${idx}">+ Add Expression</button>
        `;
        exprSection.appendChild(exprToggle);

        // Expression rows container
        const exprList = document.createElement('div');
        exprList.className = 'npc-ps-expr-list';
        exprList.style.display = exprCount > 0 ? 'block' : 'none';

        entry.expressions.forEach((expr, exprIdx) => {
            exprList.appendChild(renderExpressionRow(expr, exprIdx, idx, settings));
        });

        exprSection.appendChild(exprList);
        card.appendChild(exprSection);

        // Toggle open/close expressions
        exprToggle.addEventListener('click', e => {
            if (e.target.closest('.npc-ps-expr-add')) return; // don't toggle when clicking Add
            const open = exprList.style.display !== 'none';
            exprList.style.display = open ? 'none' : 'block';
            exprToggle.querySelector('.npc-ps-expr-chevron').textContent = open ? '▶' : '▼';
        });

        container.appendChild(card);
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ── Settings panel init ───────────────────────────────────────────────────────

function initSettingsUI() {
    const settings = getSettings();

    document.getElementById('npc-portrait-panel')?.remove();

    const panel = document.createElement('div');
    panel.innerHTML = buildSettingsHTML();
    const target = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!target) {
        console.warn('[NPC Portrait Switcher] Could not find extensions settings container.');
        return;
    }
    target.appendChild(panel);

    const header = document.getElementById('npc-portrait-header');
    const body   = document.getElementById('npc-portrait-body');
    const chev   = document.getElementById('npc-portrait-chevron');

    header.addEventListener('click', () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        chev.textContent = open ? '▼' : '▲';
    });

    const enabledCb = document.getElementById('npc_ps_enabled');
    enabledCb.checked = settings.enabled;
    enabledCb.addEventListener('change', e => {
        settings.enabled = e.target.checked;
        saveSettings();
        if (!settings.enabled) clearPortrait();
    });

    const autocloseCb = document.getElementById('npc_ps_autoclose');
    autocloseCb.checked = settings.autoClose;
    autocloseCb.addEventListener('change', e => {
        settings.autoClose = e.target.checked;
        saveSettings();
    });

    const stickyInput = document.getElementById('npc_ps_sticky');
    stickyInput.value = settings.stickySeconds;
    stickyInput.addEventListener('change', e => {
        settings.stickySeconds = Math.max(0, parseInt(e.target.value) || 0);
        saveSettings();
    });

    const caseCb = document.getElementById('npc_ps_case');
    caseCb.checked = settings.caseSensitive;
    caseCb.addEventListener('change', e => {
        settings.caseSensitive = e.target.checked;
        saveSettings();
    });

    getOrCreatePortraitPanel();
    renderEntries();
}

// ── Permanent document-level delegation ──────────────────────────────────────

document.addEventListener('click', e => {
    // Add NPC
    if (e.target.closest('#npc_ps_add')) {
        const settings = getSettings();
        settings.entries.push({ keyword: '', imageData: '', label: '', expressions: [] });
        saveSettings();
        renderEntries();
        return;
    }

    // Delete NPC
    const deleteBtn = e.target.closest('.npc-ps-delete');
    if (deleteBtn) {
        const row = deleteBtn.closest('.npc-ps-entry-row');
        if (row) {
            const idx = parseInt(row.dataset.index);
            const settings = getSettings();
            settings.entries.splice(idx, 1);
            saveSettings();
            renderEntries();
        }
        return;
    }

    // Add Expression
    const addExprBtn = e.target.closest('.npc-ps-expr-add');
    if (addExprBtn) {
        const entryIdx = parseInt(addExprBtn.dataset.entry);
        const settings = getSettings();
        if (!Array.isArray(settings.entries[entryIdx].expressions)) {
            settings.entries[entryIdx].expressions = [];
        }
        settings.entries[entryIdx].expressions.push({ keyword: '', imageData: '', label: '' });
        saveSettings();
        renderEntries();
        return;
    }

    // Delete Expression
    const deleteExprBtn = e.target.closest('.npc-ps-expr-delete');
    if (deleteExprBtn) {
        const row = deleteExprBtn.closest('.npc-ps-expr-row');
        if (row) {
            const entryIdx = parseInt(row.dataset.entryIndex);
            const exprIdx  = parseInt(row.dataset.exprIndex);
            const settings = getSettings();
            settings.entries[entryIdx].expressions.splice(exprIdx, 1);
            saveSettings();
            renderEntries();
        }
        return;
    }
});

// ── Entry point ───────────────────────────────────────────────────────────────

(function () {
    const { eventSource, event_types } = SillyTavern.getContext();

    eventSource.on(event_types.APP_READY, () => {
        initSettingsUI();
        console.log('[NPC Portrait Switcher] Loaded.');
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        const settings = getSettings();
        if (!settings.enabled) return;

        const { chat } = SillyTavern.getContext();
        const message = chat[messageId];
        if (!message || message.is_user) return;

        scanAndDisplay(message.mes ?? '');
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        clearPortrait();
    });
})();
