/* WFL SONAR app bindings — replaces legacy generator/backtest actions. */
(function(){
  "use strict";
  const $ = id => document.getElementById(id);
  function history(){
    try {
      const raw=localStorage.getItem("wlf_sonar_draws");
      return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
  }
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function bind(){
    if(!window.WFLSonarEngine) return;
    const engine=window.WFLSonarEngine;
    const gen=$("generateBtn");
    if(gen) gen.onclick=function(){
      const h=history();
      const result=engine.makeCombination(h,{
        window:Number($("sonarWindow")?.value||50),
        pool:Number($("sonarPool")?.value||14),
        recentWeight:Number($("sonarRecent")?.value||0.35),
        delayWeight:Number($("sonarDelay")?.value||0.15),
        transitionWeight:Number($("sonarTransition")?.value||0.15),
        pairWeight:Number($("sonarPair")?.value||0.1)
      });
      if(result.error){alert(result.error);return;}
      $("combination").textContent=result.numbers.join(" – ");
      $("numeroneOut").textContent=result.numerone;
      const rank=new Map(result.mainScores.map((x,i)=>[x.number,{rank:i+1,...x}]));
      $("dettaglioContainer").innerHTML='<p class="small">'+esc(result.note)+'</p><table><tr><th>Numero</th><th>Rank modello</th><th>Score</th><th>Freq. 50/100</th><th>Ritardo</th></tr>'+
        result.numbers.map(n=>{const r=rank.get(n);return '<tr><td><strong>'+n+'</strong></td><td>'+r.rank+'</td><td>'+r.score.toFixed(3)+'</td><td>'+r.recentFreq+'/'+r.longFreq+'</td><td>'+r.delay+'</td></tr>';}).join('')+'</table>'+
        '<p class="small">Pool: '+esc($("sonarPool").value)+' numeri · Numerone analizzato separatamente.</p>';
      $("suggestedWeights").textContent="Nuovo motore SONAR attivo: scoring multi-finestra, ritardi, transizioni e co-occorrenze.";
    };
    const bt=$("runBacktestBtn");
    if(bt) bt.onclick=function(){
      const h=history();
      const result=engine.backtest(h,{train:Number($("trainSize").value||100),test:Number($("testSize").value||100),window:Number($("sonarWindow")?.value||50),pool:Number($("sonarPool")?.value||14)});
      if(result.error){$("backtestLog").textContent=result.error+" Storico valido: "+result.validHistory;return;}
      $("backtestLog").innerHTML='<div class="diagnostic-grid">'+
        '<div class="diagnostic-item"><strong>Media hit principali</strong><p style="font-size:1.6rem">'+result.meanHits.toFixed(3)+'/10</p><span class="small">Riferimento casuale: 5,000/10</span></div>'+
        '<div class="diagnostic-item"><strong>Numerone</strong><p style="font-size:1.6rem">'+(100*result.numeroneRate).toFixed(2)+'%</p><span class="small">Riferimento casuale: 5,00%</span></div>'+
        '<div class="diagnostic-item"><strong>Differenza dal riferimento</strong><p style="font-size:1.4rem">'+(result.hitDelta>=0?"+":"")+result.hitDelta.toFixed(3)+'</p><span class="small">Z approssimato: '+result.approximateZ.toFixed(2)+'</span></div>'+
        '<div class="diagnostic-item"><strong>Campione</strong><p style="font-size:1.4rem">'+result.test+' estrazioni</p><span class="small">Storico valido: '+result.validHistory+'</span></div></div>'+
        '<p class="small">'+esc(result.method)+'. '+esc(result.caution)+'</p>';
    };
    const diagnostics=$("sonarRunDiagnostics");
    if(diagnostics) diagnostics.onclick=function(){
      const out=engine.diagnostics(history());
      $("sonarDiagnostics").innerHTML=out.map(w=>'<div class="diagnostic-item"><strong>Ultime '+w.window+'</strong><p>Estrazioni disponibili: '+w.draws+'</p><p>Media somme: '+w.sumMean.toFixed(2)+'</p><p class="small">Atteso teorico per numero: '+w.expectedPerNumber.toFixed(2)+'</p><p>'+w.frequencies.slice().sort((a,b)=>b.delta-a.delta).slice(0,5).map(x=>x.number+' ('+(x.delta>=0?"+":"")+x.delta+')').join(' · ')+'</p></div>').join('');
    };
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",bind); else bind();
})();