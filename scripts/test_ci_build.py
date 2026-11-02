#!/usr/bin/env python3
"""Regression checks for optional cache boundaries and exact-source reuse."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import ci_cache as cache
import ci_verification as verification
import build_portable

class BuildAccelerationTests(unittest.TestCase):
    def test_portable_flags_are_idempotent_and_preserve_optimization(self):
        first=build_portable.build_environment({'RUSTFLAGS':'-C target-cpu=generic'})
        self.assertEqual(first,build_portable.build_environment(first))
        self.assertIn('-C\x1ftarget-cpu=generic',first['CARGO_ENCODED_RUSTFLAGS'])

    def test_cache_is_bounded_and_omits_app_fingerprints(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);dep=root/'dep';dep.mkdir()
            (dep/'library').write_bytes(b'x'*10)
            (dep/'chronoscope-private').write_bytes(b'x'*20)
            (dep/'libchronoscope-private.rlib').write_bytes(b'x'*20)
            with patch.object(cache,'locations',return_value=[('cargo-cache',dep)]):
                self.assertEqual(cache.prepare(root/'staged',limit=9),0)
                self.assertEqual(cache.prepare(root/'staged',limit=10),10)
                self.assertFalse((root/'staged/cargo-cache/chronoscope-private').exists())
                with self.assertRaises(ValueError): cache.prepare(dep)
                (root/'staged/unknown').mkdir()
                with self.assertRaises(ValueError): cache.restore(root/'staged')

    def test_receipt_requires_exact_identity_and_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp);(folder/'index.html').write_text('frontend')
            receipt={'identity':{'source':'abc','platform':'mac'},'frontend':verification.hashes(folder)}
            with patch.object(verification,'identity',return_value=receipt['identity']):
                verification.validate(receipt,folder)
                (folder/'index.html').write_text('changed')
                with self.assertRaises(ValueError): verification.validate(receipt,folder)
            with patch.object(verification,'identity',return_value={'source':'new','platform':'mac'}):
                with self.assertRaises(ValueError): verification.validate(receipt,folder)

    def test_archive_refuses_traversal_aliases_and_links(self):
        for names in [['../outside'],['/absolute'],['a\\b'],['C:drive'],['a','A'],['a/./b'],['a\n']]:
            with self.subTest(names=names), tempfile.TemporaryDirectory() as temp:
                archive=Path(temp)/'input.zip'
                with zipfile.ZipFile(archive,'w') as z:
                    for name in names:
                        entry=zipfile.ZipInfo(name)
                        entry.filename=name  # Keep malicious wire bytes; Windows constructors normalize slashes.
                        z.writestr(entry,'x')
                with self.assertRaises(ValueError): verification.extract(archive,Path(temp)/'out')
        with tempfile.TemporaryDirectory() as temp:
            archive=Path(temp)/'input.zip'
            with zipfile.ZipFile(archive,'w') as z:
                info=zipfile.ZipInfo('link');info.external_attr=0o120777<<16;z.writestr(info,'outside')
            with self.assertRaises(ValueError): verification.extract(archive,Path(temp)/'out')
            with zipfile.ZipFile(archive,'w') as z:z.writestr('index.html','x'*10)
            with patch.object(verification,'MAX_BYTES',9),self.assertRaises(ValueError):verification.extract(archive,Path(temp)/'out')

    def test_windows_normalized_zip_names_still_check_original_header(self):
        entry=zipfile.ZipInfo('unsafe\\name')
        entry.filename='unsafe/name'  # Windows reader normalization; original header stays unsafe.
        with patch.object(verification.zipfile,'ZipFile') as reader:
            opened=reader.return_value.__enter__.return_value
            opened.infolist.return_value=[entry]
            with self.assertRaises(ValueError):verification.extract(Path('unused.zip'),Path('unused'))
            opened.extractall.assert_not_called()
        with tempfile.TemporaryDirectory() as temp:
            archive=Path(temp)/'safe.zip';out=Path(temp)/'out'
            with zipfile.ZipFile(archive,'w') as z:z.writestr('frontend/index.html','built')
            verification.extract(archive,out)
            self.assertEqual((out/'frontend/index.html').read_text(),'built')

    def test_seal_requires_every_source_and_contract_check(self):
        from source_checks import check_plan
        from validation_suites import load_suites
        names={c['name'] for group in ['unit','prebuild','rust','frontend','packaging'] for c in check_plan(load_suites())[group]}
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'frontend/dist').mkdir(parents=True)
            (root/'frontend/dist/index.html').write_text('built')
            source=root/'source.json';contracts=root/'contracts.json'
            def report(checks):return {'passed':True,'dirty':False,'source_revision':'reviewed','checks':[{'name':n,'exit_code':0} for n in checks]}
            source.write_text(json.dumps(report(names)));contracts.write_text(json.dumps(report(['generated-contracts'])))
            with patch.object(verification,'ROOT',root),patch.object(verification,'identity',return_value={'source':'reviewed'}):
                verification.seal(root/'sealed',source,contracts)
                verification.validate(json.loads((root/'sealed/verification.json').read_text()),root/'sealed/frontend')
                for field,value in [('passed',False),('dirty',True),('source_revision','other'),('checks',[])]:
                    failed=report(names);failed[field]=value;source.write_text(json.dumps(failed))
                    with self.subTest(field=field),self.assertRaises(ValueError):verification.seal(root/'sealed',source,contracts)

    def test_reuse_rejects_unreviewed_run_before_download(self):
        run={'head_sha':'wrong','head_branch':'main','event':'workflow_dispatch','path':'.github/workflows/build.yml','status':'completed','head_repository':{'full_name':'chronoscope-app/chronoscope-public'}}
        with patch.dict(verification.os.environ,{'GITHUB_REPOSITORY':'chronoscope-app/chronoscope-public'}),patch.object(verification,'identity',return_value={'source':'reviewed'}),patch.object(verification,'command',return_value=json.dumps(run)) as command:
            with self.assertRaises(ValueError):verification.reuse('123',Path('/unused'))
            self.assertEqual(command.call_count,1)

if __name__=='__main__':unittest.main()
