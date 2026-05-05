// ═══════════════════════════════════════════════════════════
// INJECT ASSETS
// ═══════════════════════════════════════════════════════════
(function(){
  const wcSrc = `data:image/png;base64,${WC_LOGO_B64}`;
  const wppSrc = `data:image/png;base64,${WPP_LOGO_B64}`;
  ['wc-logo-img','splash-logo-img','wc-logo-sidebar'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.src = wcSrc;
  });
  const wppEl = document.getElementById('wpp-logo-img');
  if(wppEl) wppEl.src = wppSrc;
})();

let col = {};       // id (uppercase) -> count
let buf = '';       // numpad digit buffer
let curTeam = '00'; // selected team key
let gf = 'all';    // grid filter
let tradStream = null;
let tradRaf = null;
let removeTarget = null;

// ═══════════════════════════════════════════════════════════
// PERSIST
// ═══════════════════════════════════════════════════════════
function save(){ localStorage.setItem('pn26v2', JSON.stringify(col)); }
function load(){
  try{
    const r = localStorage.getItem('pn26v2');
    if(r){ const raw=JSON.parse(r); col={}; for(const k in raw) col[k.toUpperCase()]=raw[k]; }
  }catch(e){}
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
    dn.textContent = 'Not found';
    box.className = 'display bad';
  }
}

function commit(){
  const id = resolveId(curTeam, buf);
  buf = ''; redisplay();
  if(!id || !STICKER_MAP[id]){ showFb('bad','❌ Sticker not found'); return; }
  reg(id);
}



// ═══════════════════════════════════════════════════════════
// REGISTER
// ═══════════════════════════════════════════════════════════
function reg(id){
  id = id.toUpperCase();
  const info = STICKER_MAP[id];
  if(!info){ showFb('bad','❌ Unknown sticker'); return; }
  const had = col[id] > 0;
  col[id] = (col[id]||0) + 1;
  save(); updateStats();
  const holoTag = info.holo ? ' ✨' : '';
  if(had){
    showFb('dup', `🔁 ${id} → dupes ×${col[id]}${holoTag}`);
    toast(`Dupe ${id} ×${col[id]}`, 'warn');
  } else {
    showFb('new', `✅ ${id} – ${info.name}${holoTag}`);
    toast(`¡Tenés ${id}!${holoTag}`, 'ok');
  }
  if(isActive('album')) renderGrid();
  if(isActive('dupes')) renderDupes();
}

// ═══════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════
function updateStats(){
  const got = Object.keys(col).length;
  const miss = TOTAL - got;
  const dups = Object.values(col).reduce((a,v)=>a+Math.max(0,v-1),0);
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

  // Summary screen
  setText('summary-pct-main', Math.round(got/TOTAL*100)+'%');
  setText('summary-pct', Math.round(got/TOTAL*100)+'%');
  setText('summary-total', TOTAL);
  setText('summary-miss', miss);
  setText('summary-got', got);
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


let teamSummarySort = 'complete';

function teamDisplayParts(teamInfo){
  const label = teamInfo?.label || '';
  const m = label.match(/^(\S+)\s+([A-Z0-9_]+)\s+·\s+(.+)$/);
  return {
    flag: m ? m[1] : '',
    code: m ? m[2] : (teamInfo?.key || ''),
    name: m ? m[3] : label
  };
}

function renderTeamSummary(){
  const list = document.getElementById('team-progress-list');
  if(!list) return;

  const rows = TEAMS
    .filter(t => STICKERS_BY_TEAM[t.key] && t.key !== '00')
    .map(t => {
      const stickers = STICKERS_BY_TEAM[t.key] || [];
      const total = stickers.length;
      const got = stickers.filter(s => (col[s.id.toUpperCase()]||0) > 0).length;
      const miss = total - got;
      const pct = total ? Math.round(got / total * 100) : 0;
      return { ...teamDisplayParts(t), key:t.key, got, miss, total, pct };
    })
    .sort((a,b) => {
      if(teamSummarySort === 'missing'){
        return (b.miss - a.miss) || (a.pct - b.pct) || a.name.localeCompare(b.name);
      }
      return (b.pct - a.pct) || (b.got - a.got) || a.name.localeCompare(b.name);
    });

  list.innerHTML = rows.map(r => `
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
  `).join('');
}

function setTeamSummarySort(sort, btn){
  teamSummarySort = sort;
  document.querySelectorAll('.team-progress-actions .fb2').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderTeamSummary();
}


// ═══════════════════════════════════════════════════════════
// GRID
// ═══════════════════════════════════════════════════════════
function normalizeStr(s){
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function renderGrid(){
  const q = document.getElementById('gs').value.trim().toLowerCase();
  const container = document.getElementById('album-content');
  let html = '';

  function renderTeam(teamInfo){
    const teamKey = teamInfo.key;
    const stickers = STICKERS_BY_TEAM[teamKey];
    if(!stickers) return '';
    const labelParts0 = teamInfo.label.match(/^(\S+)\s+([A-Z0-9]+)\s+·\s+(.+)$/);
    const teamFullName = labelParts0 ? labelParts0[3] : teamInfo.label;
    const teamMatchesQuery = q ? normalizeStr(teamFullName).includes(normalizeStr(q)) : false;
    const filtered = stickers.filter(s => {
      const c = col[s.id.toUpperCase()]||0;
      const got = c>0, holo=s.holo, dup=c>1;
      const nq=normalizeStr(q).replace(/\s+/g,''); const sid=normalizeStr(s.id).replace(/[- ]/g,'');
      if(q && !sid.includes(nq) && !normalizeStr(s.name).includes(normalizeStr(q)) && !teamMatchesQuery) return false;
      if(gf==='miss' && got) return false;
      if(gf==='got' && !got) return false;
      if(gf==='dup' && !dup) return false;
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

  if(!html) html = '<div class="empty">Ninguna figurita coincide con el filtro</div>';
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

  col[id] = (col[id]||0) + 1;
  save(); updateStats();

  if(el){
    el.classList.add('pop');
    setTimeout(()=>el.classList.remove('pop'),220);
  }

  const c = col[id];
  toast(c===1 ? `¡Tenés ${id}!${info.holo?' ✨':''}` : `Repetida ${id} ×${c}`, c===1?'ok':'warn');
  if(info) setTimeout(()=>checkTeamComplete(info.team), 100);

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
    col[id]--;
    if(col[id]<=0) delete col[id];

    save(); updateStats();
    const c = col[id]||0;
    toast(c===0 ? `Quitaste ${id}` : `${id} ×${c}`, c===0?'remove':'warn');

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
  col[id]--;
  if(col[id]<=0) delete col[id];
  save(); updateStats();
  toast(`Quitaste ${id}`, 'remove');
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

  if(!Object.keys(dupSet).length){ list.innerHTML=''; none.style.display='block'; return; }
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

  list.innerHTML = html || '<div class="empty">Sin repetidas</div>';
  if(window._updateScrollInd) setTimeout(_updateScrollInd, 50);
}

function removeOne(id){
  if(!col[id]) return;
  col[id]--;
  if(col[id]<=0) delete col[id];
  save(); updateStats(); renderDupes();
  if(isActive('album')) renderGrid();
  toast(`Quitaste una de ${id}`,'err');
}

function copyDupes(){
  const txt = Object.entries(col).filter(([,v])=>v>1)
    .sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([id,c])=>`${id} x${c-1}`)
    .join(', ');
  navigator.clipboard.writeText(txt||'Sin repetidas').then(()=>toast('¡Copiado!','ok'));
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
  if(!confirm('¿Reiniciar TODO el progreso? Esto no se puede deshacer.')) return;
  col={}; save(); updateStats(); renderGrid(); renderDupes();
  toast('Colección reiniciada','warn');
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
  const got = Object.keys(col).map(id=>id.toUpperCase());
  const dupes = Object.entries(col).filter(([,v])=>v>1).map(([id])=>id.toUpperCase());

  // Formato principal v26: bitset compacto.
  // p26b:g=<tengo>&d=<repetidas>
  // Hace el QR mucho menos denso y escaneable desde PC → iPhone.
  const compact = 'p26b:g=' + encodeIdBitset(got) + '&d=' + encodeIdBitset(dupes);

  // Fallback legible viejo, por si una colección muy chica queda más corta.
  const missing = ALL_IDS.filter(id=>!col[id]);
  const useMissing = missing.length < got.length;
  const mainKey = useMissing ? 'm' : 'c';
  const mainIds = useMissing ? missing : got;
  const mainPart = mainIds.map(encodeShortId).join(',');
  const dPart = dupes.map(id=>encodeShortId(id)+'x2').join(',');
  const legacy = 'p26:' + mainKey + '=' + mainPart + (dPart ? '&d=' + dPart : '');

  return compact.length <= legacy.length ? compact : legacy;
}

function buildTradeUrl(payload = buildPayload()){
  const cleanPath = location.pathname.replace(/[^/]*$/, '');
  const base = location.origin + cleanPath;
  return base + '?tab=trade&code=' + encodeURIComponent(payload);
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
      const theirGot = ALL_IDS.filter(id=>!missSet.has(id));
      const theirDupes = (obj.d||[]).map(s=>s.toUpperCase());
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
      } else if(params.m){
        const missSet = new Set(params.m.split(',').filter(Boolean).map(decodeShortId).map(s=>s.toUpperCase()));
        got = ALL_IDS.filter(id=>!missSet.has(id));
      }

      const dupes = params.d ? params.d.split(',').filter(Boolean).map(s=>{
        const m = s.match(/^(.+)x(\d+)$/i);
        return m ? decodeShortId(m[1]) : decodeShortId(s);
      }) : [];
      return { got, dupes };
    }catch(e){ return null; }
  }
  return null;
}

function myData(){
  const m = ALL_IDS.filter(id=>!col[id]);
  const d = ALL_IDS.filter(id=>col[id]>1);
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
    // QR compatible con cámara normal: abre la app/web en Intercambio con el código ya cargado.
    render(buildTradeUrl(payload));
  }catch(e){
    try{
      render(buildTradeUrl(fallbackPayload));
    }catch(e2){
      box.innerHTML = '<div style="color:#111;font-size:.75rem;padding:14px;text-align:center;font-family:Arial,sans-serif;">No se pudo generar el QR.<br>Usá “Compartir por WhatsApp”.</div>';
    }
  }
}

function copyCode(){
  navigator.clipboard.writeText(buildPayload()).then(()=>toast('¡Código copiado!','ok'));
}

function copyTradeLink(){
  navigator.clipboard.writeText(buildTradeUrl()).then(()=>toast('¡Link de intercambio copiado!','ok'));
}

async function pasteCode(){
  let txt;
  try{ txt=await navigator.clipboard.readText(); }
  catch(e){ txt=prompt("Pegá el código de tu amigo:"); }
  if(txt) processCodeAndPromptSave(txt.trim());
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

function processCodeAndPromptSave(raw){
  const parsed = parsePayload(raw);
  if(!parsed){ toast('Código inválido','err'); return; }

  window._pendingFriendCode = raw;
  showMatch(parsed);
  populateFriendCodePrompt();
  focusFriendCodePrompt();
}


function processCode(raw){
  const parsed = parsePayload(raw);
  if(!parsed){ toast('Código inválido','err'); return; }
  showMatch(parsed);
}

function showMatch(them){
  const me = myData();
  const myMiss = new Set(me.m);
  const theirGotSet = new Set((them.got||[]).map(s=>s.toUpperCase()));
  const theirMiss = new Set(ALL_IDS.filter(id=>!theirGotSet.has(id)));
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

  function renderChip(id, cls, container, selectedMap, countEl, maxQty){
    const info = STICKER_MAP[id];
    const baseLabel = info ? `${id.replace('-',' ')} · ${info.name}` : `${id}`;
    const el = document.createElement('span');
    el.className = `chip chip-sel ${cls}`;
    el.textContent = baseLabel;
    function updateChip(){
      const cur = selectedMap.get(id) || 0;
      if(cur === 0){
        el.classList.remove('selected');
        el.textContent = baseLabel;
      } else {
        el.classList.add('selected');
        el.textContent = cur > 1 ? `${baseLabel} ×${cur}` : baseLabel;
      }
      const totalGive = [...window._tradeGiveSelected.values()].reduce((a,b)=>a+b,0);
      const totalGet  = [...window._tradeGetSelected.values()].reduce((a,b)=>a+b,0);
      countEl.textContent = `${selectedMap===window._tradeGiveSelected?totalGive:totalGet} seleccionadas`;
      document.getElementById('confirm-trade-wrap').style.display = (totalGive+totalGet) > 0 ? 'block' : 'none';
      document.getElementById('match-give-n').textContent = totalGive;
      document.getElementById('match-get-n').textContent  = totalGet;
      updateMatchVerdict(totalGive, totalGet);
    }
    // Tap: add one
    el.onclick = () => {
      const cur = selectedMap.get(id) || 0;
      const next = cur + 1;
      if(maxQty !== undefined && maxQty !== null && next > maxQty){
        return;
      }
      selectedMap.set(id, next);
      updateChip();
    };
    // Long press: remove one
    let chipLpTimer = null;
    el.addEventListener('touchstart', e => {
      chipLpTimer = setTimeout(() => {
        chipLpTimer = null;
        const cur = selectedMap.get(id) || 0;
        if(cur <= 1){ selectedMap.delete(id); }
        else { selectedMap.set(id, cur - 1); }
        updateChip();
      }, 500);
    }, {passive:true});
    el.addEventListener('touchend', () => { clearTimeout(chipLpTimer); chipLpTimer = null; }, {passive:true});
    el.addEventListener('touchmove', () => { clearTimeout(chipLpTimer); chipLpTimer = null; }, {passive:true});
    el.addEventListener('mousedown', () => {
      chipLpTimer = setTimeout(() => {
        chipLpTimer = null;
        const cur = selectedMap.get(id) || 0;
        if(cur <= 1){ selectedMap.delete(id); }
        else { selectedMap.set(id, cur - 1); }
        updateChip();
      }, 500);
    });
    el.addEventListener('mouseup', () => { clearTimeout(chipLpTimer); chipLpTimer = null; });
    container.appendChild(el);
  }

  const cgive = document.getElementById('cgive');
  const cget  = document.getElementById('cget');
  cgive.innerHTML = '';
  cget.innerHTML  = '';

  const giveCountEl = document.getElementById('give-sel-count');
  const getCountEl  = document.getElementById('get-sel-count');
  giveCountEl.textContent = '0 seleccionadas';
  getCountEl.textContent  = '0 seleccionadas';
  document.getElementById('match-give-n').textContent = 0;
  document.getElementById('match-get-n').textContent  = 0;
  document.getElementById('confirm-trade-wrap').style.display = 'none';
  updateMatchVerdict(0, 0);

  if(iGive.length){
    iGive.forEach(id => renderChip(id, 'chip-m', cgive, window._tradeGiveSelected, giveCountEl, Math.max(0, (col[id]||0) - 1)));
  } else {
    cgive.innerHTML = '<span style="color:var(--muted);font-size:.68rem;font-family:\'Space Mono\',monospace;">Nada para dar</span>';
  }
  if(theyGive.length){
    theyGive.forEach(id => renderChip(id, 'chip-g', cget, window._tradeGetSelected, getCountEl, 1));
  } else {
    cget.innerHTML = '<span style="color:var(--muted);font-size:.68rem;font-family:\'Space Mono\',monospace;">Nada nuevo para vos</span>';
  }

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

// ─── CONFIRM TRADE ───────────────────────────────────────
function confirmTrade(){
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
  genQR();
  await new Promise(r => setTimeout(r, 400));
  const canvas = document.querySelector('#qrbox canvas');
  if(!canvas){ toast('Generando QR...','info'); return; }
  canvas.toBlob(async blob => {
    const file = new File([blob], 'panini-qr.png', {type:'image/png'});
    if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
      try{
        await navigator.share({ files: [file], title: 'Mi QR Panini WC 2026', text: 'Escaneá este QR o abrí el link para comparar figuritas.', url: buildTradeUrl() });
      } catch(e){ /* user cancelled */ }
    } else {
      // Fallback: just download the image
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'panini-qr.png';
      a.click();
      toast('QR descargado','ok');
    }
  });
}

// ─── SHARE QR AS IMAGE ───────────────────────────────────
function shareQRImage(){
  const box = document.getElementById('qrbox');
  const canvas = box.querySelector('canvas');
  if(!canvas){ toast('Primero generá el QR','warn'); return; }
  canvas.toBlob(blob=>{
    const file = new File([blob], 'panini-qr.png', {type:'image/png'});
    if(navigator.share && navigator.canShare({files:[file]})){
      navigator.share({files:[file], title:'Mi QR Panini WC 2026'});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'panini-qr.png';
      a.click();
    }
  });
}

// ─── FRIENDS ─────────────────────────────────────────────
function loadFriends(){ try{ return JSON.parse(localStorage.getItem('pn26_friends')||'[]'); }catch(e){return [];} }
function saveFriends(friends){ localStorage.setItem('pn26_friends', JSON.stringify(friends)); }

function renderFriends(){
  const friends = loadFriends();
  const list = document.getElementById('friend-list');
  if(!list) return;
  if(!friends.length){
    list.innerHTML = '<div class="friend-empty">Guardá amigos para intercambiar más rápido</div>';
    return;
  }
  list.innerHTML = friends.map((f,i)=>`
    <div class="friend-item" onclick="loadFriendCode(${i})">
      <div style="width:36px;height:36px;border-radius:99px;background:${avatarGradient(i)};display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:1.1rem;color:#fff;flex-shrink:0;">${f.name[0].toUpperCase()}</div>
      <div style="flex:1;">
        <div class="friend-name">${f.name}</div>
        <div class="friend-date">Guardado ${f.date}</div>
      </div>
      <div style="font-size:.6rem;font-family:'Space Mono',monospace;color:var(--purple);margin-right:4px;">Ver match →</div>
      <button class="friend-del" onclick="deleteFriend(event,${i})">✕</button>
    </div>`).join('');
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
  saveFriend();
  document.getElementById('friend-save-prompt').style.display='none';
  window._pendingFriendCode = null;
}

function updateFriendCode(i){
  const friends = loadFriends();
  const f = friends[i];
  if(!f) return;
  f.code = window._pendingFriendCode;
  f.date = new Date().toLocaleDateString('es-AR');
  friends[i] = f;
  saveFriends(friends);
  renderFriends();
  document.getElementById('friend-save-prompt').style.display='none';
  window._pendingFriendCode = null;
  toast(`✓ ${f.name} actualizado`,'ok');
}

function loadFriendCode(i){
  const friends = loadFriends();
  const f = friends[i];
  if(!f) return;
  const parsed = parsePayload(f.code);
  if(!parsed){ toast('Código inválido','err'); return; }
  window._pendingFriendCode = f.code;
  showMatch(parsed);
  document.getElementById('friend-save-prompt').style.display='none';
  document.getElementById('matchcard').scrollIntoView({behavior:'smooth',block:'start'});
  toast(`Match con ${f.name}`,'ok');
}

function deleteFriend(e, i){
  e.stopPropagation();
  const friends = loadFriends();
  const name = friends[i]?.name;
  friends.splice(i,1);
  saveFriends(friends);
  renderFriends();
  toast(`${name} eliminado`,'info');
}

// ═══════════════════════════════════════════════════════════
// QR SCANNING — cámara en vivo + galería
// ═══════════════════════════════════════════════════════════

let _qrReaderLoading = null;

function setScannerState(text, mode='idle'){
  const stat = document.getElementById('tstat');
  const pill = document.getElementById('scanner-live-pill');
  if(stat) stat.textContent = text;
  if(pill){
    pill.textContent = mode === 'live' ? 'En vivo' : mode === 'ok' ? 'Detectado' : mode === 'err' ? 'Error' : 'Listo';
    pill.className = 'scanner-live-pill ' + mode;
  }
}

async function ensureQRReader(){
  if(window.jsQR || window.BarcodeDetector) return true;
  if(_qrReaderLoading) return _qrReaderLoading;

  _qrReaderLoading = new Promise(resolve=>{
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsqr/1.4.0/jsQR.min.js';
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
      fps: 12,
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
  if((window.ZXingBrowser && window.ZXingBrowser.BrowserQRCodeReader) || (window.ZXing && window.ZXing.BrowserQRCodeReader)) return true;
  if(_zxingLoading) return _zxingLoading;

  const sources = [
    'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/index.min.js',
    'https://unpkg.com/@zxing/browser@0.1.5/umd/index.min.js',
    'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js'
  ];

  _zxingLoading = (async ()=>{
    for(const src of sources){
      const ok = await new Promise(resolve=>{
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = ()=>resolve(true);
        s.onerror = ()=>resolve(false);
        document.head.appendChild(s);
      });
      if(ok && ((window.ZXingBrowser && window.ZXingBrowser.BrowserQRCodeReader) || (window.ZXing && window.ZXing.BrowserQRCodeReader))) return true;
    }
    return false;
  })();

  return _zxingLoading;
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
        width:{ ideal:1920 },
        height:{ ideal:1080 }
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

async function toggleTradeCam(){
  if(isTradeScannerOpen()){
    stopTradeCam();
    return;
  }
  await startTradeCam();
}

async function openEnvironmentCamera(){
  const tries = [
    { audio:false, video:{ facingMode:{ exact:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } } },
    { audio:false, video:{ facingMode:{ ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } } },
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
    if(html5Started) return;

    // Fallback: ZXing.
    const zxingStarted = await startZXingTradeCam();
    if(zxingStarted) return;

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
    if(btn) btn.textContent = '✕ Cerrar escáner';
    setScannerState('Apuntá al QR de la PC. Subí el brillo, mantenelo centrado y probá acercar/alejar hasta que enfoque.', 'live');

    window._tradeScanHandled = false;
    window._tradeScanMisses = 0;
    scanTradeFrame();
  }catch(e){
    stopTradeCam();
    setScannerState('No pude abrir la cámara. Revisá permisos de Safari/iPhone o probá con galería.', 'err');
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
  if(!window._tradeScanHandled) setScannerState('Listo para escanear', 'idle');
}

function getVideoFrameImageData(video, canvas, mode){
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  if(!vw || !vh) return null;

  const maxW = 1100;
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
              mode === 'center78' ? .78 :
              mode === 'center64' ? .64 :
              mode === 'center52' ? .52 : .78;

  const size = Math.floor(Math.min(canvas.width, canvas.height) * pct);
  const sx = Math.max(0, Math.floor((canvas.width - size) / 2));
  const sy = Math.max(0, Math.floor((canvas.height - size) / 2));
  return ctx.getImageData(sx, sy, size, size);
}

async function scanTradeFrame(){
  if(!tradStream || window._tradeScanHandled) return;

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
        const passes = ['center90','center78','center64','center52','full'];
        for(const pass of passes){
          const imageData = getVideoFrameImageData(video, canvas, pass);
          if(!imageData) continue;
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth'
          });
          if(code && code.data){
            handleScannedTradeCode(code.data);
            return;
          }
        }

        window._tradeScanMisses = (window._tradeScanMisses || 0) + 1;
        if(window._tradeScanMisses === 70){
          setScannerState('Todavía no lo leo. Probá subir el brillo de la PC, acercar/alejar un poco y mantener el QR centrado.', 'live');
        }
      }else{
        setScannerState('No se cargó el lector QR. Probá con galería o pegá el código.', 'err');
      }
    }
  }catch(e){
    // No cerramos el escáner por un frame fallido.
  }

  tradRaf = requestAnimationFrame(scanTradeFrame);
}

function handleScannedTradeCode(raw){
  if(window._tradeScanHandled) return;
  const payload = normalizeTradePayload(raw);
  if(!parsePayload(payload)){
    setScannerState('Leí un QR, pero no es de intercambio Panini.', 'err');
    toast('Código QR inválido','err');
    return;
  }

  window._tradeScanHandled = true;
  setScannerState('¡QR encontrado!', 'ok');
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
      const payload = normalizeTradePayload(code);
      if(!parsePayload(payload)){
        setScannerState('La imagen tiene un QR, pero no es de intercambio Panini.', 'err');
        toast('Código QR inválido','err');
        return;
      }
      const preview = document.getElementById('qr-preview-img');
      if(preview) preview.style.display = 'none';
      setScannerState('¡QR encontrado!', 'ok');
      processCodeAndPromptSave(payload);
    })
    .catch(()=>{});
}

// ═══════════════════════════════════════════════════════════
// TAB NAV + HELPERS
// ═══════════════════════════════════════════════════════════
function goTab(name){
  if(name !== 'trade') stopTradeCam();
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
  // Bottom nav
  document.querySelectorAll('.bn').forEach(b=>b.classList.remove('active'));
  const bn = document.getElementById('bn-'+name);
  if(bn) bn.classList.add('active');
  // Sidebar nav
  document.querySelectorAll('.sidebar-nav-btn[id^="snb-"]').forEach(b=>b.classList.remove('active'));
  const snb = document.getElementById('snb-'+name);
  if(snb) snb.classList.add('active');

  if(name==='album') renderGrid();
  if(name==='summary') renderTeamSummary();
  if(name==='dupes') renderDupes();
  if(name==='trade'){ updateTradeSummary(); renderFriends(); genQR(); setTimeout(genQR, 60); }
  if(window._refreshScrollAid) setTimeout(()=>window._refreshScrollAid(false), 100);
}

function isActive(name){ return document.getElementById('panel-'+name).classList.contains('active'); }

let fbT;
function showFb(type,msg){
  const el=document.getElementById('fb');
  el.className=`fb show ${type}`; el.textContent=msg;
  clearTimeout(fbT); fbT=setTimeout(()=>el.classList.remove('show'),3200);
}

let toastT;
function toast(msg,type='info'){
  const t=document.getElementById('toast');
  if(!t) return;
  clearTimeout(toastT);
  t.className = `toast ${type}`;
  // Force a reflow so repeated toasts restart the slide-in/slide-out animation.
  void t.offsetWidth;
  t.textContent = msg;
  t.classList.add('show');
  toastT = setTimeout(()=>t.classList.remove('show'),2400);
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
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) setTimeout(setH, 120); });
})();

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
load();
updateStats();
requestAnimationFrame(updateStats);
renderGrid();
window.addEventListener('resize', ()=>{ if(isActive('trade')) genQR(); }, {passive:true});

function handleIncomingTradeLink(){
  const code = getIncomingTradeCode();
  if(!code) return;
  setTimeout(()=>{
    goTab('trade');
    const parsed = parsePayload(code);
    if(!parsed){
      toast('Código de intercambio inválido','err');
      return;
    }
    window._pendingFriendCode = code;
    showMatch(parsed);
    populateFriendCodePrompt();
    focusFriendCodePrompt();
    toast('Código de intercambio cargado','ok');
  }, 450);
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
    if(isActive('dupes')) return 'dupes';
    if(isActive('trade')) return 'trade';
    return '';
  }

  function hasDupes(){
    return Object.values(col).some(v => v > 1);
  }

  function shouldUseScrollAid(){
    const panel = activePanelName();
    if(panel === 'trade') return false;
    if(panel === 'dupes' && !hasDupes()) return false;
    return panel === 'album' || panel === 'dupes';
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

  function getActiveHeaders(){
    const panel = activePanelName();
    if(panel === 'album'){
      return [...document.querySelectorAll('#album-content .team-header')].map(h => ({
        el: h,
        flag: h.querySelector('.team-flag')?.textContent || '',
        abbrev: h.querySelector('.team-abbrev')?.textContent || ''
      }));
    }
    if(panel === 'dupes'){
      return [...document.querySelectorAll('#rlist .dupes-team-hdr')].map(h => ({
        el: h,
        flag: h.dataset.flag || h.children[0]?.textContent || '',
        abbrev: h.dataset.abbrev || h.children[1]?.textContent || ''
      }));
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

  bar.addEventListener('touchstart', e=>{onDragStart(e.touches[0].clientY);e.preventDefault();},{passive:false});
  bar.addEventListener('touchmove',  e=>{onDragMove(e.touches[0].clientY);e.preventDefault();},{passive:false});
  bar.addEventListener('touchend',   onDragEnd, {passive:true});
  bar.addEventListener('mousedown',  e=>{onDragStart(e.clientY);e.preventDefault();});
  window.addEventListener('mousemove', e=>{if(isDragging) onDragMove(e.clientY);});
  window.addEventListener('mouseup',   ()=>{if(isDragging) onDragEnd();});

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
    document.addEventListener('DOMContentLoaded', hideSplash);
  } else {
    hideSplash();
  }
})();


// ─── FIRST RUN GUIDED TUTORIAL ──────────────────────────
const TUTORIAL_KEY = 'pn26_tutorial_seen_v3';
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
    title:'Bienvenido',
    text:'Te muestro la app paso a paso. Voy a ir señalando cada parte para que sepas dónde tocar.',
    target:'.mobile-header',
    desktopTarget:'.sidebar-stats',
    items:[
      ['📊','Progreso','Acá ves cuánto álbum completaste.'],
      ['✅','Tengo / Faltan','Se actualiza cada vez que agregás o quitás figuritas.']
    ],
    hint:'Tocá Siguiente para avanzar por la guía.'
  },
  {
    kicker:'Instalación',
    title:'Usala como app',
    text:'Para que funcione mejor en iPhone, agregala a la pantalla de inicio.',
    hideOnDesktop:true,
    target:'.bottom-nav',
    items:[
      ['📱','iPhone','Safari → Compartir → Agregar a inicio.'],
      ['🤖','Android','Chrome → menú ⋮ → Instalar app.'],
      ['⚡','Más rápida','Abre en pantalla completa y se siente como app nativa.']
    ],
    hint:'Este paso aparece solo la primera vez junto con el tutorial.'
  },
  {
    kicker:'Álbum',
    title:'Marcá figuritas',
    text:'En el álbum, tocá una card para marcar que ya la tenés.',
    before:()=>goTab('album'),
    target:firstVisibleCell,
    items:[
      ['👆','Un toque','Suma una figurita.'],
      ['♻️','Repetida','Si ya la tenías, ese toque la cuenta como repetida.'],
      ['⏱️','Mantener presionado','Quita una copia de esa figurita.']
    ],
    hint:'Mientras el tutorial está abierto, no hace falta tocar la card. Solo mirá dónde se marca.'
  },
  {
    kicker:'Álbum',
    title:'Filtros y buscador',
    text:'Arriba del álbum tenés filtros y búsqueda para encontrar figuritas rápido.',
    hideOnDesktop:true,
    before:()=>goTab('album'),
    target:()=>document.querySelector('.gfilters') || document.getElementById('gs'),
    items:[
      ['🎛️','Filtros','Todas, Faltan, Tengo y Repetidas.'],
      ['🔎','Buscador','Buscá por ID, jugador o selección.']
    ],
    hint:'Ejemplo: podés buscar “MEX-13”, “Messi” o “Argentina”.'
  },
  {
    kicker:'Resumen',
    title:'Progreso por país',
    text:'Acá tenés el resumen general y el avance de cada selección ordenado por completas o faltantes.',
    before:()=>goTab('summary'),
    target:'#panel-summary',
    items:[
      ['📊','General','Ves completado, total, faltantes y tengo.'],
      ['🌎','Por país','Argentina 18/20, México 12/20 y todas las selecciones.'],
      ['↕️','Orden','Podés ordenar por más completas o más faltantes.']
    ],
    hint:'Ideal para saber qué países estás cerca de completar.'
  },
  {
    kicker:'Repetidas',
    title:'Controlá tus repetidas',
    text:'Esta pestaña muestra solo las figuritas que tenés más de una vez.',
    before:()=>{
      goTab('dupes');
      renderDupes();
      setTimeout(()=>{
        const el = dupesTutorialTarget();
        if(el && typeof el.scrollIntoView === 'function') el.scrollIntoView({behavior:'smooth',block:'center'});
      },60);
    },
    target:dupesTutorialTarget,
    items:[
      ['♻️','Lista automática','Aparecen cuando una figurita tiene cantidad mayor a 1.'],
      ['📋','Copiar lista','Sirve para pasar tus repetidas por WhatsApp.']
    ],
    hint:'Si todavía no tenés repetidas, esta sección queda vacía y no muestra scrollbar.'
  },
  {
    kicker:'Intercambio',
    title:'Compartí tu QR',
    text:'En Intercambio aparece tu QR para comparar colecciones con amigos.',
    before:()=>goTab('trade'),
    target:'#qrbox',
    items:[
      ['🔁','Mi QR','Representa tus pegadas y repetidas.'],
      ['📲','WhatsApp','Podés compartirlo directo desde la app.']
    ],
    hint:'En esta sección no aparece la scrollbar lateral, así queda más limpia.'
  },
  {
    kicker:'Intercambio',
    title:'Escaneá y compará',
    text:'Escaneá el QR de un amigo o subilo desde la galería.',
    before:()=>goTab('trade'),
    target:()=>document.querySelector('#panel-trade .btn.btn-p') || document.getElementById('qrfile'),
    items:[
      ['📷','Cámara','Leé el QR de otro usuario.'],
      ['🖼️','Galería','También podés elegir una imagen con QR.'],
      ['🤝','Match','La app calcula qué das y qué recibís.']
    ],
    hint:'Después podés guardar amigos para volver a comparar más rápido.'
  },
  {
    kicker:'Backup',
    title:'Importar y exportar',
    text:'Guardá tu colección para no perder datos o pasarla a otro dispositivo.',
    before:()=>{
      goTab('album');
      setTimeout(()=>{
        const card = [...document.querySelectorAll('.card-title')].find(el=>el.textContent.includes('Importar'));
        card?.scrollIntoView({behavior:'smooth',block:'center'});
      },60);
    },
    target:()=>[...document.querySelectorAll('.card')].find(el=>el.textContent.includes('Importar / Exportar')) || document.querySelector('#panel-album .card'),
    items:[
      ['📤','Exportar','Descarga un JSON con tu colección.'],
      ['📥','Importar','Restaura ese archivo en otro celular o PC.']
    ],
    hint:'Listo. Cuando termines, el tutorial no vuelve a aparecer automáticamente.'
  }
];

function currentTutorialTarget(step){
  const isDesk = isDesktopTutorial();
  return tutorialTarget(isDesk && step.desktopTarget ? step.desktopTarget : step.target);
}

function positionTutorial(){
  const ov = document.getElementById('tutorial-overlay');
  const card = document.getElementById('tutorial-card');
  const spot = document.getElementById('tutorial-spotlight');
  if(!ov || !card || !spot || !ov.classList.contains('show')) return;

  const steps = activeTutorialSteps();
  const step = steps[tutorialStep] || steps[0];
  const target = currentTutorialTarget(step);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 14;

  card.style.left = '';
  card.style.top = '';
  card.style.bottom = '';
  card.style.right = '';

  if(target){
    const rect = target.getBoundingClientRect();
    const pad = 8;
    const left = Math.max(8, rect.left - pad);
    const top = Math.max(8, rect.top - pad);
    const width = Math.min(vw - 16, rect.width + pad * 2);
    const height = Math.min(vh - 16, rect.height + pad * 2);

    spot.classList.add('visible');
    spot.style.left = `${left}px`;
    spot.style.top = `${top}px`;
    spot.style.width = `${width}px`;
    spot.style.height = `${height}px`;

    const cardRect = card.getBoundingClientRect();
    const cardW = Math.min(430, vw - margin*2);
    const spaceBelow = vh - (top + height) - margin;
    const spaceAbove = top - margin;
    const placeBelow = spaceBelow >= Math.min(cardRect.height || 260, 310) || spaceBelow >= spaceAbove;

    let cardLeft = Math.min(Math.max(margin, left + width/2 - cardW/2), vw - cardW - margin);
    card.style.width = `${cardW}px`;
    card.style.left = `${cardLeft}px`;

    if(placeBelow){
      card.style.top = `${Math.min(top + height + 12, vh - margin - (cardRect.height || 260))}px`;
      card.style.bottom = 'auto';
    } else {
      card.style.bottom = `${Math.min(vh - top + 12, vh - margin)}px`;
      card.style.top = 'auto';
    }
  } else {
    spot.classList.remove('visible');
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
}

function showTutorial(force=false){
  const ov = document.getElementById('tutorial-overlay');
  if(!ov) return;
  if(!force && localStorage.getItem(TUTORIAL_KEY)==='1') return;
  tutorialStep = 0;
  ov.classList.add('show');
  ov.setAttribute('aria-hidden','false');
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
  const ov = document.getElementById('tutorial-overlay');
  const spot = document.getElementById('tutorial-spotlight');
  if(!ov) return;
  ov.classList.remove('show');
  ov.setAttribute('aria-hidden','true');
  if(spot) spot.classList.remove('visible');
  if(!isActive('album')) goTab('album');
}

(function initTutorial(){
  const run = () => setTimeout(()=>showTutorial(false), 2100);
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();

  window.addEventListener('resize', ()=>{
    const ov = document.getElementById('tutorial-overlay');
    if(ov && ov.classList.contains('show')) renderTutorial();
    else scheduleTutorialPosition();
  }, {passive:true});
  window.addEventListener('orientationchange', ()=>setTimeout(scheduleTutorialPosition, 250), {passive:true});
  const sc = document.getElementById('main-scroll');
  if(sc) sc.addEventListener('scroll', scheduleTutorialPosition, {passive:true});
})();


// ─── IMPORT / EXPORT ─────────────────────────────────────
function doImport(raw){
  try{
    const parsed = JSON.parse(raw.trim());
    if(typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    col = {};
    for(const [k,v] of Object.entries(parsed)){
      if(typeof v === 'number' && v > 0) col[k.toUpperCase()] = v;
    }
    save(); updateStats(); renderGrid();
    if(isActive('dupes')) renderDupes();
    toast(`✅ ${Object.keys(col).length} figuritas importadas`,'ok');
  } catch(e){
    toast('JSON inválido','err');
  }
}

// ─── EXPORT AS FILE / IMPORT FROM FILE ───────────────────
// Override exportCollection to download JSON file
function exportCollection(){
  const data = JSON.stringify(col, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `panini-wc2026-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  toast('Colección descargada','ok');
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
