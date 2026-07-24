[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root 'runtime\python\python.exe'
if (!(Test-Path -LiteralPath $python)) { throw 'installation_incomplete: bundled Python is missing' }
$code = @'
import json, sys
from pathlib import Path
import cffi, cryptography, et_xmlfile, openpyxl, pycparser, tempfile
from openpyxl import load_workbook
import multi_source_test_audit
from multi_source_test_audit.excel import AUDIT_SHEETS, write_stage_a_workbook_v2
from multi_source_test_audit.paths import WritePolicy
root = Path(sys.executable).parents[2]
assert sys.version_info[:3] == (3, 12, 10)
assert multi_source_test_audit.__version__ == '0.1.2'
assert openpyxl.__version__ == '3.1.5' and cryptography.__version__ == '49.0.0' and cffi.__version__ == '2.1.0'
assert not any('site-packages' in p and str(root) not in p for p in sys.path)
for name in ('stage-a-analysis.schema.json', 'selected-chain-plan.schema.json'):
    json.loads((root / 'schemas' / name).read_text(encoding='utf-8'))
with tempfile.TemporaryDirectory(prefix='msa-runtime-smoke-') as raw:
    temp = Path(raw); headers=['id','title','preconditions','steps','expected','role','mutation','evidence','risk','basis']
    pending='\u672a\u6267\u884c'; reason='\u5f53\u524d\u4ec5\u5b8c\u6210\u9636\u6bb5 A'
    overview='\u5ba1\u8ba1\u603b\u89c8'; associations='\u591a\u6e90\u5173\u8054'; plan_sheet='\u5ba1\u8ba1\u8ba1\u5212'; results='\u6267\u884c\u7ed3\u679c'
    plan=dict(zip(headers,['smoke-001','static audit','none','write workbook','rule pending','auditor','none','workbook','low','smoke']))
    rows={overview:[{'project':'smoke'}],associations:[{'association':'smoke'}],plan_sheet:[plan],results:[{'id':'smoke-001','status':pending,'reason':reason}]}
    target=temp/'stage-a.xlsx'; write_stage_a_workbook_v2(target,rows,policy=WritePolicy(temp,()),project_name='smoke',selected_chain='smoke')
    book=load_workbook(target,read_only=True)
    try:
        assert book.sheetnames == list(AUDIT_SHEETS) and book[plan_sheet].max_column == 10
        assert [row[1] for row in book[results].iter_rows(min_row=5,values_only=True)] == [pending]
    finally: book.close()
print(json.dumps({'status': 'ready', 'python': sys.version.split()[0], 'runtime': multi_source_test_audit.__version__}))
'@
& $python -I -c $code
exit $LASTEXITCODE
