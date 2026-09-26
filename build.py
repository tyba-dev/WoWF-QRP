"""Assemble index.html from src/ and data/. Run: python3 build.py"""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
VER=datetime.now(ZoneInfo('Europe/London')).strftime('%Y.%m.%d-%H%M')
root=Path(__file__).parent
head=(root/'src/shell_head.html').read_text(encoding='utf-8').replace('__BUNDLE__',(root/'data/bundle.b64').read_text().strip())
out=head+(root/'src/app.js').read_text(encoding='utf-8').replace('__BUILD__',VER,1)+'\n'+(root/'src/nav.js').read_text(encoding='utf-8')+(root/'src/shell_tail.html').read_text(encoding='utf-8')
(root/'index.html').write_text(out,encoding='utf-8'); print('index.html', len(out)//1024, 'KB', 'version', VER)
