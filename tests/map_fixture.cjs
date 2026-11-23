/* Combine the real ES module bodies for the retained VM helper assertions.
 * Browser and test_map_modules separately exercise the actual import graph. */
const fs=require('node:fs'),path=require('node:path');
exports.source=()=>{
  const root=path.join(__dirname,'../app/frontend/static/js');
  const files=fs.readdirSync(root).filter(x=>x.startsWith('map-')&&x.endsWith('.js'));
  files.sort((a,b)=>a==='map-state.js'?-1:b==='map-state.js'?1:a.localeCompare(b));
  return files.concat(['map.js']).map(file=>{
    let code=fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
    if(file==='map.js')code=code.slice(0,code.indexOf('window.addEventListener("pagehide"'));
    return code;
  }).join('\n');
};
