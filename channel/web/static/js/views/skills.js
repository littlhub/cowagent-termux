/* Capabilities view: built-in tools, MCP tools, and installed skills.
   Split out of console.js. These are classic scripts sharing one global
   scope; see channel/web/README.md before changing the load order. */

// =====================================================================
// Capabilities View
// =====================================================================
let toolsLoaded = false;
let toolsExpanded = false;
const TOOLS_COLLAPSED_COUNT = 4;

const TOOL_ICONS = {
    bash: 'fa-terminal',
    edit: 'fa-pen-to-square',
    read: 'fa-file-lines',
    write: 'fa-file-pen',
    ls: 'fa-folder-open',
    send: 'fa-paper-plane',
    web_search: 'fa-magnifying-glass',
    browser: 'fa-globe',
    env_config: 'fa-key',
    scheduler: 'fa-clock',
    time: 'fa-calendar-day',
    memory_get: 'fa-brain',
    memory_search: 'fa-brain',
};

function getToolIcon(name) {
    return TOOL_ICONS[name] || 'fa-wrench';
}

function loadSkillsView() {
    bindSkillsConfigUi();
    loadToolsSection();
    loadMcpSection();
    loadSkillsSection();
}

let skillsConfigUiBound = false;

function bindSkillsConfigUi() {
    if (skillsConfigUiBound) return;
    skillsConfigUiBound = true;
    const on = (id, evt, fn) => document.getElementById(id)?.addEventListener(evt, fn);

    on('tools-toggle-btn', 'click', () => { toolsExpanded = !toolsExpanded; applyToolsCollapse(); });

    on('mcp-add-btn', 'click', () => openMcpEditor());
    on('mcp-editor-cancel', 'click', closeMcpEditor);
    on('mcp-editor-test', 'click', testMcpEditor);
    on('mcp-editor-save', 'click', saveMcpEditor);
    on('mcp-advanced-toggle', 'click', () => setMcpAdvancedOpen(
        document.getElementById('mcp-advanced-fields').classList.contains('hidden')));
    on('mcp-editor-overlay', 'click', (e) => { if (e.target.id === 'mcp-editor-overlay') closeMcpEditor(); });
    on('mcp-editor-overlay', 'input', () => setMcpSaveAnyway(false));
    on('mcp-editor-overlay', 'change', () => setMcpSaveAnyway(false));
    document.querySelectorAll('[data-mcp-tab]').forEach(btn => {
        btn.addEventListener('click', () => switchMcpTab(btn.dataset.mcpTab));
    });
    const jsonEl = document.getElementById('mcp-field-json');
    if (jsonEl) jsonEl.placeholder = MCP_JSON_PLACEHOLDER;

    bindSkillAddUi();

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!document.getElementById('mcp-editor-overlay')?.classList.contains('hidden')) closeMcpEditor();
        else if (!document.getElementById('skill-add-overlay')?.classList.contains('hidden')) closeSkillAdd();
    });
}

function setButtonBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = !!busy;
}

async function postJson(url, body, method) {
    const res = await fetch(url, {
        method: method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

// ---------------------------------------------------------------------
// Built-in tools
// ---------------------------------------------------------------------

function applyToolsCollapse() {
    const listEl = document.getElementById('tools-list');
    const btn = document.getElementById('tools-toggle-btn');
    if (!listEl || !btn) return;
    const cards = Array.from(listEl.children);
    cards.forEach((card, i) => {
        card.classList.toggle('hidden', !toolsExpanded && i >= TOOLS_COLLAPSED_COUNT);
    });
    const collapsible = cards.length > TOOLS_COLLAPSED_COUNT;
    btn.classList.toggle('hidden', !collapsible);
    const label = document.getElementById('tools-toggle-label');
    if (label) {
        const key = toolsExpanded ? 'tools_collapse' : 'tools_show_all';
        label.dataset.i18n = key;
        label.textContent = t(key);
    }
    const icon = document.getElementById('tools-toggle-icon');
    if (icon) icon.style.transform = toolsExpanded ? 'rotate(180deg)' : '';
}

function loadToolsSection() {
    if (toolsLoaded) return;
    const emptyEl = document.getElementById('tools-empty');
    const listEl = document.getElementById('tools-list');
    const badge = document.getElementById('tools-count-badge');
    const showEmpty = (key) => {
        emptyEl.classList.remove('hidden');
        emptyEl.innerHTML = `<span class="text-sm text-slate-400 dark:text-slate-500">${escapeHtml(t(key))}</span>`;
    };

    fetch('/api/tools').then(r => r.json()).then(data => {
        if (data.status !== 'success') { showEmpty('tools_load_failed'); return; }
        const tools = data.tools || [];
        emptyEl.classList.add('hidden');
        if (tools.length === 0) { showEmpty('tools_empty'); return; }
        badge.textContent = tools.length;
        badge.classList.remove('hidden');
        listEl.innerHTML = '';
        tools.forEach(tool => {
            const card = document.createElement('div');
            card.className = 'bg-white dark:bg-[#1A1A1A] rounded-xl border border-slate-200 dark:border-white/10 p-4 flex items-start gap-3';
            card.innerHTML = `
                <div class="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                    <i class="fas ${getToolIcon(tool.name)} text-blue-500 dark:text-blue-400 text-sm"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <span class="block font-medium text-sm text-slate-700 dark:text-slate-200 font-mono truncate">${escapeHtml(tool.name)}</span>
                    <p class="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-2">${escapeHtml(tool.description || '--')}</p>
                </div>`;
            listEl.appendChild(card);
        });
        listEl.classList.remove('hidden');
        applyToolsCollapse();
        toolsLoaded = true;
    }).catch(() => showEmpty('tools_load_failed'));
}

// ---------------------------------------------------------------------
// MCP tools
// ---------------------------------------------------------------------

let mcpServersCache = [];
let mcpEditorOriginalName = null;
let mcpEditorTab = 'form';
let mcpSaveAnyway = false;
let mcpPollTimer = null;
let mcpPollDeadline = 0;
const MCP_POLL_INTERVAL_MS = 1500;
const MCP_POLL_MAX_MS = 120000;

const MCP_JSON_PLACEHOLDER = JSON.stringify(
    { mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'] } } }, null, 2);

const MCP_TRANSPORT_LABELS = { stdio: 'stdio', sse: 'SSE', 'streamable-http': 'HTTP' };

function kvToObject(text) {
    const out = {};
    String(text || '').split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const idx = trimmed.indexOf('=');
        if (idx <= 0) return;
        out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1);
    });
    return out;
}

function objectToKv(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n');
}

function mcpStatusLabel(status) {
    const key = {
        ready: 'mcp_status_ready',
        pending: 'mcp_status_pending',
        failed: 'mcp_status_failed',
        needs_auth: 'mcp_status_needs_auth',
        disabled: 'mcp_status_disabled',
        idle: 'mcp_status_idle',
    }[status] || 'mcp_status_idle';
    return t(key);
}

function mcpStatusClass(status) {
    if (status === 'ready') return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400';
    if (status === 'failed') return 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400';
    if (status === 'needs_auth') return 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400';
    if (status === 'disabled') return 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400';
    return 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400';
}

function loadMcpSection() {
    const emptyEl = document.getElementById('mcp-empty');
    const listEl = document.getElementById('mcp-list');
    const badge = document.getElementById('mcp-count-badge');
    if (!listEl) return;
    const errorEl = () => {
        let el = document.getElementById('mcp-load-error');
        if (!el) {
            el = document.createElement('p');
            el.id = 'mcp-load-error';
            el.className = 'text-sm text-red-500 py-2';
            listEl.parentNode.insertBefore(el, listEl);
        }
        return el;
    };
    const showError = (msg) => {
        listEl.classList.add('hidden');
        emptyEl?.classList.add('hidden');
        const el = errorEl();
        el.textContent = msg;
        el.classList.remove('hidden');
    };
    fetch('/api/mcp/servers').then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            showError(`${t('mcp_load_failed')}: ${data.message || ''}`);
            return;
        }
        document.getElementById('mcp-load-error')?.classList.add('hidden');
        mcpServersCache = data.servers || [];
        if (badge) {
            badge.textContent = mcpServersCache.length;
            badge.classList.toggle('hidden', mcpServersCache.length === 0);
        }
        emptyEl?.classList.toggle('hidden', mcpServersCache.length > 0);
        listEl.innerHTML = '';
        mcpServersCache.forEach(server => listEl.appendChild(renderMcpCard(server)));
        listEl.classList.toggle('hidden', mcpServersCache.length === 0);
        scheduleMcpStatusPoll();
    }).catch(() => showError(t('mcp_load_failed')));
}

/** Saved servers start in the background, so keep refreshing while any is still loading. */
function scheduleMcpStatusPoll() {
    clearTimeout(mcpPollTimer);
    if (!mcpServersCache.some(s => s.status === 'pending')) {
        mcpPollDeadline = 0;
        return;
    }
    if (!mcpPollDeadline) mcpPollDeadline = Date.now() + MCP_POLL_MAX_MS;
    if (Date.now() > mcpPollDeadline) return;
    mcpPollTimer = setTimeout(() => {
        // Stop once the view is no longer on screen; opening it again reloads the list.
        if (document.getElementById('mcp-list')?.offsetParent === null) {
            mcpPollDeadline = 0;
            return;
        }
        loadMcpSection();
    }, MCP_POLL_INTERVAL_MS);
}

function renderMcpCard(server) {
    const card = document.createElement('div');
    card.className = 'group bg-white dark:bg-[#1A1A1A] rounded-xl border border-slate-200 dark:border-white/10 p-4 flex items-start gap-3 '
        + 'cursor-pointer hover:border-slate-300 dark:hover:border-white/20 transition-colors';
    const type = server.type || (server.url ? 'sse' : 'stdio');
    const summary = type === 'stdio'
        ? [server.command, ...(server.args || [])].filter(Boolean).join(' ')
        : (server.url || '');
    const disabled = server.status === 'disabled';
    card.innerHTML = `
        <div class="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center flex-shrink-0">
            <i class="fas fa-plug ${disabled ? 'text-slate-300 dark:text-slate-600' : 'text-amber-500'} text-sm"></i>
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
                <span class="font-medium text-sm text-slate-700 dark:text-slate-200 truncate font-mono">${escapeHtml(server.name)}</span>
                <span class="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400">${escapeHtml(MCP_TRANSPORT_LABELS[type] || type)}</span>
                <span class="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[10px] ${mcpStatusClass(server.status)}">${escapeHtml(mcpStatusLabel(server.status))}</span>
                <span class="flex-1"></span>
                <button type="button" data-mcp-edit title="${escapeHtml(t('mcp_edit'))}"
                        class="flex-shrink-0 p-1 -my-1 rounded text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-300 transition-colors">
                    <i class="fas fa-pen text-[10px]"></i>
                </button>
                <button type="button" data-mcp-delete title="${escapeHtml(t('mcp_delete'))}"
                        class="flex-shrink-0 p-1 -my-1 rounded text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                    <i class="fas fa-trash text-[10px]"></i>
                </button>
            </div>
            <p class="text-xs text-slate-400 dark:text-slate-500 truncate font-mono" title="${escapeHtml(summary)}">${escapeHtml(summary || '--')}</p>
        </div>`;
    card.onclick = () => openMcpEditor(server);
    card.querySelector('[data-mcp-edit]').onclick = (e) => { e.stopPropagation(); openMcpEditor(server); };
    card.querySelector('[data-mcp-delete]').onclick = (e) => { e.stopPropagation(); deleteMcpServer(server.name); };
    return card;
}

function mcpTransportOptions() {
    return [
        { value: 'stdio', label: 'stdio', hint: t('mcp_transport_stdio_hint') },
        { value: 'sse', label: 'SSE', hint: t('mcp_transport_remote_hint') },
        { value: 'streamable-http', label: 'Streamable HTTP', hint: t('mcp_transport_remote_hint') },
    ];
}

function mcpEditorTransport() {
    return getDropdownValue(document.getElementById('mcp-field-type')) || 'stdio';
}

function syncMcpEditorTransport() {
    setMcpSaveAnyway(false);
    const stdio = mcpEditorTransport() === 'stdio';
    document.getElementById('mcp-stdio-fields')?.classList.toggle('hidden', !stdio);
    document.getElementById('mcp-url-fields')?.classList.toggle('hidden', stdio);
    document.getElementById('mcp-scope-field')?.classList.toggle('hidden', stdio);
}

function setMcpAdvancedOpen(open) {
    document.getElementById('mcp-advanced-fields')?.classList.toggle('hidden', !open);
    const icon = document.getElementById('mcp-advanced-icon');
    if (icon) icon.style.transform = open ? 'rotate(90deg)' : '';
}

function clearMcpResult() {
    setMcpSaveAnyway(false);
    const result = document.getElementById('mcp-test-result');
    if (!result) return;
    result.className = 'cap-result hidden mt-4';
    result.innerHTML = '';
}

function showMcpResult(kind, html) {
    const result = document.getElementById('mcp-test-result');
    result.className = `cap-result ${kind} mt-4`;
    result.innerHTML = html;
    result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function showMcpError(message) {
    showMcpResult('fail', `
        <div class="flex items-start gap-2">
            <i class="fas fa-circle-exclamation mt-0.5"></i>
            <span class="flex-1 min-w-0 break-words">${escapeHtml(message)}</span>
        </div>`);
}

function fillMcpEditor(server) {
    const s = server || {};
    const nameEl = document.getElementById('mcp-field-name');
    nameEl.value = s.name || '';
    nameEl.disabled = !!s.name;
    const type = s.type || (s.url ? 'sse' : 'stdio');
    initDropdown(document.getElementById('mcp-field-type'), mcpTransportOptions(), type, syncMcpEditorTransport);
    document.getElementById('mcp-field-command').value = s.command || '';
    document.getElementById('mcp-field-args').value = (s.args || []).join('\n');
    document.getElementById('mcp-field-env').value = objectToKv(s.env);
    document.getElementById('mcp-field-url').value = s.url || '';
    document.getElementById('mcp-field-headers').value = objectToKv(s.headers);
    document.getElementById('mcp-field-scope').value = s.scope || '';
    document.getElementById('mcp-field-prefix').value = s.tool_name_prefix || '';
    document.getElementById('mcp-field-timeout').value = s.timeout || '';
    document.getElementById('mcp-field-disabled').checked = !!s.disabled || s.status === 'disabled';
    setMcpAdvancedOpen(!!(s.tool_name_prefix || s.timeout || s.scope));
    syncMcpEditorTransport();
}

function readMcpEditor() {
    const type = mcpEditorTransport();
    const cfg = {
        name: document.getElementById('mcp-field-name').value.trim(),
        type,
    };
    const prefix = document.getElementById('mcp-field-prefix').value;
    if (prefix) cfg.tool_name_prefix = prefix;
    if (document.getElementById('mcp-field-disabled').checked) cfg.disabled = true;
    const timeout = document.getElementById('mcp-field-timeout').value.trim();
    if (timeout) cfg.timeout = Number(timeout);
    if (type === 'stdio') {
        cfg.command = document.getElementById('mcp-field-command').value.trim();
        const args = document.getElementById('mcp-field-args').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (args.length) cfg.args = args;
        const env = kvToObject(document.getElementById('mcp-field-env').value);
        if (Object.keys(env).length) cfg.env = env;
    } else {
        cfg.url = document.getElementById('mcp-field-url').value.trim();
        const headers = kvToObject(document.getElementById('mcp-field-headers').value);
        if (Object.keys(headers).length) cfg.headers = headers;
        const scope = document.getElementById('mcp-field-scope').value.trim();
        if (scope) cfg.scope = scope;
    }
    return cfg;
}

/** A server as it is written in mcp.json: no name, no runtime fields, no empty values. */
function mcpConfigForJson(cfg) {
    const out = {};
    Object.entries(cfg || {}).forEach(([key, value]) => {
        if (key === 'name' || key === 'status') return;
        if (key === 'type' && value === 'stdio') return;
        if (value === '' || value === null || value === undefined || value === false) return;
        if (Array.isArray(value) && !value.length) return;
        if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return;
        out[key] = value;
    });
    return out;
}

function mcpServersToJson(servers) {
    const map = {};
    servers.forEach(s => { map[s.name || 'my-server'] = mcpConfigForJson(s); });
    return JSON.stringify({ mcpServers: map }, null, 2);
}

/**
 * Read the JSON pane. Accepts the {"mcpServers": {...}} file format that MCP
 * directories publish, a bare {name: config} map, a list, or one config that
 * carries its own "name".
 */
function parseMcpJson(text) {
    const raw = String(text || '').trim();
    if (!raw) throw new Error(t('mcp_json_empty'));
    let obj;
    try {
        obj = JSON.parse(raw);
    } catch (err) {
        throw new Error(`${t('mcp_json_invalid')}: ${err.message}`);
    }
    const fromMap = (map) => Object.entries(map).map(([name, cfg]) => {
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
            throw new Error(`${t('mcp_json_invalid')}: ${name}`);
        }
        return { ...cfg, name };
    });
    let servers;
    if (Array.isArray(obj)) {
        servers = obj;
    } else if (obj && typeof obj === 'object') {
        if (obj.mcpServers && typeof obj.mcpServers === 'object') {
            servers = fromMap(obj.mcpServers);
        } else if ('command' in obj || 'url' in obj || 'serverUrl' in obj) {
            if (!obj.name) throw new Error(t('mcp_json_need_name'));
            servers = [obj];
        } else {
            servers = fromMap(obj);
        }
    } else {
        throw new Error(t('mcp_json_invalid'));
    }
    servers = servers.map(s => {
        const cfg = { ...s };
        if (!cfg.url && cfg.serverUrl) cfg.url = cfg.serverUrl;
        delete cfg.serverUrl;
        delete cfg.status;
        return cfg;
    });
    if (!servers.length) throw new Error(t('mcp_json_empty'));
    return servers;
}

function switchMcpTab(tab) {
    if (tab === mcpEditorTab) return;
    const jsonEl = document.getElementById('mcp-field-json');
    if (tab === 'json') {
        const cfg = readMcpEditor();
        const touched = cfg.name || cfg.command || cfg.url;
        if (touched) jsonEl.value = mcpServersToJson([cfg]);
    } else if (jsonEl.value.trim()) {
        let servers;
        try {
            servers = parseMcpJson(jsonEl.value);
        } catch (err) {
            showMcpError(err.message);
            return;
        }
        if (servers.length > 1) {
            showMcpError(t('mcp_json_multi_to_form'));
            return;
        }
        const next = { ...servers[0] };
        if (mcpEditorOriginalName) next.name = mcpEditorOriginalName;
        fillMcpEditor(next);
        document.getElementById('mcp-field-name').disabled = !!mcpEditorOriginalName;
    }
    clearMcpResult();
    showMcpTab(tab);
    if (tab === 'json') jsonEl.focus();
}

function showMcpTab(tab) {
    mcpEditorTab = tab;
    document.querySelectorAll('[data-mcp-tab]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mcpTab === tab);
    });
    document.getElementById('mcp-pane-form').classList.toggle('hidden', tab !== 'form');
    document.getElementById('mcp-pane-json').classList.toggle('hidden', tab !== 'json');
}

/** The servers the editor currently describes, whichever tab is showing. */
function readMcpEditorServers() {
    if (mcpEditorTab === 'json') {
        const servers = parseMcpJson(document.getElementById('mcp-field-json').value);
        if (mcpEditorOriginalName && servers.length > 1) throw new Error(t('mcp_json_edit_single'));
        return servers;
    }
    const cfg = readMcpEditor();
    if (!cfg.name) throw new Error(t('mcp_name_required'));
    return [cfg];
}

function openMcpEditor(server) {
    mcpEditorOriginalName = server ? server.name : null;
    showMcpTab('form');
    fillMcpEditor(server);
    document.getElementById('mcp-field-json').value = server ? mcpServersToJson([server]) : '';
    clearMcpResult();
    const title = document.getElementById('mcp-editor-title');
    const key = server ? 'mcp_edit' : 'mcp_add_title';
    title.dataset.i18n = key;
    title.textContent = t(key);
    document.getElementById('mcp-editor-overlay').classList.remove('hidden');
    if (!server) setTimeout(() => document.getElementById('mcp-field-name')?.focus(), 30);
}

function closeMcpEditor() {
    document.getElementById('mcp-editor-overlay').classList.add('hidden');
    document.getElementById('mcp-field-type')?.classList.remove('open');
    mcpEditorOriginalName = null;
}

async function persistMcpServers(servers) {
    const data = await postJson('/api/mcp/servers', { servers }, 'PUT');
    if (data.status !== 'success') throw new Error(data.message || t('mcp_save_error'));
    mcpServersCache = data.servers || servers;
    mcpPollDeadline = 0;
    loadMcpSection();
    return data;
}

/** After a failed check, the next save skips it: the user has seen why and chose to keep the config. */
function setMcpSaveAnyway(on) {
    if (mcpSaveAnyway === on) return;
    mcpSaveAnyway = on;
    const btn = document.getElementById('mcp-editor-save');
    if (!btn) return;
    const key = on ? 'mcp_save_anyway' : 'mcp_save';
    btn.dataset.i18n = key;
    btn.textContent = t(key);
}

async function saveMcpEditor() {
    const btn = document.getElementById('mcp-editor-save');
    const testBtn = document.getElementById('mcp-editor-test');
    if (btn.disabled) return;
    let servers;
    try {
        servers = readMcpEditorServers();
    } catch (err) {
        showMcpError(err.message);
        return;
    }
    const incoming = new Set(servers.map(s => s.name));
    if (!mcpEditorOriginalName) {
        const clash = mcpServersCache.filter(s => incoming.has(s.name)).map(s => s.name);
        if (clash.length) {
            showMcpError(t('mcp_name_exists').replace('{name}', clash.join(', ')));
            return;
        }
    }
    setButtonBusy(btn, true);
    setButtonBusy(testBtn, true);
    try {
        let notice = t('mcp_saved');
        const active = servers.filter(s => !s.disabled);
        if (!mcpSaveAnyway && active.length) {
            const probes = await runMcpCheck(active);
            // A server waiting for authorization can only be authorized once saved.
            if (!probes.every(p => p.ok || p.needs_auth)) {
                appendMcpResultNote(t('mcp_check_failed'));
                setMcpSaveAnyway(true);
                return;
            }
            const toolCount = probes.reduce((sum, p) => sum + (p.tools || []).length, 0);
            if (toolCount) notice = t('mcp_saved_tools').replace('{n}', toolCount);
        }
        const next = mcpServersCache.filter(s => s.name !== mcpEditorOriginalName && !incoming.has(s.name));
        await persistMcpServers(next.concat(servers));
        closeMcpEditor();
        _wsToast(notice);
    } catch (err) {
        showMcpError(err.message || t('mcp_save_error'));
    } finally {
        setButtonBusy(btn, false);
        setButtonBusy(testBtn, false);
    }
}

function renderMcpToolList(tools) {
    if (!tools.length) {
        return `<p class="mt-2 text-xs opacity-80">${escapeHtml(t('mcp_test_no_tools'))}</p>`;
    }
    const chips = tools.map(tool => `<span class="cap-chip" title="${escapeHtml(tool.description || tool.name)}">${escapeHtml(tool.name)}</span>`).join('');
    return `
        <p class="mt-2.5 mb-1.5 text-xs font-medium opacity-80">${escapeHtml(t('mcp_test_tools'))} (${tools.length})</p>
        <div class="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">${chips}</div>`;
}

/** One probe's outcome. In a mixed batch the box is neutral, so each icon carries its own color. */
function renderMcpProbe(probe, withName, mixed) {
    const tools = (probe.tools || []).filter(x => x && x.name);
    const name = withName ? `<span class="font-mono">${escapeHtml(probe.name)}</span><span class="opacity-50">·</span>` : '';
    if (probe.ok) {
        const color = mixed ? 'text-emerald-500' : '';
        return `
            <div class="flex items-center gap-2 font-medium">
                <i class="fas fa-circle-check ${color}"></i>${name}<span>${escapeHtml(t('mcp_test_ok'))}</span>
            </div>
            ${renderMcpToolList(tools)}`;
    }
    const color = mixed ? 'text-red-500' : '';
    const detail = probe.needs_auth ? t('mcp_test_needs_auth') : (probe.error || '');
    return `
        <div class="flex items-center gap-2 font-medium">
            <i class="fas fa-circle-xmark ${color}"></i>${name}<span>${escapeHtml(t('mcp_test_fail'))}</span>
        </div>
        ${detail ? `<p class="mt-1.5 text-xs break-words opacity-90">${escapeHtml(detail)}</p>` : ''}`;
}

async function probeMcpServer(cfg) {
    try {
        const data = await postJson('/api/mcp/servers/test', { server: { ...cfg, disabled: false } });
        return { name: cfg.name, ...data };
    } catch (err) {
        return { name: cfg.name, ok: false, error: err.message || '' };
    }
}

/** Probe every server and show the outcome in the result box. */
async function runMcpCheck(servers) {
    showMcpResult('info', `
        <div class="flex items-center gap-2">
            <i class="fas fa-spinner fa-spin text-xs"></i><span>${escapeHtml(t('mcp_testing'))}</span>
        </div>`);
    const probes = await Promise.all(servers.map(probeMcpServer));
    const okCount = probes.filter(p => p.ok).length;
    const mixed = okCount > 0 && okCount < probes.length;
    const multi = probes.length > 1;
    const html = probes.map(p => `<div class="${multi ? 'py-2 first:pt-0 last:pb-0' : ''}">${renderMcpProbe(p, multi, mixed)}</div>`).join(
        multi ? '<div class="border-t border-current opacity-10"></div>' : '');
    showMcpResult(mixed ? 'info' : (okCount ? 'ok' : 'fail'), html);
    return probes;
}

function appendMcpResultNote(message) {
    const result = document.getElementById('mcp-test-result');
    if (!result) return;
    result.insertAdjacentHTML('beforeend',
        `<div class="mt-2.5 mb-2 border-t border-current opacity-10"></div><p class="text-xs font-medium">${escapeHtml(message)}</p>`);
    result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function testMcpEditor() {
    const btn = document.getElementById('mcp-editor-test');
    if (btn.disabled) return;
    let servers;
    try {
        servers = readMcpEditorServers();
    } catch (err) {
        showMcpError(err.message);
        return;
    }
    setButtonBusy(btn, true);
    const icon = document.getElementById('mcp-editor-test-icon');
    icon.className = 'fas fa-spinner fa-spin text-xs';
    try {
        await runMcpCheck(servers);
    } finally {
        setButtonBusy(btn, false);
        icon.className = 'fas fa-plug-circle-check text-xs';
    }
}

function deleteMcpServer(name) {
    showConfirmDialog({
        title: t('mcp_delete'),
        message: t('mcp_delete_confirm'),
        okText: t('mcp_delete'),
        onConfirm: async () => {
            try {
                await persistMcpServers(mcpServersCache.filter(s => s.name !== name));
            } catch (err) {
                _wsToast(err.message || t('mcp_save_error'));
            }
        },
    });
}

// ---------------------------------------------------------------------
// Add skill: fetch from a market or upload, preview, then install
// ---------------------------------------------------------------------

const SKILL_SOURCES = {
    hub: { labelKey: 'skill_value_hub', placeholder: 'skill-name', hintKey: 'skill_hint_hub', link: 'https://skills.cowagent.ai/' },
    github: { labelKey: 'skill_value_github', placeholder: 'https://github.com/owner/repo/tree/main/skills/my-skill', hintKey: 'skill_hint_github' },
    clawhub: { labelKey: 'skill_value_clawhub', placeholder: 'skill-name', hintKey: 'skill_hint_clawhub', link: 'https://clawhub.ai/skills' },
};

const SKILL_SOURCE_LABELS = {
    cowhub: 'Cow Skill Hub', github: 'GitHub', clawhub: 'ClawHub', url: 'URL',
};

const SKILL_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

const skillAdd = {
    tab: 'market',
    source: 'hub',
    step: 'input',
    token: null,
    skills: [],
    selected: new Set(),
    busy: false,
    // Bumped when a fetch or upload is abandoned, so its late reply is ignored.
    req: 0,
};

function bindSkillAddUi() {
    const on = (id, evt, fn) => document.getElementById(id)?.addEventListener(evt, fn);
    on('skill-add-btn', 'click', openSkillAdd);
    on('skill-add-close', 'click', closeSkillAdd);
    on('skill-add-cancel', 'click', closeSkillAdd);
    on('skill-add-back', 'click', backToSkillInput);
    on('skill-add-primary', 'click', onSkillAddPrimary);
    on('skill-add-overlay', 'click', (e) => { if (e.target.id === 'skill-add-overlay') closeSkillAdd(); });
    document.querySelectorAll('[data-skill-tab]').forEach(btn => {
        btn.addEventListener('click', () => switchSkillTab(btn.dataset.skillTab));
    });
    document.querySelectorAll('.skill-source-opt').forEach(btn => {
        btn.addEventListener('click', () => setSkillSource(btn.dataset.source));
    });
    on('skill-value-input', 'input', () => { hideSkillInputError(); syncSkillAddFooter(); });
    on('skill-value-input', 'keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); fetchSkillPreview(); }
    });
    on('skill-preview-all', 'change', (e) => {
        skillAdd.selected = e.target.checked ? new Set(skillAdd.skills.map(s => s.name)) : new Set();
        renderSkillPreviewList();
    });

    on('skill-pick-file', 'click', () => document.getElementById('skill-file-input').click());
    on('skill-pick-folder', 'click', () => document.getElementById('skill-folder-input').click());
    on('skill-file-input', 'change', (e) => {
        const files = Array.from(e.target.files || []).map(f => ({ file: f, path: f.name }));
        e.target.value = '';
        uploadSkillFiles(files);
    });
    on('skill-folder-input', 'change', (e) => {
        const files = Array.from(e.target.files || []).map(f => ({ file: f, path: f.webkitRelativePath || f.name }));
        e.target.value = '';
        uploadSkillFiles(files);
    });

    const zone = document.getElementById('skill-dropzone');
    if (zone) {
        ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, (e) => {
            e.preventDefault();
            if (!skillAdd.busy) zone.classList.add('dragover');
        }));
        ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
        }));
        zone.addEventListener('drop', async (e) => {
            if (skillAdd.busy) return;
            const files = await collectDroppedFiles(e.dataTransfer);
            uploadSkillFiles(files);
        });
    }
}

function openSkillAdd() {
    skillAdd.tab = 'market';
    skillAdd.step = 'input';
    skillAdd.token = null;
    skillAdd.skills = [];
    skillAdd.selected = new Set();
    skillAdd.busy = false;
    document.getElementById('skill-value-input').value = '';
    switchSkillTab('market');
    setSkillSource('hub');
    showSkillStep('input');
    document.getElementById('skill-add-overlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('skill-value-input')?.focus(), 30);
}

function closeSkillAdd() {
    if (skillAdd.busy) {
        // Installing is quick and not safely interruptible; fetching can hang on the network.
        if (skillAdd.step !== 'input') return;
        skillAdd.req++;
        setSkillAddBusy(false);
    }
    discardSkillPreview();
    document.getElementById('skill-add-overlay').classList.add('hidden');
}

function discardSkillPreview() {
    if (!skillAdd.token) return;
    const token = skillAdd.token;
    skillAdd.token = null;
    postJson('/api/skills', { action: 'discard', token }).catch(() => {});
}

function switchSkillTab(tab) {
    if (skillAdd.busy) return;
    skillAdd.tab = tab;
    document.querySelectorAll('[data-skill-tab]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.skillTab === tab);
    });
    document.getElementById('skill-pane-market').classList.toggle('hidden', tab !== 'market');
    document.getElementById('skill-pane-upload').classList.toggle('hidden', tab !== 'upload');
    hideSkillInputError();
    syncSkillAddFooter();
}

function setSkillSource(source) {
    const meta = SKILL_SOURCES[source];
    if (!meta) return;
    skillAdd.source = source;
    document.querySelectorAll('.skill-source-opt').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.source === source);
    });
    const label = document.getElementById('skill-value-label');
    label.dataset.i18n = meta.labelKey;
    label.textContent = t(meta.labelKey);
    const input = document.getElementById('skill-value-input');
    input.placeholder = meta.placeholder;
    const hint = document.getElementById('skill-source-hint');
    const link = meta.link
        ? ` <a href="${meta.link}" target="_blank" rel="noopener noreferrer" class="text-primary-500 hover:text-primary-600">${escapeHtml(meta.link.replace(/^https:\/\/|\/$/g, ''))}</a>`
        : '';
    hint.innerHTML = escapeHtml(t(meta.hintKey)) + link;
    hideSkillInputError();
    input.focus();
}

function showSkillInputError(msg) {
    const el = document.getElementById('skill-input-error');
    el.textContent = msg;
    el.classList.remove('hidden');
}

function hideSkillInputError() {
    document.getElementById('skill-input-error')?.classList.add('hidden');
}

function showSkillStep(step) {
    skillAdd.step = step;
    ['input', 'preview', 'done'].forEach(name => {
        document.getElementById(`skill-step-${name}`).classList.toggle('hidden', name !== step);
    });
    const subtitle = document.getElementById('skill-add-subtitle');
    if (step === 'preview') {
        subtitle.textContent = t('skill_preview_title');
        subtitle.classList.remove('hidden');
    } else {
        subtitle.classList.add('hidden');
    }
    syncSkillAddFooter();
}

function setSkillAddBusy(busy) {
    skillAdd.busy = busy;
    document.getElementById('skill-add-primary-spin').classList.toggle('hidden', !busy);
    const zoneIcon = document.getElementById('skill-dropzone-icon');
    if (zoneIcon) {
        zoneIcon.className = busy && skillAdd.tab === 'upload' && skillAdd.step === 'input'
            ? 'fas fa-spinner fa-spin text-primary-500'
            : 'fas fa-file-arrow-up text-slate-400';
    }
    syncSkillAddFooter();
}

function syncSkillAddFooter() {
    const primary = document.getElementById('skill-add-primary');
    const label = document.getElementById('skill-add-primary-label');
    const cancel = document.getElementById('skill-add-cancel');
    const back = document.getElementById('skill-add-back');
    back.classList.toggle('hidden', skillAdd.step !== 'preview');
    back.disabled = skillAdd.busy;
    cancel.classList.toggle('hidden', skillAdd.step === 'done');
    cancel.disabled = skillAdd.busy && skillAdd.step !== 'input';

    let text = '';
    let show = true;
    let enabled = !skillAdd.busy;
    if (skillAdd.step === 'input') {
        if (skillAdd.tab === 'upload') {
            show = skillAdd.busy;
            text = t('skill_uploading');
        } else {
            text = t(skillAdd.busy ? 'skill_fetching' : 'skill_fetch');
            enabled = enabled && !!document.getElementById('skill-value-input').value.trim();
        }
    } else if (skillAdd.step === 'preview') {
        const n = skillAdd.selected.size;
        text = skillAdd.busy ? t('skill_installing') : t('skill_confirm_install_n').replace('{n}', n);
        enabled = enabled && n > 0;
    } else {
        text = t('skill_done');
    }
    primary.classList.toggle('hidden', !show);
    primary.disabled = !enabled;
    label.textContent = text;
}

function onSkillAddPrimary() {
    if (skillAdd.step === 'input') fetchSkillPreview();
    else if (skillAdd.step === 'preview') confirmSkillInstall();
    else finishSkillAdd();
}

async function fetchSkillPreview() {
    if (skillAdd.busy || skillAdd.tab !== 'market') return;
    const value = document.getElementById('skill-value-input').value.trim();
    if (!value) return;
    await stageSkillPreview(() => postJson('/api/skills', { action: 'preview', source: skillAdd.source, value }));
}

async function stageSkillPreview(request) {
    const req = ++skillAdd.req;
    hideSkillInputError();
    setSkillAddBusy(true);
    try {
        const data = await request();
        if (req !== skillAdd.req) {
            if (data && data.token) postJson('/api/skills', { action: 'discard', token: data.token }).catch(() => {});
            return;
        }
        if (data.status !== 'success') throw new Error(data.message || t('skill_install_error'));
        showSkillPreview(data);
    } catch (err) {
        if (req === skillAdd.req) showSkillInputError(err.message || t('skill_install_error'));
    } finally {
        if (req === skillAdd.req) setSkillAddBusy(false);
    }
}

/** Walk a drop: plain files, or folders read through the entries API. */
async function collectDroppedFiles(dataTransfer) {
    const items = Array.from(dataTransfer?.items || []);
    const entries = items.map(item => item.webkitGetAsEntry && item.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) {
        return Array.from(dataTransfer?.files || []).map(f => ({ file: f, path: f.name }));
    }
    const out = [];
    const readAll = (reader) => new Promise((resolve) => {
        const acc = [];
        const next = () => reader.readEntries((batch) => {
            if (!batch.length) { resolve(acc); return; }
            acc.push(...batch);
            next();
        }, () => resolve(acc));
        next();
    });
    const walk = async (entry, prefix) => {
        if (entry.isFile) {
            const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
            if (file) out.push({ file, path: prefix + file.name });
        } else if (entry.isDirectory) {
            const children = await readAll(entry.createReader());
            for (const child of children) await walk(child, `${prefix}${entry.name}/`);
        }
    };
    for (const entry of entries) await walk(entry, '');
    return out;
}

async function uploadSkillFiles(files) {
    if (skillAdd.busy || !files.length) return;
    hideSkillInputError();
    const total = files.reduce((sum, f) => sum + (f.file.size || 0), 0);
    if (total > SKILL_UPLOAD_MAX_BYTES) {
        showSkillInputError(t('skill_upload_too_large'));
        return;
    }
    const form = new FormData();
    files.forEach(({ file, path }) => {
        form.append('files', file, file.name);
        form.append('paths', path);
    });
    await stageSkillPreview(async () => {
        const res = await fetch('/api/skills/upload', { method: 'POST', body: form });
        return res.json();
    });
}

function showSkillPreview(data) {
    discardSkillPreview();
    skillAdd.token = data.token;
    skillAdd.skills = data.skills || [];
    skillAdd.selected = new Set(skillAdd.skills.map(s => s.name));
    const multi = skillAdd.skills.length > 1;
    document.getElementById('skill-preview-count').textContent =
        t('skill_preview_found').replace('{n}', skillAdd.skills.length);
    const allWrap = document.getElementById('skill-preview-all-wrap');
    allWrap.classList.toggle('hidden', !multi);
    allWrap.classList.toggle('flex', multi);
    document.getElementById('skill-preview-error').classList.add('hidden');
    renderSkillPreviewList();
    showSkillStep('preview');
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function skillSourceLabel(source) {
    if (!source) return '';
    if (source === 'local') return t('skill_source_local');
    return SKILL_SOURCE_LABELS[source] || source;
}

function renderSkillPreviewMd(sk) {
    if (!sk.has_skill_md) {
        return `<p class="text-xs text-slate-400">${escapeHtml(t('skill_preview_no_md'))}</p>`;
    }
    const { fields, body } = parseSkillFrontmatter(sk.skill_md);
    const rows = fields.map(([key, value]) => `
        <div class="flex gap-3 text-xs">
            <span class="flex-shrink-0 w-20 font-medium text-slate-400 dark:text-slate-500">${escapeHtml(key)}</span>
            <span class="flex-1 min-w-0 text-slate-600 dark:text-slate-300 break-words">${escapeHtml(value)}</span>
        </div>`).join('');
    const header = rows ? `<div class="mb-3 pb-3 border-b border-slate-200/70 dark:border-white/10 space-y-1">${rows}</div>` : '';
    const truncated = sk.skill_md_truncated
        ? `<p class="mt-3 text-xs text-slate-400">${escapeHtml(t('skill_preview_truncated'))}</p>` : '';
    return `${header}<div class="msg-content">${renderMarkdown(body || '')}</div>${truncated}`;
}

function renderSkillPreviewList() {
    const listEl = document.getElementById('skill-preview-list');
    const multi = skillAdd.skills.length > 1;
    listEl.innerHTML = '';
    skillAdd.skills.forEach(sk => {
        const selected = skillAdd.selected.has(sk.name);
        const card = document.createElement('div');
        card.className = 'skill-preview-card' + (selected ? '' : ' unselected');
        const title = sk.display_name || sk.name;
        const extra = [
            `<span><i class="far fa-file mr-1"></i>${escapeHtml(t('skill_preview_files').replace('{n}', sk.file_count))}</span>`,
            `<span>${escapeHtml(formatBytes(sk.size))}</span>`,
        ];
        const source = skillSourceLabel(sk.source);
        if (source) extra.push(`<span>${escapeHtml(source)}</span>`);
        card.innerHTML = `
            <div class="flex items-start gap-3 p-4">
                ${multi ? `<input type="checkbox" data-select class="mt-2.5 rounded accent-primary-500 cursor-pointer" ${selected ? 'checked' : ''}>` : ''}
                <div class="w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-bolt text-primary-500 text-sm"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-medium text-sm text-slate-800 dark:text-slate-100">${escapeHtml(title)}</span>
                        ${title !== sk.name ? `<span class="text-xs font-mono text-slate-400">${escapeHtml(sk.name)}</span>` : ''}
                        ${sk.exists ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">${escapeHtml(t('skill_preview_exists'))}</span>` : ''}
                    </div>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-3">${escapeHtml(sk.description || '--')}</p>
                    <div class="flex items-center gap-2.5 mt-2 text-[11px] text-slate-400 dark:text-slate-500">${extra.join('<span class="opacity-40">·</span>')}</div>
                    <div class="flex items-center gap-1 mt-2 -ml-2">
                        <button type="button" data-toggle="md" class="cap-link-btn">
                            <i class="fas fa-chevron-right text-[9px] transition-transform"></i><span>SKILL.md</span>
                        </button>
                        <button type="button" data-toggle="files" class="cap-link-btn">
                            <i class="fas fa-chevron-right text-[9px] transition-transform"></i><span>${escapeHtml(t('skill_preview_show_files'))}</span>
                        </button>
                    </div>
                </div>
            </div>
            <div data-pane="md" class="skill-preview-md hidden"></div>
            <div data-pane="files" class="skill-preview-files hidden"></div>`;

        const panes = {
            md: card.querySelector('[data-pane="md"]'),
            files: card.querySelector('[data-pane="files"]'),
        };
        const toggle = (which, open) => {
            const pane = panes[which];
            const isOpen = open !== undefined ? open : pane.classList.contains('hidden');
            if (isOpen && !pane.dataset.rendered) {
                if (which === 'md') {
                    pane.innerHTML = renderSkillPreviewMd(sk);
                    applyHighlighting(pane);
                } else {
                    const more = sk.file_count > sk.files.length
                        ? `<div class="opacity-60">… +${sk.file_count - sk.files.length}</div>` : '';
                    pane.innerHTML = sk.files.map(f => `<div class="truncate">${escapeHtml(f)}</div>`).join('') + more;
                }
                pane.dataset.rendered = '1';
            }
            pane.classList.toggle('hidden', !isOpen);
            const icon = card.querySelector(`[data-toggle="${which}"] i`);
            if (icon) icon.style.transform = isOpen ? 'rotate(90deg)' : '';
        };
        card.querySelectorAll('[data-toggle]').forEach(btn => {
            btn.addEventListener('click', () => toggle(btn.dataset.toggle));
        });
        const checkbox = card.querySelector('[data-select]');
        if (checkbox) {
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) skillAdd.selected.add(sk.name);
                else skillAdd.selected.delete(sk.name);
                card.classList.toggle('unselected', !checkbox.checked);
                document.getElementById('skill-preview-all').checked =
                    skillAdd.selected.size === skillAdd.skills.length;
                syncSkillAddFooter();
            });
        }
        if (!multi) toggle('md', true);
        listEl.appendChild(card);
    });
    document.getElementById('skill-preview-all').checked = skillAdd.selected.size === skillAdd.skills.length;
    syncSkillAddFooter();
}

function backToSkillInput() {
    if (skillAdd.busy) return;
    discardSkillPreview();
    skillAdd.skills = [];
    skillAdd.selected = new Set();
    showSkillStep('input');
}

async function confirmSkillInstall() {
    if (skillAdd.busy || !skillAdd.token || !skillAdd.selected.size) return;
    const errorEl = document.getElementById('skill-preview-error');
    errorEl.classList.add('hidden');
    setSkillAddBusy(true);
    try {
        const data = await postJson('/api/skills', {
            action: 'confirm',
            token: skillAdd.token,
            names: Array.from(skillAdd.selected),
        });
        if (data.status !== 'success') throw new Error(data.message || t('skill_install_error'));
        skillAdd.token = null;
        showSkillDone(data.installed || []);
    } catch (err) {
        errorEl.textContent = err.message || t('skill_install_error');
        errorEl.classList.remove('hidden');
    } finally {
        setSkillAddBusy(false);
    }
}

function showSkillDone(installed) {
    skillAdd.installed = installed;
    const byName = Object.fromEntries(skillAdd.skills.map(s => [s.name, s]));
    document.getElementById('skill-done-desc').textContent =
        t('skill_installed_desc').replace('{n}', installed.length);
    document.getElementById('skill-done-names').innerHTML = installed.map(name => {
        const sk = byName[name] || {};
        return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200">
            <i class="fas fa-bolt text-primary-500 text-[10px]"></i>${escapeHtml(sk.display_name || name)}</span>`;
    }).join('');
    showSkillStep('done');
    loadSkillsSection(installed);
}

function finishSkillAdd() {
    document.getElementById('skill-add-overlay').classList.add('hidden');
    const first = (skillAdd.installed || [])[0];
    const card = first && document.querySelector(`#skills-list [data-skill-name="${CSS.escape(first)}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------------------------------------------------------------------
// Installed skills
// ---------------------------------------------------------------------

function deleteSkill(name) {
    showConfirmDialog({
        title: t('skill_delete'),
        message: t('skill_delete_confirm'),
        okText: t('skill_delete'),
        onConfirm: async () => {
            try {
                const data = await postJson('/api/skills', { action: 'delete', name });
                if (data.status !== 'success') throw new Error(data.message || t('skill_delete_error'));
                loadSkillsSection();
            } catch (err) {
                _wsToast(err.message || t('skill_delete_error'));
            }
        },
    });
}

/** Reload the skill cards; `highlight` names get a brief ring so a fresh install is easy to spot. */
function loadSkillsSection(highlight) {
    const emptyEl = document.getElementById('skills-empty');
    const listEl = document.getElementById('skills-list');
    const badge = document.getElementById('skills-count-badge');
    const fresh = new Set(highlight || []);

    return fetch('/api/skills').then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        const skills = data.skills || [];
        badge.textContent = skills.length;
        badge.classList.toggle('hidden', skills.length === 0);
        listEl.innerHTML = '';
        if (skills.length === 0) {
            emptyEl.classList.remove('hidden');
            const title = emptyEl.querySelector('p');
            if (title) { title.dataset.i18n = 'skills_empty'; title.textContent = t('skills_empty'); }
            const desc = emptyEl.querySelectorAll('p')[1];
            if (desc) { desc.dataset.i18n = 'skills_empty_hint'; desc.textContent = t('skills_empty_hint'); }
            return;
        }
        emptyEl.classList.add('hidden');

        skills.forEach(sk => {
            const card = document.createElement('div');
            card.className = 'bg-white dark:bg-[#1A1A1A] rounded-xl border border-slate-200 dark:border-white/10 '
                + 'p-4 flex items-start gap-3 transition-opacity cursor-pointer '
                + 'hover:border-slate-300 dark:hover:border-white/20';
            card.dataset.skillName = sk.name;
            card.dataset.skillDesc = sk.description || '';
            card.dataset.skillDisplayName = sk.display_name || '';
            card.dataset.enabled = sk.enabled ? '1' : '0';
            card.dataset.deletable = sk.deletable ? '1' : '0';
            renderSkillCard(card, sk);
            if (fresh.has(sk.name)) {
                card.classList.add('cap-flash');
                setTimeout(() => card.classList.remove('cap-flash'), 2600);
            }
            listEl.appendChild(card);
        });
    }).catch(() => {});
}

function renderSkillCard(card, sk) {
    const enabled = sk.enabled;
    const iconColor = enabled ? 'text-primary-500' : 'text-slate-300 dark:text-slate-600';
    const trackClass = enabled
        ? 'bg-primary-400'
        : 'bg-slate-200 dark:bg-slate-700';
    const thumbTranslate = enabled ? 'translate-x-3' : 'translate-x-0.5';
    card.innerHTML = `
        <div class="w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center flex-shrink-0">
            <i class="fas fa-bolt ${iconColor} text-sm"></i>
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
                <span class="font-medium text-sm text-slate-700 dark:text-slate-200 truncate flex-1">${escapeHtml(sk.display_name || sk.name)}</span>
                <button
                    data-skill-edit
                    class="flex-shrink-0 p-1 -mx-1 -mt-1.5 -mb-1 rounded text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-300 transition-colors"
                    title="${t('skill_edit_hint')}"
                >
                    <i class="fas fa-pen text-[10px]"></i>
                </button>
                ${sk.deletable ? `
                <button
                    data-skill-delete
                    class="flex-shrink-0 p-1 -mx-1 -mt-1.5 -mb-1 rounded text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                    title="${t('skill_delete')}"
                >
                    <i class="fas fa-trash text-[10px]"></i>
                </button>` : ''}
                <button
                    role="switch"
                    data-skill-switch
                    aria-checked="${enabled}"
                    class="relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${trackClass}"
                    title="${t(enabled ? 'skill_click_disable' : 'skill_click_enable')}"
                >
                    <span class="inline-block h-3 w-3 mt-0.5 rounded-full bg-white shadow transform transition-transform duration-200 ease-in-out ${thumbTranslate}"></span>
                </button>
            </div>
            <p class="text-xs text-slate-400 dark:text-slate-500 line-clamp-2">${escapeHtml(sk.description || '--')}</p>
        </div>`;

    // Bound here rather than written into the markup above: a skill name comes
    // from its own frontmatter, and one containing a quote would break out of
    // an inline onclick attribute.
    card.title = t('skill_open_hint');
    card.onclick = () => openSkillFile(sk.name);
    const editBtn = card.querySelector('[data-skill-edit]');
    if (editBtn) {
        editBtn.onclick = (e) => {
            e.stopPropagation();
            openSkillFile(sk.name, { edit: true });
        };
    }
    const deleteBtn = card.querySelector('[data-skill-delete]');
    if (deleteBtn) {
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteSkill(sk.name);
        };
    }
    const sw = card.querySelector('[data-skill-switch]');
    if (sw) {
        sw.onclick = (e) => {
            e.stopPropagation();
            toggleSkill(sk.name, enabled);
        };
    }
}

function toggleSkill(name, currentlyEnabled) {
    const action = currentlyEnabled ? 'close' : 'open';
    const card = document.querySelector(`[data-skill-name="${CSS.escape(name)}"]`);
    if (card) card.style.opacity = '0.5';

    postJson('/api/skills', { action, name })
    .then(data => {
        if (card) card.style.opacity = '1';
        if (data.status !== 'success') {
            _wsToast(t('skill_toggle_error'));
            return;
        }
        if (card) {
            card.dataset.enabled = currentlyEnabled ? '0' : '1';
            renderSkillCard(card, {
                name: name,
                description: card.dataset.skillDesc || '',
                display_name: card.dataset.skillDisplayName || '',
                enabled: !currentlyEnabled,
                deletable: card.dataset.deletable === '1',
            });
        }
    })
    .catch(() => {
        if (card) card.style.opacity = '1';
        _wsToast(t('skill_toggle_error'));
    });
}

// ---------------------------------------------------------------------
// Skill viewer / editor
// ---------------------------------------------------------------------

/**
 * Skills are addressed by name, not by path: which file a name resolves to is
 * the loader's business, and a builtin skill lives outside the workspace that
 * the file APIs are confined to.
 */
async function skillReadContent(name) {
    const res = await fetch(`/api/skills/content?name=${encodeURIComponent(name)}`);
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || 'read failed');
    return data;
}

/** Save a skill's definition. Returns the raw response, a conflict included. */
async function skillWriteContent(name, content, expectedMtime) {
    const res = await fetch('/api/skills/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, content: content, expected_mtime: expectedMtime }),
    });
    return res.json();
}

/** The i18n key explaining why a skill cannot be edited, or null if it can. */
function skillReadonlyReason(data) {
    if (data.editable) return null;
    // Not `source === 'builtin'`: the workspace copy of a builtin skill reads
    // back as `custom` and is refused all the same, so the server says so.
    if (data.ships_with_install) return 'skill_builtin_readonly';
    return docUneditableReason(data);
}

/**
 * Split a skill's SKILL.md into its YAML frontmatter fields and the markdown
 * body. The `---` header is metadata, not prose: fed to the markdown renderer
 * as-is it turns into a giant bold heading and a horizontal rule. Pull it out
 * so the viewer can present name/description as a proper header instead.
 *
 * @returns {{fields: Array<[string, string]>, body: string}}
 */
function parseSkillFrontmatter(content) {
    const text = content || '';
    const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
    if (!match) return { fields: [], body: text };

    const fields = [];
    for (const raw of match[1].split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        // Drop surrounding quotes a YAML scalar may carry.
        value = value.replace(/^['"]|['"]$/g, '');
        if (key) fields.push([key, value]);
    }
    return { fields, body: text.slice(match[0].length) };
}

/**
 * Render a skill's content into the viewer: the frontmatter as a titled header,
 * the remainder as markdown.
 */
function skillRenderBody(content) {
    const el = document.getElementById('skill-viewer-content');
    if (!el) return;
    const { fields, body } = parseSkillFrontmatter(content);

    let headerHtml = '';
    if (fields.length) {
        const rows = fields.map(([key, value]) => `
            <div class="flex gap-3 text-sm">
                <span class="flex-shrink-0 w-24 font-medium text-slate-400 dark:text-slate-500">${escapeHtml(key)}</span>
                <span class="flex-1 min-w-0 text-slate-700 dark:text-slate-200 break-words">${escapeHtml(value)}</span>
            </div>`).join('');
        headerHtml = `
            <div class="mb-5 pb-5 border-b border-slate-100 dark:border-white/10 space-y-2">
                ${rows}
            </div>`;
    }

    el.innerHTML = headerHtml + `<div class="msg-content">${renderMarkdown(body || '')}</div>`;
    applyHighlighting(el);
}

const skillEditor = createDocEditor({
    body: () => document.getElementById('skill-viewer-content'),
    buttons: () => ({
        edit: document.getElementById('skill-btn-edit'),
        save: document.getElementById('skill-btn-save'),
        cancel: document.getElementById('skill-btn-cancel'),
    }),
    read: (doc) => skillReadContent(doc.name),
    write: (doc, content, mtime) => skillWriteContent(doc.name, content, mtime),
    render: (doc) => skillRenderBody(doc.content),
    canEdit: (doc) => !doc.readonlyKey,
    refusal: skillReadonlyReason,
    onState: (state) => docRenderTitle('skill-viewer-title', skillEditor.current()?.name, state),
});

function openSkillFile(name, opts) {
    const startEditing = !!(opts && opts.edit);
    skillReadContent(name).then(data => {
        const badge = document.getElementById('skill-viewer-readonly');
        const readonlyKey = skillReadonlyReason(data);
        if (badge) {
            badge.classList.toggle('hidden', !readonlyKey);
            if (readonlyKey) {
                // Keep data-i18n in step so a language switch re-translates it.
                badge.dataset.i18n = readonlyKey;
                badge.textContent = t(readonlyKey);
                badge.title = t(readonlyKey);
            }
        }
        document.getElementById('skills-panel-list').classList.add('hidden');
        document.getElementById('skills-panel-viewer').classList.remove('hidden');
        skillEditor.open({
            name: data.name || name,
            content: data.content || '',
            readonlyKey: readonlyKey,
        });
        // The pencil on a card jumps straight into editing, skipping the
        // read-only view - but only where the skill is actually editable.
        if (startEditing && !readonlyKey) skillEditor.start();
    }).catch(e => _wsToast(`${t('skill_load_failed')}: ${e.message}`));
}

function closeSkillViewer() {
    if (!skillEditor.guard(closeSkillViewer)) return;
    resetSkillViewer();
    // A saved edit can change the name and description in the frontmatter, so
    // the cards behind this panel may be out of date.
    loadSkillsSection();
}

/** Drop the viewer and show the list, without asking about unsaved edits. */
function resetSkillViewer() {
    skillEditor.forget();
    document.getElementById('skills-panel-viewer')?.classList.add('hidden');
    document.getElementById('skills-panel-list')?.classList.remove('hidden');
}

