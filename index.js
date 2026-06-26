/**
 * NPC Portrait Switcher
 * Shows NPC portraits on the right side of the chat when their keywords appear in AI messages.
 * Features a circular avatar tray above the portrait — one icon per NPC seen in the current chat.
 * Clicking a tray icon switches the main portrait to that NPC.
 * Supports expression overrides: character keyword + expression keyword = expression portrait.
 */

const MODULE_NAME = 'npc_portrait_switcher';
const TRAY_MAX = 8; // max NPCs tracked at once

const defaultSettings = Object.freeze({
    enabled: true,
    entries: [],
    stickyReplies: 0,
    caseSensitive: false,
    autoClose: true,
});

// ── Runtime state (cleared on chat change) ────────────────────────────────────

// Map of entryIdx → { entryIdx, imageIdx, replyCounter }
// Represents NPCs currently "in scene" (visible in tray)
let sceneNPCs = new Map();

// Which entryIdx is currently shown in the main portrait (null = panel hidden)
let activeEntryIdx = null;

// entryIdx of the manually selected NPC (null = auto-follow keywords)
let pinnedEntryIdx = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const stored = extensionSettings[MODULE_NAME];
    for (const key of Object.keys(defaultSettings)) {
        if (stored[key] === undefined) {
            stored[key] = structuredClone(defaultSettings[key]);
        }
    }
    return extensionSettings[MODULE_NAME];
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

// ── Crop / file helpers ───────────────────────────────────────────────────────

async function cropImage(dataUrl) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const dlg = new Popup('Crop portrait image (2:3)', POPUP_TYPE.CROP, '', {
        cropImage: dataUrl, cropAspect: 2 / 3,
    });
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

// ── Keyword helpers ───────────────────────────────────────────────────────────

function splitKeywords(str) {
    return (str || '').split(',').map(k => k.trim()).filter(k => k.length > 0);
}

function matchesAny(rawText, keywords, caseSensitive, triggerCount = 1) {
    let matchCount = 0;
    const text = rawText;
    
    for (const kw of keywords) {
        if (!kw) continue;
        
        const needle = caseSensitive ? kw : kw.toLowerCase();
        const hay = caseSensitive ? text : text.toLowerCase();
        
        // Count all occurrences using indexOf in a loop
        let pos = -1;
        let count = 0;
        while ((pos = hay.indexOf(needle, pos + 1)) !== -1) {
            count++;
            // Check if it's a whole word using Unicode-aware regex
            // \w matches letters, digits, and underscore
            // Use Unicode property for proper word boundary detection
            const beforeChar = pos > 0 ? hay[pos - 1] : '';
            const afterChar = pos + needle.length < hay.length ? hay[pos + needle.length] : '';
            
            // Check if the character is a word character (letter, digit, underscore)
            // Using \w which is Unicode-aware in modern JS
            const isWordChar = (char) => /[\w]/.test(char);
            
            // Check if there's a word boundary
            const isBeforeWordBoundary = beforeChar === '' || !isWordChar(beforeChar);
            const isAfterWordBoundary = afterChar === '' || !isWordChar(afterChar);
            
            if (isBeforeWordBoundary && isAfterWordBoundary) {
                matchCount++;
                if (matchCount >= triggerCount) {
                    console.log(`[NPC Portrait Switcher] Found ${matchCount} occurrences of "${kw}" (need ${triggerCount})`);
                    return true;
                }
            }
        }
    }
    return false;
}

// Returns [{src, label}, ...] for an entry: default first, then expressions
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

// ── Panel DOM ─────────────────────────────────────────────────────────────────

function getOrCreatePanel() {
    let panel = document.getElementById('npc-ps-portrait-panel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'npc-ps-portrait-panel';

    // ── Tray (avatar icons) ──
    const tray = document.createElement('div');
    tray.id = 'npc-ps-tray';
    panel.appendChild(tray);

    // ── Close button ──
    const controlBar = document.createElement('div');
    controlBar.className = 'panelControlBar';
    const closeBtn = document.createElement('div');
    closeBtn.id = 'npc-ps-close';
    closeBtn.className = 'dragClose';
    closeBtn.title = 'Close portrait';
    closeBtn.innerHTML = '✕';
    closeBtn.addEventListener('click', () => clearAllPortraits());
    controlBar.appendChild(closeBtn);
    panel.appendChild(controlBar);

    // ── Portrait image ──
    const container = document.createElement('div');
    container.id = 'npc-ps-portrait-container';
    container.className = 'zoomed_avatar_container';
    const img = document.createElement('img');
    img.id = 'npc-ps-portrait-img';
    container.appendChild(img);
    panel.appendChild(container);

    // ── Nav arrows ──
    const navBar = document.createElement('div');
    navBar.id = 'npc-ps-nav';
    navBar.classList.add('npc-ps-nav-hidden');

    const prevBtn = document.createElement('button');
    prevBtn.id = 'npc-ps-prev';
    prevBtn.title = 'Previous expression';
    prevBtn.innerHTML = '&#8249;';
    prevBtn.addEventListener('click', () => stepExpression(-1));

    const navLabel = document.createElement('span');
    navLabel.id = 'npc-ps-nav-label';

    const nextBtn = document.createElement('button');
    nextBtn.id = 'npc-ps-next';
    nextBtn.title = 'Next expression';
    nextBtn.innerHTML = '&#8250;';
    nextBtn.addEventListener('click', () => stepExpression(1));

    navBar.appendChild(prevBtn);
    navBar.appendChild(navLabel);
    navBar.appendChild(nextBtn);
    panel.appendChild(navBar);

    document.body.appendChild(panel);
    return panel;
}

// ── Tray rendering ────────────────────────────────────────────────────────────

function rebuildTray() {
    const panel = getOrCreatePanel();
    const tray = document.getElementById('npc-ps-tray');
    if (!tray) return;
    tray.innerHTML = '';

    if (sceneNPCs.size === 0) {
        tray.style.display = 'none';
        return;
    }

    tray.style.display = 'flex';

    const settings = getSettings();
    for (const [entryIdx] of sceneNPCs) {
        const entry = settings.entries[entryIdx];
        if (!entry) continue;

        const icon = document.createElement('div');
        icon.className = 'npc-ps-tray-icon';
        icon.dataset.entryIdx = String(entryIdx);
        icon.title = entry.label || splitKeywords(entry.keyword)[0] || 'NPC';
        if (entryIdx === activeEntryIdx) icon.classList.add('active');

        const img = document.createElement('img');
        // Always use the default portrait for the tray icon
        img.src = entry.imageData || '';
        img.alt = icon.title;
        icon.appendChild(img);

        icon.addEventListener('click', () => {
            pinnedEntryIdx = entryIdx; // user manually selected this NPC
            switchActiveNPC(entryIdx);
        });

        tray.appendChild(icon);
    }

    // Show/hide panel based on whether anything is in scene
    panel.classList.toggle('visible', sceneNPCs.size > 0);
}

// ── Portrait display ──────────────────────────────────────────────────────────

function switchActiveNPC(entryIdx) {
    const npcState = sceneNPCs.get(entryIdx);
    if (!npcState) return;

    activeEntryIdx = entryIdx;

    const images = getPortraitImages(entryIdx);
    const imageIdx = npcState.imageIdx;
    const src = images[imageIdx]?.src || images[0]?.src;
    if (!src) return;

    const img = document.getElementById('npc-ps-portrait-img');
    if (img) img.src = src;

    getOrCreatePanel().classList.add('visible');
    rebuildTray(); // refresh active highlight
    updateNavLabel();
}

function updateNavLabel() {
    const nav = document.getElementById('npc-ps-nav');
    const label = document.getElementById('npc-ps-nav-label');
    if (!nav || !label) return;

    if (activeEntryIdx === null) {
        nav.classList.add('npc-ps-nav-hidden');
        return;
    }

    const npcState = sceneNPCs.get(activeEntryIdx);
    const images = getPortraitImages(activeEntryIdx);

    if (!npcState || images.length <= 1) {
        nav.classList.add('npc-ps-nav-hidden');
        label.textContent = '';
    } else {
        nav.classList.remove('npc-ps-nav-hidden');
        label.textContent = `${npcState.imageIdx + 1} / ${images.length}`;
    }
}

function stepExpression(direction) {
    if (activeEntryIdx === null) return;
    const npcState = sceneNPCs.get(activeEntryIdx);
    const images = getPortraitImages(activeEntryIdx);
    if (!npcState || images.length <= 1) return;

    npcState.imageIdx = (npcState.imageIdx + direction + images.length) % images.length;

    const img = document.getElementById('npc-ps-portrait-img');
    if (img) img.src = images[npcState.imageIdx].src;
    updateNavLabel();
}

function removeNPCFromScene(entryIdx) {
    sceneNPCs.delete(entryIdx);

    // If the removed NPC was active, switch to another in scene or hide
    if (activeEntryIdx === entryIdx) {
        activeEntryIdx = null;
        pinnedEntryIdx = null;
        if (sceneNPCs.size > 0) {
            switchActiveNPC(sceneNPCs.keys().next().value);
        } else {
            const panel = document.getElementById('npc-ps-portrait-panel');
            if (panel) panel.classList.remove('visible');
        }
    }

    rebuildTray();
}

function clearAllPortraits() {
    sceneNPCs.clear();
    activeEntryIdx = null;
    pinnedEntryIdx = null;
    const panel = document.getElementById('npc-ps-portrait-panel');
    if (panel) panel.classList.remove('visible');
    rebuildTray();
}

// ── Scanning ──────────────────────────────────────────────────────────────────

function scanAndDisplay(messageText) {
    const settings = getSettings();
    if (!settings.enabled || !settings.entries.length) return;

    const text = messageText;

    // Track which entryIdxs were matched in THIS message
    const matchedThisMessage = new Set();

    for (let entryIdx = 0; entryIdx < settings.entries.length; entryIdx++) {
        const entry = settings.entries[entryIdx];
        if (!entry.imageData) continue;

        const charKeywords = splitKeywords(entry.keyword);
        if (charKeywords.length === 0) continue;
        
        // Check if the message contains enough occurrences of the keywords
        const triggerCount = entry.mentionsBeforeTrigger || 1;
        if (!matchesAny(text, charKeywords, settings.caseSensitive, triggerCount)) continue;

        matchedThisMessage.add(entryIdx);

        // Find expression match
        let imageIdx = 0;
        if (Array.isArray(entry.expressions)) {
            for (let exprIdx = 0; exprIdx < entry.expressions.length; exprIdx++) {
                const expr = entry.expressions[exprIdx];
                if (!expr.imageData) continue;
                const exprKeywords = splitKeywords(expr.keyword);
                if (exprKeywords.length === 0) continue;
                // Expression matching doesn't use trigger count - any match triggers it
                if (matchesAny(text, exprKeywords, settings.caseSensitive, 1)) {
                    imageIdx = exprIdx + 1;
                    console.log(`[NPC Portrait Switcher] Expression matched: "${expr.keyword}"`);
                    break;
                }
            }
        }

        console.log(`[NPC Portrait Switcher] Character matched: "${entry.keyword}" entryIdx=${entryIdx} imageIdx=${imageIdx}`);

        // Check if this NPC is already in scene
        if (sceneNPCs.has(entryIdx)) {
            const state = sceneNPCs.get(entryIdx);
            state.imageIdx = imageIdx;
            state.replyCounter = 0; // Reset reply counter since they were mentioned
        } else {
            // Respect tray cap for new additions
            if (sceneNPCs.size >= TRAY_MAX) {
                console.log(`[NPC Portrait Switcher] Tray full (${TRAY_MAX}), ignoring entryIdx=${entryIdx}`);
                continue;
            }
            // Add to scene
            sceneNPCs.set(entryIdx, { 
                entryIdx, 
                imageIdx, 
                replyCounter: 0 
            });
        }
    }

    // ── Cleanup: handle NPCs not mentioned in this message ──
    const toRemove = [];
    for (const [entryIdx, state] of sceneNPCs) {
        if (matchedThisMessage.has(entryIdx)) {
            // Mentioned this message — reset reply counter
            state.replyCounter = 0;
            continue;
        }

        // Not mentioned this message
        state.replyCounter = (state.replyCounter || 0) + 1;

        if (!settings.autoClose) {
            // autoClose off — only remove NPCs that were mentioned then stopped
            if (matchedThisMessage.size > 0) {
                // Something was mentioned but not this NPC — remove it after sticky replies
                if (settings.stickyReplies > 0 && state.replyCounter <= settings.stickyReplies) {
                    // Keep it for stickyReplies number of messages
                    continue;
                } else {
                    toRemove.push(entryIdx);
                }
            }
            // If nothing matched this message, leave the scene unchanged
            continue;
        }

        // autoClose is on — remove NPCs not mentioned after sticky replies
        if (settings.stickyReplies > 0 && state.replyCounter <= settings.stickyReplies) {
            // Keep it for stickyReplies number of messages
            continue;
        } else {
            toRemove.push(entryIdx);
        }
    }

    // Remove NPCs that have expired
    for (const entryIdx of toRemove) {
        sceneNPCs.delete(entryIdx);
        if (activeEntryIdx === entryIdx) {
            activeEntryIdx = null;
            pinnedEntryIdx = null;
        }
    }

    // If scene is now empty, hide everything
    if (sceneNPCs.size === 0) {
        const panel = document.getElementById('npc-ps-portrait-panel');
        if (panel) panel.classList.remove('visible');
        rebuildTray();
        return;
    }

    rebuildTray();

    // ── Determine which NPC to show in main portrait ──
    if (matchedThisMessage.size > 0) {
        if (pinnedEntryIdx !== null && sceneNPCs.has(pinnedEntryIdx)) {
            // User pinned someone — keep showing them (expression may have updated)
            switchActiveNPC(pinnedEntryIdx);
        } else {
            // Auto-follow: show the first NPC matched in this message
            const firstMatched = [...matchedThisMessage].find(idx => sceneNPCs.has(idx));
            if (firstMatched !== undefined) {
                switchActiveNPC(firstMatched);
            }
        }
    } else if (activeEntryIdx !== null && sceneNPCs.has(activeEntryIdx)) {
        // No new matches but active NPC is still in scene (on sticky) — keep showing
        switchActiveNPC(activeEntryIdx);
    } else if (sceneNPCs.size > 0) {
        // Active NPC was removed — fall back to first remaining in scene
        switchActiveNPC(sceneNPCs.keys().next().value);
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
        Sticky replies (number of messages to keep NPC after last mention — 0 = clears immediately)
      </label>
      <input type="number" id="npc_ps_sticky" min="0" max="20" step="1" class="text_pole" style="width:80px;display:inline-block;" />
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

function renderEntries() {
    const settings = getSettings();
    const container = document.getElementById('npc_ps_entries');
    if (!container) return;
    container.innerHTML = '';

    settings.entries.forEach((entry, idx) => {
        if (!Array.isArray(entry.expressions)) entry.expressions = [];
        if (entry.mentionsBeforeTrigger === undefined) entry.mentionsBeforeTrigger = 1;

        const card = document.createElement('div');
        card.className = 'npc-ps-entry-card';
        card.dataset.index = String(idx);

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
                <div class="npc-ps-mention-field">
                    <label style="font-size:0.85em;opacity:0.7;">Mentions needed per message:</label>
                    <input type="number" class="npc-ps-mention-count text_pole" 
                        min="1" max="10" step="1" 
                        value="${entry.mentionsBeforeTrigger || 1}"
                        style="width:60px;display:inline-block;" />
                    <span style="font-size:0.8em;opacity:0.6;margin-left:4px;">(occurrences in one message)</span>
                </div>
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
        headerRow.querySelector('.npc-ps-mention-count').addEventListener('change', e => {
            settings.entries[idx].mentionsBeforeTrigger = Math.max(1, parseInt(e.target.value) || 1);
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

        const exprSection = document.createElement('div');
        exprSection.className = 'npc-ps-expr-section';

        const exprCount = entry.expressions.length;
        const exprToggle = document.createElement('div');
        exprToggle.className = 'npc-ps-expr-toggle';
        exprToggle.innerHTML = `
            <span class="npc-ps-expr-chevron">${exprCount > 0 ? '▼' : '▶'}</span>
            <span>Expressions <span class="npc-ps-expr-count">(${exprCount})</span></span>
            <button class="npc-ps-expr-add menu_button" data-entry="${idx}">+ Add Expression</button>
        `;
        exprSection.appendChild(exprToggle);

        const exprList = document.createElement('div');
        exprList.className = 'npc-ps-expr-list';
        exprList.style.display = exprCount > 0 ? 'block' : 'none';
        entry.expressions.forEach((expr, exprIdx) => {
            exprList.appendChild(renderExpressionRow(expr, exprIdx, idx, settings));
        });
        exprSection.appendChild(exprList);
        card.appendChild(exprSection);

        exprToggle.addEventListener('click', e => {
            if (e.target.closest('.npc-ps-expr-add')) return;
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

function initSettingsUI() {
    const settings = getSettings();
    document.getElementById('npc-portrait-panel')?.remove();

    const panel = document.createElement('div');
    panel.innerHTML = buildSettingsHTML();
    const target = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!target) { console.warn('[NPC Portrait Switcher] Could not find extensions settings container.'); return; }
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
        if (!settings.enabled) clearAllPortraits();
    });

    const autocloseCb = document.getElementById('npc_ps_autoclose');
    autocloseCb.checked = settings.autoClose;
    autocloseCb.addEventListener('change', e => { settings.autoClose = e.target.checked; saveSettings(); });

    const stickyInput = document.getElementById('npc_ps_sticky');
    stickyInput.value = settings.stickyReplies;
    stickyInput.addEventListener('change', e => {
        settings.stickyReplies = Math.max(0, parseInt(e.target.value) || 0);
        saveSettings();
    });

    const caseCb = document.getElementById('npc_ps_case');
    caseCb.checked = settings.caseSensitive;
    caseCb.addEventListener('change', e => { settings.caseSensitive = e.target.checked; saveSettings(); });

    getOrCreatePanel();
    renderEntries();
}

// ── Document-level delegation ─────────────────────────────────────────────────

document.addEventListener('click', e => {
    if (e.target.closest('#npc_ps_add')) {
        const settings = getSettings();
        settings.entries.push({ keyword: '', imageData: '', label: '', expressions: [], mentionsBeforeTrigger: 1 });
        saveSettings(); renderEntries(); return;
    }
    const deleteBtn = e.target.closest('.npc-ps-delete');
    if (deleteBtn) {
        const row = deleteBtn.closest('.npc-ps-entry-row');
        if (row) {
            const settings = getSettings();
            settings.entries.splice(parseInt(row.dataset.index), 1);
            saveSettings(); renderEntries();
        }
        return;
    }
    const addExprBtn = e.target.closest('.npc-ps-expr-add');
    if (addExprBtn) {
        const entryIdx = parseInt(addExprBtn.dataset.entry);
        const settings = getSettings();
        if (!Array.isArray(settings.entries[entryIdx].expressions)) settings.entries[entryIdx].expressions = [];
        settings.entries[entryIdx].expressions.push({ keyword: '', imageData: '', label: '' });
        saveSettings(); renderEntries(); return;
    }
    const deleteExprBtn = e.target.closest('.npc-ps-expr-delete');
    if (deleteExprBtn) {
        const row = deleteExprBtn.closest('.npc-ps-expr-row');
        if (row) {
            const settings = getSettings();
            settings.entries[parseInt(row.dataset.entryIndex)].expressions.splice(parseInt(row.dataset.exprIndex), 1);
            saveSettings(); renderEntries();
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
        clearAllPortraits();
    });
})();