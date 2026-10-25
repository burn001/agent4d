#!/usr/bin/env python3
"""compose.py 의 별칭(같은 인자). 재생성: python music/make_bgm.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compose import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
