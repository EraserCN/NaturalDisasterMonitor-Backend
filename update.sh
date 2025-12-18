#!/bin/bash

# 定义项目路径
PROJECT_DIR="/root/NaturalDisasterMonitor-Backend"

# 1. 进入项目目录
cd "$PROJECT_DIR" || { echo "❌ 找不到目录 $PROJECT_DIR"; exit 1; }

echo "========================================="
echo "   开始更新灾害报告后端服务..."
echo "========================================="

# 2. 备份数据库 (以防万一)
echo "📦 正在备份数据库..."
if [ -f "db.json" ]; then
    cp db.json "db.json.backup_$(date +%Y%m%d_%H%M%S)"
    echo "✅ 数据库已备份"
else
    echo "⚠️ 未找到 db.json，跳过备份"
fi

# 3. 处理 Git 更新
echo "⬇️ 正在从 GitHub 拉取更新..."

# 检查是否已经是 git 仓库
if [ ! -d ".git" ]; then
    echo "⚙️ 初始化 Git 仓库..."
    git init
    git remote add origin https://github.com/EraserCN/NaturalDisasterMonitor-Backend.git
    git fetch --all
    # 第一次强制重置为远程状态（注意：这会覆盖本地所有未提交的修改，除了 db.json）
    # 但为了保护你刚才写的 server.js，我们先尝试 stash
    echo "⚠️ 首次连接，正在尝试保留本地修改..."
    git add .
    git stash
    git pull origin main --allow-unrelated-histories
    git stash pop # 尝试恢复你的 HTTPS/登录 修改
else
    # 既然你已经修改了本地文件，我们需要先“暂存”你的修改，拉取后再“放回”你的修改
    echo "🔄 正在合并远程更新..."
    git stash # 把你的 HTTPS/登录代码先存起来
    git pull origin main
    git stash pop # 把你的代码合并回来
fi

# 4. 检查是否有冲突
if [ $? -ne 0 ]; then
    echo "❌ 警告：更新过程中发生代码冲突！"
    echo "请手动检查 server.js 或 index.html 中的 <<<<<<< 标记并修复。"
    # 这里不退出，尝试继续安装依赖
fi

# 5. 更新依赖
echo "📦 正在检查依赖更新..."
npm install

# 6. 重启服务
echo "🔄 正在重启服务..."

# 查找正在运行的 node server.js 进程 ID
PID=$(pgrep -f "node server.js")

if [ -n "$PID" ]; then
    echo "   停止旧进程 (PID: $PID)..."
    kill -9 $PID
    # 等待一秒确保端口释放
    sleep 2
fi

# 后台启动服务并记录日志
echo "   启动新服务..."
nohup node server.js > server.log 2>&1 &

echo "========================================="
echo "✅ 更新完成！"
echo "🌐 请访问: https://你的域名:3000"
echo "========================================="
