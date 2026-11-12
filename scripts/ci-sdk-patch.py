"""Bounded release work in owned CI storage; never run locally."""
import base64, hashlib, io, json, os, shutil, signal, subprocess, time, traceback, zipfile
from pathlib import Path

assert os.environ.get('GITHUB_ACTIONS') == 'true'
assert os.environ['GITHUB_REPOSITORY'] == 'alvarovillalbaa/search-gateway'
phase = os.environ['SG_PHASE']
assert phase == 'lock'
assert os.environ['GITHUB_REF'] == f'refs/heads/qa/search-sdk-patch-20261112-{phase}-1'
source = Path.cwd()
temporary = Path(os.environ['RUNNER_TEMP']).resolve()
root = temporary / f"search-sdk-{phase}-{os.environ['GITHUB_RUN_ID']}"
proof = Path(os.environ['SG_PROOF']).resolve()
assert root.parent == temporary and proof.parent == temporary
assert not root.exists() and not proof.exists() and shutil.disk_usage(temporary).free >= 4 * 1024**3
root.mkdir(mode=0o700); proof.mkdir(mode=0o700)
owner = {'run': os.environ['GITHUB_RUN_ID'], 'phase': phase}
(root/'owner.json').write_text(json.dumps(owner))
build = root/'build'; build.mkdir()
started = time.monotonic()
report = {'version': 1, 'phase': phase, 'source': os.environ['EXPECTED_SOURCE'],
          'activation': os.environ['GITHUB_SHA'], 'commands': [], 'groups': [], 'success': False}
env = dict(os.environ, npm_config_cache=str(root/'npm-cache'), npm_config_update_notifier='false')
def digest(data): return hashlib.sha256(data).hexdigest()
def snapshot():
    result=[]
    for name in filter(None, subprocess.check_output(['git','ls-files','-z']).split(b'\0')):
        relative=name.decode(); file=source/relative
        assert file.is_file() and not file.is_symlink()
        data=file.read_bytes(); assert len(data)<2*1024**2
        result.append({'path':relative,'bytes':len(data),'sha256':digest(data),'mode':file.stat().st_mode&0o777})
    assert len(result)<=150 and sum(f['bytes'] for f in result)<16*1024**2
    return result
def absent(pgid):
    try: os.killpg(pgid,0); return False
    except ProcessLookupError: return True
def command(args,cwd=build,timeout=100,extra=None):
    assert len(report['commands'])<16
    remaining=420-(time.monotonic()-started); assert remaining>0
    child=subprocess.Popen(args,cwd=cwd,env=env|(extra or {}),stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    item={'argv':args,'pid':child.pid}; report['commands'].append(item); report['groups'].append(child.pid)
    try: stdout,stderr=child.communicate(timeout=min(remaining,timeout))
    except subprocess.TimeoutExpired:
        os.killpg(child.pid,signal.SIGTERM)
        try: stdout,stderr=child.communicate(timeout=8)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid,signal.SIGKILL); stdout,stderr=child.communicate(timeout=5)
        item['timedOut']=True
    for label,data in [('stdout',stdout),('stderr',stderr)]:
        filename=f"command-{len(report['commands'])}-{label}.bin"; (proof/filename).write_bytes(data)
        item[label]={'file':filename,'bytes':len(data),'sha256':digest(data),'complete':True}
        assert len(data)<=2*1024**2
    item.update(exit=child.returncode,groupAbsent=absent(child.pid))
    assert child.returncode==0 and item['groupAbsent'] and not item.get('timedOut'),item
    assert shutil.disk_usage(temporary).free>=2*1024**3
    return stdout
try:
    assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==report['source']
    assert subprocess.check_output(['git','status','--porcelain'])==b''
    report['sourceBefore']=snapshot()
    report['indexBefore']=digest(subprocess.check_output(['git','ls-files','--stage','-z']))
    report['exports']=[]
    for file in report['sourceBefore']:
        relative=file['path']
        if relative not in ('package.json','package-lock.json','LICENSE','openapi.json','scripts/generate-openapi.mjs','scripts/sdk-patch-consumer.mjs','tests/unit/react-client-ownership.test.mjs') and not relative.startswith('packages/search-gateway/'): continue
        target=build/relative; target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes((source/relative).read_bytes()); target.chmod(file['mode'])
        assert digest(target.read_bytes())==file['sha256']; report['exports'].append(file)
    assert command(['node','--version']).decode().strip()=='v24.22.2'
    before=json.loads((build/'package-lock.json').read_text())
    command(['npm','install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],timeout=150)
    assert not (build/'node_modules').exists()
    generated=(build/'package-lock.json').read_bytes(); after=json.loads(generated)
    expected=json.loads(json.dumps(before)); expected['version']='0.1.1'
    expected['packages']['']['version']='0.1.1'; expected['packages']['packages/search-gateway']['version']='0.1.1'
    assert expected==after,'Lock changed beyond the three declared version fields'
    (proof/'package-lock.json').write_bytes(generated)
    report['lock']={'bytes':len(generated),'sha256':digest(generated),'externalGraphUnchanged':True,
                    'changedFields':['version','packages..version','packages.packages/search-gateway.version']}
    for file in report['exports']:
        if file['path']!='package-lock.json': assert digest((build/file['path']).read_bytes())==file['sha256']
    report['success']=True
except BaseException as error:
    report['error']=repr(error); report['traceback']=traceback.format_exc()
finally:
    try:
        report['scratchBytes']=sum(p.stat().st_size for p in root.rglob('*') if p.is_file() and not p.is_symlink())
        assert report['scratchBytes']<=2*1024**3
        report['sourceAfter']=snapshot(); report['indexAfter']=digest(subprocess.check_output(['git','ls-files','--stage','-z']))
        assert report['sourceBefore']==report['sourceAfter'] and report['indexBefore']==report['indexAfter']
        assert all(absent(pgid) for pgid in report['groups']) and json.loads((root/'owner.json').read_text())==owner
        shutil.rmtree(root); report['scratchAbsent']=not root.exists(); assert report['scratchAbsent']
    except BaseException as error: report['cleanupError']=repr(error); report['success']=False
    report['elapsedSeconds']=time.monotonic()-started
    (proof/'controller.json').write_text(json.dumps(report,indent=2)+'\n')
    files=sorted(proof.iterdir()); assert len(files)<=150 and all(p.is_file() and not p.is_symlink() for p in files)
    assert sum(p.stat().st_size for p in files)<=16*1024**2
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
        for file in files: archive.write(file,file.name)
    packet=buffer.getvalue(); assert len(packet)<=3*1024**2
    print('SEARCH_SDK_PACKET_BEGIN',digest(packet),len(packet),flush=True)
    encoded=base64.b64encode(packet).decode()
    for index in range(0,len(encoded),20_000): print(encoded[index:index+20_000],flush=True)
    print('SEARCH_SDK_PACKET_END',flush=True)
    print(json.dumps({'success':report['success'],'phase':phase,'elapsedSeconds':report['elapsedSeconds']}),flush=True)
raise SystemExit(0 if report['success'] else 1)
