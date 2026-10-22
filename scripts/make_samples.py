#!/usr/bin/env python3
"""Create small synthetic CSV/XLSX fixtures using only the standard library."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
import csv

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / 'tests/fixtures/import'
SAMPLES.mkdir(parents=True, exist_ok=True)
headers = ['entity', 'timestamp', 'latitude', 'longitude', 'category', 'label', 'value', 'related_to']
rows = [
    ['Alpha', '2025-06-17T08:00:00Z', 37.7955, -122.3937, 'Arrival', 'Ferry terminal', 10, 'Bravo'],
    ['Bravo', '2025-06-17T08:01:00Z', 37.7956, -122.3937, 'Arrival', 'Ferry terminal', 20, 'Alpha'],
    ['Alpha', '2025-06-17T08:15:00Z', 37.7955, -122.3937, 'Dwell', 'Ferry terminal', 30, ''],
    ['Alpha', '2025-06-17T09:00:00Z', 37.7765, -122.417, 'Transit', 'Civic center', 40, ''],
    ['Bravo', '2025-06-17T09:30:00Z', '', '', 'Message', 'No location event', 50, 'Alpha'],
]
with (SAMPLES / 'small-study.csv').open('w', newline='') as f:
    w = csv.writer(f); w.writerow(headers); w.writerows(rows)
with (SAMPLES / 'custom-dates.csv').open('w', newline='') as f:
    w = csv.writer(f, delimiter=';'); w.writerow(headers)
    for row in rows:
        row = row.copy(); row[1] = '17/06/2025 ' + row[1][11:19]; w.writerow(row)
with (SAMPLES / 'rejected-rows.csv').open('w', newline='') as f:
    w = csv.writer(f); w.writerow(headers); w.writerow(rows[0]);
    w.writerow(['Invalid', '2025-06-17', 91, 0, '', '', '', ''])
    w.writerow(['Invalid', 'ambiguous date', 37, -122, '', '', '', ''])
    w.writerow(['Invalid', '2025-06-17', 'NaN', 0, '', '', '', ''])

def cell(col, row, value, style=None):
    ref = f'{chr(65 + col)}{row}'
    if isinstance(value, (int, float)):
        return f'<c r="{ref}"' + (f' s="{style}"' if style is not None else '') + f'><v>{value}</v></c>'
    return f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'

def sheet(native_dates=False, row_offset=0):
    contents = []
    contents.append(f'<row r="{row_offset+1}">' + ''.join(cell(i,row_offset+1,h) for i,h in enumerate(headers)) + '</row>')
    for n, values in enumerate(rows, start=2):
        # Preserve a real blank source row in the workbook.
        row_no = n + row_offset + (1 if n >= 4 else 0)
        if native_dates:
            values = values.copy()
            hours = int(values[1][11:13]); minutes = int(values[1][14:16])
            values[1] = 45825 + (hours*60+minutes)/1440
        contents.append(f'<row r="{row_no}">' + ''.join(cell(i,row_no,v,1 if native_dates and i==1 else None) for i,v in enumerate(values)) + '</row>')
    return '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + ''.join(contents) + '</sheetData></worksheet>'

with ZipFile(SAMPLES / 'small-study.xlsx', 'w', ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', '''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>''')
    z.writestr('_rels/.rels', '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>''')
    z.writestr('xl/workbook.xml', '''<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ISO timestamps" sheetId="1" r:id="rId1"/><sheet name="Excel date cells" sheetId="2" r:id="rId2"/></sheets></workbook>''')
    z.writestr('xl/_rels/workbook.xml.rels', '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>''')
    z.writestr('xl/styles.xml', '''<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="22" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>''')
    z.writestr('xl/worksheets/sheet1.xml', sheet())
    z.writestr('xl/worksheets/sheet2.xml', sheet(True, 3))
