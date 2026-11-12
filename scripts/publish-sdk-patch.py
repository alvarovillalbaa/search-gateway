"""Publish only the independently qualified 0.1.1 archive and public metadata."""
import base64, gzip, hashlib, json, os, subprocess, sys, time, traceback, urllib.parse, urllib.request
from pathlib import Path

assert sys.argv[1:]==['--publish-reviewed']
repo='alvarovillalbaa/search-gateway'
tag='v0.1.1'
base=Path(__file__).resolve().parents[1]
directory=base/'docs/results/2026/11-12/sdk-publication-inputs'
remote=os.environ.get('SG_REMOTE_PUBLICATION')=='true'
if remote:
    assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ['GITHUB_REPOSITORY']==repo
    assert os.environ['GITHUB_REF']=='refs/heads/qa/search-sdk-patch-20261112-publish-1'
    proof=Path(os.environ['SG_PUBLISH_PROOF']).resolve()
    assert proof.parent==Path(os.environ['RUNNER_TEMP']).resolve() and not proof.exists()
    proof.mkdir(mode=0o700)
    (proof/'owner.json').write_text(json.dumps({'run':os.environ['GITHUB_RUN_ID']}))
else:
    proof=directory
report_file=proof/'sdk-publication.json' if remote else base/'docs/results/2026/11-12/sdk-publication.json'
assert not report_file.exists()
report={'schemaVersion':1,'repo':repo,'tag':tag,'commands':[],'downloads':[],'success':False}
started=time.monotonic()
def sha(data):return hashlib.sha256(data).hexdigest()
def run(args):
    assert len(report['commands'])<16 and time.monotonic()-started<420
    result=subprocess.run(args,cwd=base,capture_output=True,timeout=30)
    item={'argv':args,'exit':result.returncode}
    for label,data in [('stdout',result.stdout),('stderr',result.stderr)]:
        item[label]={'bytes':len(data),'sha256':sha(data),'base64':base64.b64encode(data).decode(),'complete':True}
    report['commands'].append(item)
    assert len(result.stdout)<=2*1024**2 and len(result.stderr)<=2*1024**2
    assert result.returncode==0,item
    return result.stdout
def api(route,method='GET',body=None):
    args=['gh','api','--method',method,'repos/'+repo+'/'+route]
    if body:
        path=proof/f'request-{len(report["commands"])}.json'
        data=(json.dumps(body,indent=2)+'\n').encode();path.write_bytes(data)
        report.setdefault('requests',[]).append({'file':path.name,'bytes':len(data),'sha256':sha(data),'base64':base64.b64encode(data).decode()})
        args+=['--input',str(path)]
    output=run(args)
    return json.loads(output) if output else None
def old_state():
    release=api('releases/tags/v0.1.0')
    pinned=json.loads((directory/'protected-release.json').read_text())
    assert release['id']==pinned['id']
    assets=[{k:a[k] for k in ('id','name','size','digest')} for a in release['assets']]
    assert assets==pinned['assets']
    ref=api('git/ref/tags/v0.1.0');assert ref['object']['sha']=='f891c1378ca20fb90e007d9dc9610aa4740dfc45'
    return {'release':release['id'],'assets':assets,'tag':ref['object']['sha']}
def source_vector():
    result=[]
    for name in filter(None,subprocess.check_output(['git','ls-files','-z'],cwd=base).split(b'\0')):
        path=base/name.decode();assert path.is_file() and not path.is_symlink()
        data=path.read_bytes();assert len(data)<2*1024**2
        result.append({'path':name.decode(),'bytes':len(data),'sha256':sha(data),'mode':path.stat().st_mode&0o777})
    assert len(result)<=150 and sum(f['bytes'] for f in result)<16*1024**2
    return result
try:
    review=json.loads((base/'docs/results/2026/11-12/sdk-independent-review.json').read_text())
    assert review['qualified'] and review['archiveUnchanged'] and review['oldFailedOverallPreserved']
    qualification=json.loads((directory/'search-sdk-qualification.json').read_text())
    assert qualification['qualified'] and qualification['version']=='0.1.1'
    assert qualification['source']=='ea5c7d0c7a279805347228a7bde75fe6aeb5dea6'
    names=[qualification['archive']['file'],'search-sdk-qualification.json','SHA256SUMS']
    inputs={name:(directory/name).read_bytes() for name in names}
    assert len(inputs[names[0]])==35904 and sha(inputs[names[0]])=='f83c7cdf462d4c27e27da288c87278228acf4cc727717f22a327a314fe735150'
    assert inputs['SHA256SUMS'].decode()==''.join(sha(inputs[name])+'  '+name+'\n' for name in sorted(names[:2]))
    report['inputs']=[{'file':name,'bytes':len(data),'sha256':sha(data)} for name,data in inputs.items()]
    report['sourceBefore']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=base,text=True).strip()
    if remote: assert report['sourceBefore']==os.environ['EXPECTED_SOURCE']
    report['sourceVectorBefore']=source_vector()
    report['indexBefore']=sha(subprocess.check_output(['git','ls-files','--stage','-z'],cwd=base))
    report['oldBefore']=old_state()
    releases=api('releases');assert all(r['tag_name']!=tag for r in releases)
    assert api('git/matching-refs/tags/'+tag)==[]
    body={'tag_name':tag,'target_commitish':qualification['source'],'name':'Search Gateway TypeScript SDK 0.1.1','draft':True,'prerelease':False,
          'body':'Installable TypeScript/Node/React patch for client replacement and request ownership. Ten installed React checks and strict declarations passed at the original archive source; corrected native HTTP/tool/CLI/MCP consumer checks passed separately against identical bytes. The original fixture failure remains preserved. Python 0.1.0 artifacts remain in v0.1.0. No npm/PyPI publication or live-provider/model-quality acceptance. See search-sdk-qualification.json and repository docs/results/2026/11-12/.'}
    release=api('releases','POST',body);report['releaseId']=release['id'];assert release['draft'] and release['tag_name']==tag
    run(['gh','release','upload',tag,*[str(directory/name) for name in names],'--repo',repo])
    draft=api('releases/'+str(release['id']))
    assert len(draft['assets'])==3
    for asset in draft['assets']:
        data=inputs[asset['name']];assert asset['size']==len(data) and asset['digest']=='sha256:'+sha(data)
    published=api('releases/'+str(release['id']),'PATCH',{'draft':False,'make_latest':'true'})
    assert not published['draft'] and published['tag_name']==tag
    report['releaseUrl']=published['html_url']
    report['assets']=[{k:a[k] for k in ('id','name','size','digest','browser_download_url')} for a in published['assets']]
    ref=api('git/ref/tags/'+tag);assert ref['object']['sha']==qualification['source']
    for asset in published['assets']:
        request=urllib.request.Request(asset['browser_download_url'],headers={'User-Agent':'SearchGateway-0.1.1-byte-verifier'})
        with urllib.request.urlopen(request,timeout=20) as response:
            data=response.read(2*1024**2+1)
            assert response.status==200 and len(data)<=2*1024**2
            target=urllib.parse.urlsplit(response.url)
            assert target.scheme=='https' and (target.hostname=='github.com' or target.hostname.endswith('.githubusercontent.com'))
            assert data==inputs[asset['name']]
            report['downloads'].append({'file':asset['name'],'status':response.status,'bytes':len(data),'sha256':sha(data),'headers':dict(request.header_items()),'base64':base64.b64encode(data).decode()})
    report['oldAfter']=old_state();assert report['oldBefore']==report['oldAfter']
    report['sourceAfter']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=base,text=True).strip()
    report['sourceVectorAfter']=source_vector()
    report['indexAfter']=sha(subprocess.check_output(['git','ls-files','--stage','-z'],cwd=base))
    assert report['sourceBefore']==report['sourceAfter'] and report['indexBefore']==report['indexAfter']
    assert report['sourceVectorBefore']==report['sourceVectorAfter']
    for name,data in inputs.items():assert (directory/name).read_bytes()==data
    report['success']=True
except BaseException as error:
    report['error']=repr(error);report['traceback']=traceback.format_exc()
finally:
    report['elapsedSeconds']=time.monotonic()-started
    raw=(json.dumps(report,indent=2)+'\n').encode();assert len(raw)<=2*1024**2
    report_file.write_bytes(raw)
    if remote:
        packed=gzip.compress(raw,mtime=0)
        print('SEARCH_SDK_PUBLICATION_BEGIN',sha(raw),len(raw),flush=True)
        encoded=base64.b64encode(packed).decode()
        for index in range(0,len(encoded),20000):print(encoded[index:index+20000],flush=True)
        print('SEARCH_SDK_PUBLICATION_END',flush=True)
    print(json.dumps({k:v for k,v in report.items() if k in ('success','error','releaseId','releaseUrl','elapsedSeconds')}))
raise SystemExit(0 if report['success'] else 1)
