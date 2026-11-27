/** Isolated synthetic app; real visitor profiles and existing previews are never reused. */
import {defineConfig} from '@playwright/test';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export default defineConfig({
  testDir:'./tests/browser', timeout:30000, workers:1, retries:0,
  outputDir:'.local/browser/results/'+(process.env.EGI_BROWSER_PROJECT || 'all'), reporter:[['list'],['json',{outputFile:'.local/browser/'+(process.env.EGI_BROWSER_PROJECT || 'all')+'.json'}]],
  use:{baseURL:'http://127.0.0.1:4341', browserName:'chromium', viewport:{width:1440,height:1000},
    locale:'it-IT', timezoneId:'Europe/Rome', trace:'retain-on-failure'},
  webServer:{command:quote(process.env.EGI_CHECK_PYTHON || 'python3')+' -m uvicorn checks.fixture_app:app --host 127.0.0.1 --port 4341 --no-access-log',
    url:'http://127.0.0.1:4341/__fixtures/health',reuseExistingServer:false,timeout:15000},
  projects:['browser','offline','pdf'].map(name=>({name,testMatch:`**/${name}.spec.js`}))
});
