"""Package the local prototype without user sessions, secrets or dependencies."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path)
parser.add_argument('--share', action='store_true', help='Exclude local interview-specific review notes')
options = parser.parse_args()
output = options.output or root.parent / "ON-STAGE-UI优化版.zip"
excluded_dirs = {"data", "node_modules", ".git", ".pnpm-store", ".test-temp", "design-review"}
private_notes = {
    'docs/18-49多模态补算与改善建议.md',
    'docs/快捷方式与18-49内容补评.md',
    'docs/多模态辅助评分规则_v1.md',
    '整合验收记录.md',
}
with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=6) as archive:
    for source in sorted(root.rglob("*")):
        relative = source.relative_to(root)
        if not source.is_file() or any(part in excluded_dirs for part in relative.parts):
            continue
        if source.name.startswith(".env") and source.name != ".env.example":
            continue
        if source.suffix in {".log", ".lnk"} or relative.as_posix() in {"test/ui-session.json", "scripts/prepare-rubric-review-1849.mjs"}:
            continue
        if options.share and (relative.as_posix() in private_notes or relative.parts[0] not in {'src','public','scripts','test','docs','examples'} and len(relative.parts)>1):
            continue
        if options.share and len(relative.parts)==1 and source.suffix not in {'.md','.json','.yaml','.ps1','.cmd'} and source.name not in {'.env.example','.gitignore','.gitattributes'}:
            continue
        if len(relative.parts) == 1 and source.suffix == ".png":
            continue
        archive.write(source, Path(root.name) / relative)
print(f"Packaged: {output.name}, {output.stat().st_size:,} bytes")
