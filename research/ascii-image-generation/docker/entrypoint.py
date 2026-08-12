import os
import sys
if len(sys.argv) == 1 or sys.argv[1].startswith("-"):
    os.execvp("python", ["python", "/workspace/smoke.py", *sys.argv[1:]])
os.execvp(sys.argv[1], sys.argv[1:])
