/* 避難所運営管理ツール — フロント本体（試作版 v0.1）
   - 動的フォーム生成
   - ステッパー／セグメントUI
   - IndexedDBによるオフライン退避 & 自動再送信 */

const CFG = window.APP_CONFIG;

/* ============ ログイン認証（避難所ごと） ============ */
const AUTH_KEY = 'shelter_auth';
const AUTH_TTL = 12 * 3600 * 1000;
const MY_SHELTER_KEY = 'my_shelter';       // ログイン中の避難所 {id,name}
const AUTO_RESTORE_KEY = 'auto_restore';   // 前回入力の自動復元 ON/OFF

function isLoggedIn(){
  try{
    const a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    return a && a.ok && a.shelter_id && (Date.now() - a.at < AUTH_TTL);
  }catch(e){ return false; }
}
function myShelter(){
  try{ return JSON.parse(localStorage.getItem(MY_SHELTER_KEY) || 'null'); }catch(e){ return null; }
}
function saveLogin(sid, sname){
  try{ localStorage.setItem(AUTH_KEY, JSON.stringify({ok:true, at:Date.now(), shelter_id:sid})); }catch(e){}
  try{ localStorage.setItem(MY_SHELTER_KEY, JSON.stringify({id:sid, name:sname})); }catch(e){}
}
function logout(){
  try{ localStorage.removeItem(AUTH_KEY); }catch(e){}
  location.reload();
}
// 避難所IDを並び順から算出（A,B,C…）
function shelterIdFromIndexAuth(i){
  let s=''; i=i+1;
  while(i>0){ const m=(i-1)%26; s=String.fromCharCode(65+m)+s; i=Math.floor((i-1)/26); }
  return s;
}
// ログイン画面の避難所プルダウンを生成
function buildLoginShelterSelect(){
  const sel = document.getElementById('loginShelter');
  if(!sel) return;
  (CFG.SHELTERS||[]).forEach(function(name,i){
    const id = shelterIdFromIndexAuth(i);
    const opt = document.createElement('option');
    opt.value = id; opt.dataset.name = name;
    opt.textContent = id + '：' + name;
    sel.appendChild(opt);
  });
  // 前回の避難所を初期選択
  const ms = myShelter();
  if(ms && ms.id) sel.value = ms.id;
}
async function doLogin(){
  const sel = document.getElementById('loginShelter');
  const pw = document.getElementById('loginPw').value;
  const err = document.getElementById('loginErr');
  err.textContent = '';
  if(!sel.value){ err.textContent='避難所を選んでください'; return; }
  if(!pw){ err.textContent='パスワードを入力してください'; return; }
  const sid = sel.value;
  const sname = sel.options[sel.selectedIndex].dataset.name || '';
  try{
    const res = await fetch(CFG.GAS_URL, {
      method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({action:'login', shelter_id:sid, password:pw})
    });
    const r = await res.json();
    if(r && r.ok){
      saveLogin(sid, sname);
      document.getElementById('loginGate').style.display='none';
      document.getElementById('loginPw').value='';
      afterLogin();
    }else{
      err.textContent = 'パスワードが違います';
    }
  }catch(e){
    err.textContent = '通信エラー。ネットワークを確認してください';
  }
}
function showGateIfNeeded(){
  const gate = document.getElementById('loginGate');
  buildLoginShelterSelect();
  if(isLoggedIn()){ gate.style.display='none'; afterLogin(); }
  else{ gate.style.display='flex'; setTimeout(function(){ var e=document.getElementById('loginPw'); if(e) e.focus(); }, 100); }
}
// ログイン後：避難所を報告フォームに反映＋前回入力を自動復元
function afterLogin(){
  const ms = myShelter();
  if(ms && ms.id){
    // 避難所プルダウンを自分の避難所に固定選択
    const nameSel = document.getElementById('shelter_name');
    if(nameSel){
      for(var i=0;i<nameSel.options.length;i++){
        if(nameSel.options[i].dataset && nameSel.options[i].dataset.id===ms.id){ nameSel.selectedIndex=i; break; }
      }
      document.getElementById('shelter_id').value = ms.id;
    }
  }
  // 前回入力の自動復元
  if(isAutoRestore()){ restoreLastInput(); }
}


/* ============ 設定モーダル ============ */
function openSettings(){ document.getElementById('logModal').hidden=true; document.getElementById('settingsModal').hidden=false; showCurrentShelter(); }
function closeSettings(){ document.getElementById('settingsModal').hidden=true; }
// 設定画面に現在の避難所名と自動復元状態を表示
function showCurrentShelter(){
  const ms = myShelter();
  const el = document.getElementById('currentShelter');
  if(el) el.innerHTML = 'ログイン中の避難所：<b>'+ (ms ? (ms.id+'：'+ms.name) : '—') +'</b>';
  const chk = document.getElementById('autoRestoreChk');
  if(chk) chk.checked = isAutoRestore();
}
async function changePassword(){
  const p1=document.getElementById('newPw1').value;
  const p2=document.getElementById('newPw2').value;
  const msg=document.getElementById('pwMsg');
  const ms=myShelter();
  msg.style.color=''; msg.textContent='';
  if(p1.length<4){ msg.style.color='#ff9a9a'; msg.textContent='4文字以上で入力してください'; return; }
  if(p1!==p2){ msg.style.color='#ff9a9a'; msg.textContent='確認用と一致しません'; return; }
  msg.textContent='変更中…';
  try{
    const res=await fetch(CFG.GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({action:'change_password', token:CFG.TOKEN, shelter_id:(ms&&ms.id)||'', new_password:p1})});
    const r=await res.json();
    if(r&&r.ok){ msg.style.color='#7ff0ac'; msg.textContent='この避難所のパスワードを変更しました。';
      document.getElementById('newPw1').value=''; document.getElementById('newPw2').value=''; }
    else{ msg.style.color='#ff9a9a'; msg.textContent='変更失敗：'+((r&&r.error)||'不明'); }
  }catch(e){ msg.style.color='#ff9a9a'; msg.textContent='通信エラー'; }
}
async function resetPassword(){
  const msg=document.getElementById('pwMsg');
  const ms=myShelter();
  if(!confirm('この避難所のパスワードを初期値（nagaokakyo2026）に戻しますか？')) return;
  msg.style.color=''; msg.textContent='リセット中…';
  try{
    const res=await fetch(CFG.GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({action:'reset_password', token:CFG.TOKEN, shelter_id:(ms&&ms.id)||''})});
    const r=await res.json();
    if(r&&r.ok){ msg.style.color='#7ff0ac'; msg.textContent='パスワードを nagaokakyo2026 に戻しました。'; }
    else{ msg.style.color='#ff9a9a'; msg.textContent='リセット失敗：'+((r&&r.error)||'不明'); }
  }catch(e){ msg.style.color='#ff9a9a'; msg.textContent='通信エラー'; }
}

/* ============ 前回入力の自動保存・復元 ============ */
function isAutoRestore(){
  try{ var v=localStorage.getItem(AUTO_RESTORE_KEY); return v===null ? true : v==='1'; }catch(e){ return true; }
}
function toggleAutoRestore(){
  const chk=document.getElementById('autoRestoreChk');
  try{ localStorage.setItem(AUTO_RESTORE_KEY, chk.checked?'1':'0'); }catch(e){}
  const msg=document.getElementById('autoRestoreMsg');
  if(msg){ msg.style.color='#7ff0ac'; msg.textContent = chk.checked ? '自動復元をオンにしました。' : '自動復元をオフにしました。'; }
}
// 入力内容を端末に自動保存（避難所ごと）
function autoSaveInput(){
  if(!isAutoRestore()) return;
  const ms=myShelter(); if(!ms||!ms.id) return;
  try{ localStorage.setItem('last_input_'+ms.id, JSON.stringify(collectPayload())); }catch(e){}
}
// 前回入力を復元
function restoreLastInput(){
  const ms=myShelter(); if(!ms||!ms.id) return;
  var saved=null;
  try{ saved=JSON.parse(localStorage.getItem('last_input_'+ms.id)||'null'); }catch(e){}
  if(!saved) return;
  applyPayloadToForm(saved);
}
// 保存データをフォームに反映
function applyPayloadToForm(p){
  try{
    if(p.reporter!=null) $('#reporter').value=p.reporter;
    var s=p.status||{};
    ['temperature_c','humidity_pct','infection_measures'].forEach(function(k){ if($('#'+k)&&s[k]!=null) $('#'+k).value=s[k]; });
    // ライフラインのセグメント
    ['power','water','gas','internet'].forEach(function(k){
      if(s[k]){ var g=document.querySelector('.segbtns[data-name="'+k+'"]');
        if(g){ g.querySelectorAll('.seg').forEach(function(b){ b.classList.toggle('active', b.dataset.v===s[k]); if(b.dataset.v===s[k]) g.dataset.value=s[k]; }); } }
    });
    var ev=p.evacuees||{};
    // 年代・性別・障害・要配慮・ペット
    function setCounter(name,val){ var el=document.querySelector('.counter[data-name="'+name+'"] input'); if(el&&val!=null) el.value=val; }
    if(ev.age) Object.keys(ev.age).forEach(function(k){ setCounter('age_'+k, ev.age[k]); });
    if(ev.sex){ setCounter('sex_male',ev.sex.male); setCounter('sex_female',ev.sex.female); setCounter('sex_other',ev.sex.other); }
    if(ev.disability) Object.keys(ev.disability).forEach(function(k){ setCounter('disability_'+k, ev.disability[k]); });
    setCounter('pregnant',ev.pregnant); setCounter('postpartum',ev.postpartum); setCounter('infant_households',ev.infant_households);
    if(ev.pet){ setCounter('pet_households',ev.pet.households); setCounter('pet_dogs',ev.pet.dogs); setCounter('pet_cats',ev.pet.cats); setCounter('pet_others',ev.pet.others); }
    if($('#chronic_yes')&&ev.chronic_yes!=null) $('#chronic_yes').value=ev.chronic_yes;
    if($('#chronic_note')&&ev.chronic_note!=null) $('#chronic_note').value=ev.chronic_note;
    // 自治会
    if(ev.district){ Object.keys(ev.district).forEach(function(k){ addDistrictEntry(k, ev.district[k]); }); }
    // 医療
    var med=p.medical||{};
    if($('#medical_present')&&med.present!=null) $('#medical_present').value=med.present;
    if($('#medical_org')&&med.org!=null) $('#medical_org').value=med.org;
    if($('#injured_count')&&med.injured_count!=null) $('#injured_count').value=med.injured_count;
    // メモ
    if($('#notes')&&p.notes!=null) $('#notes').value=p.notes;
    // 合計再計算
    updateAgeTotal();
    toast('前回の入力を復元しました','info');
  }catch(e){}
}

async function resetAll(){
  const msg=document.getElementById('resetMsg');
  if(!confirm('本当にすべてのデータ（報告・集計・履歴・TODO・チャット）を消去しますか？\nこの操作は取り消せません。')) return;
  if(!confirm('最終確認です。全データを消去します。よろしいですか？')) return;
  msg.style.color=''; msg.textContent='消去中…';
  try{
    const res=await fetch(CFG.GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({action:'reset_all', token:CFG.TOKEN, scope:'all'})});
    const r=await res.json();
    if(r&&r.ok){ msg.style.color='#7ff0ac'; msg.textContent='すべてのデータを消去しました。'; }
    else{ msg.style.color='#ff9a9a'; msg.textContent='消去失敗：'+((r&&r.error)||'不明'); }
  }catch(e){ msg.style.color='#ff9a9a'; msg.textContent='通信エラー'; }
}

/* ============ 日誌（アーカイブ）閲覧 ============ */
let LOG_DATA = [];
function openLog(){ document.getElementById('settingsModal').hidden=true; document.getElementById('logModal').hidden=false; loadLog(); }
function closeLog(){ document.getElementById('logModal').hidden=true; }
async function loadLog(){
  const content=document.getElementById('logContent');
  content.innerHTML='<div class="hint">読み込み中…</div>';
  try{
    const res=await fetch(CFG.GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({action:'get_archive', token:CFG.TOKEN})});
    const r=await res.json();
    if(!r||!r.ok){ content.innerHTML='<div class="hint">取得に失敗しました。</div>'; return; }
    LOG_DATA = r.archive||[];
    const dates = r.dates||[];
    const sel=document.getElementById('logDate');
    if(!dates.length){ sel.innerHTML='<option value="">記録なし</option>'; content.innerHTML='<div class="hint">まだ日誌の記録がありません。</div>'; return; }
    sel.innerHTML=dates.map(function(d){return '<option value="'+d+'">'+d+'</option>';}).join('');
    renderLogTable();
  }catch(e){ content.innerHTML='<div class="hint">通信エラー。</div>'; }
}
function esc2(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];}); }
function renderLogTable(){
  const date=document.getElementById('logDate').value;
  const content=document.getElementById('logContent');
  const rows=LOG_DATA.filter(function(r){return r.date===date;});
  if(!rows.length){ content.innerHTML='<div class="hint">この日の記録はありません。</div>'; return; }
  // 時間帯（朝昼夜）ごとにまとめる
  const bySlot={}; const order=[];
  rows.forEach(function(r){ if(!bySlot[r.slot]){bySlot[r.slot]=[];order.push(r.slot);} bySlot[r.slot].push(r); });
  let html='';
  order.forEach(function(slot){
    html+='<div class="log-slot">'+esc2(slot)+'</div>';
    html+='<table><thead><tr><th>避難所</th><th class="num">避難人数</th><th class="num">要配慮</th><th class="num">けが人</th><th>電気</th><th>水</th></tr></thead><tbody>';
    bySlot[slot].forEach(function(r){
      html+='<tr><td>'+esc2(r.shelter_id)+'：'+esc2(r.shelter_name||'')+'</td>'+
        '<td class="num">'+r.total_evacuees+'</td><td class="num">'+r.care_approx+'</td>'+
        '<td class="num">'+r.injured+'</td><td>'+esc2(r.power||'—')+'</td><td>'+esc2(r.water||'—')+'</td></tr>';
    });
    html+='</tbody></table>';
  });
  content.innerHTML=html;
}


/* ============ IndexedDB（オフライン退避） ============ */
const DB_NAME = 'shelterDB';
const STORE = 'outbox';
let db;

function openDB(){
  return new Promise((res, rej)=>{
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = e=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains(STORE)){
        d.createObjectStore(STORE, {keyPath:'submission_id'});
      }
    };
    r.onsuccess = e=>{ db = e.target.result; res(db); };
    r.onerror = e=> rej(e.target.error);
  });
}
function idbPut(rec){
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = res; tx.onerror = ()=>rej(tx.error);
  });
}
function idbDelete(id){
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = res; tx.onerror = ()=>rej(tx.error);
  });
}
function idbAll(){
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = ()=>res(req.result || []);
    req.onerror = ()=>rej(req.error);
  });
}

/* ============ 小物 ============ */
const $ = s=>document.querySelector(s);
const uuid = ()=> (crypto.randomUUID ? crypto.randomUUID()
  : 'id-'+Date.now()+'-'+Math.random().toString(16).slice(2));

function toast(msg, type='info', ms=2600){
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast '+type; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(()=> t.hidden = true, ms);
}

/* ============ 動的フォーム生成 ============ */
function counterHTML(name, label){
  return `<div class="counter" data-name="${name}">
    <span>${label}</span>
    <div class="stepper">
      <button type="button" class="minus">−</button>
      <input value="0" inputmode="numeric">
      <button type="button" class="plus">＋</button>
    </div></div>`;
}

function buildDynamicGrids(){
  $('#ageGrid').innerHTML = CFG.AGE_BUCKETS.map(a=>counterHTML('age_'+a, a+'歳')).join('');
  $('#disabilityGrid').innerHTML = CFG.DISABILITY_TYPES.map(d=>counterHTML('disability_'+d, d)).join('');
}

/* 避難所名ドロップダウンを生成。IDは並び順にA,B,C…（27件目以降はAA,AB…） */
function shelterIdFromIndex(i){
  let s=''; i=i+1;
  while(i>0){ const m=(i-1)%26; s=String.fromCharCode(65+m)+s; i=Math.floor((i-1)/26); }
  return s;
}
function buildShelterSelect(){
  const sel = $('#shelter_name');
  (CFG.SHELTERS||[]).forEach((name,i)=>{
    const id = shelterIdFromIndex(i);
    const opt = document.createElement('option');
    opt.value = name;
    opt.dataset.id = id;
    opt.textContent = id + '：' + name;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', ()=>{
    const opt = sel.options[sel.selectedIndex];
    $('#shelter_id').value = opt ? (opt.dataset.id||'') : '';
  });
}

/* 自治会ドロップダウンを生成 */
function buildDistrictSelect(){
  const sel = $('#districtSelect');
  (CFG.DISTRICTS||[]).forEach(name=>{
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    sel.appendChild(opt);
  });
}

/* 自治会の人数行を追加（同じ自治会は上書き集約） */
function addDistrictEntry(name, qty){
  if(!name){ toast('自治会を選んでください','err'); return; }
  qty = parseInt(qty,10); if(isNaN(qty)||qty<1){ toast('人数を入力してください','err'); return; }
  // 既存があれば加算
  const existing = document.querySelector(`#districtList .rowitem[data-name="${CSS.escape(name)}"]`);
  if(existing){
    const q = existing.querySelector('.dq');
    q.textContent = (parseInt(q.textContent,10)||0) + qty;
  }else{
    const el = document.createElement('div');
    el.className = 'rowitem district-row';
    el.dataset.name = name;
    el.innerHTML = `<span class="dname">${name}</span>
      <span class="dqty"><b class="dq">${qty}</b> 人</span>
      <button type="button" class="del">削除</button>`;
    $('#districtList').appendChild(el);
  }
  updateDistrictTotal();
}
function updateDistrictTotal(){
  let sum=0;
  document.querySelectorAll('#districtList .dq').forEach(e=> sum += parseInt(e.textContent,10)||0);
  $('#districtTotal').textContent = sum;
}
/* 自治会リスト → {自治会名:人数} を収集 */
function collectDistricts(){
  const o={};
  document.querySelectorAll('#districtList .rowitem').forEach(item=>{
    const name = item.dataset.name;
    const q = parseInt(item.querySelector('.dq').textContent,10)||0;
    if(name && q>0) o[name]=q;
  });
  return o;
}

/* ステッパー操作（イベント委譲） */
function bindSteppers(){
  document.body.addEventListener('click', e=>{
    const btn = e.target.closest('.stepper button');
    if(!btn) return;
    const input = btn.parentElement.querySelector('input');
    let v = parseInt(input.value||'0',10); if(isNaN(v)) v=0;
    v += btn.classList.contains('plus') ? 1 : -1;
    if(v<0) v=0;
    input.value = v;
    updateAgeTotal();
  });
  document.body.addEventListener('input', e=>{
    if(e.target.closest('.counter')) updateAgeTotal();
  });
}
function updateAgeTotal(){
  let sum=0;
  CFG.AGE_BUCKETS.forEach(a=>{
    const el = document.querySelector(`.counter[data-name="age_${a}"] input`);
    sum += parseInt(el?.value||'0',10)||0;
  });
  $('#ageTotal').textContent = sum;
}

/* セグメント（ライフライン） */
function bindSegments(){
  document.querySelectorAll('.segbtns').forEach(group=>{
    group.addEventListener('click', e=>{
      const b = e.target.closest('.seg'); if(!b) return;
      group.querySelectorAll('.seg').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      group.dataset.value = b.dataset.v;
    });
  });
}
function getSeg(name){
  const g = document.querySelector(`.segbtns[data-name="${name}"]`);
  return g ? (g.dataset.value||'') : '';
}

/* 行リスト（スタッフ・医療・備蓄・不明者） */
function addStaffRow(v={}){
  const el = document.createElement('div');
  el.className='rowitem row-4';
  el.innerHTML = `
    <input placeholder="氏名" data-k="name" value="${v.name||''}">
    <input placeholder="役割" data-k="role" value="${v.role||''}">
    <input placeholder="連絡先" data-k="contact" value="${v.contact||''}">
    <button type="button" class="del">削除</button>`;
  $('#staffList').appendChild(el);
}
function addMedStaffRow(v={}){
  const el = document.createElement('div');
  el.className='rowitem row-4';
  el.innerHTML = `
    <input placeholder="氏名" data-k="name" value="${v.name||''}">
    <select data-k="job">
      <option value="">職種</option><option>医師</option><option>看護師</option>
      <option>薬剤師</option><option>その他</option></select>
    <input placeholder="所属" data-k="org" value="${v.org||''}">
    <button type="button" class="del">削除</button>`;
  $('#medicalStaffList').appendChild(el);
}
function addSupplyRow(v={}){
  const el = document.createElement('div');
  el.className='rowitem';
  el.innerHTML = `
    <div class="row-4" style="display:grid;gap:8px">
      <input placeholder="品目" data-k="item" value="${v.item||''}">
      <input placeholder="単位" data-k="unit" value="${v.unit||''}">
      <input placeholder="在庫" data-k="qty" inputmode="numeric" value="${v.qty||''}">
      <button type="button" class="del">削除</button>
    </div>
    <select data-k="state">
      <option value="">状態</option><option>充足</option><option>不足</option><option>欠品</option>
    </select>`;
  $('#supplyList').appendChild(el);
}
function addMissingRow(v={}){
  const el = document.createElement('div');
  el.className='rowitem';
  el.innerHTML = `
    <div class="rowhead"><b>安否不明者</b><button type="button" class="del">削除</button></div>
    <div class="row-3" style="display:grid;gap:8px">
      <input placeholder="氏名" data-k="name">
      <input placeholder="年齢" data-k="age" inputmode="numeric">
      <select data-k="sex"><option value="">性別</option><option>男</option><option>女</option><option>その他</option></select>
    </div>
    <div class="row-3" style="display:grid;gap:8px">
      <input placeholder="最終確認地区" data-k="last_area">
      <input placeholder="連絡先" data-k="contact">
      <select data-k="state"><option>捜索中</option><option>確認済</option><option>避難確認</option></select>
    </div>`;
  $('#missingList').appendChild(el);
}
function readRows(listSel){
  return [...document.querySelectorAll(`${listSel} .rowitem`)].map(item=>{
    const o={};
    item.querySelectorAll('[data-k]').forEach(f=> o[f.dataset.k]=f.value);
    return o;
  }).filter(o=> Object.values(o).some(v=> v!==''));
}

/* 削除ボタン */
function bindRowDelete(){
  document.body.addEventListener('click', e=>{
    const d = e.target.closest('.del'); if(!d) return;
    d.closest('.rowitem').remove();
  });
}

/* ============ 値の収集 ============ */
function countVal(name){
  const el = document.querySelector(`.counter[data-name="${name}"] input`);
  return parseInt(el?.value||'0',10)||0;
}
function collectPayload(){
  const district = collectDistricts();
  const age={}; CFG.AGE_BUCKETS.forEach(a=> age[a]=countVal('age_'+a));
  const disability={}; CFG.DISABILITY_TYPES.forEach(d=> disability[d]=countVal('disability_'+d));

  return {
    submission_id: uuid(),
    timestamp: new Date().toISOString(),
    token: CFG.TOKEN,
    shelter_id: $('#shelter_id').value.trim(),
    shelter_name: $('#shelter_name').value.trim(),
    reporter: $('#reporter').value.trim(),
    status:{
      power:getSeg('power'), water:getSeg('water'),
      gas:getSeg('gas'), internet:getSeg('internet'),
      temperature_c:$('#temperature_c').value, humidity_pct:$('#humidity_pct').value,
      infection_measures:$('#infection_measures').value
    },
    evacuees:{
      age, sex:{male:countVal('sex_male'),female:countVal('sex_female'),other:countVal('sex_other')},
      district, disability,
      chronic_yes:$('#chronic_yes').value, chronic_note:$('#chronic_note').value,
      pregnant:countVal('pregnant'), postpartum:countVal('postpartum'),
      infant_households:countVal('infant_households'),
      pet:{households:countVal('pet_households'),dogs:countVal('pet_dogs'),
           cats:countVal('pet_cats'),others:countVal('pet_others')}
    },
    medical:{
      present:$('#medical_present').value, org:$('#medical_org').value,
      injured_count:$('#injured_count').value, staff:readRows('#medicalStaffList')
    },
    staff:readRows('#staffList'),
    supplies:readRows('#supplyList'),
    missing:readRows('#missingList'),
    operation:{
      wake_time:$('#wake_time').value, sleep_time:$('#sleep_time').value,
      orientation_done:$('#orientation_done').value, orientation_time:$('#orientation_time').value
    },
    notes:$('#notes').value
  };
}

/* ============ 報告内容の出力（共有・コピー・印刷・PDF） ============ */
function reportPlainText(){
  var p = collectPayload();
  var L = [];
  L.push('■避難所運営 報告');
  L.push('避難所：'+(p.shelter_id?('['+p.shelter_id+'] '):'')+(p.shelter_name||'（未選択）'));
  L.push('入力者：'+(p.reporter||'—')+' ／ '+new Date().toLocaleString('ja-JP'));
  L.push('');
  L.push('【ライフライン】電気:'+(p.status.power||'—')+' 水:'+(p.status.water||'—')+' ガス:'+(p.status.gas||'—')+' ネット:'+(p.status.internet||'—'));
  L.push('気温:'+(p.status.temperature_c||'—')+'℃ 湿度:'+(p.status.humidity_pct||'—')+'% 感染対策:'+(p.status.infection_measures||'—'));
  L.push('');
  var age=p.evacuees.age||{}; var ageStr=Object.keys(age).filter(function(k){return age[k]>0;}).map(function(k){return k+':'+age[k];}).join(' ');
  var total=Object.keys(age).reduce(function(s,k){return s+(age[k]||0);},0);
  L.push('【避難者】計'+total+'人');
  if(ageStr) L.push('年代 '+ageStr);
  L.push('性別 男'+p.evacuees.sex.male+' 女'+p.evacuees.sex.female+' その他'+p.evacuees.sex.other);
  var dist=p.evacuees.district||{}; var dk=Object.keys(dist);
  if(dk.length){ L.push('自治会別 '+dk.map(function(k){return k+':'+dist[k];}).join(' ')); }
  L.push('');
  L.push('【要配慮者】妊婦'+p.evacuees.pregnant+' 産婦'+p.evacuees.postpartum+' 乳幼児連れ世帯'+p.evacuees.infant_households);
  var dis=p.evacuees.disability||{}; var disStr=Object.keys(dis).filter(function(k){return dis[k]>0;}).map(function(k){return k+':'+dis[k];}).join(' ');
  if(disStr) L.push('障害 '+disStr);
  L.push('');
  L.push('【ペット】同伴世帯'+p.evacuees.pet.households+' 犬'+p.evacuees.pet.dogs+' 猫'+p.evacuees.pet.cats+' その他'+p.evacuees.pet.others);
  L.push('【医療】医療者:'+(p.medical.present||'—')+' 機関:'+(p.medical.org||'—')+' けが人:'+(p.medical.injured_count||0));
  if(p.notes){ L.push(''); L.push('【特記】'+p.notes); }
  return L.join('\n');
}
function shareReport(){
  var text = reportPlainText();
  if(navigator.share){ navigator.share({title:'避難所運営 報告', text:text}).catch(function(){}); }
  else{ copyReport(); toast('共有用にコピーしました','info'); }
}
function copyReport(){
  var text = reportPlainText();
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){ toast('コピーしました','ok'); }, function(){ toolFallbackCopy(text); });
  }else{ toolFallbackCopy(text); }
}
function toolFallbackCopy(text){
  var ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); toast('コピーしました','ok'); }catch(e){ toast('コピーに失敗しました','err'); }
  document.body.removeChild(ta);
}
function printReport(){ window.print(); }
function pdfReport(){
  toast('印刷ダイアログで「PDFに保存」を選ぶとPDF化できます','info',3200);
  setTimeout(function(){ window.print(); }, 300);
}

/* ============ 送信 & オフライン処理 ============ */
async function postToHost(payload){
  const res = await fetch(CFG.GAS_URL, {
    method:'POST',
    // GASのCORS制約回避のため text/plain で送る（GAS側はJSON.parseで受ける）
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify(payload)
  });
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}

async function trySend(payload){
  // まずoutboxに退避（pending）
  await idbPut({...payload, _status:'pending', _saved:Date.now()});
  await refreshPending();

  if(!navigator.onLine){
    toast('圏外のため保存しました。電波が戻ると自動送信します', 'info');
    return;
  }
  try{
    const r = await postToHost(payload);
    if(r && r.ok){
      await idbDelete(payload.submission_id);
      await refreshPending();
      toast('送信しました', 'ok');
    }else{
      throw new Error(r && r.error || '送信失敗');
    }
  }catch(err){
    toast('送信できませんでした。保存済みなので後で自動再送します', 'err');
  }
}

async function flushOutbox(){
  if(!navigator.onLine || !db) return;
  const items = await idbAll();
  const pend = items.filter(x=> x._status==='pending');
  for(const it of pend){
    try{
      const {_status,_saved, ...payload} = it;
      const r = await postToHost(payload);
      if(r && r.ok){ await idbDelete(it.submission_id); }
    }catch(e){ /* 次回に持ち越し */ break; }
  }
  await refreshPending();
}

async function refreshPending(){
  const items = db ? await idbAll() : [];
  const n = items.filter(x=> x._status==='pending').length;
  const bar = $('#pendingBar');
  $('#pendingCount').textContent = n;
  bar.hidden = n===0;
}

/* ネット状態表示 */
function updateNetBadge(){
  const b = $('#netBadge');
  if(navigator.onLine){ b.textContent='オンライン'; b.className='net-badge net-online'; }
  else{ b.textContent='オフライン'; b.className='net-badge net-offline'; }
}

/* 下書き（localStorage） */
function saveDraft(){
  localStorage.setItem('shelter_draft', JSON.stringify(collectPayload()));
  toast('下書きを保存しました', 'info');
}

/* ============ 初期化 ============ */
/* テーマ（ダーク/ライト）切替。選択はlocalStorageに保存し次回も維持 */
function applyTheme(theme){
  const btn = document.getElementById('themeToggle');
  if(theme==='light'){
    document.documentElement.setAttribute('data-theme','light');
    if(btn) btn.textContent = '☀️ ライト';
  }else{
    document.documentElement.removeAttribute('data-theme');
    if(btn) btn.textContent = '🌙 ダーク';
  }
}
function initTheme(){
  let saved = 'dark';
  try{ saved = localStorage.getItem('shelter_theme') || 'dark'; }catch(e){}
  applyTheme(saved);
  const btn = document.getElementById('themeToggle');
  if(btn){
    btn.onclick = ()=>{
      const now = document.documentElement.getAttribute('data-theme')==='light' ? 'light':'dark';
      const next = now==='light' ? 'dark':'light';
      applyTheme(next);
      try{ localStorage.setItem('shelter_theme', next); }catch(e){}
    };
  }
}

async function init(){
  initTheme();
  showGateIfNeeded();  // 未ログインならログイン画面を表示
  // 設定・日誌ボタン
  var sb=document.getElementById('settingsBtn'); if(sb) sb.onclick=openSettings;
  var lb=document.getElementById('logBtn'); if(lb) lb.onclick=openLog;
  var shb=document.getElementById('shareBtn'); if(shb) shb.onclick=shareReport;
  var cpb=document.getElementById('copyBtn'); if(cpb) cpb.onclick=copyReport;
  var prb=document.getElementById('printBtn'); if(prb) prb.onclick=printReport;
  var pdb=document.getElementById('pdfBtn'); if(pdb) pdb.onclick=pdfReport;
  // モーダル背景クリックで閉じる
  var sm=document.getElementById('settingsModal'); if(sm) sm.addEventListener('click',function(e){ if(e.target===sm) closeSettings(); });
  var lm=document.getElementById('logModal'); if(lm) lm.addEventListener('click',function(e){ if(e.target===lm) closeLog(); });
  // Escキーでモーダルを閉じる
  document.addEventListener('keydown', function(e){
    if(e.key==='Escape'){ closeSettings(); closeLog(); }
  });
  // 連絡チャットボタン：GAS配信のチャットページを新しいタブで開く
  const chatBtn = document.getElementById('chatBtn');
  if(chatBtn){
    chatBtn.onclick = ()=>{
      const base = (CFG.GAS_URL||'').split('?')[0];
      if(!base){ alert('チャットのURLが設定されていません'); return; }
      window.open(base + '?page=chat', '_blank');
    };
  }
  buildDynamicGrids();
  buildShelterSelect();
  buildDistrictSelect();
  bindSteppers();
  bindSegments();
  bindRowDelete();
  updateAgeTotal();

  // 初期テンプレ
  CFG.SUPPLY_TEMPLATE.forEach(t=> addSupplyRow(t));
  addStaffRow();

  // ボタン
  $('#addStaff').onclick = ()=> addStaffRow();
  $('#addMedStaff').onclick = ()=> addMedStaffRow();
  $('#addSupply').onclick = ()=> addSupplyRow();
  $('#addMissing').onclick = ()=> addMissingRow();
  $('#addDistrict').onclick = ()=>{
    addDistrictEntry($('#districtSelect').value, $('#districtQty').value);
    $('#districtSelect').value = ''; $('#districtQty').value = 1;
  };
  // 自治会行の削除時に合計を再計算
  $('#districtList').addEventListener('click', e=>{
    if(e.target.closest('.del')) setTimeout(updateDistrictTotal, 0);
  });
  $('#saveDraft').onclick = saveDraft;
  $('#submitBtn').onclick = async ()=>{
    const p = collectPayload();
    if(!p.shelter_name){ toast('避難所を選んでください','err'); return; }
    await trySend(p);
  };
  $('#retryBtn').onclick = flushOutbox;

  // 報告日時表示
  const now = new Date();
  $('#timestamp_display').value = now.toLocaleString('ja-JP');

  // ネット監視
  updateNetBadge();
  window.addEventListener('online', ()=>{ updateNetBadge(); flushOutbox(); });
  window.addEventListener('offline', updateNetBadge);

  await openDB();
  await refreshPending();
  await flushOutbox();
  // 定期的に未送信を再送
  setInterval(flushOutbox, 30000);
  // 入力内容を定期的に端末に自動保存（自動復元ON時）
  setInterval(autoSaveInput, 5000);
}

document.addEventListener('DOMContentLoaded', init);
