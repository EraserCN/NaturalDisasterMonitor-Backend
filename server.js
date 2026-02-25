// MARK: - 自然灾害报告后端服务 (SQLite版: 双数据库 + JWT 验证 + 自动迁移)

const express = require('express');
const https = require('https');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const apn = require('apn'); 
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3'); // 🆕 引入 SQLite 驱动

// MARK: - 1. 初始化配置
const app = express();
const PORT = process.env.PORT || 3001;
const SALT_ROUNDS = 10;
const BUNDLE_ID = 'org.eraser.NaturalDisasterMonitor';
const JWT_SECRET = 'Super_Secret_Key_Change_This_123'; // 🔒 JWT 密钥

// 定义数据库路径
const USER_DB_PATH = path.join(__dirname, 'users.db');
const DATA_DB_PATH = path.join(__dirname, 'data.db');
const OLD_DB_PATH = path.join(__dirname, 'db.json'); // 旧数据库路径用于迁移

// MARK: - 2. 数据库初始化 (自动创建表)
// 建立两个独立的数据库连接
const userDB = new Database(USER_DB_PATH); // 用于存放用户名和密码
const dataDB = new Database(DATA_DB_PATH); // 用于存放业务数据

// 初始化 Users 表
userDB.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        passwordHash TEXT NOT NULL
    )
`);

// 初始化 Reports 表
dataDB.exec(`
    CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        json_content TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )
`);

console.log("🚀 SQLite 数据库已加载: users.db & data.db");

// MARK: - 2.5 数据迁移逻辑 (db.json -> SQLite)
if (fs.existsSync(OLD_DB_PATH)) {
    console.log("📦 检测到旧版数据库 db.json，准备迁移数据...");
    try {
        const oldDbData = fs.readFileSync(OLD_DB_PATH, 'utf8');
        // 只有文件不为空才解析
        if (oldDbData.trim()) {
            const oldDb = JSON.parse(oldDbData);
            
            // --- 1. 迁移用户 ---
            if (oldDb.users && Array.isArray(oldDb.users) && oldDb.users.length > 0) {
                const insertUser = userDB.prepare('INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)');
                // 使用事务提高插入速度
                const migrateUsers = userDB.transaction((users) => {
                    let count = 0;
                    for (const user of users) {
                        if (user.username && user.passwordHash) {
                            insertUser.run(user.id || uuidv4(), user.username, user.passwordHash);
                            count++;
                        }
                    }
                    return count;
                });
                const userCount = migrateUsers(oldDb.users);
                console.log(`   👤 成功迁移 ${userCount} 个用户`);
            }

            // --- 2. 迁移报告 ---
            if (oldDb.reports && Array.isArray(oldDb.reports) && oldDb.reports.length > 0) {
                const insertReport = dataDB.prepare('INSERT OR IGNORE INTO reports (id, json_content, created_at) VALUES (?, ?, ?)');
                const migrateReports = dataDB.transaction((reports) => {
                    let count = 0;
                    // 旧数据通常是 [最新, ..., 最旧]
                    // 为了保持顺序，我们用当前时间倒推
                    const baseTime = Date.now();
                    
                    reports.forEach((report, index) => {
                        const rId = report.id || uuidv4();
                        // 确保 report 对象里也有 id
                        report.id = rId;
                        
                        // 如果原数据没有时间戳，就用 (当前时间 - 索引秒数) 来模拟，保证 index 0 (最新) 的时间戳最大
                        // 这样 ORDER BY created_at DESC 就能还原之前的顺序
                        const createdAt = report.timestamp || (baseTime - index * 1000);
                        
                        insertReport.run(rId, JSON.stringify(report), createdAt);
                        count++;
                    });
                    return count;
                });
                const reportCount = migrateReports(oldDb.reports);
                console.log(`   📝 成功迁移 ${reportCount} 份报告`);
            }

            // --- 3. 重命名旧文件 ---
            const backupPath = `${OLD_DB_PATH}.migrated_${Date.now()}`;
            fs.renameSync(OLD_DB_PATH, backupPath);
            console.log(`✅ 迁移完成！db.json 已重命名为: ${path.basename(backupPath)}`);
        }
    } catch (err) {
        console.error("❌ 数据迁移失败 (已跳过):", err.message);
        // 迁移失败不应该阻止服务器启动，只是打印错误
    }
}

// MARK: - 3. APNs 双通道配置
const keysOptions = {
    token: {
        key: path.join(__dirname, 'AuthKey_4P8H3V8HA4.p8'),
        keyId: '4P8H3V8HA4',
        teamId: '3P763V36ZR'
    }
};

const apnProviderSandbox = new apn.Provider({ ...keysOptions, production: false });
const apnProviderProduction = new apn.Provider({ ...keysOptions, production: true });

console.log("🚀 APNs 推送服务已初始化");

// MARK: - 4. 中间件
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// MARK: - 🔒 身份验证中间件
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.status(401).json({ message: '未授权：请先登录' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: '禁止访问：Token 无效或已过期' });
        req.user = user;
        next();
    });
};

// MARK: - 5. 图片上传配置
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// MARK: - ✅ 辅助函数：颜色逻辑
const getColorName = (level) => {
    if (!level) return 'yellow'; 
    const l = String(level);
    if (l === '特别严重' || l === 'critical' || l === 'red') return 'red';
    if (l === '严重' || l === 'severe' || l === 'orange' || l === '较重') return 'orange';
    return 'yellow';
};

// MARK: - 6. 核心：双通道推送逻辑
const sendLiveActivityUpdate = (token, report) => {
    if (!token) return console.error("❌ Token 为空");

    const notification = new apn.Notification();
    
    notification.headers = function() {
        return {
            "apns-priority": "10",
            "apns-expiration": "0",
            "apns-push-type": "liveactivity",
            "apns-topic": `${BUNDLE_ID}.push-type.liveactivity`
        };
    };

    notification.topic = `${BUNDLE_ID}.push-type.liveactivity`;
    
    notification.rawPayload = {
        aps: {
            timestamp: Math.floor(Date.now() / 1000),
            event: 'update',
            'content-state': {
                currentLevel: report.level || "未知", 
                levelColorName: getColorName(report.level),
                updateTimestamp: Math.floor(Date.now() / 1000)
            },
            alert: {
                title: `灾害更新：${report.title}`,
                body: `当前等级已变更为：${report.level}`
            },
            sound: 'default'
        }
    };

    const handleResult = (source, promise) => {
        promise.then(result => {if (result.failed.length > 0 && 
    result.failed[0].response && 
    result.failed[0].response.reason !== 'BadDeviceToken') {
                console.error(`❌ [${source}] 推送失败:`, JSON.stringify(result.failed[0], null, 2));
            } else if (result.sent.length > 0) {
                console.log(`✅ [${source}] 推送成功`);
            }
        }).catch(err => console.error(`🔥 [${source}] 错误:`, err.message));
    };

    handleResult('Sandbox', apnProviderSandbox.send(notification, token));
    handleResult('Production', apnProviderProduction.send(notification, token));
};

// MARK: - 7. API 路由 (数据库操作已替换为 SQLite)

// --- 🔓 登录接口 ---
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const stmt = userDB.prepare('SELECT * FROM users WHERE username = ?');
        const user = stmt.get(username);
        
        if (user && await bcrypt.compare(password, user.passwordHash)) {
            const token = jwt.sign(
                { id: user.id, username: user.username }, 
                JWT_SECRET, 
                { expiresIn: '24h' }
            );
            res.status(200).json({ message: 'OK', token: token });
        } else {
            res.status(401).json({ message: 'Fail' });
        }
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ message: 'Server Error' });
    }
});

// --- 🔒 用户管理接口 ---

// 1. 获取用户列表
app.get('/api/users', authenticateToken, (req, res) => {
    try {
        const stmt = userDB.prepare('SELECT id, username FROM users');
        const users = stmt.all();
        res.status(200).json(users);
    } catch (err) {
        res.status(500).json({ message: 'Database Error' });
    }
});

// 2. 删除用户
app.delete('/api/users/:id', authenticateToken, (req, res) => {
    try {
        const stmt = userDB.prepare('DELETE FROM users WHERE id = ?');
        const info = stmt.run(req.params.id);
        
        if (info.changes > 0) {
            res.status(200).json({ message: 'User deleted' });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Database Error' });
    }
});

// 3. 修改用户密码
app.put('/api/users/:id', authenticateToken, async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: 'Password required' });

    try {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const stmt = userDB.prepare('UPDATE users SET passwordHash = ? WHERE id = ?');
        const info = stmt.run(passwordHash, req.params.id);

        if (info.changes > 0) {
            res.status(200).json({ message: 'Password updated' });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Database Error' });
    }
});

// --- 🔓 注册接口 ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Missing fields' });
    
    try {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const newId = uuidv4();
        
        const stmt = userDB.prepare('INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)');
        stmt.run(newId, username, passwordHash);
        
        res.status(201).json({ userId: newId, message: 'User created' });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ message: 'Exist' });
        }
        res.status(500).json({ message: 'Database Error' });
    }
});

// --- 🔓 灾害报告相关 API (data.db) ---

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file' });
    res.status(201).json({ filePath: `/uploads/${req.file.filename}` });
});

app.get('/api/reports', (req, res) => {
    try {
        // 按时间倒序获取 (最新数据在最前，和 unshift 行为一致)
        const stmt = dataDB.prepare('SELECT json_content FROM reports ORDER BY created_at DESC');
        const rows = stmt.all();
        const reports = rows.map(row => JSON.parse(row.json_content));
        res.status(200).json(reports);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Database Error' });
    }
});

app.post('/api/reports', (req, res) => {
    try {
        const id = req.body.id || uuidv4();
        const newReport = { 
            ...req.body, 
            id: id, 
            liveActivityToken: null 
        };
        const createdAt = Date.now();

        const stmt = dataDB.prepare('INSERT INTO reports (id, json_content, created_at) VALUES (?, ?, ?)');
        stmt.run(id, JSON.stringify(newReport), createdAt);

        console.log('📝 新报告 (SQLite):', newReport.title);
        res.status(201).json(newReport);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Database Error' });
    }
});

app.post('/api/live-activity/token', (req, res) => {
    const { reportId, token } = req.body;
    if (!reportId || !token) return res.status(400).json({ message: 'Missing args' });

    try {
        const selectStmt = dataDB.prepare('SELECT json_content, created_at FROM reports WHERE id = ?');
        const row = selectStmt.get(reportId);

        if (row) {
            const report = JSON.parse(row.json_content);
            report.liveActivityToken = token;
            
            const updateStmt = dataDB.prepare('UPDATE reports SET json_content = ? WHERE id = ?');
            updateStmt.run(JSON.stringify(report), reportId);

            console.log(`💾 Token 已保存: ${token.substring(0,6)}...`);
            res.status(200).json({ message: 'Saved' });
        } else {
            res.status(404).json({ message: 'Report not found' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Database Error' });
    }
});

app.put('/api/reports/:id', (req, res) => {
    try {
        const selectStmt = dataDB.prepare('SELECT json_content FROM reports WHERE id = ?');
        const row = selectStmt.get(req.params.id);

        if (row) {
            const currentReport = JSON.parse(row.json_content);
            const updatedReport = { ...currentReport, ...req.body };
            
            const updateStmt = dataDB.prepare('UPDATE reports SET json_content = ? WHERE id = ?');
            updateStmt.run(JSON.stringify(updatedReport), req.params.id);

            console.log('🔄 报告更新:', updatedReport.title);
            
            if (updatedReport.liveActivityToken) {
                sendLiveActivityUpdate(updatedReport.liveActivityToken, updatedReport);
            }
            res.status(200).json(updatedReport);
        } else {
            res.status(404).json({ message: 'Not found' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Database Error' });
    }
});

app.delete('/api/reports/:id', (req, res) => {
    try {
        const stmt = dataDB.prepare('DELETE FROM reports WHERE id = ?');
        const info = stmt.run(req.params.id);

        if (info.changes > 0) {
            res.status(200).json({ message: 'Deleted' });
        } else {
            res.status(404).json({ message: 'Not found' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Database Error' });
    }
});

// MARK: - 8. 启动 HTTPS
try {
    const privateKey = fs.readFileSync('/root/ygkkkca/private.key', 'utf8');
    const certificate = fs.readFileSync('/root/ygkkkca/cert.crt', 'utf8');
    
    https.createServer({ key: privateKey, cert: certificate }, app).listen(PORT, () => {
        console.log(`✅ HTTPS 服务启动成功 (端口: ${PORT})`);
        console.log(`🔒 SQLite 模式: 已启用`);
    });
} catch (error) {
    console.error('❌ HTTPS 启动失败:', error.message);
    process.exit(1);
}
