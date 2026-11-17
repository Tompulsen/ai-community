"""Prepare a reviewed overlay from the exact exported production source files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kind', choices=('image-async', 'video-async'), required=True)
    parser.add_argument('--source', type=Path, required=True, help='Directory containing the exported service/ tree')
    parser.add_argument('--output', type=Path, required=True, help='New, empty build-context path')
    args = parser.parse_args()
    bundle = Path(__file__).resolve().parent
    checksums = json.loads((bundle / 'baseline-sha256.json').read_text())[args.kind]
    for relative, expected in checksums.items():
        source = args.source / relative
        if not source.is_file() or source.is_symlink() or hashlib.sha256(source.read_bytes()).hexdigest() != expected:
            parser.error('baseline mismatch: ' + relative)
    output = args.output.resolve()
    if output.exists():
        parser.error('output must be a new directory')
    output.mkdir(parents=True)
    for relative in checksums:
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.source / relative, target)
    patch = bundle / (args.kind + '.patch')
    environment = {**os.environ, 'GIT_CEILING_DIRECTORIES': str(output.parent)}
    subprocess.run(['git', 'apply', '--check', str(patch)], cwd=output, env=environment, check=True)
    subprocess.run(['git', 'apply', str(patch)], cwd=output, env=environment, check=True)
    shutil.copyfile(bundle / 'community_wallet.py', output / 'service/community_wallet.py')
    shutil.copyfile(bundle / ('Dockerfile.' + args.kind.split('-')[0]), output / 'Dockerfile')
    print(json.dumps({'kind': args.kind, 'context': str(output), 'baseline_verified': True}))


if __name__ == '__main__':
    main()
