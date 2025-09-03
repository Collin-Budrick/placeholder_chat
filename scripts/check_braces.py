#!/usr/bin/env python3
import sys
from pathlib import Path

p = Path("apps/gateway/src/main.rs")
if not p.exists():
    print("File not found:", p)
    sys.exit(1)

text = p.read_text(encoding="utf-8")
lines = text.splitlines()

balance = 0
first_negative = None
negatives = []
for i, line in enumerate(lines, start=1):
    for ch in line:
        if ch == '{':
            balance += 1
        elif ch == '}':
            balance -= 1
    if balance < 0 and first_negative is None:
        first_negative = i
    if balance < 0:
        negatives.append((i, balance, line.strip()))
# Output summary
print(f"Final balance: {balance}")
if first_negative:
    print(f"First negative balance at line {first_negative}")
if negatives:
    print("Negative balances found at lines (line, balance, line-snippet):")
    for ln, bal, snippet in negatives[:20]:
        print(f"{ln}\t{bal}\t{snippet}")
# Also print a few context lines around where final closing brace is if balance>0
if balance > 0:
    # find last lines where '{' occurred
    stack = []
    for i, line in enumerate(lines, start=1):
        for ch in line:
            if ch == '{':
                stack.append(i)
            elif ch == '}':
                if stack:
                    stack.pop()
    print("")
    print("Unclosed '{' likely started at lines (top 10):")
    for ln in stack[-10:]:
        start = max(1, ln-3)
        end = min(len(lines), ln+3)
        print(f"--- around line {ln} ---")
        for j in range(start, end+1):
            prefix = ">" if j==ln else " "
            print(f"{prefix} {j}: {lines[j-1]}")
