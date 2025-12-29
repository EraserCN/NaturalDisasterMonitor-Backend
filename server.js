// MARK: - 自然灾害报告后端服务 (最终完整版: JWT 验证 + 完整业务逻辑)

const express = require('express');
const https = require('https');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const apn = require('apn'); 
const jwt = require('jsonwebtoken'); // 🆕 引入 JWT 库

// MARK: - 1. 初始化配置
const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE_PATH = path.join(__dirname, 'db.json');
const SALT_ROUNDS = 10;
const BUNDLE_ID = 'org.eraser.NaturalDisasterMonitor';
const JWT_SECRET = 'Super_Secret_Key_Change_This_123'; // 🔒 JWT 密钥 (生产环境请修改)

// MARK: - 2. APNs 双通道配置
const keysOptions = {
    token: {
        key: path.join(__dirname, 'AuthKey_4P8H3V8HA4.p8'),
        keyId: '4P8H3V8HA4',
        teamId: '3P763V36ZR'
    }
};

// 双通道初始化
const apnProviderSandbox = new apn.Provider({ ...keysOptions, production: false });
const apnProviderProduction = new apn.Provider({ ...keysOptions, production: true });

console.log("🚀 APNs 推送服务已初始化 (JWT验证版)");

// MARK: - 3. 中间件
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// 托管静态文件 (确保 admin.html 能被访问)
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// MARK: - 🔒 身份验证中间件 (核心新增)
const authenticateToken = (req, res, next) => {
    // 1. 从请求头获取 token (格式: Bearer <token>)
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.status(401).json({ message: '未授权：请先登录' }); // 没有 Token
    }

    // 2. 验证 Token
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: '禁止访问：Token 无效或已过期' }); // Token 无效
        }
        req.user = user; // 验证通过，将用户信息存入 req
        next(); // 放行
    });
};

// MARK: - 4. 数据库辅助
const readDb = () => {
    try {
        if (!fs.existsSync(DB_FILE_PATH)) {
            const initialDb = { users: [], reports: [] };
            fs.writeFileSync(DB_FILE_PATH, JSON.stringify(initialDb));
            return initialDb;
        }
        return JSON.parse(fs.readFileSync(DB_FILE_PATH));
    } catch (error) { return { users: [], reports: [] }; }
};

const writeDb = (db) => {
    try { fs.writeFileSync(DB_FILE_PATH, JSON.stringify(db, null, 2)); } catch (e) {}
};

// MARK: - 5. 图片上传
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// MARK: - ✅ 颜色逻辑修正
const getColorName = (level) => {
    if (!level) return 'yellow'; // 防止空值报错
    
    // 转换为字符串并判断
    const l = String(level);

    // 1. 🟥 特别严重
    if (l === '特别严重' || l === 'critical' || l === 'red') {
        return 'red';
    }

    // 2. 🟧 严重 (包含 '严重', '较重', 'orange', 'severe')
    if (l === '严重' || l === 'severe' || l === 'orange' || l === '较重') {
        return 'orange';
    }

    // 3. 🟨 一般/默认
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

    // --- Sandbox 通道 ---
    apnProviderSandbox.send(notification, token)
        .then(result => {
            if (result.sent.length > 0) {
                console.log("✅ [Sandbox] 推送成功！");
            } else if (result.failed.length > 0) {
                // 仅打印非 BadDeviceToken 错误
                if (result.failed[0].response?.reason !== 'BadDeviceToken') {
                    console.error("❌ [Sandbox] 失败:", JSON.stringify(result.failed[0], null, 2));
                }
            }
        })
        .catch(err => console.error("🔥 [Sandbox] 错误:", err.message));

    // --- Production 通道 ---
    apnProviderProduction.send(notification, token)
        .then(result => {
            if (result.sent.length > 0) {
                console.log("✅ [Production] 推送成功！");
            } else if (result.failed.length > 0) {
                if (result.failed[0].response?.reason !== 'BadDeviceToken') {
                    console.error("❌ [Production] 失败:", JSON.stringify(result.failed[0], null, 2));
                }
            }
        })
        .catch(err => console.error("🔥 [Production] 错误:", err.message));
};

// MARK: - 7. API 路由

// --- 🔓 登录接口 (升级版：返回 JWT Token) ---
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const db = readDb();
    const user = db.users.find(u => u.username === username);
    
    if (user && await bcrypt.compare(password, user.passwordHash)) {
        // 登录成功，生成 Token (有效期 24小时)
        const token = jwt.sign(
            { id: user.id, username: user.username }, 
            JWT_SECRET, 
            { expiresIn: '24h' }
        );
        res.status(200).json({ message: 'OK', token: token }); // ✅ 返回 Token
    } else {
        res.status(401).json({ message: 'Fail' });
    }
});

// --- 🔒 用户管理接口 (已加锁：需要 authenticateToken) ---

// 1. 获取用户列表
app.get('/api/users', authenticateToken, (req, res) => {
    const db = readDb();
    const safeUsers = db.users.map(u => ({ id: u.id, username: u.username }));
    res.status(200).json(safeUsers);
});

// 2. 删除用户
app.delete('/api/users/:id', authenticateToken, (req, res) => {
    const db = readDb();
    const initialLength = db.users.length;
    const newUsers = db.users.filter(u => u.id !== req.params.id);
    
    if (newUsers.length === initialLength) {
        return res.status(404).json({ message: 'User not found' });
    }
    
    db.users = newUsers;
    writeDb(db);
    res.status(200).json({ message: 'User deleted' });
});

// 3. 修改用户密码
app.put('/api/users/:id', authenticateToken, async (req, res) => {
    const { password } = req.body; // 目前只允许修改密码
    if (!password) return res.status(400).json({ message: 'Password required' });

    const db = readDb();
    const userIndex = db.users.findIndex(u => u.id === req.params.id);

    if (userIndex === -1) {
        return res.status(404).json({ message: 'User not found' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    db.users[userIndex].passwordHash = passwordHash;
    
    writeDb(db);
    res.status(200).json({ message: 'Password updated' });
});

// --- 🔓 注册接口 (保持公开) ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Missing fields' });
    
    const db = readDb();
    if (db.users.find(u => u.username === username)) return res.status(409).json({ message: 'Exist' });
    
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = { id: uuidv4(), username, passwordHash };
    db.users.push(newUser);
    writeDb(db);
    res.status(201).json({ userId: newUser.id, message: 'User created' });
});

// --- 🔓 灾害报告相关 API (保持原有业务逻辑) ---
// 注意：为了不影响现有 App 的功能，灾害报告接口暂未加 authenticateToken。
// 如果需要在 App 端也进行鉴权，请让 App 端登录后在 Header 带上 Token，然后在下面接口加 authenticateToken

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file' });
    res.status(201).json({ filePath: `/uploads/${req.file.filename}` });
});

app.get('/api/reports', (req, res) => res.status(200).json(readDb().reports));

app.post('/api/reports', (req, res) => {
    const db = readDb();
    const newReport = { ...req.body, id: req.body.id || uuidv4(), liveActivityToken: null };
    db.reports.unshift(newReport);
    writeDb(db);
    console.log('📝 新报告:', newReport.title);
    res.status(201).json(newReport);
});

app.post('/api/live-activity/token', (req, res) => {
    const { reportId, token } = req.body;
    if (!reportId || !token) return res.status(400).json({ message: 'Missing args' });
    const db = readDb();
    const idx = db.reports.findIndex(r => r.id === reportId);
    if (idx !== -1) {
        db.reports[idx].liveActivityToken = token;
        writeDb(db);
        console.log(`💾 Token 已保存: ${token.substring(0,6)}...`);
        res.status(200).json({ message: 'Saved' });
    } else {
        res.status(404).json({ message: 'Report not found' });
    }
});

app.put('/api/reports/:id', (req, res) => {
    const db = readDb();
    const idx = db.reports.findIndex(r => r.id === req.params.id);
    if (idx !== -1) {
        const updatedReport = { ...db.reports[idx], ...req.body };
        db.reports[idx] = updatedReport;
        writeDb(db);
        console.log('🔄 报告更新:', updatedReport.title);
        
        // 触发 Live Activity 推送
        if (updatedReport.liveActivityToken) {
            sendLiveActivityUpdate(updatedReport.liveActivityToken, updatedReport);
        }
        res.status(200).json(updatedReport);
    } else {
        res.status(404).json({ message: 'Not found' });
    }
});

app.delete('/api/reports/:id', (req, res) => {
    const db = readDb();
    const newReports = db.reports.filter(r => r.id !== req.params.id);
    if (db.reports.length !== newReports.length) {
        db.reports = newReports;
        writeDb(db);
        res.status(200).json({ message: 'Deleted' });
    } else {
        res.status(404).json({ message: 'Not found' });
    }
});

// MARK: - 8. 启动 HTTPS
try {
    const privateKey = fs.readFileSync('/root/ygkkkca/private.key', 'utf8');
    const certificate = fs.readFileSync('/root/ygkkkca/cert.crt', 'utf8');
    
    https.createServer({ key: privateKey, cert: certificate }, app).listen(PORT, () => {
        console.log(`✅ HTTPS 服务启动成功 (端口: ${PORT})`);
        console.log(`🔒 JWT 验证已启用：访问 /api/users 相关接口需要 Token`);
    });
} catch (error) {
    console.error('❌ HTTPS 启动失败:', error.message);
    process.exit(1);
}
