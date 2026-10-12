/* WFL SONAR Lab UI: lossless history merge, import/export and automatic diagnostics. */
(function(){
"use strict";
const DATA_URL='winforlife_draws.json';
const CACHE_KEY='wfl_sonar_history_v2';
const WINDOW_KEY='wfl_sonar_window';
const $=id=>document.getElementById(id);
let draws=[], selectedWindow=localStorage.getItem(WINDOW_KEY)||'50';
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid=d=>d&&Number.isInteger(Number(d.numero))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.datetime||'')&&Array.isArray(d.numbers)&&d.numbers.length===10&&d.numbers.every(n=>Number.isInteger(Number(n))&&n>=1&&n<=20)&&new Set(d.numbers.map(Number)).size===10&&Number.isInteger(Number(d.numerone))&&Number(d.numerone)>=1&&Number(d.numerone)<=20;
const normalize=d=>({datetime:String(d.datetime),numbers:d.numbers.map(Number).sort((a,b)=>a-b),numerone:Number(d.numerone),numero:Number(d.numero)});
function merge(...sources){const map=new Map(),conflicts=[];for(const source of sources){for(const raw of Array.isArray(source)?source:[]){if(!valid(raw))continue;const d=normalize(raw),old=map.get(d.numero);if(!old)map.set(d.numero,d);else if(old.datetime!==d.datetime||old.numerone!==d.numerone||old.numbers.join(',')!==d.numbers.join(','))conflicts.push(d.numero);}}return {draws:[...map.values()].sort((a,b)=>a.datetime.localeCompare(b.datetime)||a.numero-b.numero),conflicts:[...new Set(conflicts)]};}
function save(){try{localStorage.setItem(CACHE_KEY,JSON.stringify(draws));}catch(e){setStatus('Impossibile salvare la cache locale: esporta una copia dello storico.','error');}}
function setStatus(msg,type){const el=$('dataStatus');if(el){el.textContent=msg;el.className='wfl-statusline '+(type==='error'?'wfl-error':type==='success'?'wfl-success':'');}}
function render(){
 const validDraws=draws.filter(valid);
 if($('systemStatus'))$('systemStatus').textContent=validDraws.length+' record validi';
 if($('drawCount'))$('drawCount').textContent=validDraws.length.toLocaleString('it-IT')+' estrazioni';
 if($('historyRange'))$('historyRange').textContent=validDraws.length?validDraws[0].datetime.slice(0,10)+' → '+validDraws.at(-1).datetime.slice(0,10):'Archivio vuoto';
 const nums=validDraws.flatMap(d=>d.numbers), sums=validDraws.map(d=>d.numbers.reduce((a,b)=>a+b,0)), mean=sums.length?sums.reduce((a,b)=>a+b,0)/sums.length:0;
 const ids=[...new Set(validDraws.map(d=>Number(d.numero)).filter(Number.isFinite))].sort((a,b)=>a-b);
 const missingDraws=ids.length?Math.max(0,ids[ids.length-1]-ids[0]+1-ids.length):0;
 const topNum=Array.from({length:20},(_,i)=>({n:i+1,c:nums.filter(n=>n===i+1).length})).sort((a,b)=>b.c-a.c)[0];
 const nFreq=Array.from({length:20},(_,i)=>({n:i+1,c:validDraws.filter(d=>d.numerone===i+1).length})).sort((a,b)=>b.c-a.c)[0];
 $('wflOverview').innerHTML=[
 ['Storico valido',validDraws.length.toLocaleString('it-IT'),'Record unici per concorso'],
 ['Intervallo coperto',validDraws.length?validDraws[0].datetime.slice(0,10)+' – '+validDraws.at(-1).datetime.slice(0,10):'—','Estremi temporali dei record presenti'],
 ['Concorsi mancanti',missingDraws.toLocaleString('it-IT'),missingDraws?'Backfill storico ancora necessario':'Nessun buco negli ID del campione'],
 ['Numero più frequente',topNum?topNum.n:'—',topNum?topNum.c+' occorrenze nella decina':''],
 ['Somma media',mean.toLocaleString('it-IT',{maximumFractionDigits:2}),'Sui dieci numeri principali']
 ].map(x=>'<div class="wfl-metric"><span>'+x[0]+'</span><strong>'+x[1]+'</strong><small>'+x[2]+'</small></div>').join('');
 if(window.WFLSonarDashboard)window.WFLSonarDashboard.render(validDraws,selectedWindow);
 renderRecent(validDraws);
 renderResearch(validDraws);
}
function renderRecent(ds){$('recentHistory').innerHTML='<table class="wfl-table"><thead><tr><th>Concorso</th><th>Data/ora</th><th>Dieci numeri</th><th>Numerone</th></tr></thead><tbody>'+ds.slice(-25).reverse().map(d=>'<tr><td>'+esc(d.numero)+'</td><td>'+esc(d.datetime.replace('T',' '))+'</td><td>'+d.numbers.join(' · ')+'</td><td><strong>'+d.numerone+'</strong></td></tr>').join('')+'</tbody></table>';}
function rankFreq(hist,key){const f=Array(20).fill(0);hist.forEach(d=>(key==='numerone'?[d.numerone]:d.numbers).forEach(n=>f[Number(n)-1]++));return f.map((v,i)=>({n:i+1,v})).sort((a,b)=>b.v-a.v||a.n-b.n);}
function research(ds){
 const minTrain=100, steps=Math.min(200,Math.max(0,ds.length-minTrain));if(steps<20)return {ready:false,steps,reason:'Per un primo test stabile servono almeno 100 estrazioni di training e 20 target successivi.'};
 const start=ds.length-steps;let hits=0,nh=0,randomHits=0,hitDist=Array(11).fill(0),numHits=0;
 for(let t=start;t<ds.length;t++){const past=ds.slice(0,t),actual=ds[t];const main=rankFreq(past,'main').slice(0,10).map(x=>x.n),num=rankFreq(past,'numerone')[0].n;const h=main.filter(n=>actual.numbers.includes(n)).length;hits+=h;hitDist[h]++;if(num===actual.numerone)numHits++;randomHits+=5;}
 return {ready:true,steps,train:start,meanHits:hits/steps,expected:randomHits/steps,delta:hits/steps-5,hitDist,numeroneRate:numHits/steps,numHits};
}
function renderResearch(ds){
 const r=research(ds);$('researchStatus').textContent=r.ready?'Test automatico aggiornato':'Storico insufficiente';
 if(!r.ready){$('researchPanel').innerHTML='<article class="wfl-card"><h3>Walk-forward</h3><p>'+esc(r.reason)+'</p><p class="sub">Lo storico completo viene prima di tutto; nessuna strategia è promossa automaticamente in assenza di campione sufficiente.</p></article>';return;}
 $('researchPanel').innerHTML='<article class="wfl-card"><h3>Baseline frequenze globali</h3><p class="sub">Per ogni target vengono usate solo estrazioni precedenti; si selezionano i 10 numeri più frequenti.</p><div class="wfl-metrics"><div class="wfl-metric"><span>Hit medi osservati</span><strong>'+r.meanHits.toFixed(3)+'/10</strong><small>Benchmark teorico: 5,000</small></div><div class="wfl-metric"><span>Scarto dal benchmark</span><strong>'+(r.delta>=0?'+':'')+r.delta.toFixed(3)+'</strong><small>Descrittivo, non prova di vantaggio</small></div></div></article>'+
 '<article class="wfl-card"><h3>Numerone · baseline indipendente</h3><div class="wfl-metric"><span>Hit osservati</span><strong>'+(100*r.numeroneRate).toFixed(2)+'%</strong><small>Benchmark teorico: 5,00% · '+r.numHits+'/'+r.steps+' target</small></div><p class="sub">Il Numerone non viene mescolato con i dieci numeri principali.</p></article>'+
 '<article class="wfl-card"><h3>Distribuzione hit per estrazione</h3><p class="sub">Campione walk-forward: '+r.steps+' target, training iniziale '+r.train+' estrazioni.</p><div style="display:grid;grid-template-columns:repeat(11,minmax(12px,1fr));gap:4px;align-items:end;height:100px">'+r.hitDist.map((v,i)=>'<div title="'+i+' hit: '+v+'" style="height:100%;display:flex;flex-direction:column;justify-content:end;align-items:center;gap:3px"><small>'+v+'</small><div style="width:100%;height:'+Math.max(2,v/Math.max(1,...r.hitDist)*70)+'px;background:#20b6aa;border-radius:3px 3px 0 0"></div><small>'+i+'</small></div>').join('')+'</div><p class="sub">Baseline semplice; verrà confrontata con strategie alternative e controllo casuale nel registro automatico.</p></article>'+
 '<article class="wfl-card"><h3>Regola di promozione</h3><p>Nessun aggiustamento automatico dei pesi manuali. I candidati devono superare il benchmark in test fuori campione ripetuti, con risultati registrati e nessuna selezione retrospettiva della finestra migliore.</p><p class="sub">Questo pannello ricalcola i risultati a ogni caricamento; il registro persistente e la validazione programmata verranno gestiti dalla pipeline GitHub.</p></article>';
}
async function refresh(){
 $('systemStatus').textContent='Aggiornamento archivio…';
 try{const res=await fetch(DATA_URL+'?v='+Date.now(),{cache:'no-store'});if(!res.ok)throw new Error('HTTP '+res.status);const remote=await res.json();if(!Array.isArray(remote)||!remote.length)throw new Error('Archivio remoto vuoto o non valido');const merged=merge(draws,remote);if(merged.conflicts.length){setStatus('ATTENZIONE: conflitti nei concorsi '+merged.conflicts.join(', ')+'. Nessun record è stato sovrascritto; verifica il file sorgente.','error');}const before=draws.length;draws=merged.draws;save();render();setStatus('Archivio unito senza cancellazioni: '+before+' → '+draws.length+' record. Dati remoti: '+remote.length+'.','success');$('systemStatus').textContent='Archivio aggiornato';}catch(e){render();setStatus('Impossibile aggiornare dal server ('+e.message+'). Mostro la copia locale disponibile; esportala se devi fare un backup.','error');$('systemStatus').textContent='Modalità locale';}
}
function download(){const blob=new Blob([JSON.stringify(draws,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='wfl-sonar-history-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(url);}
async function importFile(file){try{const raw=JSON.parse(await file.text());if(!Array.isArray(raw))throw new Error('Il file deve contenere un array JSON.');const good=raw.filter(valid);if(!good.length)throw new Error('Nessuna estrazione valida trovata.');const merged=merge(draws,good);if(merged.conflicts.length)throw new Error('Conflitti sui concorsi '+merged.conflicts.join(', ')+'. Import annullato per evitare perdita dati.');const before=draws.length;draws=merged.draws;save();render();setStatus('Importazione completata senza sovrascrivere record: '+before+' → '+draws.length+'.','success');}catch(e){setStatus('Import non completato: '+e.message,'error');}}
function init(){
 $('refreshData').addEventListener('click',refresh);$('exportData').addEventListener('click',download);$('runAnalysis').addEventListener('click',render);$('importData').addEventListener('change',e=>{if(e.target.files[0])importFile(e.target.files[0]);e.target.value='';});
 $('windowPicker').addEventListener('click',e=>{const b=e.target.closest('button[data-window]');if(!b)return;selectedWindow=b.dataset.window;localStorage.setItem(WINDOW_KEY,selectedWindow);$('windowPicker').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();});
 try{const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'[]');draws=merge(cached).draws;}catch(e){draws=[];}
 // Merge the older app cache too, without deleting records held in it.
 try{const legacy=JSON.parse(localStorage.getItem('wlf_sonar_draws')||'[]');draws=merge(draws,legacy).draws;}catch(e){}
 render();refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();