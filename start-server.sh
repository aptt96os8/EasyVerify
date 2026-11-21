#!/bin/sh
cd "$(dirname "$0")" || exit 1
exec "${NODE_BIN:-node}" server.js >> "${AUTH_LOG_PATH:-webadmin.log}" 2>&1
