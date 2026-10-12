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
function merge(...sources){const map=new Map(),conflicts=[];for(const source of sources){for(const raw of Array.isArray(source)?source:[]){if(!valid(raw))continue;const d=normalize(raw),id=String(d.datetime).slice(0,4)+':'+d.numero,old=map.get(id);if(!old)map.set(id,d);else if(old.datetime!==d.datetime||old.numerone!==d.numerone||old.numbers.join(',')!==d.numbers.join(','))conflicts.push(id);}}return {draws:[...map.values()].sort((a,b)=>a.datetime.localeCompare(b.datetime)||a.numero-b.numero),conflicts:[...new Set(conflicts)]};}
function save(){try{localStorage.setItem(CACHE_KEY,JSON.stringify(draws));}catch(e){setStatus('Impossibile salvare la cache locale: esporta una copia dello storico.','error');}}
function setStatus(msg,type){const el=$('dataStatus');if(el){el.textContent=msg;el.className='wfl-statusline '+(type==='error'?'wfl-error':type==='success'?'wfl-success':'');}}
function render(){
 const validDraws=draws.filter(valid);
 if($('systemStatus'))$('systemStatus').textContent=validDraws.length+' record validi';
 if($('drawCount'))$('drawCount').textContent=validDraws.length.toLocaleString('it-IT')+' estrazioni';
 if($('historyRange'))$('historyRange').textContent=validDraws.length?validDraws[0].datetime.slice(0,10)+' → '+validDraws.at(-1).datetime.slice(0,10):'Archivio vuoto';
 const nums=validDraws.flatMap(d=>d.numbers), sums=validDraws.map(d=>d.numbers.reduce((a,b)=>a+b,0)), mean=sums.length?sums.reduce((a,b)=>a+b,0)/sums.length:0;
 const idsByYear=new Map();validDraws.forEach(d=>{const y=String(d.datetime).slice(0,4);if(!idsByYear.has(y))idsByYear.set(y,new Set());idsByYear.get(y).add(Number(d.numero));});
 const missingDraws=[...idsByYear.values()].reduce((sum,set)=>{const maxId=Math.max(0,...set);return sum+Math.max(0,maxId-set.size);},0);
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
 renderGenerator();
}
function renderRecent(ds){$('recentHistory').innerHTML='<table class="wfl-table"><thead><tr><th>Concorso</th><th>Data/ora</th><th>Dieci numeri</th><th>Numerone</th></tr></thead><tbody>'+ds.slice(-25).reverse().map(d=>'<tr><td>'+esc(d.numero)+'</td><td>'+esc(d.datetime.replace('T',' '))+'</td><td>'+d.numbers.join(' · ')+'</td><td><strong>'+d.numerone+'</strong></td></tr>').join('')+'</tbody></table>';}
function rankFreq(hist,key){const f=Array(20).fill(0);hist.forEach(d=>(key==='numerone'?[d.numerone]:d.numbers).forEach(n=>f[Number(n)-1]++));return f.map((v,i)=>({n:i+1,v})).sort((a,b)=>b.v-a.v||a.n-b.n);}
function research(ds){
 const minTrain=100, steps=Math.min(200,Math.max(0,ds.length-minTrain));if(steps<20)return {ready:false,steps,reason:'Per un primo test stabile servono almeno 100 estrazioni di training e 20 target successivi.'};
 const start=ds.length-steps;let hits=0,nh=0,randomHits=0,hitDist=Array(11).fill(0),numHits=0;
 for(let t=start;t<ds.length;t++){const past=ds.slice(0,t),actual=ds[t];const main=rankFreq(past,'main').slice(0,10).map(x=>x.n),num=rankFreq(past,'numerone')[0].n;const h=main.filter(n=>actual.numbers.includes(n)).length;hits+=h;hitDist[h]++;if(num===actual.numerone)numHits++;randomHits+=5;}
 return {ready:true,steps,train:start,meanHits:hits/steps,expected:randomHits/steps,delta:hits/steps-5,hitDist,numeroneRate:numHits/steps,numHits};
}
function renderGenerator(){const out=$('generatorResult');if(!out)return;if(!window.WFLSonarEngine||draws.length<10){out.innerHTML='<p class="wfl-note">Servono almeno 10 estrazioni valide.</p>';return;}const w=Number($('generatorWindow')?.value||50),pool=Number($('generatorPool')?.value||14);const pred=window.WFLSonarEngine.makeCombination(draws,{window:w,pool});if(pred.error){out.innerHTML='<p class="wfl-error">'+esc(pred.error)+'</p>';return;}out.innerHTML='<p class="wfl-note">Calcolata su '+draws.length+' estrazioni · finestra '+w+' · pool '+pool+'.</p><h3>Decina proposta</h3><div class="wfl-proposed-numbers">'+pred.numbers.map(n=>'<span class="wfl-ball">'+n+'</span>').join('')+'</div><h3>Numerone separato</h3><div class="wfl-proposed-numbers"><span class="wfl-ball gold">'+pred.numerone+'</span></div><p class="wfl-note">'+esc(pred.note||'Punteggi esplorativi, senza garanzia predittiva.')+'</p>';out.dataset.proposal=pred.numbers.join(' ')+' | Numerone '+pred.numerone;}
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
 try{const res=await fetch(DATA_URL+'?v='+Date.now(),{cache:'no-store'});if(!res.ok)throw new Error('HTTP '+res.status);const remote=await res.json();if(!Array.isArray(remote)||!remote.length)throw new Error('Archivio remoto vuoto o non valido');const merged=merge(draws,remote);if(merged.conflicts.length){setStatus('ATTENZIONE: conflitti nei concorsi '+merged.conflicts.join(', ')+'. Nessun record è stato sovrascritto; verifica il file sorgente.','error');}const before=draws.length;draws=merged.draws;save();render();const latest=draws.at(-1);const latestLabel=latest?latest.datetime.replace('T',' '):'non disponibile';setStatus('Sincronizzazione '+new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+' · ultima estrazione disponibile: '+latestLabel+' · archivio '+before+' → '+draws.length+' record.','success');$('systemStatus').textContent='Sincronizzato · ultima '+latestLabel;}catch(e){render();setStatus('Impossibile aggiornare dal server ('+e.message+'). Mostro la copia locale disponibile; esportala se devi fare un backup.','error');$('systemStatus').textContent='Modalità locale';}
}
function download(){const blob=new Blob([JSON.stringify(draws,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='wfl-sonar-history-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(url);}
async function importFile(file){try{const raw=JSON.parse(await file.text());if(!Array.isArray(raw))throw new Error('Il file deve contenere un array JSON.');const good=raw.filter(valid);if(!good.length)throw new Error('Nessuna estrazione valida trovata.');const merged=merge(draws,good);if(merged.conflicts.length)throw new Error('Conflitti sui concorsi '+merged.conflicts.join(', ')+'. Import annullato per evitare perdita dati.');const before=draws.length;draws=merged.draws;save();render();setStatus('Importazione completata senza sovrascrivere record: '+before+' → '+draws.length+'.','success');}catch(e){setStatus('Import non completato: '+e.message,'error');}}
function init(){
 document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{const tab=b.dataset.tab;document.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==tab);try{localStorage.setItem('wfl_sonar_active_tab',tab);}catch(e){} }));
 try{const active=localStorage.getItem('wfl_sonar_active_tab');if(active){const b=document.querySelector('[data-tab="'+active+'"]');if(b)b.click();}}catch(e){}
 $('generateNumbers').addEventListener('click',renderGenerator);$('generatorWindow').addEventListener('change',renderGenerator);$('generatorPool').addEventListener('change',renderGenerator);$('copyProposal').addEventListener('click',()=>{const t=$('generatorResult')?.dataset.proposal;if(t&&navigator.clipboard?.writeText)navigator.clipboard.writeText(t).then(()=>setStatus('Proposta copiata.','success')).catch(()=>setStatus('Copia non riuscita.','error'));});
 $('refreshData').addEventListener('click',refresh);$('exportData').addEventListener('click',download);$('runAnalysis').addEventListener('click',render);$('importData').addEventListener('change',e=>{if(e.target.files[0])importFile(e.target.files[0]);e.target.value='';});
 $('windowPicker').addEventListener('click',e=>{const b=e.target.closest('button[data-window]');if(!b)return;selectedWindow=b.dataset.window;localStorage.setItem(WINDOW_KEY,selectedWindow);$('windowPicker').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();});
 try{const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'[]');draws=merge(cached).draws;}catch(e){draws=[];}
 // Merge the older app cache too, without deleting records held in it.
 try{const legacy=JSON.parse(localStorage.getItem('wlf_sonar_draws')||'[]');draws=merge(draws,legacy).draws;}catch(e){}
 render();refresh();
 // Recheck the published archive automatically while the dashboard stays open.
 window.setInterval(()=>{if(document.visibilityState==='visible')refresh();},5*60*1000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();