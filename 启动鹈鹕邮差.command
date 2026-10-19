#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print '请先安装 Node.js 22 或更新版本，再打开游戏。'
  read -k 1 '?按任意键关闭。'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  print '首次启动需要安装依赖，请在此目录运行 npm ci。'
  read -k 1 '?按任意键关闭。'
  exit 1
fi
if [[ "$(curl -fsS http://127.0.0.1:5178/ 2>/dev/null)" == *'鹈鹕邮差'* ]]; then
  open 'http://127.0.0.1:5178/'
  exit 0
fi
npm run dev -- --open
