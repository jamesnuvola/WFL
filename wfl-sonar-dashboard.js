/* WFL SONAR — dashboard statistica indipendente dal generatore.
 * Riceve lo storico WFL già caricato dall'app; non scarica né importa dati esterni.
 */
(function () {
  "use strict";
  const WINDOWS = [10, 20, 50, 100];
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const validDraw = d => d && Array.isArray(d.numbers) && d.numbers.length === 10 &&
    d.numbers.every(n => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= 20);
  const fmt = n => Number.isFinite(n) ? n.toLocaleString("it-IT", {maximumFractionDigits: 2}) : "—";
  const sum = d => d.numbers.reduce((a, n) => a + Number(n), 0);
  const freqFor = hist => {
    const freq = Array(20).fill(0);
    hist.forEach(d => d.numbers.forEach(n => freq[Number(n) - 1]++));
    return freq;
  };
  function barChart(freq, nDraws) {
    const max = Math.max(1, ...freq);
    const theoretical = nDraws * 10 / 20;
    return '<div class="wfl-chart-scroll"><div class="wfl-bars" role="img" aria-label="Frequenze dei numeri da 1 a 20">' +
      freq.map((v, i) => '<div class="wfl-bar-col" title="Numero ' + (i+1) + ': ' + v + ' occorrenze">' +
        '<span class="wfl-bar-value">' + v + '</span><div class="wfl-bar-track"><span class="wfl-bar-fill" style="height:' +
        (v / max * 100).toFixed(2) + '%"></span><span class="wfl-bar-expected" style="bottom:' +
        (theoretical / max * 100).toFixed(2) + '%"></span></div><span class="wfl-bar-label">' + (i+1) + '</span></div>').join("") +
      '</div></div><p class="wfl-chart-note">Linea oro: frequenza teorica media (' + fmt(theoretical) +
      ' occorrenze per numero). È un riferimento descrittivo, non una previsione.</p>';
  }
  function trendChart(hist) {
    const rows = hist.slice(-60).map((d, i) => ({d, originalIndex: Math.max(0, hist.length - Math.min(60, hist.length)) + i, value: sum(d)}));
    if (!rows.length) return '<p class="wfl-empty">Nessuna estrazione disponibile.</p>';
    const values = rows.map(x => x.value);
    const avg = values.reduce((a,b)=>a+b,0) / values.length;
    const min = Math.min(...values), max = Math.max(...values), range = Math.max(1, max-min);
    const w=720, h=190, pad=18;
    const pts=values.map((v,i)=> {
      const x=pad + (values.length === 1 ? 0 : i*(w-2*pad)/(values.length-1));
      const y=h-pad-(v-min)/range*(h-2*pad);
      return x.toFixed(1)+","+y.toFixed(1);
    }).join(" ");
    const avgY=(h-pad-(avg-min)/range*(h-2*pad)).toFixed(1);
    return '<div class="wfl-svg-wrap"><svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Somma dei dieci numeri nelle ultime '+values.length+' estrazioni">' +
      '<line x1="'+pad+'" y1="'+avgY+'" x2="'+(w-pad)+'" y2="'+avgY+'" stroke="var(--gold)" stroke-dasharray="5 5" stroke-width="2"/>' +
      '<polyline points="'+pts+'" fill="none" stroke="var(--accent-2)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<text x="'+pad+'" y="12" fill="var(--muted)" font-size="11">Min '+min+'</text><text x="'+(w-pad)+'" y="12" text-anchor="end" fill="var(--muted)" font-size="11">Max '+max+'</text>' +
      '</svg></div><p class="wfl-chart-note">Ultime '+values.length+' estrazioni · media somme: <strong>'+fmt(avg)+'</strong> · linea oro: media della finestra.</p>';
  }
  function heatmap(hist) {
    return '<div class="wfl-regime-grid">' + WINDOWS.map(windowSize => {
      const slice=hist.slice(-windowSize), freq=freqFor(slice), max=Math.max(1,...freq);
      const complete=hist.length >= windowSize;
      return '<section class="wfl-regime-card"><div class="wfl-regime-head"><strong>Ultime '+windowSize+'</strong><span>' +
        (complete ? slice.length+' estrazioni' : 'Storico parziale: '+slice.length+'/'+windowSize) + '</span></div><div class="wfl-heatmap">' +
        freq.map((count,i) => {
          const intensity=count/max;
          const alpha=(0.12+intensity*0.75).toFixed(2);
          return '<div class="wfl-heat-cell" title="Numero '+(i+1)+': '+count+' occorrenze" style="--heat:'+alpha+'"><span>'+(i+1)+'</span><small>'+count+'</small></div>';
        }).join("") + '</div><p class="wfl-chart-note">Attese in media per numero: '+fmt(slice.length/2)+'.</p></section>';
    }).join("") + '</div>';
  }
  function render(draws) {
    const root=document.getElementById("wflSonarDashboard");
    if (!root) return;
    const hist=Array.isArray(draws) ? draws.filter(validDraw) : [];
    if (!hist.length) {
      root.innerHTML='<div class="wfl-empty">Carica o importa lo storico WFL per visualizzare le statistiche.</div>';
      return;
    }
    const freq=freqFor(hist), totalNumbers=hist.length*10;
    const sorted=freq.map((count,i)=>({n:i+1,count})).sort((a,b)=>b.count-a.count || a.n-b.n);
    const last=hist[hist.length-1], sums=hist.map(sum), mean=sums.reduce((a,b)=>a+b,0)/sums.length;
    const latestDate=esc(String(last.datetime || "Data non disponibile").replace("T"," "));
    root.innerHTML =
      '<div class="wfl-kpi-grid">' +
      '<article class="wfl-kpi"><span>Estrazioni analizzate</span><strong>'+hist.length+'</strong><small>Storico WFL valido</small></article>' +
      '<article class="wfl-kpi"><span>Ultima estrazione</span><strong class="wfl-kpi-date">'+latestDate+'</strong><small>'+esc(last.numbers.map(Number).join(" · "))+' · Numerone '+esc(last.numerone)+'</small></article>' +
      '<article class="wfl-kpi"><span>Numero più frequente</span><strong>'+sorted[0].n+'</strong><small>'+sorted[0].count+' occorrenze su '+totalNumbers+' numeri estratti</small></article>' +
      '<article class="wfl-kpi"><span>Somma media</span><strong>'+fmt(mean)+'</strong><small>Media dei 10 numeri per estrazione</small></article>' +
      '</div>' +
      '<div class="wfl-chart-grid"><section class="wfl-panel"><h3>Frequenze · numeri 1–20</h3><p class="wfl-chart-note">Tutte le 10 posizioni considerate insieme; Numerone escluso.</p>'+barChart(freq,hist.length)+'</section>' +
      '<section class="wfl-panel"><h3>Trend delle somme</h3><p class="wfl-chart-note">Somma dei 10 numeri per estrazione, ultime 60.</p>'+trendChart(hist)+'</section></div>' +
      '<section class="wfl-panel"><h3>Micro-regimi · finestre mobili</h3><p class="wfl-chart-note">Confronta come cambia la frequenza recente su finestre di diversa ampiezza. Le frequenze non indicano probabilità future.</p>'+heatmap(hist)+'</section>' +
      '<p class="wfl-disclaimer">Analisi descrittive dello storico caricato. Non cambiano i parametri del generatore e non costituiscono una previsione dell’estrazione successiva.</p>';
  }
  window.renderWflSonarDashboard = render;
})();