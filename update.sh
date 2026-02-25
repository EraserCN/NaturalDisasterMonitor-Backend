#!/bin/bash

# 定义项目路径
PROJECT_DIR="/root/NaturalDisasterMonitor-Backend"

# 1. 进入项目目录
cd "$PROJECT_DIR" || { echo "❌ 找不到目录 $PROJECT_DIR"; exit 1; }

echo "========================================="
echo "   开始更新灾害报告后端服务..."
echo "========================================="

# 2. 备份数据库 (支持 SQLite 和旧 JSON)
echo "📦 正在备份数据库..."
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_COUNT=0

# 备份用户数据库
if [ -f "users.db" ]; then
    cp users.db "users.db.backup_$TIMESTAMP"
    echo "✅ users.db 已备份"
    ((BACKUP_COUNT++))
fi

# 备份数据数据库
if [ -f "data.db" ]; then
    cp data.db "data.db.backup_$TIMESTAMP"
    echo "✅ data.db 已备份"
    ((BACKUP_COUNT++))
fi

# 备份旧版 JSON 数据库 (如果存在)
if [ -f "db.json" ]; then
    cp db.json "db.json.backup_$TIMESTAMP"
    echo "✅ db.json 已备份"
    ((BACKUP_COUNT++))
fi

if [ $BACKUP_COUNT -eq 0 ]; then
    echo "⚠️ 未找到任何数据库文件，跳过备份"
fi

# 3. 处理 Git 更新
echo "⬇️ 正在从 GitHub 拉取更新..."

# 检查是否已经是 git 仓库
if [ ! -d ".git" ]; then
    echo "⚙️ 初始化 Git 仓库..."
    git init
    git remote add origin https://github.com/EraserCN/NaturalDisasterMonitor-Backend.git
    git fetch --all
    echo "⚠️ 首次连接，正在尝试保留本地修改..."
    git add .
    git stash
    git pull origin main --allow-unrelated-histories
    git stash pop 
else
    echo "🔄 正在合并远程更新..."
    git stash 
    git pull origin main
    git stash pop 
fi

# 4. 检查是否有冲突
if [ $? -ne 0 ]; then
    echo "❌ 警告：更新过程中发生代码冲突！"
    echo "请手动检查 server.js 中的 <<<<<<< 标记并修复。"
fi

# 5. 更新依赖 (非常重要：安装 better-sqlite3 等新包)
echo "📦 正在同步依赖 (包括 SQLite 驱动)..."
# 为了避免 sqlite 编译问题，有时候需要 --build-from-source，但通常直接 install 即可
npm install

# 6. 重启服务
echo "🔄 正在重启服务..."

# 查找正在运行的 node server.js 进程 ID
PID=$(pgrep -f "node server.js")

if [ -n "$PID" ]; then
    echo "   停止旧进程 (PID: $PID)..."
    kill -9 $PID
    sleep 2
fi

# 后台启动服务
echo "   启动新服务..."
nohup node server.js > server.log 2>&1 &

echo "========================================="
echo "✅ 更新完成！"
echo "🌐 请访问: https://你的域名:3001"
echo "========================================="
