#!/usr/bin/env bash
# Parse GitHub closing references out of a PR body + commit messages and print
# every referenced issue number, deduplicated and ascending, one per line.
#
# Used by `.github/workflows/qa-issue-label.yml` to decide which issues get the
# `status:in-qa` label when a PR merges into the `qa` staging branch (#806).
#
# Why a standalone script: this parser is the bit that broke (#1763) and it is
# fiddly enough to deserve a forcing-function test. The matching shell test
# (`parse-closing-refs.test.sh`, run directly: `bash <file>`) pins the
# behaviour, mirroring the `extract-linked-issues.sh` + `.test.sh` pair.
#
# Input is a single newline-joined string on stdin (PR body, then a blank line,
# then every commit headline/body). Numbers are printed to stdout.
#
# Matching rules - what counts as a closing reference:
#   * A keyword from GitHub's exact set, case-insensitive:
#       close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved.
#   * An optional colon after the keyword (`closes: #5`), then whitespace.
#   * THEN a run of one-or-more `#N` tokens. GitHub's own linking honours one
#     `#N` per keyword, but PRs in this repo routinely write a space-separated
#     list under a single keyword (`closes #1720 #1721 #1722`), and the old
#     single-`#N` regex labelled ONLY the first of those (#1763, gap 1). So we
#     consume a trailing run, where the separators between successive `#N`
#     tokens may be whitespace, commas, and/or the word "and"
#     (`closes #1, #2 and #3`).
#
# What must NOT match: a bare `#N` with no preceding keyword (e.g. the
# `Refs #1714, #806` line that conventionally trails an issue body). The run is
# anchored to a keyword; a `#N` only counts while it stays inside the
# keyword-initiated run.
#
# A `\b` (word boundary) before the keyword stops a match inside a longer word
# (e.g. "preclose", "prefix").

set -euo pipefail

INPUT="$(cat || true)"

# The keyword half of the pattern. `[[:<:]]` / `\b` portability: GNU grep -P is
# not guaranteed on macOS, so we lean on POSIX ERE with an explicit
# non-word-char (or start-of-line) guard implemented via grep's own `\b`, which
# both GNU and BSD grep honour in -E mode for this case.
KEYWORD='(close[sd]?|fix(es|ed)?|resolve[sd]?)'

# The trailing run: `:?` optional colon, required whitespace, then one `#N`
# followed by zero-or-more `(<sep>#N)` where <sep> is any mix of whitespace,
# commas, and the literal word "and".
#   sep      = [[:space:],]            (whitespace or comma)
#   run-tail = (sep | "and" )* #N
RUN='#[0-9]+([[:space:],]+(and[[:space:]]+)?#[0-9]+)*'

# Match each keyword-anchored span, then pull every #N out of the span. The
# two-stage grep keeps stray `#N` (no keyword) out: only spans that begin with a
# keyword survive the first grep, so only their numbers reach the second.
printf '%s\n' "$INPUT" \
  | grep -oiE "\\b${KEYWORD}:?[[:space:]]+${RUN}" \
  | grep -oE '#[0-9]+' \
  | grep -oE '[0-9]+' \
  | sort -un \
  || true
