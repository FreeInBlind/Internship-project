const { chromium } = require('C:/Users/jm166/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await page.route('http://127.0.0.1:8001/**', r=>r.continue({url:r.request().url().replace(':8001', ':8002')}));
    await page.goto('http://127.0.0.1:5501/index.html');
    await page.evaluate(()=>signIn('admin@example.com','TestAccount123!',false));
    await page.locator('#walking-points').waitFor();
    await page.locator('#walking-points').fill('42');
    await page.locator('#cycling-enabled').uncheck();
    await page.locator('#adminRuleSave').click();
    await page.waitForFunction(()=>document.querySelector('#adminRuleMessage').textContent.includes('saved'));
    await page.reload();
    await page.locator('#walking-points').waitFor();
    assert.equal(await page.locator('#walking-points').inputValue(),'42');
    assert.equal(await page.locator('#cycling-enabled').isChecked(),false);
    await page.locator('.admin-rule-panel').screenshot({path:path.join(__dirname,'admin-rules-light.png')});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>document.body.classList.add('dark-mode'));
    assert.ok(await page.locator('.admin-rule-panel').evaluate(el=>el.getBoundingClientRect().width > 250));
    await page.locator('.admin-rule-panel').screenshot({path:path.join(__dirname,'admin-rules-mobile-dark.png')});
    const data=await (await page.request.get('http://127.0.0.1:8002/test/session/1')).json();
    await page.evaluate(data=>{saveSession(data,false);updateUserLabels(data.user);showPage('ecoPointsPage');},data);
    await page.locator('[data-transport-mode="walking"]').click();
    await page.waitForFunction(()=>document.querySelector('#tripRule').textContent.includes('+42 EcoPoints'));
    await page.locator('#tripFile').setInputFiles(path.join(__dirname,'fixtures/walk-demo.gpx'));
    await page.locator('#tripSubmit').click();
    await page.waitForFunction(()=>document.querySelector('#tripUploadResult').textContent.includes('earned 42'));
    await page.keyboard.press('Escape');
    await page.locator('[data-transport-mode="cycling"]').click();
    await page.waitForFunction(()=>document.querySelector('#tripRule').textContent.includes('paused'));
    assert.deepEqual(errors,[]);
    console.log('PASS: Admin save/reload, persisted rules, mobile/dark layout, user reward 42 and paused cycling.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
