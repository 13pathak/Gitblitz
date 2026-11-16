const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const channel = process.env.GITBLITZ_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
  const browser = await chromium.launch({channel, headless:true});
  try {
    const errors = [];
    for (const modern of [false, true]) {
      const page = await browser.newPage({viewport:{width:1000,height:760}});
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => { errors.push('Unexpected blocking dialog: ' + dialog.message()); dialog.dismiss(); });
      await page.route('https://github.com/**', route => route.fulfill({contentType:'text/html', body: (modern ? '<!doctype html><html lang="en"><head><title>Repository fixture</title></head><body><header><h1>upstream/demo</h1><div><ul data-testid="repo-header-actions"></ul></div></header><main><p>Repository code</p><button id="ref-picker-repos-header-ref-selector"><span data-component="text">feature/login</span></button></main></body></html>' : '<!doctype html><html lang="en"><head><title>Repository fixture</title></head><body><header><h1>upstream/demo</h1><ul class="pagehead-actions"></ul></header><main><p>Repository code</p></main></body></html>')}));
      await page.addInitScript(() => {
        window.testState = {messages:[], copied:[], response:{success:true,cloneUrl:'https://github.com/me/demo.git',branch:'feature/login'}};
        window.chrome = window.chrome || {};
        chrome.runtime = {onMessage:{addListener(fn){testState.listener=fn;}}, async sendMessage(message){testState.messages.push(message); if(testState.defer) return new Promise(resolve => {testState.resolve=resolve;}); return testState.response;}};
        Object.defineProperty(navigator,'clipboard',{value:{async writeText(text){if(testState.denyClipboard) throw new Error('Denied'); testState.copied.push(text);}}});
      });
      await page.goto('https://github.com/upstream/demo/tree/feature/login');
      await page.addStyleTag({path:path.resolve('content.css')});
      await page.addScriptTag({path:path.resolve('content.js')});
      await page.evaluate(() => testState.listener({action:'TRIGGER_FIX_REPO'}));
      await page.waitForFunction(() => document.querySelector('#gitblitz-command')?.value.includes('--branch feature/login'));
      assert.equal(await page.locator('#gitblitz-fix-btn').evaluate(el=>el.tagName),'BUTTON');
      assert.equal(await page.locator('#gitblitz-command').inputValue(), await page.evaluate(()=>testState.copied[0]));
      assert.equal(await page.evaluate(()=>testState.messages[0].ref.path),'feature/login');
      assert.equal(await page.evaluate(()=>testState.messages[0].ref.name), modern ? 'feature/login' : '');
      await page.locator('.gitblitz-dismiss').click();
      assert.equal(await page.evaluate(()=>document.activeElement.id),'gitblitz-fix-btn');
      await page.evaluate(()=>{testState.denyClipboard=true;});
      await page.locator('#gitblitz-fix-btn').click();
      await page.waitForFunction(()=>document.querySelector('#gitblitz-status').textContent.includes('copy it manually'));
      await page.locator('#gitblitz-command').focus();
      assert.equal(await page.locator('#gitblitz-command').evaluate(el=>el.selectionEnd-el.selectionStart), (await page.locator('#gitblitz-command').inputValue()).length);
      await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
      const contentAudit = await page.evaluate(async()=> (await axe.run({include:['#gitblitz-fix-btn','#gitblitz-feedback']})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));
      assert.deepEqual(contentAudit,[]);
      await page.evaluate(()=>{testState.defer=true;testState.denyClipboard=false;});
      const beforeCount = await page.evaluate(()=>testState.messages.length);
      await page.evaluate(()=>{testState.listener({action:'TRIGGER_FIX_REPO'});testState.listener({action:'TRIGGER_FIX_REPO'});});
      assert.equal(await page.evaluate(()=>testState.messages.length), beforeCount+1);
      const beforeCopied = await page.evaluate(()=>testState.copied.length);
      await page.evaluate(()=>{history.pushState({},'', '/another/project');testState.resolve(testState.response);});
      await page.waitForFunction(()=>document.querySelector('#gitblitz-fix-btn').getAttribute('aria-disabled')==='false');
      assert.equal(await page.evaluate(()=>testState.copied.length),beforeCopied);
      await page.evaluate(()=>{testState.defer=false;testState.response={success:false,error:'No GitHub token found.'};});
      await page.locator('#gitblitz-fix-btn').click();
      await page.waitForFunction(()=>document.querySelector('#gitblitz-status').textContent==='No GitHub token found.');
      assert.equal(await page.evaluate(()=>testState.messages.at(-1).owner),'another');
      assert.equal(await page.evaluate(()=>testState.messages.at(-1).repo),'project');
      await page.evaluate(()=>document.querySelector('[data-testid="repo-header-actions"], .pagehead-actions').replaceChildren());
      await page.locator('#gitblitz-fix-btn').waitFor();
      assert.equal(await page.locator('#gitblitz-fix-btn').count(),1);
      console.log('PASS: shortcut, full clipboard command, copy-denied fallback, focus, duplicate guard, SPA navigation, inline errors, reinjection; content axe violations: 0.');

      await page.close();
    }

    const popup = await browser.newPage({viewport:{width:360,height:760}});
    popup.on('pageerror', error=>errors.push(error.message));
    await popup.addInitScript(()=>{
      window.testState={storage:{}, fetchMode:'success'};
      window.chrome=window.chrome||{};
      chrome.runtime={};
      chrome.storage={local:{get(keys,callback){callback(testState.storage);},set(data,callback){Object.assign(testState.storage,data);callback?.();},remove(keys,callback){keys.forEach(key=>delete testState.storage[key]);callback();}}};
      window.fetch=async()=>{if(testState.fetchMode==='network') throw new Error('Offline');return {ok:true,status:200,async json(){return {login:'test-user'};}};};
    });
    await popup.goto(pathToFileURL(path.resolve('popup.html')).href);
    assert.equal(await popup.locator('#fork-history').innerText(),'No recent forks');
    await popup.locator('#pat-input').fill('test-token');
    await popup.locator('#pat-input').press('Enter');
    await popup.waitForFunction(()=>document.querySelector('#status-msg').textContent==='Token saved successfully!');
    assert.equal(await popup.evaluate(()=>testState.storage.githubUsername),'test-user');
    await popup.locator('input[value="ssh"]').check();
    assert.equal(await popup.evaluate(()=>testState.storage.cloneUrlPreference),'ssh');
    await popup.locator('#clear-btn').click();
    assert.equal(await popup.evaluate(()=>testState.storage.githubPat),undefined);
    await popup.locator('#pat-input').fill('test-token');
    await popup.evaluate(()=>{testState.fetchMode='network';});
    await popup.locator('#save-btn').click();
    await popup.waitForFunction(()=>document.querySelector('#status-msg').textContent.includes('Could not reach GitHub'));
    assert.equal(await popup.locator('#clear-btn').isEnabled(),true);
    await popup.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
    const popupAudit=await popup.evaluate(async()=>(await axe.run()).violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})));
    assert.deepEqual(popupAudit,[]);
    assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    console.log('PASS: popup empty history, Enter to save, account identity, SSH preference, clear token, network error, no horizontal overflow; popup axe violations: 0.');
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
