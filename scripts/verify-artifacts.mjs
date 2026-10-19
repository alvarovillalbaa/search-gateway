// T2: install the actual package archives in an isolated temporary consumer.
import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const repo = process.cwd(); const temp = await mkdtemp(join(tmpdir(), 'search-gateway-consumer-'));
function run(command, args, cwd = temp) {
  const result = spawnSync(command, args, {cwd, encoding: 'utf8', env: {...process.env, npm_config_cache: join(temp, 'npm-cache'), PIP_NO_CACHE_DIR: '1'}});
  if (result.status !== 0) throw new Error(`${command} failed\n${result.stdout}\n${result.stderr}`);
}
try {
  const tar = (await readdir(repo)).find(x => x === 'alvarovillalbaa-search-gateway-0.1.0.tgz');
  const wheel = (await readdir(join(repo, 'python/dist'))).find(x => x.endsWith('.whl'));
  if (!tar || !wheel) throw new Error('Build npm and Python artifacts first');
  await writeFile(join(temp, 'package.json'), '{"private":true,"type":"module"}\n');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', resolve(repo, tar)]);
  run(process.execPath, ['--input-type=module', '-e', `import {SearchGateway,createSearchTool} from '@alvarovillalbaa/search-gateway'; import {createSearchGateway,PROVIDERS} from '@alvarovillalbaa/search-gateway/core'; import {createApiKey} from '@alvarovillalbaa/search-gateway/server'; if(PROVIDERS.length!==13 || typeof createApiKey!=='function' || typeof SearchGateway!=='function') throw Error('bad exports'); const g=createSearchGateway({providerKeys:{exa:'mock'},adapters:[{id:'exa',description:'mock',search:async()=>({sources:[{url:'https://example.com/a',text:'packed text'}]})}]}); const r=await createSearchTool(g).execute({query:'packed',content:'text'}); if(r.sources[0].content.text!=='packed text') throw Error('bad package behavior');`]);
  run(process.execPath, [join(temp, 'node_modules/@alvarovillalbaa/search-gateway/dist/cli.js'), '--help']);
  run(join(temp, 'node_modules/.bin/search-gateway'), ['--help']);
  const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  run(python, ['-m', 'venv', join(temp, 'venv')]);
  const py = join(temp, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  run(py, ['-m', 'pip', 'install', '--no-index', '--no-deps', resolve(repo, 'python/dist', wheel)]);
  run(py, ['-c', "from search_gateway import SearchGateway,AsyncSearchGateway,SEARCH_TOOL; from importlib.metadata import version; assert version('search-gateway-client')=='0.1.0'; assert SEARCH_TOOL['name']=='web_search'; assert SearchGateway().base_url=='http://127.0.0.1:8787'"]);
  await writeFile(join(temp, 'http-consumer.mjs'), `
import {spawn} from 'node:child_process';
import {SearchGateway} from '@alvarovillalbaa/search-gateway';
import {createSearchGateway} from '@alvarovillalbaa/search-gateway/core';
import {createGatewayServer} from '@alvarovillalbaa/search-gateway/server';
const gateway=createSearchGateway({providerKeys:{exa:'mock'},adapters:[{id:'exa',description:'mock',search:async()=>({sources:[{url:'https://example.com/a',text:'installed HTTP content'}]})}]});
const server=createGatewayServer({gateway,authenticate:key=>key==='mock-gateway'?{id:'test',name:'test',requestsPerMinute:60}:undefined});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const baseUrl='http://127.0.0.1:'+server.address().port;
  const client=new SearchGateway({baseUrl,apiKey:'mock-gateway'});
  if((await client.search({query:'installed',content:'text'})).sources[0].content.text!=='installed HTTP content') throw Error('Node installed HTTP failure');
  const child=spawn(process.argv[2],['-c',"import asyncio; from search_gateway import SearchGateway,AsyncSearchGateway; assert SearchGateway().search('installed',content='text')['sources'][0]['content']['text']=='installed HTTP content'; assert asyncio.run(AsyncSearchGateway().search('async'))['query']=='async'"],{env:{...process.env,SEARCH_GATEWAY_URL:baseUrl,SEARCH_GATEWAY_API_KEY:'mock-gateway'},stdio:'inherit'});
  if(await new Promise(resolve=>child.on('exit',resolve))!==0) throw Error('Python installed HTTP failure');
} finally {await new Promise(resolve=>server.close(resolve));}
`);
  run(process.execPath, [join(temp, 'http-consumer.mjs'), py]);
  console.log('Packed npm and Python consumer installation passed');
} finally { await rm(temp, {recursive: true, force: true}); }
