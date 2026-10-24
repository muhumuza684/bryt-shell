#!/bin/sh
# Test stand-in for PowerShell: decodes -EncodedCommand (UTF-16LE base64) and runs it with sh.
while [ $# -gt 0 ]; do case "$1" in -EncodedCommand) enc="$2"; shift;; esac; shift; done
cmd=$(printf %s "$enc" | base64 -d | iconv -f UTF-16LE -t UTF-8)
cmd="${cmd#*new(\$false);}"
exec sh -c "$cmd"
