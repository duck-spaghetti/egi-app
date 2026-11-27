/** Locate field citations and retain exact Unicode/code-point passage boundaries. */
import {readPath} from './draft.js';
export function evidenceMatches(payload,proposal,evidence) {
  const expected=readPath(proposal,evidence.path);
  return expected!==undefined && JSON.stringify(readPath(payload,evidence.path))===JSON.stringify(expected);
}
export function evidenceFor(payload,path) {
  return payload.evidence.filter(item=>item.quote && (item.path===path || path.startsWith(item.path+'/') || item.path.startsWith(path+'/')));
}
export function passageFor(original,evidence) {
  const points=Array.from(original.replace(/^\uFEFF/,'')), {start,end}=evidence.span || {};
  const valid=Number.isInteger(start) && Number.isInteger(end) && start>=0 && end>start && end<=points.length && points.slice(start,end).join('')===evidence.quote;
  return valid ? {valid,before:points.slice(Math.max(0,start-120),start).join(''),quote:evidence.quote,after:points.slice(end,end+180).join('')} : {valid,before:'',quote:evidence.quote,after:''};
}
