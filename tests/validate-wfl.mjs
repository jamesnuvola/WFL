import fs from 'node:fs';
import assert from 'node:assert/strict';
const data=JSON.parse(fs.readFileSync('winforlife_draws.json','utf8'));
const baseline=JSON.parse(fs.readFileSync('data/archive/winforlife_draws_baseline_2026-10-12.json','utf8'));
const ids=new Set();
for(const d of data){
 assert(Number.isInteger(Number(d.numero)),'contest number must be integer');
 assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.datetime),'datetime format');
 assert.equal(d.numbers.length,10,'exactly 10 main numbers');
 assert.equal(new Set(d.numbers).size,10,'main numbers unique');
 assert(d.numbers.every(n=>Number.isInteger(n)&&n>=1&&n<=20),'main number range');
 assert(Number.isInteger(d.numerone)&&d.numerone>=1&&d.numerone<=20,'Numerone range');
 assert(!ids.has(Number(d.numero)),'duplicate contest id');
 ids.add(Number(d.numero));
}
const byId=new Map(data.map(d=>[Number(d.numero),d]));
for(const old of baseline){
 const now=byId.get(Number(old.numero));
 assert(now,'baseline record missing from current dataset: '+old.numero);
 assert.equal(now.datetime,old.datetime,'baseline datetime changed: '+old.numero);
 assert.deepEqual(now.numbers,old.numbers,'baseline numbers changed: '+old.numero);
 assert.equal(now.numerone,old.numerone,'baseline Numerone changed: '+old.numero);
}
const html=fs.readFileSync('index.html','utf8');
for(const file of ['wfl-sonar-theme.css','wfl-sonar-dashboard.js','wfl-sonar-engine.js','wfl-sonar-app.js'])assert(html.includes(file),'index missing '+file);
const app=fs.readFileSync('wfl-sonar-app.js','utf8');
assert(app.includes('Concorsi mancanti'),'missing-contest KPI must be visible');
assert(html.includes('Statistical Lab'),'new SONAR lab page is not active in branch');
console.log(JSON.stringify({status:'PASS',datasetRecords:data.length,baselineRecords:baseline.length,baselinePreserved:true,uniqueContestIds:ids.size,first:data[0].datetime,last:data.at(-1).datetime,missingContestIds:Math.max(...ids)-Math.min(...ids)+1-ids.size},null,2));
