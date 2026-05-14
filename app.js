// ═══════════════════════════════════════════════════════════
// STATIC IMAGE ASSETS
// ═══════════════════════════════════════════════════════════
(function(){
  const wcSrc = 'images/wc-logo.png';
  ['wc-logo-img','splash-logo-img','wc-logo-sidebar'].forEach(id => {
    const el = document.getElementById(id);
    if(el && !el.getAttribute('src')) el.src = wcSrc;
  });
})();

let col = {};       // id (uppercase) -> count
let buf = '';       // numpad digit buffer
let curTeam = '00'; // selected team key
let gf = 'all';    // grid filter
let tradStream = null;
let tradRaf = null;
let removeTarget = null;
let currentFriendMissingState = { name: '', ids: [] };

function trackEvent(eventName, params={}){
  try{
    if(typeof window.gtag === 'function'){
      window.gtag('event', eventName, params || {});
    }
  }catch(_){ }
}

function officialAlbumIds(){
  return (typeof OFFICIAL_ALBUM_IDS !== 'undefined' && Array.isArray(OFFICIAL_ALBUM_IDS)) ? OFFICIAL_ALBUM_IDS : ALL_IDS;
}
function isOfficialAlbumId(id){
  const up = String(id || '').toUpperCase();
  if(typeof OFFICIAL_ALBUM_ID_SET !== 'undefined') return OFFICIAL_ALBUM_ID_SET.has(up);
  return !!STICKER_MAP[up];
}

function isCocaColaId(id){
  return /^CC\d{1,2}$/i.test(String(id || '').trim());
}

function inferGotFromMissingSet(missSet, explicitIds=[]){
  const explicit = new Set(explicitIds.map(id => String(id || '').toUpperCase()).filter(Boolean));
  const hasExplicitCC = [...missSet].some(isCocaColaId) || [...explicit].some(isCocaColaId);
  return officialAlbumIds().filter(id => {
    const up = String(id).toUpperCase();
    if(missSet.has(up)) return false;
    // Compatibilidad: algunas versiones viejas no incluían CC en la lista de faltantes.
    // En ese caso NO asumimos que el amigo las tiene, porque inflaba 14 figuritas.
    if(isCocaColaId(up) && !hasExplicitCC) return false;
    return true;
  });
}

let undoSnapshot = null;

// ═══════════════════════════════════════════════════════════
// ONLINE FRIEND SYNC (Supabase)
// ═══════════════════════════════════════════════════════════
// Pegá acá los datos de tu proyecto Supabase.
// Estos datos NO son la API key secreta de OpenAI; el anon key de Supabase está pensado para usarse en frontend con RLS.
const SUPABASE_URL = 'https://xcaqlqmpvelzhvcejqdz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Z98vUM6TdhWmlABzSYnxCg_03jUw2Th';

let onlineSyncTimer = null;
let onlineFriendsRefreshTimer = null;
let supabaseClient = null;
let updatingOnlineFriendIndexes = new Set();


function haptic(ms=10){
  try{
    if(navigator.vibrate) navigator.vibrate(ms);
  }catch(_){}
}

async function copyTextToClipboard(text){
  const value = String(text || '');

  if(navigator.clipboard && window.isSecureContext){
    try{
      await navigator.clipboard.writeText(value);
      return true;
    }catch(_){}
  }

  try{
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    ta.style.fontSize = '16px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  }catch(_){
    return false;
  }
}

function showManualCopyBox(text, title = 'Copiar'){
  const value = String(text || '');
  let overlay = document.getElementById('manual-copy-overlay');

  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'manual-copy-overlay';
    overlay.className = 'manual-copy-overlay';
    overlay.innerHTML = `
      <div class="manual-copy-card" role="dialog" aria-modal="true">
        <div class="manual-copy-title" id="manual-copy-title">Copiar</div>
        <div class="manual-copy-help">Si tu iPhone no copia automáticamente, mantené apretado el texto y elegí copiar.</div>
        <textarea class="manual-copy-text" id="manual-copy-text" readonly></textarea>
        <div class="manual-copy-actions">
          <button class="btn btn-g" type="button" id="manual-copy-select">Seleccionar</button>
          <button class="btn btn-s" type="button" id="manual-copy-close">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#manual-copy-close')?.addEventListener('click', ()=>{
      overlay.classList.remove('show');
    });
    overlay.addEventListener('click', e=>{
      if(e.target === overlay) overlay.classList.remove('show');
    });
    overlay.querySelector('#manual-copy-select')?.addEventListener('click', ()=>{
      const ta = overlay.querySelector('#manual-copy-text');
      if(!ta) return;
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
    });
  }

  const titleEl = overlay.querySelector('#manual-copy-title');
  const textEl = overlay.querySelector('#manual-copy-text');
  if(titleEl) titleEl.textContent = title;
  if(textEl){
    textEl.value = value;
    setTimeout(()=>{
      textEl.focus();
      textEl.select();
      textEl.setSelectionRange(0, textEl.value.length);
    }, 60);
  }
  overlay.classList.add('show');
}


function cloneColState(){
  return JSON.parse(JSON.stringify(col || {}));
}

function rememberUndo(label){
  undoSnapshot = {
    col: cloneColState(),
    label: label || 'Cambio'
  };
}

function refreshAfterCollectionChange(){
  save();
  syncCompletedTeamsState();
  updateStats();
  if(isActive('album')) renderGrid();
  if(isActive('dupes')) renderDupes();
  if(isActive('summary')) renderTeamSummary();
  if(isActive('trade')){ updateTradeSummary(); renderFriends(); genQR(); }
  if(window._refreshScrollAid) setTimeout(()=>window._refreshScrollAid(false), 80);
}

function undoLastChange(){
  if(!undoSnapshot) return;
  col = {...undoSnapshot.col};
  undoSnapshot = null;
  refreshAfterCollectionChange();
  toast('Último cambio deshecho','info');
}


// ═══════════════════════════════════════════════════════════
// PERSIST
// ═══════════════════════════════════════════════════════════
let lastSavedAt = null;
let saveIndicatorTimer = null;

function savedTextAndDelay(){
  if(!lastSavedAt) return { text:'', delay:60000 };
  const diff = Math.max(0, Date.now() - lastSavedAt);
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(diff / 60000);
  const hr  = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);

  if(sec < 60){
    return { text:'Último cambio: recién', delay: Math.max(1000, 60000 - diff) };
  }
  if(min < 60){
    // Del minuto 1 al 10 se actualiza minuto a minuto.
    // Después vuelve a actualizarse cada 5 minutos.
    if(min <= 10){
      const next = (min + 1) * 60000;
      return { text:`Último cambio: hace ${min} min`, delay: Math.max(10000, next - diff) };
    }
    const rounded = Math.max(10, Math.floor(min / 5) * 5);
    const next = (rounded + 5) * 60000;
    return { text:`Último cambio: hace ${rounded} min`, delay: Math.max(10000, next - diff) };
  }
  if(hr < 24){
    const label = hr === 1 ? '1 hora' : `${hr} horas`;
    const next = (hr + 1) * 3600000;
    return { text:`Último cambio: hace ${label}`, delay: Math.max(30000, next - diff) };
  }
  const label = day === 1 ? '1 día' : `${day} días`;
  const next = (day + 1) * 86400000;
  return { text:`Último cambio: hace ${label}`, delay: Math.max(60000, next - diff) };
}

function updateSaveIndicator(){
  const {text, delay} = savedTextAndDelay();
  ['save-indicator','save-indicator-inline'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.textContent = text;
  });
  clearTimeout(saveIndicatorTimer);
  saveIndicatorTimer = setTimeout(updateSaveIndicator, delay);
}

function loadLastChange(){
  const ts = Number(localStorage.getItem('pn26_last_change') || 0);
  lastSavedAt = Number.isFinite(ts) && ts > 0 ? ts : null;
  updateSaveIndicator();
}

function markSaved(){
  lastSavedAt = Date.now();
  localStorage.setItem('pn26_last_change', String(lastSavedAt));
  updateSaveIndicator();
}

function save(opts={}){
  localStorage.setItem('pn26v2', JSON.stringify(col));
  if(!opts.silent){
    markSaved();
    scheduleOnlineProfileSync();
    scheduleSharedAlbumPush();
  }
}

function load(){
  try{
    const r = localStorage.getItem('pn26v2');
    if(!r) return;

    const raw = JSON.parse(r);
    const source = (raw && typeof raw === 'object' && raw.collection && typeof raw.collection === 'object')
      ? raw.collection
      : raw;

    col = {};
    const known = new Set(ALL_IDS.map(id => id.toUpperCase()));
    let fixed = 0;

    if(source && typeof source === 'object' && !Array.isArray(source)){
      for(const [k,v] of Object.entries(source)){
        const id = String(k || '').toUpperCase().trim();
        const qty = Math.floor(Number(v));

        if(!known.has(id) || !Number.isFinite(qty) || qty <= 0){
          fixed++;
          continue;
        }

        // Cantidades absurdas suelen venir de datos corruptos o import raro.
        const safeQty = Math.min(qty, 99);
        if(safeQty !== qty) fixed++;
        col[id] = safeQty;
      }
    } else {
      fixed++;
    }

    save({silent:true});

    if(fixed > 0){
      setTimeout(()=>toast(`Se corrigieron ${fixed} datos inválidos`,'info'), 700);
    }
  }catch(e){
    col = {};
    localStorage.removeItem('pn26v2');
    setTimeout(()=>toast('Se corrigieron datos inválidos','info'), 700);
  }
}

// ═══════════════════════════════════════════════════════════
// TEAM SELECTOR INIT
// ═══════════════════════════════════════════════════════════
function initTeamSel(){
  const sel = document.getElementById('team-sel');
  sel.innerHTML = TEAMS.map(t => `<option value="${t.key}">${t.label}</option>`).join('');
  sel.value = curTeam;
}

function onTeamChange(){
  curTeam = document.getElementById('team-sel').value;
  buf = '';
  redisplay();
}

// ═══════════════════════════════════════════════════════════
// NUMPAD
// ═══════════════════════════════════════════════════════════
function nk(v){
  if(v==='del'){ buf=buf.slice(0,-1); redisplay(); return; }
  if(v==='add'){ commit(); return; }
  if(buf.length >= 3) return;
  buf += v;
  redisplay();
}

function resolveId(teamKey, numStr){
  if(!numStr) return null;
  // Special teams: CC uses just numbers (CC1..CC14), 00 is just '00'
  let id;
  if(teamKey === '00') id = '00';
  else if(teamKey === 'CC') id = `CC${numStr}`;
  else if(teamKey === 'FWC') id = `FWC-${numStr}`;
  else id = `${teamKey}-${numStr}`;
  return id.toUpperCase();
}

function redisplay(){
  const dv = document.getElementById('dval');
  const dn = document.getElementById('dname');
  const box = document.getElementById('disp');
  if(!buf){ dv.textContent='--'; dn.textContent='\u00a0'; box.className='display'; return; }
  const id = resolveId(curTeam, buf);
  const info = id ? STICKER_MAP[id] : null;
  dv.textContent = id || buf;
  if(info){
    dn.textContent = info.name;
    box.className = col[id] > 0 ? 'display dup' : 'display ok';
  } else {
    dn.textContent = 'No encontrada';
    box.className = 'display bad';
  }
}

function commit(){
  const id = resolveId(curTeam, buf);
  buf = ''; redisplay();
  if(!id || !STICKER_MAP[id]){ showFb('bad','❌ Figurita no encontrada'); return; }
  reg(id);
}



// ═══════════════════════════════════════════════════════════
// REGISTER
// ═══════════════════════════════════════════════════════════
function reg(id){
  id = id.toUpperCase();
  const info = STICKER_MAP[id];
  if(!info){ showFb('bad','❌ Figurita no encontrada'); return; }
  rememberUndo(`agregar ${id}`);
  haptic(10);
  const had = col[id] > 0;
  col[id] = (col[id]||0) + 1;
  save(); updateStats();
  trackEvent('sticker_marked', { id, team: info.team || '', count: col[id], source: 'numpad', repeated: had });
  const holoTag = info.holo ? ' ✨' : '';
  if(had){
    showFb('dup', `🔁 Repetida ${id} ×${col[id]}${holoTag}`);
    toast(`Repetida ${id} ×${col[id]}`, 'warn', {undo:true});
  } else {
    showFb('new', `✅ ${id} – ${info.name}${holoTag}`);
    toast(`Tenés ${id}${holoTag}`, 'ok', {undo:true});
  }
  if(info && !had) setTimeout(()=>checkTeamComplete(info.team), 100);
  if(isActive('album')) renderGrid();
  if(isActive('dupes')) renderDupes();
}

// ═══════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════
function updateStats(){
  const validEntries = Object.entries(col).filter(([id,v]) => STICKER_MAP[id] && isOfficialAlbumId(id) && Number(v) > 0);
  const got = validEntries.length;
  const miss = TOTAL - got;
  const dups = validEntries.reduce((a,[,v])=>a+Math.max(0,Number(v)-1),0);
  const pct = (got/TOTAL*100).toFixed(1);

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if(el) el.textContent = value;
  };
  const setWidth = (id, value) => {
    const el = document.getElementById(id);
    if(el) el.style.width = value;
  };

  // Mobile header
  setText('pct', pct+'%');
  setWidth('pbar', pct+'%');
  setText('smain', `${got} / ${TOTAL}`);
  setText('ms-g', got);
  setText('ms-mi', miss);
  setText('ms-du', dups);

  // Album quick dashboard
  setText('album-quick-miss', miss);
  setText('album-quick-dups', dups);

  // Summary screen
  setText('summary-pct-main', Math.round(got/TOTAL*100)+'%');
  setText('summary-pct', Math.round(got/TOTAL*100)+'%');
  setText('summary-total', TOTAL);
  setText('summary-miss', miss);
  setText('summary-got', got);
  setText('summary-dups', dups);
  const summaryDonut = document.getElementById('summary-donut');
  if(summaryDonut) summaryDonut.style.setProperty('--pct', got/TOTAL*100);

  // Desktop sidebar
  setText('pct-side', pct+'%');
  setText('smain-side', `${got}/${TOTAL}`);
  setWidth('prog-side', pct+'%');
  setText('ms-got-side', got);
  setText('ms-mis-side', miss);
  setText('ms-dup-side', dups);

  updateTradeSummary();
  if(isActive('summary')) renderTeamSummary();
}


let teamSummarySort = 'groups';

function teamDisplayParts(teamInfo){
  const label = teamInfo?.label || '';
  const m = label.match(/^(\S+)\s+([A-Z0-9_]+)\s+·\s+(.+)$/);
  return {
    flag: m ? m[1] : '',
    code: m ? m[2] : (teamInfo?.key || ''),
    name: m ? m[3] : label
  };
}


function progressTeamRows(){
  return TEAMS
    .filter(t => STICKERS_BY_TEAM[t.key] && t.key !== '00')
    .map(t => {
      const stickers = STICKERS_BY_TEAM[t.key] || [];
      const total = stickers.length;
      const got = stickers.filter(st => (col[st.id.toUpperCase()]||0) > 0).length;
      const miss = total - got;
      const pct = total ? Math.round(got / total * 100) : 0;
      return { ...teamDisplayParts(t), key:t.key, got, miss, total, pct };
    });
}

function renderProgressInsights(rows){
  const box = document.getElementById('progress-insights');
  if(!box) return;
  const usable = [...rows].filter(r => r.total > 0);
  const closest = [...usable]
    .filter(r => r.miss > 0)
    .sort((a,b)=> (a.miss - b.miss) || (b.pct - a.pct) || a.name.localeCompare(b.name))
    .slice(0,3);
  const emptiest = [...usable]
    .sort((a,b)=> (b.miss - a.miss) || (a.pct - b.pct) || a.name.localeCompare(b.name))
    .slice(0,3);

  const renderList = arr => arr.map(r => `
    <div class="progress-insight-row">
      <span class="progress-insight-main"><span class="progress-insight-flag">${r.flag}</span><b>${r.name}</b></span>
      <span class="progress-insight-miss">faltan ${r.miss}</span>
    </div>
  `).join('') || '<div class="progress-insight-empty">Sin datos todavía.</div>';

  box.innerHTML = `
    <div class="progress-insight-card">
      <div class="progress-insight-title">Más cerca de completar</div>
      ${renderList(closest)}
    </div>
    <div class="progress-insight-card">
      <div class="progress-insight-title">Más incompletos</div>
      ${renderList(emptiest)}
    </div>
  `;
}

function renderTeamSummary(){
  const list = document.getElementById('team-progress-list');
  if(!list) return;

  const rowsAll = progressTeamRows();
  renderProgressInsights(rowsAll);

  const teamMap = new Map(rowsAll.map(r => [r.key, r]));

  const buildGroup = (name, rows) => {
    const total = rows.reduce((n,r)=>n+r.total,0);
    const got = rows.reduce((n,r)=>n+r.got,0);
    const miss = total - got;
    const pct = total ? Math.round(got/total*100) : 0;
    return { name, rows, total, got, miss, pct };
  };

  const renderGroup = group => `
    <section class="team-progress-group">
      <div class="team-progress-group-head">
        <div>
          <div class="team-progress-group-kicker">${group.rows.length} selecciones</div>
          <div class="team-progress-group-title">${group.name}</div>
        </div>
        <div class="team-progress-group-side">
          <div class="team-progress-group-pct">${group.pct}%</div>
          <div class="team-progress-group-sub">${group.got}/${group.total} · faltan ${group.miss}</div>
        </div>
      </div>
      <div class="team-progress-group-bar"><div style="width:${group.pct}%"></div></div>
      <div class="team-progress-group-list">
        ${group.rows.map(r => `
          <div class="team-progress-row">
            <div class="team-progress-main">
              <div class="team-progress-flag">${r.flag}</div>
              <div class="team-progress-text">
                <div class="team-progress-name"><span>${r.code}</span> ${r.name}</div>
                <div class="team-progress-sub">${r.got}/${r.total} · faltan ${r.miss}</div>
              </div>
            </div>
            <div class="team-progress-side">
              <div class="team-progress-pct">${r.pct}%</div>
              <div class="team-progress-bar"><div style="width:${r.pct}%"></div></div>
            </div>
          </div>
        `).join('')}
      </div>
    </section>`;

  if(teamSummarySort === 'complete' || teamSummarySort === 'missing'){
    const rows = [...teamMap.values()].sort((a,b)=>{
      if(teamSummarySort === 'missing'){
        return (b.miss - a.miss) || (a.pct - b.pct) || a.name.localeCompare(b.name);
      }
      return (b.got - a.got) || (b.pct - a.pct) || a.name.localeCompare(b.name);
    });
    const title = teamSummarySort === 'missing' ? 'Más vacías' : 'Más completas';
    list.innerHTML = renderGroup(buildGroup(title, rows));
    return;
  }

  const groups = WC_GROUPS
    .map(group => buildGroup(
      group.name,
      (group.teams || []).map(key => teamMap.get(key)).filter(Boolean)
    ))
    .filter(g => g.rows.length);

  list.innerHTML = groups.map(renderGroup).join('');
}

function setTeamSummarySort(sort, btn){
  const same = teamSummarySort === sort;
  teamSummarySort = same ? 'groups' : sort;
  document.querySelectorAll('.team-progress-actions .fb2').forEach(b=>b.classList.remove('active'));
  if(btn && !same) btn.classList.add('active');
  renderTeamSummary();
  if(window._refreshScrollAid) setTimeout(()=>window._refreshScrollAid(false), 80);
}


// ═══════════════════════════════════════════════════════════
// GRID
// ═══════════════════════════════════════════════════════════

function searchTokenize(q){
  return normalizeStr(String(q || ''))
    .replace(/[-_.,;:]+/g,' ')
    .split(/\s+/)
    .map(t=>t.trim())
    .filter(Boolean);
}

function parseSearchIntent(q){
  const tokens = searchTokenize(q);
  const compact = normalizeStr(String(q || '')).replace(/[-_\s]+/g,'');

  const wantsDup = tokens.some(t => ['rep','repe','repetida','repetidas','dupe','dupes','duplicada','duplicadas'].includes(t));
  const wantsGot = tokens.some(t => ['tengo','pegadas','pegada','got'].includes(t));
  const wantsMiss = tokens.some(t => ['falta','faltan','faltante','faltantes','miss','missing'].includes(t));

  return { tokens, compact, wantsDup, wantsGot, wantsMiss };
}

function stickerSearchText(s, teamInfo, teamFullName, abbrev){
  return normalizeStr([
    s.id,
    s.id.replace('-',' '),
    s.id.replace('-',''),
    s.name,
    teamFullName,
    abbrev,
    teamInfo.key,
    teamInfo.label
  ].join(' '));
}

function stickerMatchesSearch(s, teamInfo, teamFullName, abbrev, intent){
  if(!intent.tokens.length) return true;

  const idCompact = normalizeStr(s.id).replace(/[-_\s]+/g,'');
  const text = stickerSearchText(s, teamInfo, teamFullName, abbrev);
  const teamText = normalizeStr(`${teamFullName} ${abbrev} ${teamInfo.key} ${teamInfo.label}`);

  // "arg 10", "argentina 10", "mex 13"
  const nums = intent.tokens.filter(t => /^\d{1,3}$/.test(t));
  const words = intent.tokens.filter(t => !/^\d{1,3}$/.test(t) && !['rep','repe','repetida','repetidas','dupe','dupes','duplicada','duplicadas','tengo','pegadas','pegada','got','falta','faltan','faltante','faltantes','miss','missing'].includes(t));

  if(nums.length){
    const numOk = nums.some(n => idCompact.endsWith(n));
    const wordOk = !words.length || words.every(w => teamText.includes(w) || text.includes(w));
    if(numOk && wordOk) return true;
  }

  // "arg10", "mex13", "fwc3"
  if(intent.compact && idCompact.includes(intent.compact)) return true;

  // General: "messi", "argentina", "mex repetidas"
  return words.every(w => text.includes(w));
}

function onSearchInput(){
  const clear = document.getElementById('gs-clear');
  const gs = document.getElementById('gs');
  const wrap = gs ? gs.closest('.search-wrap') : null;
  const hasValue = !!(gs && gs.value.trim());
  if(clear) clear.classList.toggle('show', hasValue);
  if(wrap) wrap.classList.toggle('has-clear', hasValue);
  renderGrid();
}

function clearSearch(){
  const gs = document.getElementById('gs');
  if(gs){
    gs.value = '';
    gs.blur(); // cierra el teclado y deja de seleccionar el buscador en iPhone
  }
  onSearchInput();
  if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
}


function normalizeStr(s){
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function escapeHtml(str){
  return String(str || '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}

function renderSearchResults(intent, q){
  const results = [];
  for(const teamInfo of TEAMS){
    const stickers = STICKERS_BY_TEAM[teamInfo.key];
    if(!stickers) continue;
    const labelParts0 = teamInfo.label.match(/^(\S+)\s+([A-Z0-9]+)\s+·\s+(.+)$/);
    const teamFullName = labelParts0 ? labelParts0[3] : teamInfo.label;
    const abbrevForSearch = labelParts0 ? labelParts0[2] : teamInfo.key;
    const flag = labelParts0 ? labelParts0[1] : '';
    for(const s of stickers){
      const id = s.id.toUpperCase();
      const c = col[id] || 0;
      const got = c > 0;
      const dup = c > 1;
      if(!stickerMatchesSearch(s, teamInfo, teamFullName, abbrevForSearch, intent)) continue;
      if((gf==='miss' || intent.wantsMiss) && got) continue;
      if((gf==='got' || intent.wantsGot) && !got) continue;
      if((gf==='dup' || intent.wantsDup) && !dup) continue;
      results.push({s, id, c, got, dup, flag, code:abbrevForSearch, teamName:teamFullName});
    }
  }

  if(!results.length){
    return `<div class="empty empty-state search-empty"><div class="empty-title">No encontré “${escapeHtml(q)}”</div><div class="empty-sub">Probá con ARG-10, Argentina o el nombre del jugador.</div></div>`;
  }

  const visible = results.slice(0,80);
  const more = results.length > visible.length ? `<div class="search-more-note">Mostrando ${visible.length} de ${results.length}. Afiná la búsqueda para ver menos.</div>` : '';
  return `<div class="search-results-shell">
    <div class="search-results-head"><span>Resultados</span><b>${results.length}</b></div>
    <div class="search-results-grid">
      ${visible.map(({s,id,c,got,dup,flag,code,teamName}) => `
        <button class="search-result-card ${got?'got':'miss'} ${dup?'dup':''}" type="button" onclick="cellTap('${id}',this)">
          <span class="search-result-id">${escapeHtml(String(s.id).replace('-',' '))}</span>
          <span class="search-result-body">
            <span class="search-result-name">${escapeHtml(s.name)}</span>
            <span class="search-result-team">${flag} ${escapeHtml(code)} · ${escapeHtml(teamName)}</span>
          </span>
          <span class="search-result-state">${dup ? '×'+(c-1) : got ? 'Tengo' : 'Falta'}</span>
        </button>
      `).join('')}
    </div>
    ${more}
  </div>`;
}

function renderGrid(){
  const q = document.getElementById('gs').value.trim().toLowerCase();
  const intent = parseSearchIntent(q);
  const container = document.getElementById('album-content');
  let html = '';

  if(q){
    container.innerHTML = renderSearchResults(intent, q);
    if(window._updateScrollInd) setTimeout(_updateScrollInd, 50);
    return;
  }

  function renderTeam(teamInfo){
    const teamKey = teamInfo.key;
    const stickers = STICKERS_BY_TEAM[teamKey];
    if(!stickers) return '';
    const labelParts0 = teamInfo.label.match(/^(\S+)\s+([A-Z0-9]+)\s+·\s+(.+)$/);
    const teamFullName = labelParts0 ? labelParts0[3] : teamInfo.label;
    const abbrevForSearch = labelParts0 ? labelParts0[2] : teamInfo.key;
    const filtered = stickers.filter(s => {
      const c = col[s.id.toUpperCase()]||0;
      const got = c>0, holo=s.holo, dup=c>1;
      if(q && !stickerMatchesSearch(s, teamInfo, teamFullName, abbrevForSearch, intent)) return false;
      if((gf==='miss' || intent.wantsMiss) && got) return false;
      if((gf==='got' || intent.wantsGot) && !got) return false;
      if((gf==='dup' || intent.wantsDup) && !dup) return false;
      return true;
    });
    if(!filtered.length) return '';
    const total = stickers.length;
    const gotCount = stickers.filter(s=>col[s.id.toUpperCase()]>0).length;
    const teamPct = Math.round(gotCount/total*100);
    const labelParts = labelParts0;
    const flag   = labelParts ? labelParts[1] : '';
    const abbrev = labelParts ? labelParts[2] : teamInfo.key;
    const tname  = teamFullName;
    let out = `<div class="team-group">
      <div class="team-header">
        <div class="team-flag">${flag}</div>
        <div class="team-name"><span class="team-abbrev">${abbrev}</span> <span class="team-fullname">${tname}</span></div>
        <div class="team-prog">${gotCount}/${total}</div>
        <div class="team-bar-wrap"><div class="team-bar-fill" style="width:${teamPct}%"></div></div>
      </div>`;
    const useLayout20 = stickers.length===20 && !q && gf==='all';
    const searchMode = !!q;
    out += `<div class="${useLayout20?'sgrid layout-20':searchMode?'sgrid search-mode':'sgrid'}">`;
    const colMap20 = {0:[3,1,1],1:[4,1,1],2:[1,2,1],3:[2,2,1],4:[3,2,1],5:[4,2,1],6:[1,3,1],7:[2,3,1],8:[3,3,1],9:[4,3,1],10:[6,1,1],11:[7,1,1],12:[8,1,1],13:[6,2,1],14:[7,2,1],15:[8,2,1],16:[9,2,1],17:[7,3,1],18:[8,3,1],19:[9,3,1]};
    for(let si=0; si<filtered.length; si++){
      const s = filtered[si];
      const id = s.id.toUpperCase();
      const c = col[id]||0;
      const got=c>0, dup=c>1;
      let cls = 'sc';
      if(s.holo) cls += ' holo';
      cls += got ? ' got' : ' miss';
      if(dup) cls += ' dup';
      const shortId = s.id.replace('-',' ');
      const isStd20 = useLayout20;
      if(si===12 && isStd20) cls += ' s13';
      const pos = isStd20 && colMap20[si] ? colMap20[si] : null;
      const posStyle = pos ? ` style="grid-column:${pos[0]}${pos[2]>1?' / span '+pos[2]:''};grid-row:${pos[1]}"` : '';
      out += `<div class="${cls}"${dup?` data-c="${c-1}"`:''}${posStyle}
        data-id="${id}"
        title="${s.id}: ${s.name}${s.holo?' ✨ Hologram':''}"
        onclick="cellTap('${id}',this)"
        onmousedown="startLongPress(event,'${id}')"
        onmouseup="cancelLongPress()"
        onmouseleave="cancelLongPress()"
        ontouchstart="startLongPress(event,'${id}')"
        ontouchend="handleCellTouchEnd(event,'${id}',this)"
        ontouchmove="handleCellTouchMove(event,this)"
        ontouchcancel="cancelLongPress()"
      >
        <div class="sc-id">${shortId}</div>
        <div class="sc-name">${s.name}</div>
      </div>`;
    }
    out += `</div></div>`;
    return out;
  }

  for(const group of WC_GROUPS){
    const teamKeys = group.teams;
    // collect rendered teams for this group
    let groupTeamsHtml = '';
    for(const key of teamKeys){
      const teamInfo = TEAMS.find(t=>t.key===key);
      if(teamInfo) groupTeamsHtml += renderTeam(teamInfo);
    }
    if(!groupTeamsHtml) continue;
    html += `<div class="group-section">
      <div class="group-header">${group.name}</div>
      ${groupTeamsHtml}
    </div>`;
  }

  if(!html){
    const safeQ = (q || '').replace(/[<>&]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[ch]));
    html = q
      ? `<div class="empty empty-state search-empty"><div class="empty-title">No encontré “${safeQ}”</div><div class="empty-sub">Probá con ARG-10, Argentina o el nombre del jugador.</div></div>`
      : '<div class="empty empty-state"><div class="empty-title">No hay figuritas para mostrar</div><div class="empty-sub">Cambiá el filtro para ver más resultados.</div></div>';
  }
  container.innerHTML = html;

  const importExportCard = document.getElementById('import-export-card');
  if(importExportCard) importExportCard.style.display = q ? 'none' : '';

  if(window._updateScrollInd) setTimeout(_updateScrollInd, 50);
}

function cellTap(id, el, fromTouch=false){
  const nowClick = Date.now();
  // Evita el click sintético de iOS después de un tap real o después de scrollear sobre cards.
  if(!fromTouch && window._lastTouchTap && window._lastTouchTap.id === id && nowClick - window._lastTouchTap.ts < 800){ return; }
  if(!fromTouch && window._lastPaniniScrollAt && nowClick - window._lastPaniniScrollAt < 180){ return; }

  // No registrar si venimos de un long press o de un gesto bloqueado.
  if(el && el._longFired) { el._longFired=false; return; }
  if(window._lpBlockedId === id) { window._lpBlockedId=null; return; }

  const info = STICKER_MAP[id];
  if(!info) return;

  const hadBefore = (col[id]||0) > 0;
  rememberUndo(`agregar ${id}`);
  haptic(10);
  col[id] = (col[id]||0) + 1;
  save(); updateStats();
  trackEvent('sticker_marked', { id, team: info.team || '', count: col[id], source: 'grid', repeated: hadBefore });

  if(el){
    el.classList.add('pop');
    setTimeout(()=>el.classList.remove('pop'),220);
  }

  const c = col[id];
  toast(c===1 ? `Tenés ${id}${info.holo?' ✨':''}` : `Repetida ${id} ×${c}`, c===1?'ok':'warn', {undo:true});
  if(info && !hadBefore) setTimeout(()=>checkTeamComplete(info.team), 100);

  renderGrid();
  if(isActive('dupes')) renderDupes();
  if(window._refreshScrollAid) setTimeout(()=>window._refreshScrollAid(false), 80);
}

function handleCellTouchMove(e, el){
  if(!el || !el._touchStart) { cancelLongPress(); return; }
  const t = e.touches && e.touches[0];
  if(!t) { cancelLongPress(); return; }

  const dx = Math.abs(t.clientX - el._touchStart.x);
  const dy = Math.abs(t.clientY - el._touchStart.y);

  // Si el dedo se mueve, era scroll y NO un tap sobre la figurita.
  if(dx > 8 || dy > 8){
    el._touchMoved = true;
    cancelLongPress();
  }
}

function handleCellTouchEnd(e, id, el){
  clearTimeout(lpTimer); lpTimer=null;
  document.querySelectorAll('.sc.pressing').forEach(node=>node.classList.remove('pressing'));

  if(el && el._longFired){ el._longFired = false; cleanupTouchState(el); return; }
  if(window._lpBlockedId === id){ window._lpBlockedId = null; cleanupTouchState(el); return; }

  const now = Date.now();
  const start = el && el._touchStart ? el._touchStart : null;
  const t = e.changedTouches && e.changedTouches[0];
  const moved = !!(el && el._touchMoved);
  const dx = start && t ? Math.abs(t.clientX - start.x) : 0;
  const dy = start && t ? Math.abs(t.clientY - start.y) : 0;
  const elapsed = start ? now - start.ts : 0;

  // Evita que una pasada de scroll sobre una card marque figuritas "solas".
  const justScrolled = window._lastPaniniScrollAt && (now - window._lastPaniniScrollAt < 180);
  if(moved || dx > 10 || dy > 10 || elapsed > 650 || justScrolled){
    cleanupTouchState(el);
    return;
  }

  window._lastTouchTap = { id, ts: now };
  cellTap(id, el, true);
  cleanupTouchState(el);
  if(e && e.cancelable) e.preventDefault();
}

function cleanupTouchState(el){
  if(!el) return;
  el._touchStart = null;
  el._touchMoved = false;
}

// ─── LONG PRESS ───────────────────────────────
let lpTimer = null;
function startLongPress(e, id){
  if(e.touches && e.touches.length > 1) return; // ignore multi-touch
  const el = e.currentTarget || e.target?.closest('.sc');
  if(!el) return;

  const t = e.touches && e.touches[0];
  el._touchStart = t ? {x:t.clientX, y:t.clientY, ts:Date.now()} : null;
  el._touchMoved = false;
  el._longFired = false;

  cancelLongPress();
  el.classList.add('pressing');
  lpTimer = setTimeout(()=>{
    el._longFired = true;
    window._lpBlockedId = id;
    el.classList.remove('pressing');
    cleanupTouchState(el);

    if(!col[id] || col[id]<=0){ toast('No está en tu colección','warn'); return; }
    rememberUndo(`quitar ${id}`);
    haptic(15);
    col[id]--;
    if(col[id]<=0) delete col[id];

    save(); updateStats();
    const c = col[id]||0;
    toast(c===0 ? `Quitaste ${id}` : `${id} ×${c}`, c===0?'remove':'warn', {undo:true});

    renderGrid();
    if(isActive('dupes')) renderDupes();
    if(window._refreshScrollAid) setTimeout(()=>window._refreshScrollAid(false), 80);
    setTimeout(()=>{ window._lpBlockedId=null; }, 300);
  }, 600);
}
function cancelLongPress(){
  clearTimeout(lpTimer); lpTimer=null;
  document.querySelectorAll('.sc.pressing').forEach(el=>el.classList.remove('pressing'));
}
function openRemoveSheet(id){
  if(!col[id]||col[id]<=0){ toast('No está en tu colección','warn'); return; }
  const info = STICKER_MAP[id];
  removeTarget = id;
  document.getElementById('rs-id').textContent = id + (info.holo?' ✨':'');
  document.getElementById('rs-name').textContent = info.name + ' — ' + (TEAMS.find(t=>t.key===info.team)||{label:info.team}).label;
  document.getElementById('remove-overlay').classList.add('show');
}
function closeRemoveSheet(){ document.getElementById('remove-overlay').classList.remove('show'); removeTarget=null; }
function confirmRemove(){
  if(!removeTarget) return;
  const id = removeTarget;
  rememberUndo(`quitar ${id}`);
  haptic(15);
  col[id]--;
  if(col[id]<=0) delete col[id];
  save(); updateStats();
  toast(`Quitaste ${id}`, 'remove', {undo:true});
  closeRemoveSheet();
  renderGrid();
  if(isActive('dupes')) renderDupes();
}

function setF(f,btn){
  gf=f;
  document.querySelectorAll('.fb2').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderGrid();
}

// ═══════════════════════════════════════════════════════════
// DUPES
// ═══════════════════════════════════════════════════════════
function renderDupes(){
  const list = document.getElementById('rlist');
  const none = document.getElementById('nodup');

  const dupSet = {};
  for(const [id,v] of Object.entries(col)) if(v>1) dupSet[id]=v;

  if(!Object.keys(dupSet).length){ list.innerHTML=''; none.style.display='block'; if(window._updateScrollInd) setTimeout(_updateScrollInd, 50); return; }
  none.style.display='none';

  let html = '';
  for(const group of WC_GROUPS){
    let groupHtml = '';
    for(const teamKey of group.teams){
      const stickers = STICKERS_BY_TEAM[teamKey];
      if(!stickers) continue;
      let teamHtml = '';
      for(const s of stickers){
        const id = s.id.toUpperCase();
        if(!dupSet[id]) continue;
        const c = dupSet[id];
        teamHtml += `<div class="ri">
          <div class="ri-n">${id.replace('-',' ')}</div>
          <div class="ri-tag">${s.name}</div>
          <div class="ri-badge">×${c-1}</div>
          <button class="ri-del" onclick="removeOne('${id}')">✕</button>
        </div>`;
      }
      if(!teamHtml) continue;
      const lp = (TEAMS.find(t=>t.key===teamKey)||{label:teamKey}).label.match(/^(\S+)\s+[A-Z0-9_]+\s+·\s+(.+)$/);
      const flag = lp ? lp[1] : '';
      const tname = lp ? lp[2] : teamKey;
      groupHtml += `<div class="dupes-team">
        <div class="dupes-team-hdr" data-flag="${flag}" data-abbrev="${teamKey.replace('_INTRO','')}">
          <span style="font-size:1.2rem;line-height:1;flex-shrink:0">${flag}</span>
          <span style="color:var(--accent);letter-spacing:2px">${teamKey.replace('_INTRO','')}</span>
          <span style="color:var(--muted);font-size:.75rem;font-family:'Space Mono',monospace;font-weight:400;letter-spacing:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${tname}</span>
        </div>
        <div class="rlist-inner">${teamHtml}</div>
      </div>`;
    }
    if(!groupHtml) continue;
    html += `<div class="dupes-group">
      <div class="dupes-group-hdr">${group.name}</div>
      ${groupHtml}
    </div>`;
  }

  list.innerHTML = html || '<div class="empty empty-state"><div class="empty-title">Todavía no tenés repetidas</div><div class="empty-sub">Cuando sumes una figurita que ya tenés, va a aparecer acá para intercambiarla.</div></div>';
  if(window._updateScrollInd) setTimeout(_updateScrollInd, 50);
}

function removeOne(id){
  if(!col[id]) return;
  rememberUndo(`quitar ${id}`);
  haptic(15);
  col[id]--;
  if(col[id]<=0) delete col[id];
  save(); updateStats(); renderDupes();
  if(isActive('album')) renderGrid();
  toast(`Quitaste una de ${id}`,'err', {undo:true});
}

function buildDupesListText(){
  const lines = [
    'Album Tracker App - Lista',
    'Usa Méx Can 26',
    'Mis repetidas'
  ];

  let totalDupes = 0;
  for(const group of WC_GROUPS){
    for(const teamKey of group.teams){
      const stickers = STICKERS_BY_TEAM[teamKey] || [];
      const dupes = stickers
        .map(s => {
          const id = String(s.id).toUpperCase();
          const extra = Math.max(0, (col[id] || 0) - 1);
          if(!extra) return null;
          totalDupes += extra;
          const n = stickerShareNumber(id);
          return extra > 1 ? `${n} x${extra}` : n;
        })
        .filter(Boolean);

      if(dupes.length){
        lines.push(`${missingShareLabel(teamKey)}: ${dupes.join(', ')}`);
      }
    }
  }

  lines.push('');
  lines.push('Compartido desde Panini Album Tracker World Cup 2026');
  return { text: lines.join('\n'), totalDupes };
}

async function shareDupesList(){
  const { text, totalDupes } = buildDupesListText();

  if(!totalDupes){
    toast('Todavía no tenés repetidas para mandar','warn');
    return;
  }

  if(navigator.share){
    try{
      await navigator.share({
        title:'Mis repetidas',
        text
      });
      trackEvent('share_dupes_list', { method:'web_share', total_dupes: totalDupes });
      toast('Lista de repetidas lista para mandar','ok');
      return;
    }catch(e){
      if(e && e.name === 'AbortError') return;
    }
  }

  const copied = await copyTextToClipboard(text);
  if(copied){
    trackEvent('share_dupes_list', { method:'copy', total_dupes: totalDupes });
    toast('Lista de repetidas copiada','ok');
  }else{
    showManualCopyBox(text, 'Mis repetidas');
    toast('Copiala desde el recuadro','warn');
  }
}

function copyDupes(){
  shareDupesList();
}

// ═══════════════════════════════════════════════════════════
// BULK IMPORT
// ═══════════════════════════════════════════════════════════
function bulkImport(){
  const txt = document.getElementById('bulk').value;
  // Match IDs like ALG-1, CC14, FWC-3, 00
  const matches = [...txt.matchAll(/\b([A-Z]{2,3}-?\d{1,2}|CC\d{1,2}|00)\b/gi)];
  const ids = matches.map(m=>m[0].toUpperCase()).filter(id=>STICKER_MAP[id]);
  if(!ids.length){ toast('No se encontraron IDs válidos','warn'); return; }
  ids.forEach(id=>{ col[id]=(col[id]||0)+1; });
  save(); updateStats();
  if(isActive('album')) renderGrid();
  if(isActive('dupes')) renderDupes();
  document.getElementById('bulk').value='';
  toast(`Importaste ${ids.length} figuritas`,'ok');
}

function doReset(){
  const modal = document.getElementById('reset-album-confirm');
  if(modal){
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
    return;
  }
  // Fallback si el modal no existe
  confirmResetAlbum();
}

function closeResetAlbumConfirm(){
  const modal = document.getElementById('reset-album-confirm');
  if(modal){
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden','true');
  }
}

function confirmResetAlbum(){
  col={};
  save();
  updateStats();
  renderGrid();
  renderDupes();
  closeResetAlbumConfirm();
  toast('Álbum borrado','warn');
}

// ═══════════════════════════════════════════════════════════
// TRADE / QR
// ═══════════════════════════════════════════════════════════
// ── TRADE ENCODING STRATEGY ──────────────────────────────
// Instead of encoding missing (900+ IDs at start = huge QR),
// we encode COLLECTED + DUPES only (small list, grows gradually).
// The receiver derives missing = ALL_IDS - their_collected.
// Dupes encoded as comma-separated short IDs with run-length.
// Format: "p26:c=ALG1,ALG3,ARG17&d=ALG1x2,ARG3x3"
// ─────────────────────────────────────────────────────────

function encodeShortId(id){
  // "ALG-1" -> "ALG1", "FWC-3" -> "FWC3", "CC1" -> "CC1", "00" -> "00"
  return id.replace('-','');
}
function decodeShortId(s){
  // "ALG1" -> "ALG-1", "FWC3" -> "FWC-3", "CC1" -> "CC1", "00" -> "00"
  s = s.toUpperCase();
  if(s === '00') return '00';
  if(s.startsWith('CC')) return s; // CC1..CC14 no dash
  const m = s.match(/^([A-Z]+)(\d+)$/);
  if(!m) return s;
  return m[1] + '-' + m[2];
}


// Bitset compacto para QR: reduce el payload a ~300 chars y se escanea mejor desde otra pantalla.
function b64UrlEncodeBinary(bin){
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64UrlDecodeBinary(str){
  str = (str || '').replace(/-/g,'+').replace(/_/g,'/');
  while(str.length % 4) str += '=';
  return atob(str);
}
function encodeIdBitset(ids){
  const set = new Set((ids || []).map(id => id.toUpperCase()));
  const bytes = new Uint8Array(Math.ceil(ALL_IDS.length / 8));
  ALL_IDS.forEach((id, i)=>{
    if(set.has(id.toUpperCase())) bytes[i >> 3] |= (1 << (i & 7));
  });
  let bin = '';
  for(let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
  return b64UrlEncodeBinary(bin);
}
function decodeIdBitset(str){
  const bin = b64UrlDecodeBinary(str || '');
  const out = [];
  for(let i=0;i<ALL_IDS.length;i++){
    const code = bin.charCodeAt(i >> 3) || 0;
    if(code & (1 << (i & 7))) out.push(ALL_IDS[i].toUpperCase());
  }
  return out;
}

function buildPayload(){
  const got = Object.keys(col)
    .map(id=>id.toUpperCase())
    .filter(id => isOfficialAlbumId(id) && Number(col[id]) > 0);
  const dupes = Object.entries(col)
    .filter(([id,v])=>isOfficialAlbumId(id) && Number(v)>1)
    .map(([id])=>id.toUpperCase());

  // Formato principal v26: bitset compacto y exacto.
  // Evitamos el fallback por faltantes porque versiones viejas podían omitir CC
  // y eso hacía que a los amigos les contaran 14 Coca-Cola que no habían marcado.
  return 'p26b:g=' + encodeIdBitset(got) + '&d=' + encodeIdBitset(dupes);
}

function buildTradeUrl(payload = buildPayload()){
  const cleanPath = location.pathname.replace(/[^/]*$/, '');
  const base = location.origin + cleanPath;
  return base + '?tab=trade&code=' + encodeURIComponent(payload);
}

function buildOnlineFriendUrl(friendCode = displayOnlineFriendCode(getMyOnlineProfile().id)){
  const cleanPath = location.pathname.replace(/[^/]*$/, '');
  const base = location.origin + cleanPath;
  return base + '?tab=trade&friend=' + encodeURIComponent(friendCode);
}

function getIncomingOnlineFriendCode(){
  const fromUrl = (urlLike)=>{
    try{
      const url = new URL(urlLike, location.href);
      return url.searchParams.get('friend') || url.searchParams.get('amigo') || '';
    }catch(e){ return ''; }
  };

  let code = fromUrl(location.href);
  if(code) return code;

  const hash = location.hash || '';
  if(hash){
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : hash.replace(/^#/, '?');
    code = fromUrl(location.origin + location.pathname + hashQuery);
    if(code) return code;
  }
  return '';
}

function getIncomingTradeCode(){
  const fromUrl = (urlLike)=>{
    try{
      const url = new URL(urlLike, location.href);
      return url.searchParams.get('code') || url.searchParams.get('trade') || url.searchParams.get('cambio') || '';
    }catch(e){ return ''; }
  };

  let code = fromUrl(location.href);
  if(code) return code;

  const hash = location.hash || '';
  if(hash){
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : hash.replace(/^#/, '?');
    code = fromUrl(location.origin + location.pathname + hashQuery);
    if(code) return code;
  }
  return '';
}


function normalizeTradePayload(raw){
  raw = (raw || '').trim();

  // Puede venir como payload directo o como link completo:
  // https://.../albumtracker/?tab=trade&code=p26b%3A...
  try{
    const url = new URL(raw, location.href);
    const code = url.searchParams.get('code') || url.searchParams.get('trade') || url.searchParams.get('cambio');
    if(code) raw = code;
    else if(url.hash){
      const hashQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?')) : url.hash.replace(/^#/, '?');
      const hashUrl = new URL(url.origin + url.pathname + hashQuery);
      const hashCode = hashUrl.searchParams.get('code') || hashUrl.searchParams.get('trade') || hashUrl.searchParams.get('cambio');
      if(hashCode) raw = hashCode;
    }
  }catch(e){
    const m = raw.match(/[?&#](?:code|trade|cambio)=([^&#]+)/);
    if(m) raw = m[1];
  }

  try{
    raw = decodeURIComponent(raw.replace(/\+/g, ' '));
  }catch(e){}

  return raw.trim();
}

function parsePayload(raw){
  raw = normalizeTradePayload(raw);

  // Formato v26 compacto con bitset.
  if(raw.startsWith('p26b:')){
    try{
      const body = raw.slice(5);
      const params = {};
      body.split('&').forEach(part=>{
        const eq = part.indexOf('=');
        if(eq < 0) return;
        params[part.slice(0, eq)] = part.slice(eq + 1);
      });
      const got = decodeIdBitset(params.g || '');
      const dupes = decodeIdBitset(params.d || '');
      return { got, dupes };
    }catch(e){ return null; }
  }

  // Legacy base64 format
  if(raw.startsWith('pn26v2:') || raw.startsWith('pn26:')){
    try{
      const obj = JSON.parse(atob(raw.replace('pn26v2:','').replace('pn26:','')));
      // Convert old format: had m=missing, d=dupes
      // Derive collected = ALL_IDS - missing
      const missSet = new Set((obj.m||[]).map(s=>s.toUpperCase()));
      const theirDupes = (obj.d||[]).map(s=>s.toUpperCase());
      const theirGot = inferGotFromMissingSet(missSet, theirDupes);
      return { got: theirGot, dupes: theirDupes };
    }catch(e){ return null; }
  }
  // New compact format
  if(raw.startsWith('p26:')){
    try{
      const body = raw.slice(4);
      const params = {};
      body.split('&').forEach(part=>{
        const eq = part.indexOf('=');
        if(eq < 0) return;
        const k = part.slice(0, eq);
        const v = part.slice(eq + 1);
        params[k] = v || '';
      });

      let got = [];
      if(params.c){
        got = params.c.split(',').filter(Boolean).map(decodeShortId);
      }
      const dupes = params.d ? params.d.split(',').filter(Boolean).map(s=>{
        const m = s.match(/^(.+)x(\d+)$/i);
        return m ? decodeShortId(m[1]) : decodeShortId(s);
      }) : [];

      if(params.m){
        const missSet = new Set(params.m.split(',').filter(Boolean).map(decodeShortId).map(s=>s.toUpperCase()));
        got = inferGotFromMissingSet(missSet, dupes);
      }
      return { got, dupes };
    }catch(e){ return null; }
  }
  return null;
}

function myData(){
  const m = officialAlbumIds().filter(id=>!col[id]);
  const d = officialAlbumIds().filter(id=>col[id]>1);
  return {m,d};
}

function genQR(){
  const box = document.getElementById('qrbox');
  if(!box) return;

  const payload = buildPayload();
  const dupesOnly = Object.keys(col).filter(id=>col[id]>1).map(encodeShortId).join(',');
  const fallbackPayload = 'p26:d=' + dupesOnly;

  function cleanupQR(){
    const direct = [...box.children];
    const qrNode =
      direct.find(n => n.tagName === 'CANVAS') ||
      direct.find(n => n.tagName === 'IMG') ||
      direct.find(n => n.tagName === 'TABLE') ||
      direct[0];

    if(!qrNode) return false;

    direct.forEach(n => { if(n !== qrNode) n.remove(); });

    qrNode.style.display = 'block';
    qrNode.style.margin = '0 auto';
    qrNode.style.width = '320px';
    qrNode.style.height = '320px';
    qrNode.style.maxWidth = '100%';
    qrNode.style.maxHeight = '100%';
    return true;
  }

  function render(text){
    box.innerHTML = '';
    new QRCode(box,{
      text,
      width: 320,
      height: 320,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.L
    });
    cleanupQR();
    requestAnimationFrame(cleanupQR);
    setTimeout(cleanupQR, 80);
    setTimeout(cleanupQR, 250);
    return true;
  }

  try{
    // Si Supabase está configurado, el QR usa tu código fijo online.
    // Así tu amigo lo escanea una sola vez y después tus repetidas se actualizan solas.
    if(isOnlineSyncConfigured()){
      try{ ensureOnlineProfileSynced().catch(()=>{}); }catch(_){}
      render(buildOnlineFriendUrl());
    }else{
      render(buildTradeUrl(payload));
    }
  }catch(e){
    try{
      render(isOnlineSyncConfigured() ? buildOnlineFriendUrl() : buildTradeUrl(fallbackPayload));
    }catch(e2){
      box.innerHTML = '<div style="color:#111;font-size:.75rem;padding:14px;text-align:center;font-family:Arial,sans-serif;">No se pudo generar el QR.<br>Copiá tu código fijo o compartí por mensaje.</div>';
    }
  }
}

async function copyCode(){
  try{
    if(isOnlineSyncConfigured()){
      await ensureOnlineProfileSynced();
      const code = displayOnlineFriendCode(getMyOnlineProfile().id);
      if(!(await copyTextToClipboard(code))) throw new Error('copy_failed');
      refreshMyOnlineCodeUI();
      toast('Código fijo copiado','ok');
      return;
    }
    if(!(await copyTextToClipboard(buildPayload()))) throw new Error('copy_failed');
    toast('¡Código copiado!','ok');
  }catch(e){
    console.error(e);
    toast('No pude copiar el código','err');
  }
}

async function copyTradeLink(){
  try{
    const online = isOnlineSyncConfigured();
    const url = online ? buildOnlineFriendUrl(displayOnlineFriendCode(getMyOnlineProfile().id)) : buildTradeUrl();

    const copied = await copyTextToClipboard(url);
    if(copied){
      toast(online ? 'Link fijo copiado. Al abrirlo carga el código en la app.' : '¡Link copiado!','ok');
    }else{
      showManualCopyBox(url, online ? 'Copiar link del QR' : 'Copiar link');
      toast('Copialo desde el recuadro','warn');
    }

    if(online){
      ensureOnlineProfileSynced()
        .then(refreshMyOnlineCodeUI)
        .catch(e => console.warn('No se pudo sincronizar antes/después de copiar el link', e));
    }
  }catch(e){
    console.error(e);
    toast('No pude preparar el link','err');
  }
}

function populateFriendCodePrompt(){
  const prompt = document.getElementById('friend-save-prompt');
  if(!prompt) return;

  prompt.style.display = 'block';

  const friends = loadFriends();
  const pfl = document.getElementById('prompt-friends-list');
  const pdiv = document.getElementById('prompt-divider');

  if(pfl){
    if(friends.length){
      pfl.style.display = 'flex';
      pfl.innerHTML = friends.map((f,i)=>`<button onclick="updateFriendCode(${i})" style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:8px 14px;font-family:'Nunito',sans-serif;font-weight:700;font-size:.78rem;color:var(--text);cursor:pointer;display:flex;align-items:center;gap:7px;transition:all .12s;" onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text)'">
        <span style="width:26px;height:26px;border-radius:99px;background:${avatarGradient(i)};display:inline-flex;align-items:center;justify-content:center;font-size:.75rem;color:#fff;flex-shrink:0;">${f.name[0].toUpperCase()}</span>
        ${f.name}
      </button>`).join('');
      if(pdiv) pdiv.style.display = 'flex';
    } else {
      pfl.style.display = 'none';
      if(pdiv) pdiv.style.display = 'none';
    }
  }
}

function focusFriendCodePrompt(){
  const prompt = document.getElementById('friend-save-prompt');
  if(!prompt) return;

  requestAnimationFrame(()=>{
    prompt.scrollIntoView({behavior:'smooth', block:'start'});
    setTimeout(()=>{
      const input = document.getElementById('friend-name-input');
      if(input && !input.value){
        try{ input.focus({preventScroll:true}); }catch(e){ input.focus(); }
      }
    }, 260);
  });
}


function prefillOnlineFriendCode(raw){
  const onlineId = normalizeOnlineFriendCode(raw);
  if(!onlineId) return '';
  const displayCode = displayOnlineFriendCode(onlineId);
  const codeInput = document.getElementById('online-friend-code');
  if(codeInput) codeInput.value = displayCode;
  const nameInput = document.getElementById('online-friend-name');
  if(nameInput && !nameInput.value){
    try{ nameInput.focus({preventScroll:true}); }catch(e){ nameInput.focus(); }
  }
  return displayCode;
}

function processCodeAndPromptSave(raw){
  const parsed = parsePayload(raw);
  if(!parsed){ toast('Código inválido','err'); return; }

  window._pendingOnlineFriend = null;
  window._pendingFriendCode = raw;
  showMatch(parsed);
  populateFriendCodePrompt();
  focusFriendCodePrompt();
}

async function processOnlineFriendCodeAndPromptSave(raw){
  const onlineId = normalizeOnlineFriendCode(raw);
  if(!onlineId){
    toast('Código fijo inválido','err');
    return;
  }
  prefillOnlineFriendCode(onlineId);
  if(!isOnlineSyncConfigured()){
    toast('Supabase no está configurado','warn');
    refreshMyOnlineCodeUI();
    return;
  }

  try{
    setScannerState('Código fijo detectado. Buscando repetidas actualizadas…', 'idle');
    const profile = await fetchOnlineFriendProfile(onlineId);
    const parsed = parsePayload(profile.payload);
    if(!parsed) throw new Error('El código fijo no tiene datos válidos');

    window._pendingOnlineFriend = {
      online: true,
      onlineId: profile.id,
      code: profile.payload,
      updatedAt: profile.updated_at || new Date().toISOString()
    };
    window._pendingFriendCode = profile.payload;

    showMatch(parsed);
    populateFriendCodePrompt();
    focusFriendCodePrompt();
    toast('Código fijo cargado. Guardalo con un nombre.','ok');
  }catch(e){
    console.error(e);
    toast(e.message || 'No pude cargar ese código fijo','err');
  }
}


function processCode(raw){
  const parsed = parsePayload(raw);
  if(!parsed){ toast('Código inválido','err'); return; }
  showMatch(parsed);
}


function formatTradeChosenCount(count, total){
  const n = Number(count || 0);
  const t = Math.max(0, Number(total || 0));
  const word = n === 1 ? 'elegida' : 'elegidas';
  return `${n} ${word} de ${t}`;
}

function updateTradeChosenCountLabel(el, count){
  if(!el) return;
  const total = Number(el.dataset.total || 0);
  el.textContent = formatTradeChosenCount(count, total);
}


function showMatch(them){
  const me = myData();
  const myMiss = new Set(me.m);
  const theirGotSet = new Set((them.got||[]).map(s=>s.toUpperCase()));
  const theirMiss = new Set(officialAlbumIds().filter(id=>!theirGotSet.has(id)));
  const theirDupesSet = new Set((them.dupes||[]).map(s=>s.toUpperCase()));
  // Build album order index
  const albumOrder = [];
  for(const group of WC_GROUPS)
    for(const key of group.teams)
      if(STICKERS_BY_TEAM[key]) for(const s of STICKERS_BY_TEAM[key]) albumOrder.push(s.id.toUpperCase());
  const orderIdx = {};
  albumOrder.forEach((id,i) => orderIdx[id] = i);
  const byAlbum = (a,b) => (orderIdx[a]??9999) - (orderIdx[b]??9999);

  const iGive   = me.d
    .filter(n=>theirMiss.has(n))
    .filter(n=>(col[n]||0) > 1) // solo se pueden dar copias repetidas, nunca la pegada del álbum
    .sort(byAlbum);
  const theyGive = [...theirDupesSet].filter(n=>myMiss.has(n)).sort(byAlbum);

  document.getElementById('matchcard').style.display='block';

  // Score
  document.getElementById('match-give-n').textContent = iGive.length;
  document.getElementById('match-get-n').textContent = theyGive.length;

  updateMatchVerdict(0, 0);

  // Store for confirm — Maps: id -> quantity selected
  window._tradeGive = iGive;
  window._tradeGet  = theyGive;
  window._tradeGiveSelected = new Map();
  window._tradeGetSelected  = new Map();

  const cgetBox = document.getElementById('cget');
  const cgiveBox = document.getElementById('cgive');
  if(!theyGive.length && cgetBox){
    cgetBox.innerHTML = '<div class="empty-mini">No hay figuritas nuevas para recibir con este código.</div>';
  }
  if(!iGive.length && cgiveBox){
    cgiveBox.innerHTML = '<div class="empty-mini">No tenés repetidas que a esta persona le falten.</div>';
  }

  function renderChip(id, cls, container, selectedMap, countEl, maxQty){
    const info = STICKER_MAP[id];
    const baseLabel = info ? `${id.replace('-',' ')} · ${info.name}` : `${id}`;
    const el = document.createElement('span');
    el.className = `chip chip-sel ${cls}`;
    el.textContent = baseLabel;

    function updateChip(){
      const cur = selectedMap.get(id) || 0;

      // Reconstruimos el contenido completo en cada toque.
      // Esto evita restos visuales/focus raro en iPhone cuando pasa de seleccionado a no seleccionado.
      el.textContent = baseLabel;
      el.dataset.qty = cur ? String(cur) : '';

      if(cur === 0){
        el.classList.remove('selected');
        el.removeAttribute('aria-pressed');
        el.blur?.();
      } else {
        el.classList.add('selected');
        el.setAttribute('aria-pressed','true');
        const qty = document.createElement('span');
        qty.className = 'trade-chip-qty';
        qty.textContent = `×${cur}`;
        el.appendChild(qty);
      }

      const totalGive = [...window._tradeGiveSelected.values()].reduce((a,b)=>a+b,0);
      const totalGet  = [...window._tradeGetSelected.values()].reduce((a,b)=>a+b,0);
      updateTradeChosenCountLabel(countEl, selectedMap===window._tradeGiveSelected ? totalGive : totalGet);
      setTradeActionButtons((totalGive+totalGet) > 0);
      document.getElementById('match-give-n').textContent = totalGive;
      document.getElementById('match-get-n').textContent  = totalGet;
      updateMatchVerdict(totalGive, totalGet);
      renderTradeLiveSummary();
    }

    // Tap cíclico:
    // no seleccionada → x1 → x2 → x3 → ... → límite → no seleccionada
    let downPos = null;
    function cycleSelection(e){
      if(e){
        e.preventDefault();
        e.stopPropagation();
      }

      const limit = Math.max(1, Number(maxQty ?? 1));
      const cur = selectedMap.get(id) || 0;
      const next = cur >= limit ? 0 : cur + 1;

      if(next === 0) selectedMap.delete(id);
      else selectedMap.set(id, next);

      updateChip();
    }

    el.addEventListener('pointerdown', e => {
      downPos = {x:e.clientX, y:e.clientY};
    }, {passive:true});

    el.addEventListener('pointerup', e => {
      if(downPos){
        const dx = Math.abs(e.clientX - downPos.x);
        const dy = Math.abs(e.clientY - downPos.y);
        downPos = null;
        if(dx > 8 || dy > 8) return;
      }
      cycleSelection(e);
      requestAnimationFrame(()=>el.blur?.());
    });

    container.appendChild(el);
  }

  const cgive = document.getElementById('cgive');
  const cget  = document.getElementById('cget');
  cgive.innerHTML = '';
  cget.innerHTML  = '';

  const giveCountEl = document.getElementById('give-sel-count');
  const getCountEl  = document.getElementById('get-sel-count');
  const givePossibleTotal = iGive.reduce((sum,id)=>sum + Math.max(0, (col[id]||0) - 1), 0);
  const getPossibleTotal = theyGive.length;
  giveCountEl.dataset.total = String(givePossibleTotal);
  getCountEl.dataset.total = String(getPossibleTotal);
  updateTradeChosenCountLabel(giveCountEl, 0);
  updateTradeChosenCountLabel(getCountEl, 0);
  document.getElementById('match-give-n').textContent = 0;
  document.getElementById('match-get-n').textContent  = 0;
  setTradeActionButtons(false);
  updateMatchVerdict(0, 0);
  renderTradeLiveSummary();

  function renderTradeGrouped(ids, cls, container, selectedMap, countEl, maxQtyForId, emptyText){
    container.innerHTML = '';
    if(!ids.length){
      container.innerHTML = `<div class="empty-mini">${emptyText}</div>`;
      return;
    }

    const idSet = new Set(ids);
    for(const group of WC_GROUPS){
      for(const teamKey of group.teams){
        const stickers = STICKERS_BY_TEAM[teamKey];
        if(!stickers) continue;
        const teamIds = stickers.map(s=>s.id.toUpperCase()).filter(id=>idSet.has(id));
        if(!teamIds.length) continue;

        const parts = teamDisplayParts(TEAMS.find(t=>t.key===teamKey) || {key:teamKey,label:teamKey});
        const block = document.createElement('div');
        block.className = 'trade-team-block';
        block.innerHTML = `
          <div class="trade-team-hdr">
            <span class="trade-team-flag">${parts.flag}</span>
            <span class="trade-team-code">${parts.code}</span>
            <span class="trade-team-name">${parts.name}</span>
            <span class="trade-team-count">${teamIds.length}</span>
          </div>
          <div class="trade-team-chips"></div>
        `;
        const chips = block.querySelector('.trade-team-chips');
        teamIds.forEach(id => renderChip(id, cls, chips, selectedMap, countEl, maxQtyForId(id)));
        container.appendChild(block);
      }
    }
  }

  renderTradeGrouped(
    iGive,
    'chip-m',
    cgive,
    window._tradeGiveSelected,
    giveCountEl,
    id => Math.max(0, (col[id]||0) - 1),
    'Nada para dar'
  );

  renderTradeGrouped(
    theyGive,
    'chip-g',
    cget,
    window._tradeGetSelected,
    getCountEl,
    id => 1,
    'Nada nuevo para vos'
  );

  toast(`Das ${iGive.length} · Recibís ${theyGive.length}`,'ok');
  document.getElementById('matchcard').scrollIntoView({behavior:'smooth',block:'start'});
}

function updateTradeSummary(){
  const d = myData();
  const missSet = new Set(d.m);
  const dupSet  = new Set(d.d);

  // Missing: grouped by team, in album order
  const summCount = document.getElementById('summ-count');
  if(summCount) summCount.textContent = `(${d.m.length})`;
  let missHtml = '';
  if(!d.m.length){
    missHtml = '<span style="color:var(--green);font-size:.72rem;font-family:\'Space Mono\',monospace;">¡Completo! 🎉</span>';
  } else {
    for(const group of WC_GROUPS){
      for(const teamKey of group.teams){
        const stickers = STICKERS_BY_TEAM[teamKey];
        if(!stickers) continue;
        const teamMiss = stickers.filter(s=>missSet.has(s.id.toUpperCase()));
        if(!teamMiss.length) continue;
        const lp = (TEAMS.find(t=>t.key===teamKey)||{label:teamKey}).label.match(/^(\S+)\s+[A-Z0-9_]+\s+·\s+(.+)$/);
        const flag = lp?lp[1]:''; const tname = lp?lp[2]:teamKey;
        missHtml += `<div class="summ-group">
          <div class="summ-group-hdr">${flag} <span>${tname}</span> · ${teamMiss.length}</div>
          <div class="chips">${teamMiss.map(s=>`<span class="chip chip-m">${s.id.replace('-',' ')}</span>`).join('')}</div>
        </div>`;
      }
    }
  }
  const summEl = document.getElementById('summ'); if(summEl) summEl.innerHTML = missHtml;

  // Dupes: flat chips with count
  const sumdCount = document.getElementById('sumd-count');
  if(sumdCount) sumdCount.textContent = `(${d.d.length} únicas)`;
  const cD = d.d.map(n=>{
    const c = col[n]||0;
    const info = STICKER_MAP[n];
    const lbl = info ? `${n.replace('-',' ')} ×${c-1}` : n;
    return `<span class="chip chip-d">${lbl}</span>`;
  }).join('');
  const sumdEl = document.getElementById('sumd'); if(sumdEl) sumdEl.innerHTML = cD||'<span style="color:var(--muted);font-size:.68rem;font-family:\'Space Mono\',monospace;">Sin repetidas aún</span>';
}



// ─── MATCH VERDICT ───────────────────────────────────────
function updateMatchVerdict(give, get){
  const verdict = document.getElementById('match-verdict');
  const advice = document.getElementById('trade-advice');
  if(!verdict) return;

  let msg = '';
  let cls = 'match-verdict';
  let tip = 'Elegí qué figuritas querés recibir y cuáles repetidas le das.';

  if(give === 0 && get === 0){
    msg = 'Seleccioná figuritas';
  } else if(give === 0){
    msg = `🎉 Recibís ${get} sin dar nada`;
    cls = 'match-verdict win';
    tip = 'Buen intercambio: no entregás repetidas.';
  } else if(get === 0){
    msg = `⚠️ Le das ${give} y no recibís nada`;
    cls = 'match-verdict lose';
    tip = 'Ojo: estás entregando repetidas sin recibir figuritas nuevas.';
  } else {
    const diff = give - get;
    if(diff === 0){
      msg = '🤝 Intercambio parejo';
      cls = 'match-verdict fair';
      tip = 'Cantidad equilibrada entre lo que recibís y lo que das.';
    } else if(diff < 0){
      msg = `🎉 Te conviene +${Math.abs(diff)}`;
      cls = 'match-verdict win';
      tip = 'Recibís más figuritas nuevas de las que entregás.';
    } else {
      msg = `⚠️ Estás dando +${diff}`;
      cls = 'match-verdict lose';
      tip = diff >= 3 ? 'Alerta: estás dando muchas más repetidas de las que recibís.' : 'Revisá si te conviene: estás dando un poco más.';
    }
  }

  verdict.textContent = msg;
  verdict.className = cls;
  if(advice) advice.textContent = tip;
}




function tradeLiveSelectionCounts(){
  const getCount = [...(window._tradeGetSelected || new Map()).values()].reduce((a,b)=>a + Number(b || 0),0);
  const giveCount = [...(window._tradeGiveSelected || new Map()).values()].reduce((a,b)=>a + Number(b || 0),0);
  return {getCount,giveCount};
}

function updateTradeLiveToggleLabel(){
  const btn = document.getElementById('trade-live-toggle');
  const shell = document.getElementById('trade-live-shell');
  const getCountEl = document.getElementById('trade-live-get-count');
  const giveCountEl = document.getElementById('trade-live-give-count');
  const oldCount = document.getElementById('trade-live-toggle-count');
  if(!btn || !shell) return;
  const {getCount,giveCount} = tradeLiveSelectionCounts();
  if(getCountEl) getCountEl.textContent = getCount;
  if(giveCountEl) giveCountEl.textContent = giveCount;
  if(oldCount) oldCount.textContent = `${getCount} / ${giveCount}`;
  if(getCount + giveCount > 0) shell.classList.remove('collapsed');
  const clearBtn = document.getElementById('trade-clear-chosen-btn');
  if(clearBtn) clearBtn.style.display = (getCount + giveCount) > 0 ? 'inline-flex' : 'none';
  btn.setAttribute('aria-expanded', shell.classList.contains('collapsed') ? 'false' : 'true');
}

function toggleTradeLiveSummary(){
  const shell = document.getElementById('trade-live-shell');
  if(!shell) return;
  shell.classList.toggle('collapsed');
  updateTradeLiveToggleLabel();
}

function clearTradeChosen(){
  if(window._tradeGiveSelected?.clear) window._tradeGiveSelected.clear();
  if(window._tradeGetSelected?.clear) window._tradeGetSelected.clear();

  document.querySelectorAll('#cget .chip-sel.selected, #cgive .chip-sel.selected').forEach(el => {
    el.classList.remove('selected');
    el.removeAttribute('aria-pressed');
    el.dataset.qty = '';
    el.querySelectorAll('.trade-chip-qty').forEach(q => q.remove());
    el.blur?.();
  });

  const giveCountEl = document.getElementById('give-sel-count');
  const getCountEl  = document.getElementById('get-sel-count');
  updateTradeChosenCountLabel(giveCountEl, 0);
  updateTradeChosenCountLabel(getCountEl, 0);

  const giveNum = document.getElementById('match-give-n');
  const getNum = document.getElementById('match-get-n');
  if(giveNum) giveNum.textContent = '0';
  if(getNum) getNum.textContent = '0';

  updateMatchVerdict(0, 0);
  setTradeActionButtons(false);
  renderTradeLiveSummary();
  toast('Elegidas limpiadas','info');
}

function renderTradeLiveSummary(){
  const getEl = document.getElementById('trade-live-get-list');
  const giveEl = document.getElementById('trade-live-give-list');
  if(!getEl || !giveEl) return;

  function rows(selectedMap, preferredOrder, emptyText){
    const map = selectedMap || new Map();
    const order = Array.isArray(preferredOrder) ? preferredOrder : [];
    const ids = [
      ...order.filter(id => map.has(id)),
      ...[...map.keys()].filter(id => !order.includes(id))
    ];

    if(!ids.length){
      return `<span class="trade-live-empty">${emptyText}</span>`;
    }

    return ids.map(id => {
      const qty = Math.max(1, Number(map.get(id) || 1));
      const info = STICKER_MAP[String(id).toUpperCase()];
      const name = info?.name || 'Figurita';
      const qtyText = qty > 1 ? `<span class="trade-live-qty">×${qty}</span>` : '';
      return `<div class="trade-live-item">
        <span class="trade-live-code">${String(id).replace('-', ' ')}</span>
        <span class="trade-live-name">${name}</span>
        ${qtyText}
      </div>`;
    }).join('');
  }

  getEl.innerHTML = rows(window._tradeGetSelected, window._tradeGet, 'Todavía no elegiste nada');
  giveEl.innerHTML = rows(window._tradeGiveSelected, window._tradeGive, 'Todavía no elegiste nada');
  updateTradeLiveToggleLabel();
}




function tradeOfferStickerLabel(id, qty=1){
  const code = String(id || '').toUpperCase();
  const info = STICKER_MAP[code];
  const name = info?.name || 'Figurita';
  const qtyText = Number(qty) > 1 ? ` ×${Number(qty)}` : '';
  return `${code.replace('-', ' ')} · ${name}${qtyText}`;
}

function tradeOfferLinesFromSelection(selectedMap, preferredOrder){
  const map = selectedMap || new Map();
  const order = Array.isArray(preferredOrder) ? preferredOrder : [];
  const orderedIds = [
    ...order.filter(id => map.has(id)),
    ...[...map.keys()].filter(id => !order.includes(id))
  ];

  return orderedIds
    .map(id => {
      const qty = Math.max(1, Number(map.get(id) || 1));
      return `• ${tradeOfferStickerLabel(id, qty)}`;
    });
}

function buildTradeOfferMessage(){
  const getLines = tradeOfferLinesFromSelection(window._tradeGetSelected, window._tradeGet);
  const giveLines = tradeOfferLinesFromSelection(window._tradeGiveSelected, window._tradeGive);
  const friendName = (window._currentTradeFriendName || '').trim();

  const parts = [
    'Propuesta de intercambio - Album Tracker',
    friendName ? `Para ${friendName}:` : '',
    '',
    'Me darías:',
    getLines.length ? getLines.join('\n') : '• Nada elegido',
    '',
    'Yo te daría:',
    giveLines.length ? giveLines.join('\n') : '• Nada elegido',
    '',
    '¿Te sirve?'
  ].filter((line, idx, arr) => {
    // Mantiene renglones vacíos útiles, pero evita dos vacíos seguidos al inicio.
    if(line !== '') return true;
    return idx > 0 && arr[idx - 1] !== '';
  });

  return parts.join('\n');
}

async function shareTradeOffer(){
  const {totalGive,totalGet} = tradeSelectionTotals();
  if(totalGive + totalGet <= 0){
    toast('Seleccioná figuritas para compartir la propuesta','warn');
    return;
  }

  const text = buildTradeOfferMessage();

  if(navigator.share){
    try{
      await navigator.share({
        title:'Propuesta de intercambio',
        text
      });
    }catch(e){
      console.warn('Compartir propuesta cancelado o no disponible', e);
    }
    return;
  }

  toast('Este dispositivo no permite compartir desde la app','warn');
}

let _pendingTradeAction = null;

function tradeSelectionTotals(){
  const totalGive = [...(window._tradeGiveSelected || new Map()).values()].reduce((a,b)=>a+b,0);
  const totalGet  = [...(window._tradeGetSelected || new Map()).values()].reduce((a,b)=>a+b,0);
  return {totalGive,totalGet};
}

function openTradeActionConfirm({kind,title,sub,buttonText,buttonClass}){
  _pendingTradeAction = kind;
  const ov = document.getElementById('trade-confirm-overlay');
  const titleEl = document.getElementById('trade-confirm-title');
  const subEl = document.getElementById('trade-confirm-sub');
  const action = document.getElementById('trade-confirm-action');
  if(titleEl) titleEl.textContent = title;
  if(subEl) subEl.textContent = sub;
  if(action){
    action.textContent = buttonText;
    action.className = buttonClass || 'trade-confirm-danger';
  }
  if(ov) ov.classList.add('show');
}

function closeTradeActionConfirm(){
  const ov = document.getElementById('trade-confirm-overlay');
  if(ov) ov.classList.remove('show');
  _pendingTradeAction = null;
}

function requestCancelTradeMatch(){
  openTradeActionConfirm({
    kind:'cancel',
    title:'¿Cancelar cambio?',
    sub:'Se va a cerrar este intercambio y no se va a modificar tu álbum.',
    buttonText:'Sí, cancelar',
    buttonClass:'trade-confirm-danger'
  });
}

function requestConfirmTrade(){
  const {totalGive,totalGet} = tradeSelectionTotals();
  if(totalGive + totalGet <= 0){
    toast('Seleccioná figuritas primero','warn');
    return;
  }
  openTradeActionConfirm({
    kind:'confirm',
    title:'¿Confirmar intercambio?',
    sub:`Vas a dar ${totalGive} y recibir ${totalGet}. Después se actualiza tu álbum.`,
    buttonText:'Sí, confirmar',
    buttonClass:'trade-confirm-ok'
  });
}

function runTradeActionConfirm(){
  const action = _pendingTradeAction;
  closeTradeActionConfirm();
  if(action === 'cancel') performCancelTradeMatch();
  if(action === 'confirm') performConfirmTrade();
}


function setTradeActionButtons(hasSelection){
  const wrap = document.getElementById('confirm-trade-wrap');
  const confirmBtn = document.querySelector('.trade-confirm-btn');
  const shareBtn = document.querySelector('.trade-offer-share-btn');
  const clearBtn = document.getElementById('trade-clear-chosen-btn');
  if(wrap) wrap.style.display = 'grid';
  if(confirmBtn) confirmBtn.style.display = hasSelection ? 'block' : 'none';
  if(shareBtn) shareBtn.style.display = hasSelection ? 'flex' : 'none';
  if(clearBtn) clearBtn.style.display = hasSelection ? 'inline-flex' : 'none';
}

function performCancelTradeMatch(){
  window._tradeGiveSelected = new Map();
  window._tradeGetSelected  = new Map();

  const match = document.getElementById('matchcard');
  if(match) match.style.display = 'none';

  const wrap = document.getElementById('confirm-trade-wrap');
  if(wrap) wrap.style.display = 'none';
  setTradeActionButtons(false);

  const giveCountEl = document.getElementById('give-sel-count');
  const getCountEl  = document.getElementById('get-sel-count');
  if(giveCountEl){ giveCountEl.dataset.total = '0'; updateTradeChosenCountLabel(giveCountEl, 0); }
  if(getCountEl){ getCountEl.dataset.total = '0'; updateTradeChosenCountLabel(getCountEl, 0); }

  updateMatchVerdict(0,0);
  toast('Intercambio cancelado','info');
}

// ─── CONFIRM TRADE ───────────────────────────────────────
function performConfirmTrade(){
  if((!window._tradeGiveSelected?.size) && (!window._tradeGetSelected?.size)){
    toast('Seleccioná figuritas primero','warn'); return;
  }

  const giveMap = window._tradeGiveSelected || new Map();
  const getMap  = window._tradeGetSelected || new Map();

  // Remove only duplicate copies. The album copy always stays protected.
  let totalGiven = 0;
  giveMap.forEach((qty, id) => {
    const have = col[id] || 0;
    const maxGive = Math.max(0, have - 1);
    const safeQty = Math.max(0, Math.min(qty, maxGive));
    if(safeQty <= 0) return;
    col[id] = have - safeQty;
    if(col[id] < 1) col[id] = 1;
    totalGiven += safeQty;
  });

  // Add N copies of each sticker we're receiving
  let totalGotten = 0;
  getMap.forEach((qty, id) => {
    const safeQty = Math.max(0, qty || 0);
    if(safeQty <= 0) return;
    col[id] = (col[id]||0) + safeQty;
    totalGotten += safeQty;
  });

  if(totalGiven === 0 && totalGotten === 0){
    toast('No había repetidas disponibles para dar','warn');
    return;
  }

  save();
  updateStats();
  if(isActive('album')) renderGrid();

  // Reset
  window._tradeGiveSelected = new Map();
  window._tradeGetSelected  = new Map();
  document.getElementById('confirm-trade-wrap').style.display = 'none';
  document.getElementById('matchcard').style.display = 'none';

  toast(`🤝 ¡Intercambio hecho! +${totalGotten} pegadas, -${totalGiven} repetidas`, 'ok');
}


// ─── AVATAR COLOR ────────────────────────────────────────
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#a78bfa,#60a5fa)',   // purple-blue
  'linear-gradient(135deg,#f5c842,#ff6b35)',   // gold-orange
  'linear-gradient(135deg,#4ade80,#22c55e)',   // green
  'linear-gradient(135deg,#f87171,#ec4899)',   // red-pink
  'linear-gradient(135deg,#60a5fa,#34d399)',   // blue-teal
  'linear-gradient(135deg,#fb923c,#f59e0b)',   // orange-amber
  'linear-gradient(135deg,#e879f9,#a78bfa)',   // pink-purple
  'linear-gradient(135deg,#2dd4bf,#60a5fa)',   // teal-blue
];
function avatarGradient(i){ return AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length]; }


// ─── CONFETTI ────────────────────────────────────────────
function launchConfetti(teamName){
  const canvas = document.getElementById('confetti-canvas');
  if(!canvas) return;
  canvas.style.display = 'block';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const pieces = Array.from({length:120}, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * -canvas.height,
    w: Math.random()*10+5, h: Math.random()*6+4,
    r: Math.random()*Math.PI*2,
    dr: (Math.random()-.5)*.2,
    dx: (Math.random()-.5)*4,
    dy: Math.random()*4+2,
    color: ['#f5c842','#a78bfa','#60a5fa','#4ade80','#f87171','#fb923c'][Math.floor(Math.random()*6)]
  }));

  // Smooth completion alert
  const msg = `🎉 ¡Completaste ${teamName}!`;
  const div = document.createElement('div');
  div.className = 'team-complete-alert';
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(()=>div.remove(), 2200);

  let frame = 0;
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    pieces.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
      ctx.restore();
      p.x += p.dx; p.y += p.dy; p.r += p.dr;
    });
    frame++;
    if(frame < 120) requestAnimationFrame(draw);
    else { ctx.clearRect(0,0,canvas.width,canvas.height); canvas.style.display='none'; }
  }
  draw();
}

// Check if team just completed
let _prevComplete = new Set();

function syncCompletedTeamsState(){
  _prevComplete = new Set();
  for(const [teamKey, stickers] of Object.entries(STICKERS_BY_TEAM)){
    if(!stickers || !stickers.length) continue;
    if(stickers.every(s => (col[s.id.toUpperCase()]||0) > 0)){
      _prevComplete.add(teamKey);
    }
  }
}


function checkTeamComplete(teamKey){
  const stickers = STICKERS_BY_TEAM[teamKey];
  if(!stickers || stickers.length === 0) return;
  const allGot = stickers.every(s => (col[s.id.toUpperCase()]||0) > 0);
  const wasComplete = _prevComplete.has(teamKey);
  if(allGot && !wasComplete){
    _prevComplete.add(teamKey);
    const teamInfo = TEAMS.find(t=>t.key===teamKey);
    const lp = teamInfo?.label.match(/^\S+\s+[A-Z0-9_]+\s+·\s+(.+)$/);
    const name = lp ? lp[1] : teamKey;
    launchConfetti(name);
  } else if(!allGot){
    _prevComplete.delete(teamKey);
  }
}



// ─── WHATSAPP SHARE ──────────────────────────────────────
async function shareWhatsApp(){
  return shareQRImage();
}

// ─── SHARE QR AS IMAGE ───────────────────────────────────
async function shareQRImage(){
  try{
    if(isOnlineSyncConfigured()){
      await ensureOnlineProfileSynced();
      refreshMyOnlineCodeUI();
    }
  }catch(e){
    console.warn('No se pudo sincronizar antes de compartir el QR', e);
  }

  genQR();
  await new Promise(r => setTimeout(r, 250));

  const box = document.getElementById('qrbox');
  const canvas = box ? box.querySelector('canvas') : null;
  const shareUrl = isOnlineSyncConfigured() ? buildOnlineFriendUrl() : buildTradeUrl();
  const shareText = isOnlineSyncConfigured()
    ? `Agregame a Album Tracker. Mi código fijo es ${displayOnlineFriendCode(getMyOnlineProfile().id)}.`
    : 'Escaneá este QR para intercambiar figuritas.';

  if(!navigator.share){
    toast('Tu navegador no permite compartir. Usá Copiar link.','warn');
    return;
  }

  if(canvas && canvas.toBlob){
    canvas.toBlob(async blob=>{
      try{
        if(blob){
          const file = new File([blob], 'albumtracker-qr.png', {type:'image/png'});
          if(navigator.canShare && navigator.canShare({files:[file]})){
            await navigator.share({
              files:[file],
              title:'Mi QR Album Tracker',
              text:shareText
            });
            return;
          }
        }

        await navigator.share({
          title:'Mi QR Album Tracker',
          text:`${shareText}\n${shareUrl}`
        });
      }catch(e){
        console.warn('Compartir cancelado o no disponible', e);
        toast('No se compartió el QR','warn');
      }
    }, 'image/png');
    return;
  }

  try{
    await navigator.share({
      title:'Mi QR Album Tracker',
      text:`${shareText}\n${shareUrl}`
    });
  }catch(e){
    console.warn('Compartir cancelado o no disponible', e);
    toast('No se compartió el QR','warn');
  }
}


function isOnlineSyncConfigured(){
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);
}

function getSupabaseClient(){
  if(!isOnlineSyncConfigured()) return null;
  if(!supabaseClient){
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}

function randomOnlinePart(len=10){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for(const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function extractOnlineFriendCode(raw){
  raw = String(raw || '').trim();
  if(!raw) return '';

  // Puede venir como código directo: AT-ABC123DEF4
  // o como link de QR: https://.../?tab=trade&friend=AT-ABC123DEF4
  try{
    const url = new URL(raw, location.href);
    const fromQuery = url.searchParams.get('friend') || url.searchParams.get('amigo');
    if(fromQuery) raw = fromQuery;
    else if(url.hash){
      const hashQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?')) : url.hash.replace(/^#/, '?');
      const hashUrl = new URL(url.origin + url.pathname + hashQuery);
      const hashCode = hashUrl.searchParams.get('friend') || hashUrl.searchParams.get('amigo');
      if(hashCode) raw = hashCode;
    }
  }catch(e){}

  const normalized = raw.toUpperCase().replace(/^AT-/, '').replace(/[^A-Z0-9]/g, '');
  // Los códigos fijos propios de la app son de 10 caracteres.
  if(/^[A-Z0-9]{10}$/.test(normalized)) return normalized;
  return '';
}

function normalizeOnlineFriendCode(raw){
  return extractOnlineFriendCode(raw);
}

function displayOnlineFriendCode(id){
  return id ? 'AT-' + String(id).toUpperCase() : '';
}

function getMyOnlineProfile(){
  let profile = null;
  try{ profile = JSON.parse(localStorage.getItem('pn26_online_profile') || 'null'); }catch(e){}
  if(!profile || !profile.id || !profile.editToken){
    profile = {
      id: randomOnlinePart(10),
      editToken: randomOnlinePart(32),
      name: localStorage.getItem('pn26_online_name') || 'Mi álbum'
    };
    localStorage.setItem('pn26_online_profile', JSON.stringify(profile));
  }
  return profile;
}

function setOnlineStatus(text, kind='info'){
  const el = document.getElementById('online-sync-help');
  if(!el) return;
  el.textContent = text;
  el.classList.remove('ok','warn','err');
  el.classList.add(kind);
}

function refreshMyOnlineCodeUI(){
  const el = document.getElementById('my-online-code');
  if(!el) return;
  if(!isOnlineSyncConfigured()){
    el.textContent = 'Supabase no configurado';
    setOnlineStatus('Para activar amigos automáticos, pegá SUPABASE_URL y SUPABASE_ANON_KEY en app.js.', 'warn');
    return;
  }
  const profile = getMyOnlineProfile();
  el.textContent = displayOnlineFriendCode(profile.id);
  setOnlineStatus('Compartí este código una sola vez. La app sube tus repetidas y faltantes cuando cambiás tu álbum.', 'ok');
}

async function ensureOnlineProfileSynced(){
  const client = getSupabaseClient();
  if(!client) return false;
  const profile = getMyOnlineProfile();
  const payload = buildPayload();

  const { data: existing, error: selectError } = await client
    .from('album_profiles')
    .select('id')
    .eq('id', profile.id)
    .maybeSingle();

  if(selectError) throw selectError;

  if(!existing){
    const { error } = await client.from('album_profiles').insert({
      id: profile.id,
      name: profile.name || 'Mi álbum',
      payload,
      edit_token: profile.editToken
    });
    if(error) throw error;
  }else{
    const { error } = await client.rpc('update_album_profile', {
      p_id: profile.id,
      p_edit_token: profile.editToken,
      p_name: profile.name || 'Mi álbum',
      p_payload: payload
    });
    if(error) throw error;
  }

  localStorage.setItem('pn26_online_last_sync', String(Date.now()));
  return true;
}

function scheduleOnlineProfileSync(){
  if(!isOnlineSyncConfigured()) return;
  clearTimeout(onlineSyncTimer);
  onlineSyncTimer = setTimeout(async ()=>{
    try{
      await ensureOnlineProfileSynced();
      refreshMyOnlineCodeUI();
    }catch(e){
      console.warn('No se pudo sincronizar mi perfil online', e);
    }
  }, 1400);
}

async function copyMyOnlineFriendCode(){
  if(!isOnlineSyncConfigured()){
    toast('Primero configurá Supabase en app.js','warn');
    refreshMyOnlineCodeUI();
    return;
  }

  const code = displayOnlineFriendCode(getMyOnlineProfile().id);
  refreshMyOnlineCodeUI();

  const copied = await copyTextToClipboard(code);
  if(copied){
    toast('Código fijo copiado','ok');
  }else{
    showManualCopyBox(code, 'Copiar mi código fijo');
    toast('Copialo desde el recuadro','warn');
  }

  ensureOnlineProfileSynced()
    .then(refreshMyOnlineCodeUI)
    .catch(e => console.warn('No se pudo sincronizar mi código online', e));
}

async function copyMyOnlineFriendLink(){
  if(!isOnlineSyncConfigured()){
    toast('Primero configurá Supabase en app.js','warn');
    refreshMyOnlineCodeUI();
    return;
  }

  const link = buildOnlineFriendUrl(displayOnlineFriendCode(getMyOnlineProfile().id));
  refreshMyOnlineCodeUI();

  const copied = await copyTextToClipboard(link);
  if(copied){
    toast('Link de código fijo copiado','ok');
  }else{
    showManualCopyBox(link, 'Copiar link del QR');
    toast('Copialo desde el recuadro','warn');
  }

  ensureOnlineProfileSynced()
    .then(refreshMyOnlineCodeUI)
    .catch(e => console.warn('No se pudo sincronizar mi link online', e));
}

async function fetchOnlineFriendProfile(rawCode){
  const client = getSupabaseClient();
  if(!client) throw new Error('Supabase no configurado');
  const id = normalizeOnlineFriendCode(rawCode);
  if(!id) throw new Error('Código vacío');

  const { data, error } = await client
    .from('album_profiles')
    .select('id,name,payload,updated_at')
    .eq('id', id)
    .maybeSingle();

  if(error) throw error;
  if(!data) throw new Error('No existe ese código');
  return data;
}


function friendBenefitCountFromPayload(payload){
  const parsed = parsePayload(payload);
  if(!parsed) return 0;
  const me = myData();
  const myMiss = new Set(me.m);
  const theirDupesSet = new Set((parsed.dupes || []).map(s => String(s).toUpperCase()));
  return [...theirDupesSet].filter(id => myMiss.has(id)).length;
}


function friendMissingIdsFromPayload(payload){
  const parsed = parsePayload(payload);
  if(!parsed) return [];
  const gotSet = new Set((parsed.got || []).map(s => String(s).toUpperCase()));
  return officialAlbumIds().filter(id => !gotSet.has(id));
}

function renderFriendMissingGroups(ids){
  const idSet = new Set((ids || []).map(id => String(id).toUpperCase()));
  if(!idSet.size){
    return '<div class="friend-missing-empty">No le faltan figuritas cargadas.</div>';
  }

  let html = '';
  for(const group of WC_GROUPS){
    for(const teamKey of group.teams){
      const stickers = STICKERS_BY_TEAM[teamKey];
      if(!stickers) continue;
      const teamIds = stickers.map(s => s.id.toUpperCase()).filter(id => idSet.has(id));
      if(!teamIds.length) continue;

      const parts = teamDisplayParts(TEAMS.find(t => t.key === teamKey) || {key:teamKey,label:teamKey});
      html += `<div class="friend-missing-group">
        <div class="friend-missing-hdr">
          <span>${parts.flag}</span>
          <strong>${parts.code}</strong>
          <span>${parts.name}</span>
          <em>${teamIds.length}</em>
        </div>
        <div class="friend-missing-chips">
          ${teamIds.map(id => `<span>${id.replace('-', ' ')}</span>`).join('')}
        </div>
      </div>`;
    }
  }

  return html || '<div class="friend-missing-empty">No le faltan figuritas cargadas.</div>';
}

function closeFriendMissingModal(){
  const overlay = document.getElementById('friend-missing-overlay');
  if(!overlay) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden','true');
}


function formatFriendMissingText(name, ids){
  const cleanIds = (ids || []).map(id => String(id || '').toUpperCase()).filter(Boolean);
  const title = name ? `Faltantes de ${name}` : 'Faltantes del amigo';
  if(!cleanIds.length) return `${title}\nNo aparecen faltantes cargados.`;

  const idSet = new Set(cleanIds);
  const lines = [title, ''];

  for(const group of WC_GROUPS){
    for(const teamKey of group.teams){
      const stickers = STICKERS_BY_TEAM[teamKey];
      if(!stickers) continue;
      const teamIds = stickers.map(s => s.id.toUpperCase()).filter(id => idSet.has(id));
      if(!teamIds.length) continue;

      const team = TEAMS.find(t => t.key === teamKey) || {key:teamKey,label:teamKey};
      const parts = teamDisplayParts(team);
      const nums = teamIds.map(id => id.split('-')[1] || id).join(', ');
      lines.push(`${parts.flag} ${parts.code}: ${nums}`);
    }
  }

  return lines.join('\n').trim();
}

async function copyFriendMissingCodes(){
  const text = formatFriendMissingText(currentFriendMissingState.name, currentFriendMissingState.ids);
  const copied = await copyTextToClipboard(text);
  if(copied){
    toast('Faltantes copiados','ok');
  }else{
    showManualCopyBox(text, 'Copiar faltantes');
    toast('Copialo desde el recuadro','warn');
  }
}

function openFriendMissingModal(friend){
  if(!friend) return;
  const ids = friendMissingIdsFromPayload(friend.code);
  let overlay = document.getElementById('friend-missing-overlay');

  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'friend-missing-overlay';
    overlay.className = 'friend-missing-overlay';
    overlay.setAttribute('aria-hidden','true');
    overlay.innerHTML = `
      <div class="friend-missing-card" role="dialog" aria-modal="true">
        <div class="friend-missing-top">
          <div class="friend-missing-heading">
            <div class="friend-missing-kicker">Faltantes del amigo</div>
            <div class="friend-missing-title" id="friend-missing-title">Faltantes</div>
          </div>
          <div class="friend-missing-top-actions">
            <button class="friend-missing-copy" type="button" onclick="copyFriendMissingCodes()">Copiar códigos</button>
            <button class="friend-missing-close" type="button" onclick="closeFriendMissingModal()" aria-label="Cerrar">×</button>
          </div>
        </div>
        <div class="friend-missing-sub" id="friend-missing-sub"></div>
        <div class="friend-missing-list" id="friend-missing-list"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
      if(e.target === overlay) closeFriendMissingModal();
    });
  }

  currentFriendMissingState = { name: friend.name || '', ids: [...ids] };

  const title = overlay.querySelector('#friend-missing-title');
  const sub = overlay.querySelector('#friend-missing-sub');
  const list = overlay.querySelector('#friend-missing-list');
  if(title) title.textContent = friend.name ? `Faltantes de ${friend.name}` : 'Faltantes del amigo';
  if(sub) sub.textContent = ids.length ? `${ids.length} figuritas que todavía le faltan.` : 'No aparecen faltantes para este amigo.';
  if(list) list.innerHTML = renderFriendMissingGroups(ids);

  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden','false');
}

async function showFriendMissing(event, i){
  if(event) event.stopPropagation();
  const friends = loadFriends();
  const f = friends[i];
  if(!f) return;

  if(f.online && f.onlineId && isOnlineSyncConfigured()){
    try{
      const row = await fetchOnlineFriendProfile(f.onlineId);
      if(row && row.payload){
        f.code = row.payload;
        f.updatedAt = row.updated_at;
        f.date = new Date(row.updated_at || Date.now()).toLocaleDateString('es-AR');
        friends[i] = f;
        saveFriends(friends);
        renderFriends();
      }
    }catch(e){
      console.warn('No se pudo actualizar faltantes del amigo', e);
      toast('Muestro los últimos faltantes guardados','warn');
    }
  }

  openFriendMissingModal(f);
}

function onlineFriendAlreadyMessage(name){
  return `${name || 'Ese amigo'} ya está en tu lista`;
}

async function saveOnlineFriend(){
  const nameEl = document.getElementById('online-friend-name');
  const codeEl = document.getElementById('online-friend-code');
  const name = (nameEl?.value || '').trim();
  const rawCode = (codeEl?.value || '').trim();

  if(!name){ toast('Escribí el nombre del amigo','warn'); return; }
  if(!rawCode){ toast('Pegá el código fijo del amigo','warn'); return; }

  try{
    const profile = await fetchOnlineFriendProfile(rawCode);
    const parsed = parsePayload(profile.payload);
    if(!parsed) throw new Error('El código fijo no tiene datos válidos');

    const friends = loadFriends();
    const onlineId = profile.id;
    const existingByCode = friends.findIndex(f => f.online && f.onlineId === onlineId);
    const existingByName = friends.findIndex(f => (f.name || '').toLowerCase() === name.toLowerCase());

    const entry = {
      name,
      code: profile.payload,
      online: true,
      onlineId,
      date: new Date().toLocaleDateString('es-AR'),
      updatedAt: profile.updated_at || new Date().toISOString()
    };

    if(existingByCode >= 0){
      friends[existingByCode] = {...friends[existingByCode], ...entry};
      saveFriends(friends);
      if(nameEl) nameEl.value = '';
      if(codeEl) codeEl.value = '';
      renderFriends();
      showMatch(parsed);
      document.getElementById('matchcard')?.scrollIntoView({behavior:'smooth',block:'start'});
      toast(onlineFriendAlreadyMessage(friends[existingByCode].name),'info');
      return;
    }

    if(existingByName >= 0){
      friends[existingByName] = {...friends[existingByName], ...entry};
    }else{
      friends.push(entry);
    }

    saveFriends(friends);
    if(nameEl) nameEl.value = '';
    if(codeEl) codeEl.value = '';
    renderFriends();
    showMatch(parsed);
    document.getElementById('matchcard')?.scrollIntoView({behavior:'smooth',block:'start'});
    toast(`${name} agregado correctamente`,'ok');
  }catch(e){
    console.error(e);
    const msg = String(e?.message || '').toLowerCase();
    if(msg.includes('no existe') || msg.includes('código vacío') || msg.includes('codigo vacio')){
      toast('Ese código no existe todavía','err');
    }else{
      toast(e.message || 'No pude guardar ese amigo','err');
    }
  }
}

async function refreshOnlineFriends(showToast=false){
  const client = getSupabaseClient();
  if(!client){
    if(showToast) toast('Supabase no está configurado','warn');
    refreshMyOnlineCodeUI();
    return;
  }

  const friends = loadFriends();
  const onlineFriends = friends.filter(f=>f.online && f.onlineId);
  if(!onlineFriends.length){
    if(showToast) toast('No tenés amigos online guardados','info');
    return;
  }

  try{
    const ids = onlineFriends.map(f=>f.onlineId);
    const { data, error } = await client
      .from('album_profiles')
      .select('id,name,payload,updated_at')
      .in('id', ids);
    if(error) throw error;

    const byId = new Map((data||[]).map(row=>[row.id, row]));
    let changed = 0;

    for(const f of friends){
      if(!f.online || !f.onlineId) continue;
      const row = byId.get(f.onlineId);
      if(!row || !row.payload) continue;
      if(f.code !== row.payload || f.updatedAt !== row.updated_at){
        f.code = row.payload;
        f.updatedAt = row.updated_at;
        f.date = new Date(row.updated_at || Date.now()).toLocaleDateString('es-AR');
        changed++;
      }
    }

    saveFriends(friends);
    renderFriends();
    if(showToast) toast(changed ? `Actualicé ${changed} amigo(s)` : 'Tus amigos ya estaban actualizados', changed ? 'ok' : 'info');
  }catch(e){
    console.error(e);
    if(showToast) toast('No pude actualizar amigos online','err');
  }
}


async function updateOnlineFriendFromList(event, i){
  if(event) event.stopPropagation();
  await loadFriendCode(i, { forceOnlineRefresh:true, fromButton:true });
}

function scheduleOnlineFriendsRefresh(){
  clearInterval(onlineFriendsRefreshTimer);
  if(!isOnlineSyncConfigured()) return;
  onlineFriendsRefreshTimer = setInterval(()=>refreshOnlineFriends(false), 5 * 60 * 1000);
}


// ─── FRIENDS ─────────────────────────────────────────────
function loadFriends(){ try{ return JSON.parse(localStorage.getItem('pn26_friends')||'[]'); }catch(e){return [];} }
function saveFriends(friends){ localStorage.setItem('pn26_friends', JSON.stringify(friends)); }

function renderFriends(){
  const friends = loadFriends();
  const list = document.getElementById('friend-list');
  if(!list) return;
  if(!friends.length){
    list.innerHTML = '<div class="friend-empty empty-state"><div class="empty-title">Todavía no guardaste amigos</div><div class="empty-sub">Escaneá su QR o pegá su código fijo una sola vez. Después tocás su tarjeta y la app trae sus repetidas actualizadas.</div></div>';
    return;
  }

  const sortedFriends = friends
    .map((f, i) => ({ f, i, benefitCount: friendBenefitCountFromPayload(f.code) }))
    .sort((a, b) => b.benefitCount - a.benefitCount || String(a.f.name || '').localeCompare(String(b.f.name || '')));

  list.innerHTML = sortedFriends.map(({f, i, benefitCount})=>{
    const badge = f.online ? '' : '<span class="friend-legacy-badge">LOCAL</span>';
    const dateTxt = f.online
      ? ''
      : `Guardado ${f.date || ''}`;
    const benefitTxt = `Tiene ${benefitCount} que te sirven`;
    const benefitClass = benefitCount > 0 ? 'friend-benefit friend-benefit-ok' : 'friend-benefit friend-benefit-zero';
    const isUpdating = updatingOnlineFriendIndexes.has(i);
    const actionLabel = f.online
      ? (isUpdating ? 'Actualizando...' : 'Actualizar y ver repetidas')
      : 'Abrir match';
    return `
    <div class="friend-item ${f.online ? 'friend-online' : 'friend-legacy'}" onclick="loadFriendCode(${i})" title="${f.online ? 'Actualizar repetidas y abrir match' : 'Abrir match guardado'}">
      <div class="friend-avatar" style="background:${avatarGradient(i)};">${(f.name||'?')[0].toUpperCase()}</div>
      <div class="friend-info">
        <div class="friend-mainline">
          <div class="friend-name">${f.name} ${badge}</div>
          <div class="${benefitClass} friend-benefit-line">${benefitTxt}</div>
          ${dateTxt ? `<div class="friend-date friend-sync">${dateTxt}</div>` : ''}
        </div>
        <div class="friend-actions">
          <button class="friend-update" type="button" onclick="updateOnlineFriendFromList(event,${i})" ${isUpdating ? 'disabled' : ''}>${actionLabel}</button>
          ${f.online ? `<button class="friend-missing-link" type="button" onclick="showFriendMissing(event,${i})">Ver faltantes</button>` : ''}
        </div>
      </div>
      <button class="friend-del" type="button" onclick="deleteFriend(event,${i})" aria-label="Eliminar amigo">✕</button>
    </div>`;
  }).join('');
}

function saveFriend(){
  const nameEl = document.getElementById('friend-name-input');
  const name = nameEl.value.trim();
  if(!name){ toast('Escribí un nombre','warn'); return; }
  const payload = window._pendingFriendCode || buildPayload();
  const friends = loadFriends();
  const existing = friends.findIndex(f=>f.name.toLowerCase()===name.toLowerCase());
  const entry = { name, code: payload, date: new Date().toLocaleDateString('es-AR') };
  if(existing>=0) friends[existing] = entry;
  else friends.push(entry);
  saveFriends(friends);
  nameEl.value = '';
  renderFriends();
  toast(`¡${name} guardado!`,'ok');
}

function saveFriendFromMatch(){
  const pendingOnline = window._pendingOnlineFriend;
  if(pendingOnline && pendingOnline.onlineId){
    const nameEl = document.getElementById('friend-name-input');
    const name = (nameEl?.value || '').trim();
    if(!name){ toast('Escribí un nombre','warn'); return; }

    const friends = loadFriends();
    const existingByCode = friends.findIndex(f => f.online && f.onlineId === pendingOnline.onlineId);
    const existingByName = friends.findIndex(f => (f.name || '').toLowerCase() === name.toLowerCase());

    const entry = {
      name,
      code: pendingOnline.code,
      online: true,
      onlineId: pendingOnline.onlineId,
      date: new Date(pendingOnline.updatedAt || Date.now()).toLocaleDateString('es-AR'),
      updatedAt: pendingOnline.updatedAt || new Date().toISOString()
    };

    if(existingByCode >= 0){
      friends[existingByCode] = {...friends[existingByCode], ...entry};
      saveFriends(friends);
      if(nameEl) nameEl.value = '';
      renderFriends();
      document.getElementById('friend-save-prompt').style.display='none';
      window._pendingFriendCode = null;
      window._pendingOnlineFriend = null;
      toast(onlineFriendAlreadyMessage(name),'info');
      return;
    }

    if(existingByName >= 0) friends[existingByName] = {...friends[existingByName], ...entry};
    else friends.push(entry);

    saveFriends(friends);
    if(nameEl) nameEl.value = '';
    renderFriends();
    document.getElementById('friend-save-prompt').style.display='none';
    window._pendingFriendCode = null;
    window._pendingOnlineFriend = null;
    toast(`${name} agregado correctamente`,'ok');
    return;
  }

  saveFriend();
  document.getElementById('friend-save-prompt').style.display='none';
  window._pendingFriendCode = null;
}

function updateFriendCode(i){
  const friends = loadFriends();
  const f = friends[i];
  if(!f) return;

  const pendingOnline = window._pendingOnlineFriend;
  if(pendingOnline && pendingOnline.onlineId){
    friends[i] = {
      ...f,
      code: pendingOnline.code,
      online: true,
      onlineId: pendingOnline.onlineId,
      date: new Date(pendingOnline.updatedAt || Date.now()).toLocaleDateString('es-AR'),
      updatedAt: pendingOnline.updatedAt || new Date().toISOString()
    };
  }else{
    f.code = window._pendingFriendCode;
    f.date = new Date().toLocaleDateString('es-AR');
    friends[i] = f;
  }

  saveFriends(friends);
  renderFriends();
  document.getElementById('friend-save-prompt').style.display='none';
  window._pendingFriendCode = null;
  window._pendingOnlineFriend = null;
  toast(`✓ ${f.name} actualizado`,'ok');
}

async function loadFriendCode(i, opts={}){
  const friends = loadFriends();
  const f = friends[i];
  if(!f) return;

  if(f.online && updatingOnlineFriendIndexes.has(i)) return;

  if(f.online && f.onlineId){
    updatingOnlineFriendIndexes.add(i);
    renderFriends();
    if(isOnlineSyncConfigured()){
      try{
        const row = await fetchOnlineFriendProfile(f.onlineId);
        if(row && row.payload){
          f.code = row.payload;
          f.updatedAt = row.updated_at;
          f.date = new Date(row.updated_at || Date.now()).toLocaleDateString('es-AR');
          friends[i] = f;
          saveFriends(friends);
        }
      }catch(e){
        console.warn('No se pudo actualizar amigo online', e);
        toast('No pude actualizarlo online, uso el último dato guardado','warn');
      }finally{
        updatingOnlineFriendIndexes.delete(i);
        renderFriends();
      }
    }else{
      updatingOnlineFriendIndexes.delete(i);
      renderFriends();
      toast('Supabase no está configurado. Uso el último dato guardado.','warn');
      refreshMyOnlineCodeUI();
    }
  }

  const parsed = parsePayload(f.code);
  if(!parsed){ toast('Código inválido','err'); return; }
  window._pendingFriendCode = f.code;
  window._currentTradeFriendName = f.name || '';
  showMatch(parsed);
  const prompt = document.getElementById('friend-save-prompt');
  if(prompt) prompt.style.display='none';
  document.getElementById('matchcard')?.scrollIntoView({behavior:'smooth',block:'start'});
  if(!opts.silent){
    toast(f.online ? `Match actualizado con ${f.name}` : `Match con ${f.name}`, 'ok');
  }
}

let _pendingFriendDeleteIndex = null;

function deleteFriend(e, i){
  if(e) e.stopPropagation();
  const friends = loadFriends();
  const friend = friends[i];
  if(!friend) return;

  _pendingFriendDeleteIndex = i;
  const modal = document.getElementById('friend-delete-confirm');
  const text = document.getElementById('friend-delete-confirm-text');
  if(text) text.textContent = `¿Querés eliminar a ${friend.name || 'este amigo'} de tus amigos?`;
  if(modal){
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
  }
}

function closeFriendDeleteConfirm(){
  const modal = document.getElementById('friend-delete-confirm');
  if(modal){
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden','true');
  }
  _pendingFriendDeleteIndex = null;
}

function confirmFriendDelete(){
  if(_pendingFriendDeleteIndex === null) return;
  const friends = loadFriends();
  const friend = friends[_pendingFriendDeleteIndex];
  if(!friend){
    closeFriendDeleteConfirm();
    return;
  }

  friends.splice(_pendingFriendDeleteIndex, 1);
  saveFriends(friends);
  renderFriends();
  toast(`${friend.name || 'Amigo'} eliminado`,'info');
  closeFriendDeleteConfirm();
}

// ═══════════════════════════════════════════════════════════
// QR SCANNING — cámara en vivo + galería
// ═══════════════════════════════════════════════════════════

let _qrReaderLoading = null;

function scannerHelpfulText(text, mode='idle'){
  if(mode === 'err'){
    return `${text} Probá subir el brillo de la pantalla del otro celular, acercar/alejar hasta que el QR ocupe el cuadrado, o elegir una captura desde galería.`;
  }
  if(mode === 'live'){
    return `${text} Tip: si no lee, subí el brillo del otro dispositivo y acercá/alejá hasta que el QR quede nítido dentro del cuadrado.`;
  }
  return text;
}

function setScannerState(text, mode='idle'){
  text = scannerHelpfulText(text, mode);
  window._lastScannerState = { text, mode };
}

async function ensureQRReader(){
  if(window.jsQR || window.BarcodeDetector) return true;
  if(_qrReaderLoading) return _qrReaderLoading;

  _qrReaderLoading = new Promise(resolve=>{
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    s.onload = ()=>resolve(!!window.jsQR);
    s.onerror = ()=>resolve(false);
    document.head.appendChild(s);
  });

  return _qrReaderLoading;
}


let _zxingReader = null;
let _zxingControls = null;
let _zxingLoading = null;

let _html5Qr = null;
let _html5QrRunning = false;
let _html5QrLoading = null;

async function ensureHtml5QrReader(){
  if(window.Html5Qrcode) return true;
  if(_html5QrLoading) return _html5QrLoading;

  const sources = [
    'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
    'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js'
  ];

  _html5QrLoading = (async ()=>{
    for(const src of sources){
      const ok = await new Promise(resolve=>{
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = ()=>resolve(!!window.Html5Qrcode);
        s.onerror = ()=>resolve(false);
        document.head.appendChild(s);
      });
      if(ok && window.Html5Qrcode) return true;
    }
    return false;
  })();

  return _html5QrLoading;
}

async function startHtml5QrTradeCam(){
  const box = document.getElementById('trade-cam-box');
  const video = document.getElementById('trade-video');
  const btn = document.getElementById('trade-scan-btn');
  const hasReader = await ensureHtml5QrReader();
  if(!hasReader) return false;

  let readerEl = document.getElementById('html5qr-reader');
  if(!readerEl){
    readerEl = document.createElement('div');
    readerEl.id = 'html5qr-reader';
    if(box) box.prepend(readerEl);
  }
  readerEl.innerHTML = '';
  readerEl.style.display = 'block';
  if(video) video.style.display = 'none';

  if(box) box.style.display = 'block';
  if(btn) btn.textContent = '✕ Cerrar escáner';
  setScannerState('Cámara activa. Poné el QR dentro del marco y esperá a que enfoque.', 'live');

  window._tradeScanHandled = false;
  window._tradeScanMisses = 0;

  try{
    _html5Qr = new Html5Qrcode('html5qr-reader', { verbose:false });
    _html5QrRunning = true;

    const config = {
      fps: 5,
      aspectRatio: 1.0,
      disableFlip: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      qrbox: (viewfinderWidth, viewfinderHeight)=>{
        const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.76);
        return { width: edge, height: edge };
      }
    };

    await _html5Qr.start(
      { facingMode: { ideal: 'environment' } },
      config,
      decodedText => {
        if(!decodedText || window._tradeScanHandled) return;
        handleScannedTradeCode(decodedText);
      },
      () => {}
    );
    return true;
  }catch(e){
    _html5QrRunning = false;
    try{
      if(_html5Qr && _html5Qr.clear) await _html5Qr.clear();
    }catch(_){}
    _html5Qr = null;
    if(readerEl) readerEl.style.display = 'none';
    if(video) video.style.display = 'block';
    if(box) box.style.display = 'none';
    if(btn) btn.textContent = '📷 Escanear QR en vivo';
    return false;
  }
}



async function ensureZXingReader(){
  return false;
}


function isTradeScannerOpen(){
  return !!(tradStream || _zxingControls || _html5QrRunning);
}

async function startZXingTradeCam(){
  const box = document.getElementById('trade-cam-box');
  const video = document.getElementById('trade-video');
  const btn = document.getElementById('trade-scan-btn');
  if(!video) return false;

  const hasZXing = await ensureZXingReader();
  if(!hasZXing) return false;

  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.autoplay = true;
  video.muted = true;

  if(box) box.style.display = 'block';
  if(btn) btn.textContent = '✕ Cerrar escáner';
  setScannerState('Cámara activa. Acercá/alejá el iPhone hasta que el QR quede nítido dentro del marco.', 'live');

  window._tradeScanHandled = false;
  window._tradeScanMisses = 0;

  const onResult = (value)=>{
    if(!value || window._tradeScanHandled) return;
    handleScannedTradeCode(String(value));
  };

  try{
    const constraints = {
      audio:false,
      video:{
        facingMode:{ ideal:'environment' },
        width:{ ideal:640 },
        height:{ ideal:480 },
        frameRate:{ ideal:24, max:30 }
      }
    };

    if(window.ZXingBrowser && window.ZXingBrowser.BrowserQRCodeReader){
      _zxingReader = new ZXingBrowser.BrowserQRCodeReader();
      _zxingControls = await _zxingReader.decodeFromConstraints(constraints, video, (result, error, controls)=>{
        if(result){
          onResult(result.getText ? result.getText() : (result.text || result.rawValue || result));
        }
      });
      return true;
    }

    if(window.ZXing && window.ZXing.BrowserQRCodeReader){
      _zxingReader = new ZXing.BrowserQRCodeReader();
      await _zxingReader.decodeFromVideoDevice(null, video, (result, error)=>{
        if(result){
          onResult(result.getText ? result.getText() : (result.text || result.rawValue || result));
        }
      });
      _zxingControls = { stop:()=>{ try{ _zxingReader.reset(); }catch(e){} } };
      return true;
    }
  }catch(e){
    try{
      if(_zxingReader && _zxingReader.reset) _zxingReader.reset();
    }catch(_){}
    _zxingReader = null;
    _zxingControls = null;
    if(box) box.style.display = 'none';
    if(btn) btn.textContent = '📷 Escanear QR en vivo';
    return false;
  }

  return false;
}


function focusTradeScannerSection(){
  const target = document.getElementById('trade-cam-box') || document.querySelector('#panel-trade .scanner-card') || document.getElementById('trade-scan-btn');
  if(!target) return;
  setTimeout(()=>{
    try{
      target.scrollIntoView({behavior:'smooth', block:'center', inline:'nearest'});
    }catch(_){}
  }, 80);
  setTimeout(()=>{
    try{
      target.scrollIntoView({behavior:'smooth', block:'center', inline:'nearest'});
    }catch(_){}
  }, 420);
}

async function toggleTradeCam(){
  if(isTradeScannerOpen()){
    stopTradeCam();
    return;
  }
  await startTradeCam();
  focusTradeScannerSection();
}

async function openEnvironmentCamera(){
  const tries = [
    { audio:false, video:{ facingMode:{ exact:'environment' }, width:{ ideal:640 }, height:{ ideal:480 }, frameRate:{ ideal:30, max:30 } } },
    { audio:false, video:{ facingMode:{ ideal:'environment' }, width:{ ideal:640 }, height:{ ideal:480 }, frameRate:{ ideal:30, max:30 } } },
    { audio:false, video:{ facingMode:'environment' } },
    { audio:false, video:true }
  ];

  let lastErr = null;
  for(const constraints of tries){
    try{
      return await navigator.mediaDevices.getUserMedia(constraints);
    }catch(e){
      lastErr = e;
    }
  }
  throw lastErr || new Error('camera-error');
}

async function startTradeCam(){
  const box = document.getElementById('trade-cam-box');
  const video = document.getElementById('trade-video');
  const btn = document.getElementById('trade-scan-btn');

  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    setScannerState('Este navegador no permite cámara en vivo. Usá galería o pegá el código.', 'err');
    return;
  }

  try{
    setScannerState('Preparando lector QR…', 'idle');

    // Primero usamos html5-qrcode: en iPhone suele ser más confiable para leer QR desde pantallas.
    const html5Started = await startHtml5QrTradeCam();
    if(html5Started){ focusTradeScannerSection(); return; }

    // Fallback: ZXing.
    const zxingStarted = await startZXingTradeCam();
    if(zxingStarted){ focusTradeScannerSection(); return; }

    await ensureQRReader();

    setScannerState('Pidiendo permiso de cámara…', 'idle');
    tradStream = await openEnvironmentCamera();

    try{
      const track = tradStream.getVideoTracks()[0];
      const caps = track && track.getCapabilities ? track.getCapabilities() : {};
      if(track && track.applyConstraints && caps.focusMode && caps.focusMode.includes('continuous')){
        await track.applyConstraints({advanced:[{focusMode:'continuous'}]});
      }
    }catch(e){}

    if(!video) throw new Error('video-not-found');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.autoplay = true;
    video.muted = true;
    video.srcObject = tradStream;

    await new Promise((resolve, reject)=>{
      let done = false;
      const ok = ()=>{ if(!done){ done=true; resolve(); } };
      const fail = ()=>{ if(!done){ done=true; reject(new Error('video-error')); } };
      video.onloadedmetadata = ok;
      video.oncanplay = ok;
      video.onerror = fail;
      setTimeout(ok, 1200);
    });

    try{ await video.play(); }catch(e){}

    if(box) box.style.display = 'block';
    focusTradeScannerSection();
    if(btn) btn.textContent = '✕ Cerrar escáner';
    setScannerState('Apuntá al QR de la PC. Subí el brillo, mantenelo centrado y probá acercar/alejar hasta que enfoque.', 'live');

    window._tradeScanHandled = false;
    window._tradeScanMisses = 0;
    window._tradeScanLastFrame = 0;
    window._tradeScanBusy = false;
    window._tradeScanPass = 0;
    scheduleTradeScanFrame(120);
  }catch(e){
    stopTradeCam();
    setScannerState('No se pudo abrir la cámara. Revisá permisos o probá con galería.', 'err');
  }
}

function stopTradeCam(){
  if(_html5Qr){
    const reader = _html5Qr;
    _html5Qr = null;
    _html5QrRunning = false;
    try{
      const stopPromise = reader.stop ? reader.stop() : Promise.resolve();
      Promise.resolve(stopPromise).then(()=>{
        try{ if(reader.clear) reader.clear(); }catch(e){}
        const readerEl = document.getElementById('html5qr-reader');
        if(readerEl){ readerEl.innerHTML=''; readerEl.style.display='none'; }
      }).catch(()=>{});
    }catch(e){}
  } else {
    _html5QrRunning = false;
  }
  const html5ReaderEl = document.getElementById('html5qr-reader');
  if(html5ReaderEl) html5ReaderEl.style.display = 'none';
  const legacyVideo = document.getElementById('trade-video');
  if(legacyVideo) legacyVideo.style.display = 'block';

  if(window._tradeScanTimer){
    clearTimeout(window._tradeScanTimer);
    window._tradeScanTimer = null;
  }
  if(tradRaf){
    cancelAnimationFrame(tradRaf);
    tradRaf = null;
  }
  if(_zxingControls){
    try{ _zxingControls.stop(); }catch(e){}
    _zxingControls = null;
  }
  if(_zxingReader && _zxingReader.reset){
    try{ _zxingReader.reset(); }catch(e){}
  }
  if(tradStream){
    tradStream.getTracks().forEach(t=>t.stop());
    tradStream = null;
  }
  const video = document.getElementById('trade-video');
  if(video){
    try{
      if(video.srcObject && video.srcObject.getTracks){
        video.srcObject.getTracks().forEach(t=>t.stop());
      }
    }catch(e){}
    video.srcObject = null;
  }
  const box = document.getElementById('trade-cam-box');
  if(box) box.style.display = 'none';
  const btn = document.getElementById('trade-scan-btn');
  if(btn) btn.textContent = '📷 Escanear QR en vivo';
  if(!window._tradeScanHandled) setScannerState('Listo para escanear QR de amigo', 'idle');
}

function getVideoFrameImageData(video, canvas, mode){
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  if(!vw || !vh) return null;

  const maxW = 560;
  const scale = Math.min(1, maxW / vw);
  canvas.width = Math.max(1, Math.round(vw * scale));
  canvas.height = Math.max(1, Math.round(vh * scale));

  const ctx = canvas.getContext('2d', { willReadFrequently:true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  if(mode === 'full'){
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  // Recortes centrales de distintos tamaños. Desde un monitor a iPhone
  // el QR suele quedar centrado pero no ocupa siempre el mismo porcentaje.
  const pct = mode === 'center90' ? .90 :
              mode === 'center72' ? .72 :
              mode === 'center56' ? .56 :
              mode === 'center78' ? .78 :
              mode === 'center64' ? .64 :
              mode === 'center52' ? .52 : .72;

  const size = Math.floor(Math.min(canvas.width, canvas.height) * pct);
  const sx = Math.max(0, Math.floor((canvas.width - size) / 2));
  const sy = Math.max(0, Math.floor((canvas.height - size) / 2));
  return ctx.getImageData(sx, sy, size, size);
}


function scheduleTradeScanFrame(delay=180){
  if(window._tradeScanTimer){
    clearTimeout(window._tradeScanTimer);
    window._tradeScanTimer = null;
  }
  if(tradRaf){
    cancelAnimationFrame(tradRaf);
    tradRaf = null;
  }
  const runner = ()=>{
    window._tradeScanTimer = null;
    tradRaf = requestAnimationFrame(scanTradeFrame);
  };
  if(delay > 0){
    window._tradeScanTimer = setTimeout(runner, delay);
  }else{
    runner();
  }
}

async function scanTradeFrame(now){
  if(!tradStream || window._tradeScanHandled) return;

  // Leer QR es lo que más traba la cámara. Procesamos pocos frames, chicos,
  // y alternamos recortes para dejar libre la animación del scanner.
  const elapsed = now ? (now - (window._tradeScanLastFrame || 0)) : 999;
  if(window._tradeScanBusy || elapsed < 180){
    scheduleTradeScanFrame(90);
    return;
  }

  window._tradeScanLastFrame = now || performance.now();
  window._tradeScanBusy = true;

  const video = document.getElementById('trade-video');
  const canvas = document.getElementById('trade-scan-canvas');

  try{
    if(video && canvas && video.readyState >= 2){
      if(window.BarcodeDetector){
        try{
          if(!window._tradeBarcodeDetector){
            window._tradeBarcodeDetector = new BarcodeDetector({formats:['qr_code']});
          }
          const codes = await window._tradeBarcodeDetector.detect(video);
          if(codes && codes.length){
            handleScannedTradeCode(codes[0].rawValue || codes[0].rawValueText || codes[0].data);
            return;
          }
        }catch(e){}
      }

      if(window.jsQR){
        const passIndex = (window._tradeScanPass || 0) % 4;
        window._tradeScanPass = passIndex + 1;

        const passes = passIndex === 0 ? ['center90'] :
                       passIndex === 1 ? ['center72'] :
                       passIndex === 2 ? ['center56'] :
                                         ['full'];

        for(const pass of passes){
          const imageData = getVideoFrameImageData(video, canvas, pass);
          if(!imageData) continue;
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert'
          }) || jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'onlyInvert'
          });
          if(code && code.data){
            handleScannedTradeCode(code.data);
            return;
          }
        }

        window._tradeScanMisses = (window._tradeScanMisses || 0) + 1;
        if(window._tradeScanMisses === 35){
          setScannerState('Todavía no lo leo. Probá subir el brillo de la pantalla del otro dispositivo, acercar/alejar y mantener el QR dentro del cuadrado.', 'live');
        }
        if(window._tradeScanMisses === 80){
          setScannerState('Sigue sin leer. También podés sacar una captura del QR y tocar “Elegir de galería”.', 'live');
        }
      }else{
        setScannerState('No se cargó el lector QR. Probá con galería o pegá el código.', 'err');
      }
    }
  }catch(e){
    // No cerramos el escáner por un frame fallido.
  }finally{
    window._tradeScanBusy = false;
  }

  scheduleTradeScanFrame(170);
}

function handleScannedTradeCode(raw){
  if(window._tradeScanHandled) return;

  const onlineId = normalizeOnlineFriendCode(raw);
  if(onlineId){
    window._tradeScanHandled = true;
    setScannerState('Código fijo detectado. Cargando amigo…', 'ok');
    stopTradeCam();
    processOnlineFriendCodeAndPromptSave(onlineId);
    return;
  }

  const payload = normalizeTradePayload(raw);
  if(!parsePayload(payload)){
    setScannerState('Leí un QR, pero no es un código válido de Album Tracker.', 'err');
    toast('Ese QR no es válido','err');
    return;
  }

  window._tradeScanHandled = true;
  setScannerState('Código detectado. Cargando match…', 'ok');
  stopTradeCam();
  processCodeAndPromptSave(payload);
}

// Decode QR from image using canvas + jsQR/BarcodeDetector.
async function decodeQRFromImage(file){
  setScannerState('Leyendo imagen…', 'idle');
  await ensureQRReader();

  return new Promise((resolve, reject)=>{
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = async ()=>{
      const c = document.createElement('canvas');
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      c.width  = Math.max(1, Math.round(img.width  * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      const ctx = c.getContext('2d', { willReadFrequently:true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);

      try{
        if(window.BarcodeDetector){
          const detector = new BarcodeDetector({formats:['qr_code']});
          const codes = await detector.detect(c);
          if(codes && codes.length){
            resolve(codes[0].rawValue || codes[0].rawValueText || codes[0].data);
            return;
          }
        }
      }catch(e){}

      if(window.jsQR){
        const tries = [
          ctx.getImageData(0, 0, c.width, c.height)
        ];

        const size = Math.floor(Math.min(c.width, c.height) * 0.86);
        if(size > 80){
          const sx = Math.floor((c.width - size) / 2);
          const sy = Math.floor((c.height - size) / 2);
          tries.push(ctx.getImageData(sx, sy, size, size));
        }

        for(const imageData of tries){
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth'
          });
          if(code && code.data){
            resolve(code.data);
            return;
          }
        }
      }

      const dataUrl = c.toDataURL('image/jpeg', 0.85);
      const preview = document.getElementById('qr-preview-img');
      if(preview){
        preview.src = dataUrl;
        preview.style.display = 'block';
      }
      setScannerState('No pude leer la imagen. Probá con una foto más cerca o pegá el código.', 'err');
      reject(new Error('qr-not-found'));
    };

    img.onerror = ()=>{
      URL.revokeObjectURL(url);
      setScannerState('No pude abrir la imagen.', 'err');
      reject(new Error('img-load'));
    };

    img.src = url;
  });
}

function readQRFile(e){
  const file = e.target.files[0];
  if(!file) return;
  e.target.value = '';

  decodeQRFromImage(file)
    .then(code =>{
      const preview = document.getElementById('qr-preview-img');
      if(preview) preview.style.display = 'none';

      const onlineId = normalizeOnlineFriendCode(code);
      if(onlineId){
        setScannerState('Código fijo detectado. Cargando amigo…', 'ok');
        processOnlineFriendCodeAndPromptSave(onlineId);
        return;
      }

      const payload = normalizeTradePayload(code);
      if(!parsePayload(payload)){
        setScannerState('La imagen tiene un QR, pero no es un código válido de Album Tracker.', 'err');
        toast('Ese QR no es válido','err');
        return;
      }
      setScannerState('Código detectado. Cargando match…', 'ok');
      processCodeAndPromptSave(payload);
    })
    .catch(()=>{ setScannerState('No se pudo leer ese QR.', 'err'); toast('No se pudo leer el QR','err'); });
}

// ═══════════════════════════════════════════════════════════
// TAB NAV + HELPERS
// ═══════════════════════════════════════════════════════════


function showMoreMenu(){
  const panel = document.getElementById('panel-config');
  const menu = document.getElementById('more-menu');
  const sections = document.querySelectorAll('#panel-config .more-section');
  if(panel) panel.classList.remove('more-section-open');
  if(menu) menu.classList.remove('is-hidden');
  sections.forEach(s => s.classList.remove('is-open'));
  const scroll = document.getElementById('main-scroll');
  if(scroll) scroll.scrollTo({top:0, behavior:'smooth'});
  if(window._updateScrollInd) setTimeout(_updateScrollInd, 80);
}

function openMoreSection(name){
  const panel = document.getElementById('panel-config');
  const menu = document.getElementById('more-menu');
  const sections = document.querySelectorAll('#panel-config .more-section');
  if(panel) panel.classList.add('more-section-open');
  if(menu) menu.classList.add('is-hidden');
  sections.forEach(s => s.classList.remove('is-open'));
  const target = document.getElementById('more-section-' + name);
  if(target) target.classList.add('is-open');
  if(name === 'share') renderDupes();
  if(name === 'shared' && typeof updateSharedAlbumUI === 'function') updateSharedAlbumUI();
  const scroll = document.getElementById('main-scroll');
  if(scroll) scroll.scrollTo({top:0, behavior:'smooth'});
  if(window._updateScrollInd) setTimeout(_updateScrollInd, 80);
}

function focusAlbumSearch(){
  goTab('album');
  setTimeout(() => {
    const input = document.getElementById('gs');
    if(input){
      input.scrollIntoView({ behavior:'smooth', block:'center' });
      input.focus();
    }
  }, 80);
}

function goTab(name){
  const scroll = document.getElementById('main-scroll');
  const panel = document.getElementById('panel-'+name);
  if(!panel) return;
  const wasActive = isActive(name);

  if(name !== 'trade') stopTradeCam();

  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  panel.classList.add('active');

  // Bottom nav
  document.querySelectorAll('.bn').forEach(b=>b.classList.remove('active'));
  const bn = document.getElementById('bn-'+name);
  if(bn) bn.classList.add('active');

  // Sidebar nav
  document.querySelectorAll('.sidebar-nav-btn[id^="snb-"]').forEach(b=>b.classList.remove('active'));
  const snb = document.getElementById('snb-'+name);
  if(snb) snb.classList.add('active');

  if(name==='album') renderGrid();
  if(name==='dupes' || name==='config') renderDupes();
  if(name==='config') showMoreMenu();
  if(name==='trade'){
    trackEvent('open_trade');
    updateTradeSummary(); renderFriends(); genQR(); setTimeout(genQR, 60);
  }
  if(name==='summary') renderTeamSummary();

  if(scroll){
    scroll.scrollTo({ top:0, behavior: wasActive ? 'smooth' : 'auto' });
  }
  if(window._updateScrollInd) setTimeout(_updateScrollInd, 120);
}

function isActive(name){
  const panel = document.getElementById('panel-'+name);
  return !!(panel && panel.classList.contains('active'));
}

let fbT;
function showFb(type,msg){
  const el=document.getElementById('fb');
  el.className=`fb show ${type}`; el.textContent=msg;
  clearTimeout(fbT); fbT=setTimeout(()=>el.classList.remove('show'),3200);
}

let toastT;
function toast(msg,type='info',opts={}){
  const t=document.getElementById('toast');
  if(!t) return;
  clearTimeout(toastT);
  t.className = `toast ${type}`;
  void t.offsetWidth;

  const text = String(msg || '');
  if(opts.undo){
    t.innerHTML = `<span class="toast-msg"></span><button class="toast-undo" onclick="undoLastChange()">Deshacer</button>`;
    const msgEl = t.querySelector('.toast-msg');
    if(msgEl) msgEl.textContent = text;
    t.classList.add('has-action');
    t.style.pointerEvents = 'auto';
  } else {
    t.textContent = text;
    t.classList.remove('has-action');
    t.style.pointerEvents = 'none';
  }

  t.classList.add('show');
  toastT = setTimeout(()=>{
    t.classList.remove('show');
    t.classList.remove('has-action');
    t.style.pointerEvents = 'none';
  }, opts.undo ? 4200 : 2400);
}

// AdMob removed

// ─── iPHONE / PWA VIEWPORT HEIGHT ───────────────────────
(function syncAppHeight(){
  function isStandalone(){
    return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  }

  function getUsableHeight(){
    // En PWA instalada conviene innerHeight: visualViewport suele recortar de más.
    if(isStandalone()) return window.innerHeight;

    // En Safari normal, visualViewport evita saltos cuando aparece/desaparece la barra.
    if(window.visualViewport && window.visualViewport.height){
      return Math.max(window.visualViewport.height, window.innerHeight * 0.82);
    }
    return window.innerHeight;
  }

  function setH(){
    const h = Math.round(getUsableHeight());
    document.documentElement.style.setProperty('--app-height', `${h}px`);
    document.documentElement.style.setProperty('--vvh', `${h}px`);

    if(window._refreshScrollAid) setTimeout(()=>window._refreshScrollAid(false), 80);
  }

  setH();
  window.addEventListener('resize', setH, {passive:true});
  window.addEventListener('orientationchange', ()=>setTimeout(setH, 300), {passive:true});
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', setH, {passive:true});
    window.visualViewport.addEventListener('scroll', setH, {passive:true});
  }
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) setTimeout(setH, 120); }, {passive:true});
})();

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
load();
loadLastChange();
refreshMyOnlineCodeUI();
scheduleOnlineProfileSync();
refreshOnlineFriends(false);
scheduleOnlineFriendsRefresh();
syncCompletedTeamsState();
updateStats();
requestAnimationFrame(updateStats);
renderGrid();
window.addEventListener('resize', ()=>{ if(isActive('trade')) genQR(); }, {passive:true});

function handleIncomingTradeLink(){
  const friendCode = getIncomingOnlineFriendCode();
  const code = getIncomingTradeCode();

  if(!friendCode && !code) return false;

  setTimeout(()=>{
    goTab('trade');

    if(friendCode){
      prefillOnlineFriendCode(friendCode);
      processOnlineFriendCodeAndPromptSave(friendCode);
      return;
    }

    const parsed = parsePayload(code);
    if(!parsed){
      toast('Código fijo inválido','err');
      return;
    }
    window._pendingOnlineFriend = null;
    window._pendingFriendCode = code;
    showMatch(parsed);
    populateFriendCodePrompt();
    focusFriendCodePrompt();
    toast('Código cargado','ok');
  }, 450);
  return true;
}
handleIncomingTradeLink();

// ─── SCROLLBAR + TEAM INDICATOR ──────────────────────────
(function(){
  const scroll = document.getElementById('main-scroll');
  const ind    = document.getElementById('scroll-ind');
  const indFlag   = document.getElementById('scroll-ind-flag');
  const indAbbrev = document.getElementById('scroll-ind-abbrev');
  if(!scroll || !ind) return;

  let bar = document.getElementById('scrollBar');
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'scrollBar';
    bar.className = 'scroll-bar';
    document.body.appendChild(bar);
  }

  let hideTimer = null;
  let isDragging = false;
  let startY = 0;
  let startScrollTop = 0;
  let trackStart = 0;
  let trackEnd = 0;
  let trackH = 0;
  let barH = 0;

  function activePanelName(){
    if(isActive('album')) return 'album';
    if(isActive('summary')) return 'summary';
    if(isActive('dupes')) return 'dupes';
    if(isActive('config')) return 'config';
    if(isActive('trade')) return 'trade';
    return '';
  }

  function hasDupes(){
    return Object.values(col).some(v => v > 1);
  }

  function shouldUseScrollAid(){
    const panel = activePanelName();
    if(panel === 'trade' || panel === 'config') return false;
    if(panel === 'dupes' && !hasDupes()) return false;
    return panel === 'album' || panel === 'dupes' || panel === 'summary';
  }

  function hideScrollAid(){
    bar.classList.remove('visible');
    ind.classList.remove('visible');
  }

  function scheduleHide(){
    clearTimeout(hideTimer);
    if(isDragging) return;
    hideTimer = setTimeout(hideScrollAid, 900);
  }

  function getNav(){ return document.querySelector('.bottom-nav'); }

  function calcTrack(){
    const rect = scroll.getBoundingClientRect();
    const nav = getNav();
    const navTop = (nav && nav.offsetParent) ? nav.getBoundingClientRect().top : window.innerHeight;
    trackStart = rect.top + 4;
    trackEnd   = Math.max(trackStart + 44, navTop - 4);
    trackH     = trackEnd - trackStart;
    const {scrollHeight, clientHeight} = scroll;
    barH = Math.max(44, Math.min(trackH * (clientHeight / scrollHeight), trackH));
  }

  function getEmojiText(el){
    if(!el) return '';
    return el.dataset?.flag || el.querySelector?.('img.emoji')?.getAttribute('alt') || el.textContent || '';
  }

  function getActiveHeaders(){
    const panel = activePanelName();
    if(panel === 'album'){
      return [...document.querySelectorAll('#album-content .team-header')].map(h => ({
        el: h,
        flag: getEmojiText(h.querySelector('.team-flag')),
        abbrev: h.querySelector('.team-abbrev')?.textContent || ''
      }));
    }
    if(panel === 'dupes'){
      return [...document.querySelectorAll('#rlist .dupes-team-hdr')].map(h => ({
        el: h,
        flag: h.dataset.flag || getEmojiText(h.children[0]),
        abbrev: h.dataset.abbrev || h.children[1]?.textContent || ''
      }));
    }
    if(panel === 'summary'){
      return [...document.querySelectorAll('#team-progress-list .team-progress-group-head')].map(h => ({
        el: h,
        flag: '',
        abbrev: h.querySelector('.team-progress-group-title')?.textContent || 'Progreso'
      }));
    }
    if(panel === 'config'){
      const items = [];
      const hero = document.querySelector('#panel-config .settings-hero');
      if(hero){
        items.push({
          el: hero,
          flag: '',
          abbrev: 'Ajustes'
        });
      }

      document.querySelectorAll('#panel-config .settings-card').forEach(card => {
        // En la sección de repetidas, el indicador funciona igual que en Álbum:
        // va mostrando país/equipo a medida que bajás por la lista.
        if(card.querySelector('#rlist')){
          card.querySelectorAll('.dupes-team-hdr').forEach(h => {
            items.push({
              el: h,
              flag: h.dataset.flag || getEmojiText(h.children[0]),
              abbrev: h.dataset.abbrev || h.children[1]?.textContent || ''
            });
          });

          // Si todavía no hay repetidas, mostramos una etiqueta simple.
          if(!card.querySelector('.dupes-team-hdr')){
            const empty = card.querySelector('#nodup');
            if(empty){
              items.push({
                el: card,
                flag: '',
                abbrev: 'Repetidas'
              });
            }
          }
          return;
        }

        const rawTitle = card.querySelector('.card-title')?.textContent || 'Más';
        const cleanTitle = rawTitle.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
        items.push({
          el: card,
          flag: '',
          abbrev: cleanTitle || 'Más'
        });
      });
      return items;
    }
    return [];
  }

  function updateIndicatorPosition(pct){
    const barTop = trackStart + (trackH - barH) * pct;
    const indH = ind.offsetHeight || 44;
    ind.style.top = (barTop + barH/2 - indH/2) + 'px';
  }

  function updateScrollAid({show=true} = {}){
    if(!shouldUseScrollAid()){
      hideScrollAid();
      return;
    }

    const {scrollTop, scrollHeight, clientHeight} = scroll;
    if(scrollHeight <= clientHeight + 10){
      hideScrollAid();
      return;
    }

    calcTrack();

    const scrollable = scrollHeight - clientHeight;
    const pct = scrollable > 0 ? Math.min(scrollTop / scrollable, 1) : 0;

    bar.style.height = barH + 'px';
    bar.style.top = (trackStart + (trackH - barH) * pct) + 'px';

    const headers = getActiveHeaders();
    if(headers.length){
      const scanLine = scrollTop + (pct * clientHeight);
      let active = null;
      for(const h of headers){
        if(h.el.offsetTop <= scanLine) active = h;
        else break;
      }
      if(active){
        if(active.abbrev !== indAbbrev.textContent){
          indFlag.textContent = active.flag;
          if(typeof renderEmojiImages === 'function') renderEmojiImages(indFlag);
          indAbbrev.textContent = active.abbrev;
          ind.animate([{transform:'scale(1)'},{transform:'scale(1.08)'},{transform:'scale(1)'}],
            {duration:150, easing:'ease-out'});
        }
        updateIndicatorPosition(pct);
        if(show) ind.classList.add('visible');
      } else {
        ind.classList.remove('visible');
      }
    } else {
      ind.classList.remove('visible');
    }

    if(show) bar.classList.add('visible');
    scheduleHide();
  }

  scroll.addEventListener('scroll', ()=>{
    window._lastPaniniScrollAt = Date.now();
    updateScrollAid({show:true});
  }, {passive:true});

  function onDragStart(clientY){
    if(!shouldUseScrollAid()) return;
    isDragging = true;
    startY = clientY;
    startScrollTop = scroll.scrollTop;
    clearTimeout(hideTimer);
    bar.style.transition = 'none';
    updateScrollAid({show:true});
  }

  function onDragMove(clientY){
    if(!isDragging) return;
    const {scrollHeight, clientHeight} = scroll;
    const scrollable = scrollHeight - clientHeight;
    const trackScrollable = trackH - barH;
    const ratio = trackScrollable > 0 ? scrollable / trackScrollable : 1;
    const newTop = startScrollTop + (clientY - startY) * ratio;
    scroll.scrollTop = Math.max(0, Math.min(newTop, scrollable));
    updateScrollAid({show:true});
  }

  function onDragEnd(){
    if(!isDragging) return;
    isDragging = false;
    bar.style.transition = '';
    scheduleHide();
  }

  // Usamos Pointer Events + touch-action:none para evitar warnings de listeners no pasivos.
  bar.addEventListener('pointerdown', e=>{
    onDragStart(e.clientY);
    try{ bar.setPointerCapture(e.pointerId); }catch(_){}
  }, {passive:true});

  bar.addEventListener('pointermove', e=>{
    if(isDragging) onDragMove(e.clientY);
  }, {passive:true});

  bar.addEventListener('pointerup', e=>{
    try{ bar.releasePointerCapture(e.pointerId); }catch(_){}
    onDragEnd();
  }, {passive:true});

  bar.addEventListener('pointercancel', onDragEnd, {passive:true});
  bar.addEventListener('mousedown',  e=>{onDragStart(e.clientY); if(e.cancelable) e.preventDefault();});
  window.addEventListener('mousemove', e=>{if(isDragging) onDragMove(e.clientY);}, {passive:true});
  window.addEventListener('mouseup',   ()=>{if(isDragging) onDragEnd();}, {passive:true});

  window._updateScrollInd = ()=>{ updateScrollAid({show:false}); };
  window._updateScrollBar = ()=>{ updateScrollAid({show:false}); };
  window._refreshScrollAid = (show=true)=>{ updateScrollAid({show}); };
  updateScrollAid({show:false});
})();


// ── SPLASH ──────────────────────────────────────────────
(function(){
  function hideSplash(){
    const splash = document.getElementById('splash');
    if(!splash) return;
    setTimeout(() => {
      splash.classList.add('hide');
      setTimeout(() => { if(splash.parentNode) splash.remove(); }, 700);
    }, 1800);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', hideSplash, {passive:true});
  } else {
    hideSplash();
  }
})();


// ─── FIRST RUN GUIDED TUTORIAL ──────────────────────────
const TUTORIAL_KEY = 'pn26_tutorial_seen_v13';
let tutorialStep = 0;
let tutorialPositionRaf = null;

function tutorialTarget(selector){
  if(!selector) return null;
  if(typeof selector === 'function') return selector();
  return document.querySelector(selector);
}

function firstVisibleCell(){
  return document.querySelector('#panel-album .sc') || document.querySelector('.sc');
}

function isDesktopTutorial(){
  return window.matchMedia('(min-width: 768px)').matches;
}

function activeTutorialSteps(){
  return tutorialSteps.filter(step => !(isDesktopTutorial() && step.hideOnDesktop));
}

function dupesTutorialTarget(){
  const firstGroup = document.querySelector('#panel-dupes .dupes-group, #panel-dupes .dupes-team, #panel-dupes .ri');
  if(firstGroup) return firstGroup;
  const none = document.getElementById('nodup');
  if(none && getComputedStyle(none).display !== 'none') return none;
  return document.querySelector('#panel-dupes > div') || document.getElementById('panel-dupes');
}

const tutorialSteps = [
  {
    kicker:'Inicio',
    title:'Cómo usar la app',
    text:'Marcá figuritas, buscá rápido, intercambiá con amigos y compartí el álbum sin login.',
    target:'.mobile-header',
    desktopTarget:'.sidebar-stats',
    items:[
      ['👆','Tocá una figurita','Suma una copia.'],
      ['⏱️','Mantené presionado','Quita una copia.'],
      ['♻️','Repetidas','Con 2 o más, cuenta como repetida.']
    ],
    hint:'Todo se guarda automáticamente. Si usás álbum compartido, también se sincroniza online.'
  },
  {
    kicker:'Instalación',
    title:'Agregar a inicio',
    text:'Instalala como app para abrirla desde el ícono del celular.',
    hideOnDesktop:true,
    target:'.bottom-nav',
    items:[
      ['🍎','iPhone','Abrí en Safari → Compartir → Agregar a pantalla de inicio.'],
      ['🤖','Android','Abrí en Chrome → menú ⋮ → Instalar app.'],
      ['🔄','Actualizar','Usá Más → Configuración → Buscar actualización.']
    ],
    hint:'En iPhone conviene instalarla desde Safari.'
  },
  {
    kicker:'Álbum',
    title:'Buscar y marcar',
    text:'La pestaña Álbum es para cargar tu colección y encontrar figuritas sin scrollear tanto.',
    before:()=>goTab('album'),
    target:()=>document.querySelector('#album-search-card') || document.querySelector('#panel-album .search-wrap') || firstVisibleCell(),
    items:[
      ['🔎','Buscador','Probá ARG 10, TUN, México o un número.'],
      ['🎛️','Filtros','Todas, Faltan, Tengo o Repetidas.'],
      ['↩️','Deshacer','Sirve si tocaste una figurita por error.']
    ],
    hint:'No necesitás tocar ningún botón de guardar.'
  },
  {
    kicker:'Progreso',
    title:'Ver avances',
    text:'En Progreso ves el estado general y qué equipos están más cerca de completarse.',
    before:()=>goTab('summary'),
    target:()=>document.querySelector('#summary-hero') || document.getElementById('panel-summary'),
    items:[
      ['📊','General','Total, tengo, faltan y repetidas.'],
      ['✅','Más cerca','Equipos con pocas figuritas faltantes.'],
      ['⚠️','Más incompletos','Equipos donde todavía falta más.']
    ],
    hint:'Útil para saber qué buscar primero.'
  },
  {
    kicker:'Intercambio',
    title:'Amigos por código fijo',
    text:'Tu QR y tu código fijo sirven para que un amigo te guarde una sola vez.',
    before:()=>goTab('trade'),
    target:'#qrbox',
    items:[
      ['🔳','Compartir QR','Mandá tu QR desde el botón Compartir.'],
      ['🔗','Copiar link','Abre la app con tu código ya cargado.'],
      ['🔁','Actualizar amigo','Trae sus repetidas nuevas cuando las necesites.']
    ],
    hint:'No hace falta mandar un código nuevo cada vez.'
  },
  {
    kicker:'Más',
    title:'Elegí una sección',
    text:'Más ahora funciona como menú: entrás solo a lo que necesitás.',
    before:()=>{ goTab('config'); showMoreMenu(); },
    target:'#more-menu',
    items:[
      ['♻️','Repetidas y faltantes','Mandá listas para intercambiar.'],
      ['🤝','Álbum compartido','Usá el mismo álbum con otra persona.'],
      ['⚙️','Configuración','Backups, actualización y ayuda.']
    ],
    hint:'Cada sección tiene un botón ← Más para volver al menú.'
  },
  {
    kicker:'Compartir',
    title:'Faltantes y repetidas',
    text:'Desde esta sección generás listas listas para mandar por WhatsApp.',
    before:()=>{ goTab('config'); openMoreSection('share'); },
    target:'#more-section-share',
    items:[
      ['📨','Mandar faltantes','Comparte las figuritas que todavía necesitás.'],
      ['♻️','Mandar repetidas','Comparte tus repetidas para intercambiar.'],
      ['📋','Lista automática','La app arma el texto por país y número.']
    ],
    hint:'Si el dispositivo no puede compartir, la lista se copia.'
  },
  {
    kicker:'Compartido',
    title:'Álbum compartido sin login',
    text:'Creá un código ALB o unite al código de otra persona para editar el mismo álbum.',
    before:()=>{ goTab('config'); openMoreSection('shared'); },
    target:'#more-section-shared',
    items:[
      ['➕','Crear álbum','Usalo si vos empezás y querés pasar el código.'],
      ['🔑','Unirme','Pegá un código ALB que te mandaron.'],
      ['🔄','Auto-refresh','Se revisa cada 7 segundos y avisa qué cambió.']
    ],
    hint:'Cuando se actualiza desde otro dispositivo, muestra un resumen de nuevas y repetidas.'
  },
  {
    kicker:'Configuración',
    title:'Backups y actualización',
    text:'Acá están las cosas de mantenimiento de la app.',
    before:()=>{ goTab('config'); openMoreSection('settings'); },
    target:'#more-section-settings',
    items:[
      ['📤','Exportar','Guardá una copia de tu colección.'],
      ['📥','Importar','Cargá una colección o una lista de Figuritas.'],
      ['🔄','Actualizar','Busca una versión nueva de GitHub Pages.']
    ],
    hint:'Zona peligrosa queda separada para no borrar el álbum por error.'
  }
]

function currentTutorialTarget(step){
  const isDesk = isDesktopTutorial();
  return tutorialTarget(isDesk && step.desktopTarget ? step.desktopTarget : step.target);
}


function tutorialViewport(){
  const vv = window.visualViewport;
  return {
    width: vv ? vv.width : window.innerWidth,
    height: vv ? vv.height : window.innerHeight
  };
}

function ensureTutorialTargetVisible(target){
  if(!target) return;
  try{
    const isPhone = window.innerWidth <= 767;
    const sc = document.getElementById('main-scroll');

    if(isPhone){
      const rect = target.getBoundingClientRect();
      const vp = tutorialViewport();
      const desiredY = vp.height * 0.38;
      const currentY = rect.top + rect.height / 2;
      const delta = currentY - desiredY;
      if(Math.abs(delta) > 18){
        if(sc) sc.scrollTo({top: Math.max(0, sc.scrollTop + delta), behavior:'smooth'});
        else target.scrollIntoView({behavior:'smooth', block:'center', inline:'nearest'});
      }
      return;
    }

    target.scrollIntoView({behavior:'smooth', block:'center', inline:'nearest'});
  }catch(_){ }
}

function focusTutorialTarget(step){
  ensureTutorialTargetVisible(currentTutorialTarget(step));
  setTimeout(()=>ensureTutorialTargetVisible(currentTutorialTarget(step)), 120);
  setTimeout(()=>ensureTutorialTargetVisible(currentTutorialTarget(step)), 280);
  setTimeout(scheduleTutorialPosition, 120);
  setTimeout(scheduleTutorialPosition, 280);
  setTimeout(scheduleTutorialPosition, 520);
  setTimeout(scheduleTutorialPosition, 860);
}

function positionTutorial(){
  const ov = document.getElementById('tutorial-overlay');
  const card = document.getElementById('tutorial-card');
  const spot = document.getElementById('tutorial-spotlight');
  if(!ov || !card || !spot || !ov.classList.contains('show')) return;

  const steps = activeTutorialSteps();
  const step = steps[tutorialStep] || steps[0];
  const target = currentTutorialTarget(step);
  const vp = tutorialViewport();
  const vw = vp.width;
  const vh = vp.height;
  const isPhone = window.innerWidth <= 767;
  const margin = isPhone ? 10 : 14;

  card.style.left = '';
  card.style.top = '';
  card.style.bottom = '';
  card.style.right = '';
  card.style.width = '';
  card.style.transform = '';
  card.classList.remove('tutorial-card--dock-top','tutorial-card--dock-bottom');

  if(target){
    const rect = target.getBoundingClientRect();
    const isSticker = target.classList && target.classList.contains('sc');
    const pad = isSticker ? 2 : (isPhone ? 6 : 8);

    let left = rect.left - pad;
    let top = rect.top - pad;
    let width = rect.width + pad * 2;
    let height = rect.height + pad * 2;

    const maxW = vw - 16;
    const maxH = vh - 16;
    if(width > maxW){ left = 8; width = maxW; }
    else { left = Math.max(8, Math.min(left, vw - width - 8)); }

    if(height > maxH){ top = 8; height = maxH; }
    else { top = Math.max(8, Math.min(top, vh - height - 8)); }

    spot.classList.add('visible');
    spot.style.left = `${Math.round(left)}px`;
    spot.style.top = `${Math.round(top)}px`;
    spot.style.width = `${Math.round(Math.max(28,width))}px`;
    spot.style.height = `${Math.round(Math.max(28,height))}px`;
    spot.classList.toggle('sticker-target', !!isSticker);

    if(isPhone){
      const cardW = vw - margin*2;
      card.style.width = `${cardW}px`;
      card.style.left = `${margin}px`;

      const cardH = Math.min(card.getBoundingClientRect().height || 230, vh - 24);
      const spaceAbove = top - margin;
      const spaceBelow = vh - (top + height) - margin;
      const putBelow = spaceBelow >= cardH + 10 || spaceBelow > spaceAbove;

      if(putBelow){
        card.style.top = `${Math.min(top + height + 10, vh - cardH - margin)}px`;
        card.style.bottom = 'auto';
        card.classList.add('tutorial-card--dock-bottom');
      }else{
        card.style.top = `${Math.max(margin, top - cardH - 10)}px`;
        card.style.bottom = 'auto';
        card.classList.add('tutorial-card--dock-top');
      }
      return;
    }

    const cardH = card.getBoundingClientRect().height || 260;
    const cardW = Math.min(430, vw - margin*2);
    const spaceBelow = vh - (top + height) - margin;
    const spaceAbove = top - margin;
    const placeBelow = spaceBelow >= cardH || spaceBelow >= spaceAbove;

    let cardLeft = Math.min(Math.max(margin, left + width/2 - cardW/2), vw - cardW - margin);
    card.style.width = `${cardW}px`;
    card.style.left = `${cardLeft}px`;
    card.style.top = placeBelow
      ? `${Math.min(top + height + 12, vh - margin - cardH)}px`
      : `${Math.max(margin, top - cardH - 12)}px`;
  } else {
    spot.classList.remove('visible');
    spot.classList.remove('sticker-target');
    card.style.width = `min(430px, calc(100vw - 28px))`;
    card.style.left = '50%';
    card.style.top = '50%';
    card.style.transform = 'translate(-50%,-50%) scale(1)';
  }
}

function scheduleTutorialPosition(){
  cancelAnimationFrame(tutorialPositionRaf);
  tutorialPositionRaf = requestAnimationFrame(positionTutorial);
}

function renderTutorial(){
  const ov = document.getElementById('tutorial-overlay');
  if(!ov) return;
  const steps = activeTutorialSteps();
  if(tutorialStep >= steps.length) tutorialStep = Math.max(0, steps.length - 1);
  const step = steps[tutorialStep] || steps[0];

  if(typeof step.before === 'function') step.before();
  focusTutorialTarget(step);

  document.getElementById('tutorial-kicker').textContent = step.kicker;
  document.getElementById('tutorial-count').textContent = `${tutorialStep + 1}/${steps.length}`;
  document.getElementById('tutorial-title').textContent = step.title;
  document.getElementById('tutorial-text').textContent = step.text;
  document.getElementById('tutorial-list').innerHTML = step.items.map(([emoji,title,desc]) => `
    <div class="tutorial-item">
      <div class="tutorial-emoji">${emoji}</div>
      <div>
        <div class="tutorial-item-title">${title}</div>
        <div class="tutorial-item-desc">${desc}</div>
      </div>
    </div>
  `).join('');

  const hint = document.getElementById('tutorial-hint');
  hint.textContent = step.hint || '';
  hint.classList.toggle('show', !!step.hint);

  document.getElementById('tutorial-dots').innerHTML = steps.map((_,i)=>`<span class="tutorial-dot ${i===tutorialStep?'active':''}"></span>`).join('');
  document.getElementById('tutorial-next').textContent = tutorialStep === steps.length - 1 ? 'Terminar' : 'Siguiente';
  document.getElementById('tutorial-back').disabled = tutorialStep === 0;
  document.getElementById('tutorial-skip').style.visibility = tutorialStep === steps.length - 1 ? 'hidden' : 'visible';

  setTimeout(scheduleTutorialPosition, 90);
  setTimeout(scheduleTutorialPosition, 280);
  setTimeout(scheduleTutorialPosition, 520);
  setTimeout(scheduleTutorialPosition, 820);
  setTimeout(scheduleTutorialPosition, 1200);
}

function showTutorial(force=false){
  const ov = document.getElementById('tutorial-overlay');
  if(!ov) return;
  if(!force && localStorage.getItem(TUTORIAL_KEY)==='1') return;
  tutorialStep = 0;
  ov.classList.add('show');
  renderTutorial();
}

function nextTutorialStep(){
  const steps = activeTutorialSteps();
  if(tutorialStep < steps.length - 1){
    tutorialStep++;
    renderTutorial();
  } else {
    finishTutorial();
  }
}

function prevTutorialStep(){
  if(tutorialStep > 0){
    tutorialStep--;
    renderTutorial();
  }
}

function finishTutorial(){
  localStorage.setItem(TUTORIAL_KEY,'1');
  if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const ov = document.getElementById('tutorial-overlay');
  const spot = document.getElementById('tutorial-spotlight');
  if(!ov) return;
  ov.classList.remove('show');
  if(spot) spot.classList.remove('visible');
  if(!isActive('album')) goTab('album');
}

(function initTutorial(){
  const run = () => setTimeout(()=>showTutorial(false), 2100);
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, {passive:true});
  else run();

  window.addEventListener('resize', ()=>{
    const ov = document.getElementById('tutorial-overlay');
    if(ov && ov.classList.contains('show')) renderTutorial();
    else scheduleTutorialPosition();
  }, {passive:true});
  window.addEventListener('orientationchange', ()=>setTimeout(scheduleTutorialPosition, 250), {passive:true});
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', scheduleTutorialPosition, {passive:true});
    window.visualViewport.addEventListener('scroll', scheduleTutorialPosition, {passive:true});
  }
  const sc = document.getElementById('main-scroll');
  if(sc) sc.addEventListener('scroll', scheduleTutorialPosition, {passive:true});
})();


// ─── IMPORT / EXPORT ─────────────────────────────────────

let pendingImportPreview = null;

function importStats(collection){
  const entries = Object.entries(collection || {}).filter(([id,v]) => STICKER_MAP[id] && isOfficialAlbumId(id) && Number(v) > 0);
  const got = entries.length;
  const dups = entries.reduce((a,[,v]) => a + Math.max(0, Number(v)-1), 0);
  return { got, dups, miss: TOTAL - got };
}

function setImportPreviewText(id, value){
  const el = document.getElementById(id);
  if(el) el.textContent = value;
}

function showImportPreview(collection, source='Importación', note=''){
  pendingImportPreview = { collection: {...collection}, source, note };
  const before = importStats(col);
  const after = importStats(collection);

  setImportPreviewText('import-preview-source', source);
  setImportPreviewText('ip-got-before', before.got);
  setImportPreviewText('ip-got-after', after.got);
  setImportPreviewText('ip-dups-before', before.dups);
  setImportPreviewText('ip-dups-after', after.dups);
  setImportPreviewText('ip-miss-before', before.miss);
  setImportPreviewText('ip-miss-after', after.miss);

  const noteEl = document.getElementById('import-preview-note');
  if(noteEl){
    noteEl.textContent = note || 'No se va a aplicar nada hasta que toques Importar.';
    noteEl.style.display = note || true ? '' : 'none';
  }

  const ov = document.getElementById('import-preview-overlay');
  if(ov) ov.classList.add('show');
}

function closeImportPreview(){
  const ov = document.getElementById('import-preview-overlay');
  if(ov) ov.classList.remove('show');
  pendingImportPreview = null;
}

function applyImportedCollection(nextCollection, toastText='Colección importada'){
  rememberUndo('importar colección');
  col = {...nextCollection};
  save();
  updateStats();
  renderGrid();
  if(isActive('dupes')) renderDupes();
  if(isActive('summary')) renderTeamSummary();
  if(isActive('trade')){ updateTradeSummary(); renderFriends(); genQR(); }
  toast(toastText, 'ok', {undo:true});
}

function confirmImportPreview(){
  if(!pendingImportPreview) return;
  const {collection, source} = pendingImportPreview;
  const count = Object.keys(collection).length;
  if(String(source || '').toLowerCase().includes('figuritas')){
    trackEvent('import_figuritas_app', { imported_count: count });
  }
  applyImportedCollection(collection, `${count} figuritas importadas`);
  syncCompletedTeamsState();
  closeImportPreview();

  const box = document.getElementById('figuritas-import-box');
  if(box) box.classList.remove('show');
}


function normalizeImportCollection(source){
  if(!source || typeof source !== 'object') throw new Error('collection inválida');

  const known = new Set(ALL_IDS.map(id => id.toUpperCase()));
  const next = {};
  let ignored = 0;

  const put = (id, qty=1) => {
    id = String(id || '').trim().toUpperCase();
    qty = Math.floor(Number(qty || 1));
    if(!id || !known.has(id) || !Number.isFinite(qty) || qty <= 0){
      if(id) ignored++;
      return;
    }
    next[id] = Math.max(next[id] || 0, qty);
  };

  const scanString = (text) => {
    const s = String(text || '');
    const matches = s.match(/\b(?:00|CC\d{1,2}|FWC-?\d{1,2}|[A-Z]{3}-?\d{1,2})\b/gi) || [];
    for(const raw of matches){
      let id = raw.toUpperCase();
      if(id !== '00' && !id.startsWith('CC') && !id.includes('-')){
        id = id.replace(/^([A-Z]+)(\d+)$/, '$1-$2');
      }
      put(id, (next[id] || 0) + 1);
    }
  };

  const walk = (value, depth=0) => {
    if(depth > 7 || value == null) return;

    if(typeof value === 'string'){
      scanString(value);
      return;
    }

    if(Array.isArray(value)){
      for(const item of value) walk(item, depth + 1);
      return;
    }

    if(typeof value !== 'object') return;

    // Formato objeto de una figurita: {id:"ARG-10", count:2} / {code:"MEX-13", qty:3}
    const idLike = value.id || value.ID || value.code || value.codigo || value.sticker || value.figurita || value.card;
    if(idLike){
      const qty = value.count ?? value.qty ?? value.cantidad ?? value.copies ?? value.copias ?? value.value ?? 1;
      put(idLike, qty);
    }

    // Formato mapa directo: {"ARG-10":1, "MEX-13":2}
    for(const [k,v] of Object.entries(value)){
      const key = String(k || '').trim().toUpperCase();
      const normalizedKey = (key !== '00' && !key.startsWith('CC') && !key.includes('-'))
        ? key.replace(/^([A-Z]+)(\d+)$/, '$1-$2')
        : key;

      if(known.has(normalizedKey)){
        if(typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'){
          put(normalizedKey, v === true ? 1 : v);
        } else if(v && typeof v === 'object'){
          const qty = v.count ?? v.qty ?? v.cantidad ?? v.copies ?? v.copias ?? 1;
          put(normalizedKey, qty);
        }
        continue;
      }

      // Buscar adentro de nombres comunes y también de objetos anidados.
      if(['collection','col','cards','stickers','figuritas','album','data','items','owned','tengo','repetidas','dupes','duplicates'].includes(key.toLowerCase())){
        walk(v, depth + 1);
      } else if(typeof v === 'object' || Array.isArray(v)){
        walk(v, depth + 1);
      }
    }
  };

  walk(source);

  return {collection: next, ignored};
}

function parseAnyImport(raw){
  const text = String(raw || '').trim();
  if(!text) throw new Error('vacío');

  // Texto de Figuritas App: reconstruye usando faltantes + repetidas.
  // Soporta español (Me faltan / Repetidas) e inglés (I need / Swaps).
  if(/Figuritas App|Me faltan|Repetidas|I\s+need|Swaps/i.test(text)){
    const fig = parseFiguritasList(text);
    const collection = fig?.collection || fig?.col;
    if(fig && collection) return {collection, ignored: fig.unknown?.length || 0, source:'Figuritas'};
  }

  // JSON flexible: nuevo, viejo, arrays, objetos anidados, etc.
  try{
    const parsed = JSON.parse(text);
    const source = (parsed && typeof parsed === 'object' && parsed.collection && typeof parsed.collection === 'object')
      ? parsed.collection
      : parsed;
    const result = normalizeImportCollection(source);
    return {...result, source:'JSON'};
  }catch(_){}

  // Texto libre: busca IDs tipo ARG-10, ARG10, CC1, FWC-3, 00.
  const result = normalizeImportCollection(text);
  return {...result, source:'texto'};
}

function doImport(raw){
  try{
    const result = parseAnyImport(raw);

    if(!Object.keys(result.collection).length){
      toast('No encontré figuritas para importar','err');
      return;
    }

    const extra = result.ignored ? `${result.ignored} entradas ignoradas porque no coinciden con figuritas del álbum.` : '';
    showImportPreview(result.collection, `Importar desde ${result.source || 'archivo'}`, extra);
  } catch(e){
    toast('No pude importar ese formato','err');
  }
}


// ─── IMPORT FROM FIGURITAS APP TEXT ──────────────────────
function toggleFiguritasImport(){
  const box = document.getElementById('figuritas-import-box');
  if(!box) return;
  box.classList.toggle('show');
  if(box.classList.contains('show')){
    setTimeout(()=>document.getElementById('figuritas-import-text')?.focus(), 80);
  }
}

function clearFiguritasImport(){
  const txt = document.getElementById('figuritas-import-text');
  if(txt) txt.value = '';
}

function figuritasId(prefix, num){
  prefix = String(prefix || '').toUpperCase().trim();
  const raw = String(num || '').trim();
  const n = parseInt(raw, 10);
  if(!prefix || !Number.isFinite(n)) return null;

  // En Figuritas App, FWC 🏆 puede traer "00". Esa figurita en este álbum es el ID "00".
  if(prefix === 'FWC' && /^0+$/.test(raw)) return '00';

  if(n <= 0) return null;
  if(prefix === 'CC') return `CC${n}`;
  if(prefix === 'FWC') return `FWC-${n}`;
  return `${prefix}-${n}`;
}

function parseFiguritasNumbers(value){
  // Toma solamente los números después de los dos puntos.
  // Soporta "00", "1, 2, 3", "1 2 3" y copiados con espacios raros.
  return (String(value || '').match(/\d{1,2}/g) || [])
    .map(n => String(n).trim())
    .filter(Boolean);
}

function extractFiguritasSection(text, startLabel, endLabels){
  const source = String(text || '');
  const startRe = new RegExp(startLabel, 'i');
  const startMatch = startRe.exec(source);
  if(!startMatch) return '';

  const from = startMatch.index + startMatch[0].length;
  let to = source.length;

  for(const label of endLabels){
    const endRe = new RegExp(label, 'i');
    const endMatch = endRe.exec(source.slice(from));
    if(endMatch) to = Math.min(to, from + endMatch.index);
  }

  return source.slice(from, to);
}

function parseFiguritasEntries(sectionText){
  const source = String(sectionText || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const entries = [];
  const entryRe = /(?:^|\s)([A-Z]{2,4})\b[^:]{0,30}:\s*/gi;
  const matches = [];
  let match;

  while((match = entryRe.exec(source))){
    matches.push({
      prefix: match[1].toUpperCase(),
      numbersStart: entryRe.lastIndex,
      labelStart: match.index
    });
  }

  for(let i = 0; i < matches.length; i++){
    const current = matches[i];
    const next = matches[i + 1];
    const numbersText = source.slice(current.numbersStart, next ? next.labelStart : source.length);
    const nums = parseFiguritasNumbers(numbersText);
    if(nums.length){
      entries.push({ prefix: current.prefix, nums });
    }
  }

  return entries;
}

function parseFiguritasList(raw){
  const text = String(raw || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();

  if(!text || !/(Figuritas\s+App|Me\s+faltan|Repetidas|I\s+need|Swaps)/i.test(text)) return null;

  const known = new Set(ALL_IDS.map(id => id.toUpperCase()));
  const missing = new Set();
  const dupes = [];
  const unknown = [];

  const endLabels = [
    'Repetidas\\s*:?',
    'Swaps\\s*:?',
    'Descarga\\s+la\\s+app',
    'Download\\s+the\\s+app',
    'https?:\\/\\/'
  ];

  const missingSection = extractFiguritasSection(text, 'Me\\s+faltan\\s*:?', endLabels)
    || extractFiguritasSection(text, 'I\\s+need\\s*:?', endLabels);

  const dupesSection = extractFiguritasSection(text, 'Repetidas\\s*:?', [
    'Descarga\\s+la\\s+app',
    'Download\\s+the\\s+app',
    'https?:\\/\\/'
  ]) || extractFiguritasSection(text, 'Swaps\\s*:?', [
    'Descarga\\s+la\\s+app',
    'Download\\s+the\\s+app',
    'https?:\\/\\/'
  ]);

  const sections = [
    { type: 'missing', entries: parseFiguritasEntries(missingSection) },
    { type: 'dupes', entries: parseFiguritasEntries(dupesSection) }
  ];

  let parsedLines = 0;

  for(const section of sections){
    for(const entry of section.entries){
      parsedLines++;
      for(const n of entry.nums){
        const id = figuritasId(entry.prefix, n);
        if(!id) continue;

        const up = id.toUpperCase();
        if(!known.has(up)){
          unknown.push(up);
          continue;
        }

        if(section.type === 'missing'){
          missing.add(up);
        } else {
          dupes.push(up);
        }
      }
    }
  }

  if(!parsedLines) return null;

  // "Me faltan" lista las que NO tenés. Por eso reconstruimos el álbum
  // con todas las figuritas conocidas menos las faltantes.
  const collection = {};
  const hasExplicitCC = [...missing].some(isCocaColaId) || dupes.some(isCocaColaId);
  for(const id of officialAlbumIds()){
    const up = id.toUpperCase();
    if(isCocaColaId(up) && !hasExplicitCC) continue;
    if(!missing.has(up)){
      collection[up] = 1;
    }
  }

  // "Repetidas" significa que tenés la original + al menos una copia extra.
  // Si apareciera repetida más de una vez en el texto, suma copias.
  for(const id of dupes){
    const up = id.toUpperCase();
    collection[up] = Math.max(collection[up] || 1, 1) + 1;
  }

  const uniqueUnknown = [...new Set(unknown)];
  return {
    collection,
    col: collection, // compatibilidad con versiones anteriores
    missingCount: missing.size,
    dupesCount: dupes.length,
    importedCount: Object.keys(collection).length,
    unknown: uniqueUnknown
  };
}

function importFromFiguritas(){
  const input = document.getElementById('figuritas-import-text');
  const raw = input ? input.value : '';
  const parsed = parseFiguritasList(raw);

  if(!parsed || !parsed.collection || !Object.keys(parsed.collection).length){
    toast('Mensaje de Figuritas inválido','err');
    return;
  }

  const unknownCount = parsed.unknown ? parsed.unknown.length : 0;
  const note = `Detecté ${parsed.missingCount || 0} faltantes y ${parsed.dupesCount || 0} repetidas.${unknownCount ? ' ' + unknownCount + ' ignoradas porque no existen en este álbum.' : ''}`;
  showImportPreview(parsed.collection, 'Importar desde app "Figuritas"', note);
}


function showInstallHelp(platform){
  if(platform === 'ios'){
    toast('iPhone: Safari → Compartir → Agregar a pantalla de inicio', 'info');
  }else if(platform === 'android'){
    toast('Android: Chrome → menú ⋮ → Instalar app', 'info');
  }else{
    showTutorial(true);
  }
}

// ─── SHARE MY MISSING LIST ──────────────────────────────
function stickerShareNumber(id){
  const value = String(id || '').toUpperCase();
  if(value === '00') return '00';
  const cc = value.match(/^CC(\d{1,2})$/);
  if(cc) return String(parseInt(cc[1], 10));
  const dashed = value.match(/^[A-Z]{2,4}-(\d{1,2})$/);
  if(dashed) return String(parseInt(dashed[1], 10));
  return value;
}

function missingShareLabel(teamKey){
  if(teamKey === 'FWC_INTRO') return 'FWC 🏆';
  if(teamKey === 'FWC') return 'FWC 📜';
  if(teamKey === 'CC') return 'CC 🥤';

  const team = TEAMS.find(t => t.key === teamKey);
  const parts = teamDisplayParts(team);
  const code = parts.code || teamKey;
  const flag = parts.flag || '';
  return flag ? `${code} ${flag}` : code;
}

function buildMissingListText(){
  const lines = [
    'Album Tracker App - Lista',
    'Usa Méx Can 26',
    'Me faltan'
  ];

  for(const group of WC_GROUPS){
    for(const teamKey of group.teams){
      const stickers = STICKERS_BY_TEAM[teamKey] || [];
      const missing = stickers
        .filter(s => isOfficialAlbumId(String(s.id).toUpperCase()))
        .filter(s => !col[String(s.id).toUpperCase()])
        .map(s => stickerShareNumber(s.id));

      if(missing.length){
        lines.push(`${missingShareLabel(teamKey)}: ${missing.join(', ')}`);
      }
    }
  }

  lines.push('');
  lines.push('Compartido desde Panini Album Tracker World Cup 2026');
  return lines.join('\n');
}

async function shareMissingList(){
  const missingCount = officialAlbumIds().filter(id => !col[id]).length;
  const text = buildMissingListText();

  if(!missingCount){
    toast('No tenés faltantes para mandar 🎉','ok');
    return;
  }

  if(navigator.share){
    try{
      await navigator.share({
        title:'Mis faltantes',
        text
      });
      trackEvent('share_missing_list', { method:'web_share', missing_count: missingCount });
      toast('Lista de faltantes lista para mandar','ok');
      return;
    }catch(e){
      if(e && e.name === 'AbortError') return;
    }
  }

  const copied = await copyTextToClipboard(text);
  if(copied){
    trackEvent('share_missing_list', { method:'copy', missing_count: missingCount });
    toast('Lista de faltantes copiada','ok');
  }else{
    showManualCopyBox(text, 'Mis faltantes');
  }
}


// ═══════════════════════════════════════════════════════════
// SHARED ALBUM BY CODE (NO LOGIN)
// ═══════════════════════════════════════════════════════════
const SHARED_ALBUM_KEY = 'pn26_shared_album';
const SHARED_DEVICE_KEY = 'pn26_shared_device_id';
const SHARED_REFRESH_MS = 30000;
let sharedAlbumPushTimer = null;
let sharedAlbumRefreshTimer = null;
let sharedAlbumBusy = false;
let sharedAlbumLastRemoteAt = '';

function getSharedDeviceId(){
  let id = localStorage.getItem(SHARED_DEVICE_KEY);
  if(!id){
    id = 'DEV-' + randomOnlinePart(12);
    localStorage.setItem(SHARED_DEVICE_KEY, id);
  }
  return id;
}

function normalizeSharedAlbumCode(raw){
  const clean = String(raw || '').toUpperCase().replace(/^ALB-/, '').replace(/[^A-Z0-9]/g, '');
  if(!/^[A-Z0-9]{6,12}$/.test(clean)) return '';
  return 'ALB-' + clean;
}

function makeSharedAlbumCode(){
  return 'ALB-' + randomOnlinePart(8);
}

function sanitizeCollectionMap(source){
  const out = {};
  const known = new Set(ALL_IDS.map(id => String(id).toUpperCase()));
  if(!source || typeof source !== 'object' || Array.isArray(source)) return out;
  for(const [k,v] of Object.entries(source)){
    const id = String(k || '').toUpperCase().trim();
    const qty = Math.floor(Number(v));
    if(!known.has(id) || !Number.isFinite(qty) || qty <= 0) continue;
    out[id] = Math.min(qty, 99);
  }
  return out;
}

function getSharedAlbumState(){
  try{
    const s = JSON.parse(localStorage.getItem(SHARED_ALBUM_KEY) || 'null');
    if(s && s.code) return s;
  }catch(_){ }
  return null;
}

function setSharedAlbumState(state){
  if(!state || !state.code){
    localStorage.removeItem(SHARED_ALBUM_KEY);
    sharedAlbumLastRemoteAt = '';
  }else{
    localStorage.setItem(SHARED_ALBUM_KEY, JSON.stringify(state));
    sharedAlbumLastRemoteAt = state.updatedAt || sharedAlbumLastRemoteAt || '';
  }
  refreshSharedAlbumUI();
}

function sharedAlbumActive(){
  return !!getSharedAlbumState();
}

function setSharedAlbumStatus(text, kind='info'){
  const el = document.getElementById('shared-album-status');
  if(!el) return;
  el.textContent = text;
  el.classList.remove('ok','warn','err');
  el.classList.add(kind);
}

function refreshSharedAlbumUI(){
  const state = getSharedAlbumState();
  const cardEl = document.getElementById('shared-album-card');
  const codeEl = document.getElementById('shared-album-current-code');
  const nameEl = document.getElementById('shared-album-current-name');
  const activeBox = document.getElementById('shared-album-active-box');
  const createBtn = document.getElementById('shared-album-create-btn');
  const joinInput = document.getElementById('shared-album-code-input');

  if(cardEl) cardEl.classList.toggle('is-active', !!state);
  if(codeEl) codeEl.textContent = state ? state.code : 'Sin código';
  if(nameEl) nameEl.textContent = state ? (state.name || 'Álbum compartido') : 'Todavía no estás usando un álbum compartido.';
  if(activeBox) activeBox.classList.toggle('is-active', !!state);
  if(createBtn) createBtn.textContent = state ? 'Crear otro álbum' : 'Crear álbum';
  if(joinInput && !state) joinInput.value = joinInput.value || '';

  if(state){
    setSharedAlbumStatus(`Activo. Se sincroniza automáticamente cada ${Math.round(SHARED_REFRESH_MS/1000)} segundos.`, 'ok');
  }else{
    setSharedAlbumStatus('Creá uno nuevo o unite con el código que te pasaron.', 'info');
  }
}

function stopSharedAlbumAutoRefresh(){
  clearInterval(sharedAlbumRefreshTimer);
  sharedAlbumRefreshTimer = null;
}

function startSharedAlbumAutoRefresh(){
  stopSharedAlbumAutoRefresh();
  if(document.hidden) return;
  sharedAlbumRefreshTimer = setInterval(()=>{
    fetchSharedAlbumRemote({silent:true}).catch(()=>{});
  }, SHARED_REFRESH_MS);
}

function scheduleSharedAlbumPush(){
  const state = getSharedAlbumState();
  if(!state || sharedAlbumBusy) return;
  clearTimeout(sharedAlbumPushTimer);
  sharedAlbumPushTimer = setTimeout(()=>pushSharedAlbumRemote({silent:true}).catch(()=>{}), 900);
}

async function pushSharedAlbumRemote(opts={}){
  const state = getSharedAlbumState();
  const client = getSupabaseClient();
  if(!state || !client) return false;
  if(sharedAlbumBusy) return false;

  sharedAlbumBusy = true;
  if(!opts.silent) setSharedAlbumStatus('Sincronizando álbum compartido...', 'info');

  try{
    const deviceId = getSharedDeviceId();
    const { data, error } = await client
      .from('shared_albums')
      .update({
        collection: sanitizeCollectionMap(col),
        updated_at: new Date().toISOString(),
        last_updated_by: deviceId
      })
      .eq('code', state.code)
      .select('code,name,updated_at,last_updated_by')
      .maybeSingle();

    if(error) throw error;
    if(!data) throw new Error('shared_album_not_found');

    const next = {...state, name:data.name || state.name, updatedAt:data.updated_at || state.updatedAt};
    setSharedAlbumState(next);
    if(!opts.silent) setSharedAlbumStatus('Álbum compartido sincronizado.', 'ok');
    return true;
  }catch(e){
    console.error(e);
    if(!opts.silent) setSharedAlbumStatus('No pude sincronizar. Revisá conexión o Supabase.', 'err');
    return false;
  }finally{
    sharedAlbumBusy = false;
  }
}


function getSharedAlbumChangeSummary(beforeCollection, afterCollection){
  const before = sanitizeCollectionMap(beforeCollection);
  const after = sanitizeCollectionMap(afterCollection);
  const ids = new Set([...Object.keys(before), ...Object.keys(after), ...ALL_IDS.map(id => String(id).toUpperCase())]);
  let newPasted = 0;
  let repeatedDelta = 0;

  ids.forEach(id => {
    const prev = Math.max(0, Math.floor(Number(before[id] || 0)));
    const next = Math.max(0, Math.floor(Number(after[id] || 0)));

    if(prev <= 0 && next > 0) newPasted += 1;
    repeatedDelta += Math.max(0, next - 1) - Math.max(0, prev - 1);
  });

  const parts = [];
  if(newPasted > 0) parts.push(`+${newPasted} nuevas pegadas`);
  if(repeatedDelta < 0) parts.push(`${repeatedDelta} repetidas`);
  else if(repeatedDelta > 0) parts.push(`+${repeatedDelta} repetidas`);

  return parts.length ? `Álbum actualizado · ${parts.join(' · ')}` : 'Álbum actualizado';
}

function applySharedAlbumCollection(remoteCollection, remoteUpdatedAt=''){
  const next = sanitizeCollectionMap(remoteCollection);
  col = next;
  localStorage.setItem('pn26v2', JSON.stringify(col));
  lastSavedAt = Date.now();
  localStorage.setItem('pn26_last_change', String(lastSavedAt));
  updateSaveIndicator();
  syncCompletedTeamsState();
  updateStats();
  if(isActive('album')) renderGrid();
  if(isActive('dupes')) renderDupes();
  if(isActive('summary')) renderTeamSummary();
  if(isActive('trade')){ updateTradeSummary(); renderFriends(); genQR(); }
  if(window._refreshScrollAid) setTimeout(()=>window._refreshScrollAid(false), 80);
  sharedAlbumLastRemoteAt = remoteUpdatedAt || sharedAlbumLastRemoteAt;
}

async function fetchSharedAlbumRemote(opts={}){
  const state = getSharedAlbumState();
  const client = getSupabaseClient();
  if(!state || !client) return false;
  if(sharedAlbumBusy) return false;

  sharedAlbumBusy = true;
  if(!opts.silent) setSharedAlbumStatus('Buscando cambios...', 'info');

  try{
    const { data, error } = await client
      .from('shared_albums')
      .select('code,name,collection,updated_at,last_updated_by')
      .eq('code', state.code)
      .maybeSingle();

    if(error) throw error;
    if(!data) throw new Error('shared_album_not_found');

    const remoteAt = data.updated_at || '';
    const deviceId = getSharedDeviceId();
    const isDifferent = remoteAt && remoteAt !== sharedAlbumLastRemoteAt && remoteAt !== state.updatedAt;
    const fromOtherDevice = data.last_updated_by && data.last_updated_by !== deviceId;

    const nextState = {...state, name:data.name || state.name, updatedAt:remoteAt};
    setSharedAlbumState(nextState);

    if(isDifferent && fromOtherDevice){
      const summary = getSharedAlbumChangeSummary(col, data.collection || {});
      applySharedAlbumCollection(data.collection || {}, remoteAt);
      if(!opts.silent) setSharedAlbumStatus(summary, 'ok');
      toast(summary, 'ok');
    }else if(!opts.silent){
      setSharedAlbumStatus('No hay cambios nuevos.', 'ok');
    }
    return true;
  }catch(e){
    console.error(e);
    if(!opts.silent) setSharedAlbumStatus('No pude buscar cambios. Revisá el código o conexión.', 'err');
    return false;
  }finally{
    sharedAlbumBusy = false;
  }
}

async function createSharedAlbum(){
  const client = getSupabaseClient();
  if(!client){
    setSharedAlbumStatus('Supabase no está disponible.', 'err');
    return;
  }

  const nameInput = document.getElementById('shared-album-name-input');
  const name = (nameInput && nameInput.value.trim()) || 'Álbum compartido';
  const deviceId = getSharedDeviceId();
  const code = makeSharedAlbumCode();

  setSharedAlbumStatus('Creando álbum compartido...', 'info');
  try{
    const { data, error } = await client
      .from('shared_albums')
      .insert({
        code,
        name,
        collection: sanitizeCollectionMap(col),
        last_updated_by: deviceId
      })
      .select('code,name,updated_at,last_updated_by')
      .single();
    if(error) throw error;

    setSharedAlbumState({code:data.code, name:data.name || name, updatedAt:data.updated_at || ''});
    trackEvent('create_shared_album');
    startSharedAlbumAutoRefresh();
    setSharedAlbumStatus('Álbum compartido creado. Copiá el código para invitar a otra persona.', 'ok');
    toast('Álbum compartido creado','ok');
  }catch(e){
    console.error(e);
    setSharedAlbumStatus('No pude crear el álbum. Revisá la tabla shared_albums.', 'err');
  }
}

async function joinSharedAlbum(){
  const client = getSupabaseClient();
  if(!client){
    setSharedAlbumStatus('Supabase no está disponible.', 'err');
    return;
  }
  const input = document.getElementById('shared-album-code-input');
  const code = normalizeSharedAlbumCode(input ? input.value : '');
  if(!code){
    setSharedAlbumStatus('Código inválido. Usá algo tipo ALB-8K4P2X.', 'warn');
    return;
  }

  setSharedAlbumStatus('Uniéndote al álbum compartido...', 'info');
  try{
    const { data, error } = await client
      .from('shared_albums')
      .select('code,name,collection,updated_at,last_updated_by')
      .eq('code', code)
      .maybeSingle();
    if(error) throw error;
    if(!data){
      setSharedAlbumStatus('No encontré ese álbum compartido.', 'err');
      return;
    }

    setSharedAlbumState({code:data.code, name:data.name || 'Álbum compartido', updatedAt:data.updated_at || ''});
    trackEvent('join_shared_album');
    applySharedAlbumCollection(data.collection || {}, data.updated_at || '');
    startSharedAlbumAutoRefresh();
    setSharedAlbumStatus('Te uniste al álbum compartido. Los cambios se actualizan solos.', 'ok');
    toast('Álbum compartido conectado','ok');
  }catch(e){
    console.error(e);
    setSharedAlbumStatus('No pude unirme. Revisá conexión o Supabase.', 'err');
  }
}

async function copySharedAlbumCode(){
  const state = getSharedAlbumState();
  if(!state){
    setSharedAlbumStatus('Primero creá o unite a un álbum compartido.', 'warn');
    return;
  }
  const copied = await copyTextToClipboard(state.code);
  if(copied) toast('Código compartido copiado','ok');
  else showManualCopyBox(state.code, 'Código de álbum compartido');
}

function leaveSharedAlbum(){
  setSharedAlbumState(null);
  clearTimeout(sharedAlbumPushTimer);
  stopSharedAlbumAutoRefresh();
  setSharedAlbumStatus('Saliste del álbum compartido. Tu copia local queda en este dispositivo.', 'info');
  toast('Saliste del álbum compartido','info');
}

function initSharedAlbum(){
  refreshSharedAlbumUI();
  const state = getSharedAlbumState();
  if(state){
    sharedAlbumLastRemoteAt = state.updatedAt || '';
    startSharedAlbumAutoRefresh();
    setTimeout(()=>fetchSharedAlbumRemote({silent:true}).catch(()=>{}), 1200);
  }else{
    startSharedAlbumAutoRefresh();
  }
  document.addEventListener('visibilitychange', ()=>{
    if(document.hidden){
      stopSharedAlbumAutoRefresh();
      return;
    }
    startSharedAlbumAutoRefresh();
    fetchSharedAlbumRemote({silent:true}).catch(()=>{});
  }, {passive:true});
}

// Init shared album after its state variables are initialized.
initSharedAlbum();

// ─── EXPORT AS FILE / IMPORT FROM FILE ───────────────────

// ═══════════════════════════════════════════════════════════
// EMOJI RENDERING VIA TWEMOJI (SVG)
// Convierte todos los emojis visibles de la app en SVG para que se vean
// bien en Windows, Android, iPhone y PWA, sin depender del sistema.
// ═══════════════════════════════════════════════════════════
let _emojiRenderTimer = null;
function renderEmojiImages(root=document.body){
  if(!window.twemoji) return;
  const scope = root && root.nodeType ? root : document.body;

  try{
    twemoji.parse(scope, {
      folder: 'svg',
      ext: '.svg',
      className: 'emoji',
      attributes: () => ({ draggable: 'false', loading: 'lazy', decoding: 'async' })
    });
  }catch(_){ }
}

function scheduleEmojiRender(root=document.body){
  clearTimeout(_emojiRenderTimer);
  _emojiRenderTimer = setTimeout(() => renderEmojiImages(root), 30);
}

(function initEmojiRendering(){
  const run = () => {
    renderEmojiImages(document.body);
    if(!document.body || !window.MutationObserver) return;
    const observer = new MutationObserver(() => scheduleEmojiRender(document.body));
    observer.observe(document.body, { childList:true, subtree:true, characterData:true });
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, {passive:true});
  else run();
})();

// Override exportCollection to download JSON file
function exportCollection(){
  const payload = {
    app: 'Album Tracker',
    version: 2,
    createdAt: new Date().toISOString(),
    total: TOTAL,
    collection: col
  };
  const data = JSON.stringify(payload, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `album-tracker-wc2026-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  toast('Colección exportada','ok');
}

function importFromFile(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    doImport(ev.target.result);
    e.target.value = ''; // reset so same file can be imported again
  };
  reader.readAsText(file);
}


// ═══════════════════════════════════════════════════════════
// PWA UPDATES
// ═══════════════════════════════════════════════════════════
// Sistema automático: ya no hace falta cambiar a mano la versión del cache.
// La app compara el contenido real de estos archivos publicados en GitHub Pages.
const PWA_CURRENT_CACHE = 'panini-auto-cache-v36-ga-events-pause-sort-friends';
const PWA_UPDATE_ASSETS = [
  'index.html',
  'style.css',
  'data.js',
  'app.js',
  'manifest.json'
];

const PWA_SIGNATURE_KEY = 'pn26_pwa_asset_signature_v1';
let pendingPwaWorker = null;
let pwaRefreshing = false;
let latestPwaSignature = null;
let pwaUpdateAvailable = false;

function showPwaUpdateNotice(){
  const el = document.getElementById('pwa-update-banner');
  if(el) el.hidden = false;
}

function hidePwaUpdateNotice(){
  const el = document.getElementById('pwa-update-banner');
  if(el) el.hidden = true;
}

function pwaHashString(str){
  // FNV-1a simple, suficiente para detectar cambios de archivos.
  let h = 2166136261;
  for(let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function getPublishedAssetSignature(){
  const base = new URL('.', window.location.href);
  const parts = [];

  for(const asset of PWA_UPDATE_ASSETS){
    const url = new URL(asset, base);
    url.searchParams.set('_update_check', Date.now().toString());

    const res = await fetch(url.toString(), {
      cache: 'no-store',
      credentials: 'same-origin'
    });

    if(!res.ok) throw new Error(`No se pudo revisar ${asset}`);
    const text = await res.text();
    parts.push(`${asset}:${pwaHashString(text)}`);
  }

  return pwaHashString(parts.join('|')) + ':' + parts.join(',');
}

async function getPublishedPwaCacheName(){
  const url = new URL('sw.js', new URL('.', window.location.href));
  url.searchParams.set('_update_check', Date.now().toString());

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'same-origin'
  });
  if(!res.ok) throw new Error('No se pudo revisar sw.js');

  const text = await res.text();
  const match = text.match(/const\s+CACHE\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : '';
}

async function checkPwaAssetUpdate({forceNotice=false} = {}){
  try{
    const publishedCache = await getPublishedPwaCacheName();

    // Regla principal:
    // - Si el sw.js publicado tiene el mismo cache que esta app, está al día.
    // - Si es distinto, hay una versión nueva publicada.
    // - El banner NO se muestra automáticamente para evitar falsos positivos molestos.
    //   Solo aparece cuando el usuario toca "Buscar actualización" y realmente hay diferencia.
    if(publishedCache && publishedCache === PWA_CURRENT_CACHE){
      pwaUpdateAvailable = false;
      pendingPwaWorker = null;
      hidePwaUpdateNotice();
      sessionStorage.removeItem('pn26_pwa_update_dismissed');

      const signature = await getPublishedAssetSignature().catch(() => '');
      if(signature){
        latestPwaSignature = signature;
        localStorage.setItem(PWA_SIGNATURE_KEY, signature);
      }
      return false;
    }

    if(publishedCache && publishedCache !== PWA_CURRENT_CACHE){
      pwaUpdateAvailable = true;
      latestPwaSignature = await getPublishedAssetSignature().catch(() => '');
      if(forceNotice){
        showPwaUpdateNotice();
      }else{
        hidePwaUpdateNotice();
      }
      return true;
    }

    // Si no pudimos leer una versión de cache válida, no mostramos banner.
    pwaUpdateAvailable = false;
    hidePwaUpdateNotice();
    return false;
  }catch(_){
    pwaUpdateAvailable = false;
    hidePwaUpdateNotice();
    return false;
  }
}

async function checkForPwaUpdateManual(){
  const btn = document.querySelector('[data-pwa-check-btn]');
  const original = btn ? btn.textContent : '';
  if(btn){
    btn.disabled = true;
    btn.textContent = 'Revisando...';
  }

  try{
    if('serviceWorker' in navigator){
      const reg = await navigator.serviceWorker.getRegistration();
      if(reg) await reg.update().catch(()=>{});
    }
    const hasUpdate = await checkPwaAssetUpdate({forceNotice:true});
    if(hasUpdate){
      toast('Hay una actualización disponible','ok');
    }else{
      hidePwaUpdateNotice();
      toast('La app ya está actualizada','ok');
    }
  }catch(_){
    toast('No pude buscar actualización','err');
  }finally{
    if(btn){
      btn.disabled = false;
      btn.textContent = original || 'Buscar actualización';
    }
  }
}

async function clearPwaCaches(){
  if(!('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.map(key => caches.delete(key)));
}

async function applyPwaUpdate(){
  const btn = document.querySelector('#pwa-update-banner .pwa-update-btn.primary');
  if(btn){
    btn.disabled = true;
    btn.textContent = 'Actualizando...';
  }

  sessionStorage.removeItem('pn26_pwa_update_dismissed');

  // Guardamos la firma esperada para no mostrar el banner otra vez si la recarga entra bien.
  if(latestPwaSignature){
    localStorage.setItem(PWA_SIGNATURE_KEY, latestPwaSignature);
  }

  // iOS puede quedarse con caches viejos en PWA instalada. Por eso el botón hace un update fuerte:
  // 1) pide al SW nuevo que active, 2) borra caches, 3) desregistra SW viejo, 4) recarga con cache-buster.
  try{
    if('serviceWorker' in navigator){
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(async reg => {
        try{ await reg.update(); }catch(_){}
        try{
          if(reg.waiting) reg.waiting.postMessage({type:'SKIP_WAITING'});
          if(reg.active) reg.active.postMessage({type:'CLEAR_CACHES'});
        }catch(_){}
      }));
    }
  }catch(_){}

  try{
    await clearPwaCaches();
  }catch(_){}

  try{
    if('serviceWorker' in navigator){
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister().catch(()=>{})));
    }
  }catch(_){}

  const url = new URL(window.location.href);
  url.searchParams.set('_updated', Date.now().toString());
  url.searchParams.set('_cachebust', Math.random().toString(36).slice(2));

  setTimeout(() => {
    window.location.replace(url.toString());
  }, 150);

  // Fallback por si iOS no navega en el primer intento.
  setTimeout(() => {
    try{ window.location.reload(); }catch(_){}
  }, 1800);
}

function initPwaUpdates(){
  hidePwaUpdateNotice();
  const dismissedUpdate = () => sessionStorage.setItem('pn26_pwa_update_dismissed', '1');
  const originalHide = hidePwaUpdateNotice;
  window.hidePwaUpdateNotice = function(){
    dismissedUpdate();
    originalHide();
  };

  if('serviceWorker' in navigator){
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if(pwaRefreshing) return;
      pwaRefreshing = true;
      const url = new URL(window.location.href);
      url.searchParams.set('_updated', Date.now().toString());
      window.location.replace(url.toString());
    });

    window.addEventListener('load', async () => {
      try{
        const reg = await navigator.serviceWorker.register('sw.js');

        if(reg.waiting && navigator.serviceWorker.controller){
          pendingPwaWorker = reg.waiting;
          checkPwaAssetUpdate({forceNotice:false});
        }

        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if(!worker) return;

          worker.addEventListener('statechange', () => {
            if(worker.state === 'installed' && navigator.serviceWorker.controller){
              pendingPwaWorker = worker;
              checkPwaAssetUpdate({forceNotice:false});
            }
          });
        });

        setTimeout(() => reg.update().catch(()=>{}), 2500);
        setInterval(() => reg.update().catch(()=>{}), 60 * 60 * 1000);
      }catch(_){}
    });
  }

  window.addEventListener('load', () => {
    setTimeout(() => checkPwaAssetUpdate(), 3500);
    setInterval(() => checkPwaAssetUpdate(), 60 * 60 * 1000);
  });

  document.addEventListener('visibilitychange', () => {
    if(!document.hidden) checkPwaAssetUpdate();
  });
}

