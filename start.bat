@echo off
wsl sudo service docker start
wsl sudo docker start searxng
start cmd /k "ollama serve"
cd /d C:\xampp\htdocs\aniruddh-project\local_AI
start cmd /k "node server.js"
start cmd /k "cloudflared tunnel --url https://localhost:5000"