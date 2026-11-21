@echo off
cd /d "%~dp0"
node server.js >> webadmin.log 2>&1
