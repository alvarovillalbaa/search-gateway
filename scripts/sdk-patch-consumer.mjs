// Execute only in the fresh archive consumer, never against workspace imports.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SearchGateway, createSearchTool} from '@alvarovillalbaa/search-gateway';
import {createSearchGateway, PROVIDERS} from '@alvarovillalbaa/search-gateway/core';
import {createGatewayServer} from '@alvarovillalbaa/search-gateway/server';
import {useSearchGateway} from '@alvarovillalbaa/search-gateway/react';

const out=process.env.SG_CONSUMER_REPORT;
assert.ok(out && path.isAbsolute(out));
const report={version:1,success:false,exports:[],requests:[]};
const sha=data=>createHash('sha256').update(data).digest('hex');
let server,child,exited=false,deadline;
let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0);
try {
  for(const entry of ['', '/core', '/server', '/react']) {
    const resolved=fileURLToPath(import.meta.resolve('@alvarovillalbaa/search-gateway'+entry));
    assert.ok(resolved.startsWith(path.join(process.cwd(),'node_modules/@alvarovillalbaa/search-gateway/dist/')));
    const bytes=await readFile(resolved);
    report.exports.push({entry:entry||'.',file:path.basename(resolved),bytes:bytes.length,sha256:sha(bytes)});
  }
  assert.equal(typeof useSearchGateway,'function'); assert.equal(PROVIDERS.length,13);
  const gateway=createSearchGateway({providerKeys:{exa:'authored-provider-fixture'},adapters:[{
    id:'exa',description:'Authored package fixture',search:async request=>{
      report.requests.push(request.query);
      return {sources:[{url:'https://example.invalid/archive',title:'Authored result',text:'Installed archive content'}]};
    },
  }]});
  server=createGatewayServer({gateway,authenticate:key=>key==='authored-gateway-fixture'?{id:'fixture',name:'fixture',requestsPerMinute:60}:undefined});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const baseUrl='http://127.0.0.1:'+server.address().port;
  const health=await fetch(baseUrl+'/health'); report.health={status:health.status,body:await health.json()};
  assert.equal(report.health.status,200); assert.equal(report.health.body.version,'0.1.1');
  const client=new SearchGateway({baseUrl,apiKey:'authored-gateway-fixture'});
  report.client=await client.search({query:'archive-client',providers:['exa'],mode:'single',content:'text'});
  assert.equal(report.client.sources[0].content.text,'Installed archive content');
  report.tool=await createSearchTool(client).execute({query:'archive-tool',providers:['exa'],mode:'single',content:'text'});
  assert.equal(report.tool.sources[0].content.text,'Installed archive content');
  const binary=path.join(process.cwd(),'node_modules/.bin/search-gateway');
  child=spawn(binary,['mcp','--base-url',baseUrl],{cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:process.env.HOME,SEARCH_GATEWAY_API_KEY:'authored-gateway-fixture'},stdio:['pipe','pipe','pipe']});
  report.mcp={pid:child.pid};
  const terminal=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',(code,signal)=>{exited=true;resolve({code,signal});});
  });
  const collect=(kind,data)=>{
    if(kind==='stdout')stdout=Buffer.concat([stdout,data]);else stderr=Buffer.concat([stderr,data]);
    if(stdout.length+stderr.length>65_536)child.kill('SIGTERM');
  };
  child.stdout.on('data',data=>collect('stdout',data));child.stderr.on('data',data=>collect('stderr',data));
  deadline=setTimeout(()=>child.kill('SIGTERM'),10_000);
  const requests=[
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'archive-fixture',version:'1'}}},
    {jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/list'},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'web_search',arguments:{query:'archive-mcp',providers:['exa'],mode:'single',content:'text'}}},
  ];
  child.stdin.end(requests.map(x=>JSON.stringify(x)).join('\n')+'\n');
  report.mcp.terminal=await terminal;clearTimeout(deadline);
  assert.deepEqual(report.mcp.terminal,{code:0,signal:null});
  // Wait for both output streams to close before parsing the originals.
  await Promise.all([child.stdout,child.stderr].map(stream=>stream.closed?Promise.resolve():new Promise(resolve=>stream.once('close',resolve))));
  report.mcp.stdout={bytes:stdout.length,sha256:sha(stdout),base64:stdout.toString('base64')};
  report.mcp.stderr={bytes:stderr.length,sha256:sha(stderr),base64:stderr.toString('base64')};
  const replies=stdout.toString().trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(replies.map(x=>x.id),[1,2,3]);
  assert.equal(replies[0].result.serverInfo.version,'0.1.1');
  assert.deepEqual(replies[1].result.tools.map(t=>t.name),['web_search','read_sources']);
  const call=JSON.parse(replies[2].result.content[0].text);
  assert.equal(call.sources[0].content.text,'Installed archive content');
  assert.equal(replies[2].result.isError,undefined);assert.equal(stderr.length,0);
  assert.deepEqual(report.requests,['archive-client','archive-tool','archive-mcp']);
  report.success=true;
} catch(error) {report.error=error.stack;process.exitCode=1;}
finally {
  clearTimeout(deadline);
  if(child&&!exited){child.stdin.end();child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
  if(server){server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));report.serverClosed=!server.listening;}
  await writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({success:report.success,exports:report.exports.length,requests:report.requests,serverClosed:report.serverClosed}));
}
