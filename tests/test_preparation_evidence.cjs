/** Passage navigation uses retained code-point offsets, never normalized textarea offsets. */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
(async()=>{
 const {load}=environment();const {passageFor,evidenceFor,evidenceMatches}=await load('features/preparations/evidence.js');
 const source='\uFEFF🧭\r\nCaffè sociale\r\nTelefono 123';
 const citation={id:'a',path:'/service/name',quote:'Caffè sociale',span:{start:3,end:16}};
 const passage=passageFor(source,citation);
 assert.equal(passage.valid,true);assert.equal(passage.quote,'Caffè sociale');assert.equal(passage.before,'🧭\r\n');
 assert.equal(passageFor(source.replace(/\r\n/g,'\n'),citation).valid,false,'changed line endings cannot silently move a verified quote');
 assert.equal(passageFor(source,{...citation,quote:'Unrelated'}).valid,false);
 assert.equal(passageFor(source,{...citation,span:{start:-1,end:16}}).valid,false);
 const payload={evidence:[citation,{id:'b',quote:'123',path:'/service/contacts/0'},{id:'c',quote:'Other',path:'/service/contacts/1/value'}]};
 assert.equal(evidenceFor(payload,'/service/contacts/0/value').length,1);
 assert.equal(evidenceFor(payload,'/service/contacts/0/value')[0].id,'b');
 assert.equal(evidenceFor(payload,'/service/contacts/10/value').length,0);
 const proposed={service:{name:'Proposed',contacts:[{value:'123'}]}},baseline={service:{name:'Existing',contacts:[{value:'456'},{value:'123'}]}};
 assert.equal(evidenceMatches(baseline,proposed,{path:'/service/name'}),false,'an unselected name cannot borrow proposal evidence');
 assert.equal(evidenceMatches(baseline,proposed,{path:'/service/contacts/0'}),false,'an appended proposal cannot cite a different baseline component');
 assert.equal(evidenceMatches(proposed,proposed,{path:'/service/name'}),true);
 console.log('Preparation evidence: Unicode/BOM/CRLF, mismatches and exact component paths passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
