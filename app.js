// ═══════════════════════════════════════════════════════════
// INJECT ASSETS
// ═══════════════════════════════════════════════════════════
(function(){
  const wcSrc = `data:image/png;base64,${WC_LOGO_B64}`;
  const wppSrc = `data:image/png;base64,${WPP_LOGO_B64}`;
  ['wc-logo-img','splash-logo-img'].forEach(id => {
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
  document.getElementById('pct').textContent = pct+'%';
  document.getElementById('pbar').style.width = pct+'%';
  document.getElementById('smain').textContent = `${got} / ${TOTAL}`;
  document.getElementById('ms-g').textContent = got;
  document.getElementById('ms-mi').textContent = miss;
  document.getElementById('ms-du').textContent = dups;
  updateTradeSummary();
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
      out += `<div class="${cls}"${dup?` data-c="${c}"`:''}${posStyle}
        data-id="${id}"
        title="${s.id}: ${s.name}${s.holo?' ✨ Hologram':''}"
        onclick="cellTap('${id}',this)"
        onmousedown="startLongPress(event,'${id}')"
        onmouseup="cancelLongPress()"
        onmouseleave="cancelLongPress()"
        ontouchstart="startLongPress(event,'${id}')"
        ontouchend="cancelLongPress()"
        ontouchmove="cancelLongPress()"
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
  if(window._updateScrollInd) setTimeout(_updateScrollInd, 50);
}

function cellTap(id, el){
  // Don't fire if coming from long press
  if(el._longFired) { el._longFired=false; return; }
  if(window._lpBlockedId === id) { window._lpBlockedId=null; return; }
  const info = STICKER_MAP[id];
  col[id] = (col[id]||0) + 1;
  save(); updateStats();
  el.classList.add('pop');
  setTimeout(()=>el.classList.remove('pop'),220);
  const c = col[id];
  toast(c===1 ? `¡Tenés ${id}!${info.holo?' ✨':''}` : `Repetida ${id} ×${c}`, c===1?'ok':'warn');
  renderGrid();
  if(isActive('dupes')) renderDupes();
}

// ─── LONG PRESS ───────────────────────────────
let lpTimer = null;
function startLongPress(e, id){
  const el = e.currentTarget;
  if(e.type==='touchstart') e.preventDefault();
  el._longFired = false;
  cancelLongPress();
  el.classList.add('pressing');
  lpTimer = setTimeout(()=>{
    el._longFired = true;
    window._lpBlockedId = id;
    el.classList.remove('pressing');
    if(!col[id] || col[id]<=0){ toast('No está en tu colección','warn'); return; }
    col[id]--;
    if(col[id]<=0) delete col[id];
    save(); updateStats();
    const c = col[id]||0;
    toast(c===0 ? `Quitaste ${id}` : `${id} ×${c}`, c===0?'info':'warn');
    renderGrid();
    if(isActive('dupes')) renderDupes();
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
  toast(`Quitaste ${id}`, 'info');
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
          <div class="ri-badge">×${c-1} extra</div>
          <button class="ri-del" onclick="removeOne('${id}')">✕</button>
        </div>`;
      }
      if(!teamHtml) continue;
      const lp = (TEAMS.find(t=>t.key===teamKey)||{label:teamKey}).label.match(/^(\S+)\s+[A-Z0-9_]+\s+·\s+(.+)$/);
      const flag = lp ? lp[1] : '';
      const tname = lp ? lp[2] : teamKey;
      groupHtml += `<div class="dupes-team">
        <div class="dupes-team-hdr">
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
}

function removeOne(id){
  if(!col[id]) return;
  col[id]--;
  if(col[id]<=0) delete col[id];
  save(); updateStats(); renderDupes();
  if(isActive('album')) renderGrid();
  toast(`Quitaste una de ${id}`,'info');
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

function buildPayload(){
  const got = Object.keys(col); // collected IDs
  const dupes = Object.entries(col).filter(([,v])=>v>1);
  const cPart = got.map(encodeShortId).join(',');
  const dPart = dupes.map(([id,c])=>encodeShortId(id)+'x'+c).join(',');
  return 'p26:c=' + cPart + (dPart ? '&d=' + dPart : '');
}

function parsePayload(raw){
  raw = raw.trim();
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
        const [k,v] = part.split('=');
        params[k] = v||'';
      });
      const got = params.c ? params.c.split(',').filter(Boolean).map(decodeShortId) : [];
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
  box.innerHTML='';
  const payload = buildPayload();
  const charCount = payload.length;
  try{
    new QRCode(box,{
      text: payload,
      width: 220,
      height: 220,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.L
    });

  }catch(e){
    const dupesOnly = Object.keys(col).filter(id=>col[id]>1).map(encodeShortId).join(',');
    const fallback = 'p26:d=' + dupesOnly;
    try{
      new QRCode(box,{text:fallback,width:220,height:220,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.L});
  
    }catch(e2){
      box.innerHTML='<div style="color:var(--red);font-size:.68rem;padding:14px;text-align:center;">Collection too large for QR.<br>Use Copy Code instead.</div>';
    }
  }
}

function copyCode(){
  navigator.clipboard.writeText(buildPayload()).then(()=>toast('¡Código copiado!','ok'));
}

async function pasteCode(){
  let txt;
  try{ txt=await navigator.clipboard.readText(); }
  catch(e){ txt=prompt("Pegá el código de tu amigo:"); }
  if(txt) processCodeAndPromptSave(txt.trim());
}

function processCodeAndPromptSave(raw){
  const parsed = parsePayload(raw);
  if(!parsed){ toast('Código inválido','err'); return; }
  // Store pending code for potential save
  window._pendingFriendCode = raw;
  showMatch(parsed);
  // Show save prompt after match renders
  setTimeout(()=>{
    document.getElementById('friend-save-prompt').style.display='block';
    // Populate existing friends as quick-update buttons
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
  }, 400);
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

  const iGive   = me.d.filter(n=>theirMiss.has(n)).sort(byAlbum);
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
    const baseLabel = info ? `${id.replace('-',' ')} · ${info.name}` : id;
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
      if(maxQty && next > maxQty) return; // can't give more than you have
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
    iGive.forEach(id => renderChip(id, 'chip-m', cgive, window._tradeGiveSelected, giveCountEl, col[id]||1));
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
  document.getElementById('summ-count').textContent = `(${d.m.length})`;
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
  document.getElementById('summ').innerHTML = missHtml;

  // Dupes: flat chips with count
  document.getElementById('sumd-count').textContent = `(${d.d.length} únicas)`;
  const cD = d.d.map(n=>{
    const c = col[n]||0;
    const info = STICKER_MAP[n];
    const lbl = info ? `${n.replace('-',' ')} ×${c-1}` : n;
    return `<span class="chip chip-d">${lbl}</span>`;
  }).join('');
  document.getElementById('sumd').innerHTML = cD||'<span style="color:var(--muted);font-size:.68rem;font-family:\'Space Mono\',monospace;">Sin repetidas aún</span>';
}



// ─── MATCH VERDICT ───────────────────────────────────────
function updateMatchVerdict(give, get){
  const verdict = document.getElementById('match-verdict');
  if(!verdict) return;
  if(give === 0 && get === 0){
    verdict.textContent = 'Seleccioná figuritas';
    verdict.className = 'match-verdict';
  } else if(give === 0){
    verdict.textContent = `🎉 Recibís ${get} sin dar nada`;
    verdict.className = 'match-verdict win';
  } else if(get === 0){
    verdict.textContent = `⚠️ Das ${give} sin recibir nada`;
    verdict.className = 'match-verdict lose';
  } else {
    const diff = give - get;
    if(diff === 0){
      verdict.textContent = '🤝 Intercambio justo';
      verdict.className = 'match-verdict fair';
    } else if(diff < 0){
      verdict.textContent = `🎉 Salís ganando +${Math.abs(diff)}`;
      verdict.className = 'match-verdict win';
    } else {
      verdict.textContent = `⚠️ Ellos salen ganando +${diff}`;
      verdict.className = 'match-verdict lose';
    }
  }
}

// ─── CONFIRM TRADE ───────────────────────────────────────
function confirmTrade(){
  if((!window._tradeGiveSelected?.size) && (!window._tradeGetSelected?.size)){
    toast('Seleccioná figuritas primero','warn'); return;
  }

  const giveMap = window._tradeGiveSelected;
  const getMap  = window._tradeGetSelected;

  // Remove N copies of each sticker we're giving
  let totalGiven = 0;
  giveMap.forEach((qty, id) => {
    col[id] = (col[id]||0) - qty;
    if(col[id] <= 0) delete col[id];
    totalGiven += qty;
  });

  // Add N copies of each sticker we're receiving
  let totalGotten = 0;
  getMap.forEach((qty, id) => {
    col[id] = (col[id]||0) + qty;
    totalGotten += qty;
  });

  save();
  updateStats();
  if(isActive('album')) renderGrid();

  // Reset
  window._tradeGiveSelected = new Map();
  window._tradeGetSelected  = new Map();
  document.getElementById('confirm-trade-wrap').style.display = 'none';
  document.getElementById('matchcard').style.display = 'none';

  toast(`🤝 ¡Intercambio hecho! +${totalGotten} pegadas, -${totalGiven} dadas`, 'ok');
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

// ─── WHATSAPP SHARE ──────────────────────────────────────
async function shareWhatsApp(){
  // First make sure QR is generated
  genQR();
  await new Promise(r => setTimeout(r, 300));

  const box = document.getElementById('qrbox');
  const canvas = box.querySelector('canvas');

  if(canvas && navigator.share){
    // Share QR image via native share sheet (works on mobile)
    canvas.toBlob(async blob => {
      const file = new File([blob], 'panini-wc2026-qr.png', {type:'image/png'});
      try{
        await navigator.share({
          files: [file],
          title: 'Panini WC 2026',
          text: '🃏 Escaneá mi QR en la app para ver qué podemos intercambiar!'
        });
      } catch(e){
        // Fallback: download + open WhatsApp
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'panini-qr.png';
        a.click();
        setTimeout(()=>{ window.open('https://wa.me/','_blank'); }, 800);
        toast('Guardá el QR y mandalo por WhatsApp','info');
      }
    });
  } else if(canvas){
    // Desktop fallback: download image
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'panini-qr.png';
      a.click();
      toast('QR descargado — mandalo por WhatsApp','ok');
    });
  } else {
    toast('Primero generá el QR','warn');
  }
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
// QR SCANNING — uses Capacitor MLKit BarcodeScanner (native)
// with fallback to image upload + ZXing via input[capture]
// ═══════════════════════════════════════════════════════════

async function toggleTradeCam(){
  const stat = document.getElementById('tstat');

  // Try Capacitor BarcodeScanner plugin first (native, reliable)
  const scanner = window.Capacitor?.Plugins?.BarcodeScanner
                || window.Capacitor?.Plugins?.MLKitBarcodeScanner;

  if(scanner){
    try{
      stat.textContent = 'Abriendo escáner…';
      // Make background transparent so native scanner shows through
      document.body.style.background = 'transparent';
      await scanner.checkPermission({force: true});
      scanner.hideBackground?.();
      const result = await scanner.startScan?.() || await scanner.scan?.();
      document.body.style.background = '';
      if(result?.hasContent || result?.content){
        const code = result.content || result.hasContent;
        stat.textContent = '¡QR encontrado!';
        processCode(typeof code === 'string' ? code : result.content);
      } else {
        stat.textContent = 'No se detectó QR — probá subiendo una imagen';
        document.body.style.background = '';
      }
    }catch(e){
      document.body.style.background = '';
      stat.textContent = 'Escáner no disponible — usá la opción de imagen abajo';
    }
    return;
  }

  // Fallback: open camera via file input with capture attribute
  // This works in Capacitor WebView on Android — opens camera app,
  // user takes photo of QR, we decode it
  stat.textContent = 'Abriendo cámara…';
  const input = document.getElementById('qr-capture-input');
  input.click();
}

// Decode QR from image using canvas + inline jsQR-compatible logic
// We use a simple approach: send pixel data to a Worker or use
// the ZXing WASM that ships with @zxing/browser
async function decodeQRFromImage(file){
  const stat = document.getElementById('tstat');
  stat.textContent = 'Leyendo QR…';

  return new Promise((resolve, reject)=>{
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = ()=>{
      const c = document.createElement('canvas');
      // Scale down large images for speed
      const MAX = 800;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      c.width  = Math.round(img.width  * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);

      // Try jsQR if it was loaded successfully from CDN
      if(window.jsQR){
        const imageData = ctx.getImageData(0, 0, c.width, c.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });
        if(code){ resolve(code.data); return; }
      }

      // jsQR not available — show the image and ask user to paste code manually
      const dataUrl = c.toDataURL('image/jpeg', 0.85);
      document.getElementById('qr-preview-img').src = dataUrl;
      document.getElementById('qr-preview-img').style.display = 'block';
      stat.textContent = 'Biblioteca QR no cargada — pegá el código manualmente abajo';
      reject(new Error('no-jsqr'));
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('img-load')); };
    img.src = url;
  });
}

function readQRFile(e){
  const file = e.target.files[0];
  if(!file) return;
  // Reset input so same file can be selected again
  e.target.value = '';
  decodeQRFromImage(file)
    .then(code =>{
      document.getElementById('tstat').textContent = '¡QR encontrado!';
      document.getElementById('qr-preview-img').style.display = 'none';
      processCodeAndPromptSave(code);
    })
    .catch(err =>{
      if(err.message !== 'no-jsqr'){
        document.getElementById('tstat').textContent = 'No se pudo leer la imagen — intentá de nuevo';
      }
    });
}

// ═══════════════════════════════════════════════════════════
// TAB NAV + HELPERS
// ═══════════════════════════════════════════════════════════
function goTab(name){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
  document.querySelectorAll('.bn').forEach(b=>b.classList.remove('active'));
  const bn = document.getElementById('bn-'+name);
  if(bn) bn.classList.add('active');
  if(name==='album') renderGrid();
  if(name==='dupes') renderDupes();
  if(name==='trade'){ updateTradeSummary(); renderFriends(); genQR(); }
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
  t.textContent=msg; t.className=`toast show ${type}`;
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2400);
}

// AdMob removed

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
load();
updateStats();
renderGrid();

// ─── SCROLLBAR + TEAM INDICATOR (ported from Messi app) ───
(function(){
  const scroll = document.getElementById('main-scroll');
  const ind    = document.getElementById('scroll-ind');
  const indFlag   = document.getElementById('scroll-ind-flag');
  const indAbbrev = document.getElementById('scroll-ind-abbrev');
  if(!scroll || !ind) return;

  // Create draggable scrollbar
  let bar = document.getElementById('scrollBar');
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'scrollBar';
    bar.className = 'scroll-bar';
    document.body.appendChild(bar);
  }

  let hideTimer, isDragging=false, startY=0, startScrollTop=0;

  function getNav(){ return document.querySelector('.bottom-nav'); }

  function updateBar(){
    const {scrollTop, scrollHeight, clientHeight} = scroll;
    if(scrollHeight <= clientHeight+10){ bar.classList.remove('visible'); return; }
    const rect   = scroll.getBoundingClientRect();
    const nav    = getNav();
    const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
    const trackStart = rect.top + 4;
    const trackEnd   = navTop - 4;
    const trackH     = trackEnd - trackStart;
    const barH       = Math.max(44, Math.min(trackH*(clientHeight/scrollHeight), trackH));
    const scrollable = scrollHeight - clientHeight;
    const pct        = scrollable > 0 ? Math.min(scrollTop/scrollable, 1) : 0;
    bar.style.height = barH+'px';
    bar.style.top    = (trackStart + (trackH-barH)*pct)+'px';
    bar.classList.add('visible');
    clearTimeout(hideTimer);
    if(!isDragging) hideTimer = setTimeout(()=>bar.classList.remove('visible'), 800);
  }

  function updateIndicator(){
    if(!document.getElementById('panel-album').classList.contains('active')){
      ind.classList.remove('visible'); return;
    }
    const hdrs = [...document.querySelectorAll('#album-content .team-header')];
    if(!hdrs.length){ ind.classList.remove('visible'); return; }

    // scanLine: same formula as Messi app
    const pct      = scroll.scrollTop / (scroll.scrollHeight - scroll.clientHeight) || 0;
    const scanLine = scroll.scrollTop + (pct * scroll.clientHeight);

    let active = null;
    for(const h of hdrs){
      if(h.offsetTop <= scanLine) active = h;
      else break;
    }
    if(!active){ ind.classList.remove('visible'); return; }

    const flagEl   = active.querySelector('.team-flag');
    const abbrevEl = active.querySelector('.team-abbrev');
    const newFlag   = flagEl   ? flagEl.textContent   : '';
    const newAbbrev = abbrevEl ? abbrevEl.textContent : '';

    if(newAbbrev !== indAbbrev.textContent){
      indFlag.textContent   = newFlag;
      indAbbrev.textContent = newAbbrev;
      ind.animate([{transform:'scale(1)'},{transform:'scale(1.08)'},{transform:'scale(1)'}],
        {duration:150, easing:'ease-out'});
    }

    // Position: follow the scrollbar
    const barRect = bar.getBoundingClientRect();
    const nav     = getNav();
    const navTop  = nav ? nav.getBoundingClientRect().top : window.innerHeight;
    ind.style.top = Math.max(60, Math.min(barRect.top + barRect.height/2 - 20, navTop-50)) + 'px';
    ind.classList.add('visible');
    clearTimeout(ind._hideTimer);
    ind._hideTimer = setTimeout(()=>ind.classList.remove('visible'), 800);
  }

  scroll.addEventListener('scroll', ()=>{ updateBar(); updateIndicator(); }, {passive:true});

  // Drag support
  function onDragStart(clientY){
    isDragging=true; startY=clientY; startScrollTop=scroll.scrollTop;
    bar.classList.add('visible'); bar.style.transition='none';
  }
  function onDragMove(clientY){
    if(!isDragging) return;
    const {scrollHeight,clientHeight} = scroll;
    const rect = scroll.getBoundingClientRect();
    const ratio = (scrollHeight-clientHeight) / (rect.height - parseInt(bar.style.height||'44'));
    scroll.scrollTop = startScrollTop + (clientY-startY)*ratio;
    updateBar(); updateIndicator();
  }
  function onDragEnd(){
    isDragging=false; bar.style.transition='opacity .3s';
    hideTimer = setTimeout(()=>bar.classList.remove('visible'), 800);
    setTimeout(()=>ind.classList.remove('visible'), 300);
  }

  bar.addEventListener('touchstart', e=>{onDragStart(e.touches[0].clientY);e.preventDefault();},{passive:false});
  bar.addEventListener('touchmove',  e=>{onDragMove(e.touches[0].clientY);e.preventDefault();},{passive:false});
  bar.addEventListener('touchend',   onDragEnd, {passive:true});
  bar.addEventListener('mousedown',  e=>{onDragStart(e.clientY);e.preventDefault();});
  window.addEventListener('mousemove', e=>{if(isDragging) onDragMove(e.clientY);});
  window.addEventListener('mouseup',   ()=>{if(isDragging) onDragEnd();});

  window._updateScrollInd = ()=>{ updateBar(); updateIndicator(); };
  updateBar();
})();


// ── SPLASH ──────────────────────────────────────────────
(function(){
  const splash = document.getElementById('splash');
  if(!splash) return;
  setTimeout(() => {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 700);
  }, 1800);
})();
