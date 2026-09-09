# -*- coding: utf-8 -*-
"""
把 app/ 目录同步到 android/app/src/main/assets/（构建 APK 前执行一次）。
用法：python tools/sync_assets.py
"""
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'app')
DST = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'assets')

EXCLUDE = {'.DS_Store', 'Thumbs.db'}


def main():
    if not os.path.isdir(SRC):
        raise SystemExit('找不到源目录: %s' % SRC)
    if os.path.isdir(DST):
        shutil.rmtree(DST)
    shutil.copytree(SRC, DST, ignore=shutil.ignore_patterns(*EXCLUDE))
    n = 0
    for base, _dirs, files in os.walk(DST):
        n += len(files)
    print('已同步 %d 个文件 -> %s' % (n, DST))


if __name__ == '__main__':
    main()
