@echo off
wsl sudo service docker start
wsl sudo docker start searxng
start cmd /k "ollama serve"
start cmd /k "node server.js"