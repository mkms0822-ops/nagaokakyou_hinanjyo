/* 避難所運営管理ツール — フロント本体（試作版 v0.1）
   - 動的フォーム生成
   - ステッパー／セグメントUI
   - IndexedDBによるオフライン退避 & 自動再送信 */

const CFG = window.APP_CONFIG;

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
}

document.addEventListener('DOMContentLoaded', init);
