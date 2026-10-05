import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises';
const records=[];
const problems=[];
for(const [version,directory] of [['candidate','docs/evidence/smoke'],['baseline','throttle-baseline/docs/evidence/smoke']]) {
 for(const viewport of ['phone-portrait-393x648','phone-landscape-568x320','pc-1280x720']) {
  try {
   const evidence=JSON.parse(await readFile(`${directory}/${viewport}.json`,'utf8'));
   const row={version,viewport,easyRun:evidence.easyRun??null,pageErrors:evidence.pageErrors??[],consoleErrors:evidence.consoleErrors??[],actions:evidence.actions??[],failure:evidence.failure??null,finalState:evidence.finalState??null,finalUi:evidence.finalUi??null};
   records.push(row);console.log('THROTTLE_BASELINE_SMOKE '+JSON.stringify(row));
  } catch(error) {
   const reason=String(error);
   records.push({version,viewport,missing:true,reason});
   problems.push(`${version} ${viewport} evidence is missing or invalid: ${reason}`);
  }
 }
}
await mkdir('test-results',{recursive:true});
await writeFile('test-results/throttle-baseline-smoke-comparison.json',JSON.stringify(records,null,2));

const runs=[];
for(const [version,path,outcome,required] of [
 ['candidate','test-results/browser-results.json',process.env.CANDIDATE_BROWSER_OUTCOME,true],
 ['baseline','throttle-baseline/test-results/baseline-smoke-results.json',process.env.BASELINE_BROWSER_OUTCOME,false],
]) {
 try {
  const report=JSON.parse(await readFile(path,'utf8'));
  if(!report.stats || !Array.isArray(report.suites) || !Array.isArray(report.errors)) throw new Error('invalid Playwright report');
  const stats=report.stats;
  for(const name of ['expected','skipped','unexpected','flaky']) {
   if(!Number.isInteger(stats[name]) || stats[name]<0) throw new Error(`invalid ${name} count`);
  }
  const smokeTests=[];
  const visit=suites=>{
   for(const suite of suites) {
    for(const spec of suite.specs??[]) {
     if(spec.file==='smoke.spec.ts') smokeTests.push(...spec.tests);
    }
    visit(suite.suites??[]);
   }
  };
  visit(report.suites);
  if(smokeTests.length!==3 || smokeTests.some(test=>!test.results?.length || test.results.some(result=>!['passed','failed','timedOut'].includes(result.status)))) {
   throw new Error('all three inherited smoke cases must actually run');
  }
  if(report.errors.length) problems.push(`${version} runner reported ${report.errors.length} global error(s)`);
  const observedOutcome=stats.unexpected || stats.flaky || report.errors.length ? 'failure' : 'success';
  if(outcome && outcome!==observedOutcome) problems.push(`${version} step outcome ${outcome} disagrees with report ${observedOutcome}`);
  const run={version,required,outcome:outcome??observedOutcome,passed:stats.expected,skipped:stats.skipped,failed:stats.unexpected,flaky:stats.flaky};
  runs.push(run);
  if(required && observedOutcome!=='success') problems.push('candidate browser checks failed');
  if(!required && observedOutcome==='failure') console.log('::warning::Pinned baseline smoke failed; this historical result is diagnostic. Candidate browser checks remain required.');
 } catch(error) {
  problems.push(`${version} browser report is missing, invalid, or incomplete: ${String(error)}`);
  runs.push({version,required,outcome:outcome??'unknown',incomplete:true});
 }
}
await writeFile('test-results/throttle-browser-outcomes.json',JSON.stringify({runs,problems},null,2));
const summary=[
 '### Candidate checks and pinned baseline comparison',
 '',
 '| Version | Gate | Outcome | Passed | Skipped | Failed | Flaky |',
 '| --- | --- | --- | ---: | ---: | ---: | ---: |',
 ...runs.map(run=>`| ${run.version} | ${run.required?'Required':'Historical diagnostic'} | ${run.outcome}${run.incomplete?' (incomplete)':''} | ${run.passed??'-'} | ${run.skipped??'-'} | ${run.failed??'-'} | ${run.flaky??'-'} |`),
 '',
 'A failure in the pinned historical baseline remains a failed observation in the artifact. It does not waive a candidate failure. Missing or incomplete comparison evidence fails this summary step.',
 ...problems.map(problem=>`- ${problem}`),
 '',
].join('\n');
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
if(problems.length) process.exitCode=1;
