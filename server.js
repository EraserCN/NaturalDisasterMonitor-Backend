// MARK: - 自然灾害报告全栈服务 (合并版: API + 静态托管 + JWT验证)

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

// MARK: - 1. 初始化配置
const app = express();
const PORT = process.env.PORT || 3000; // 统一使用 3000 端口
const DB_FILE_PATH = path.join(__dirname, 'db.json');
const SALT_ROUNDS = 10;
const BUNDLE_ID = 'org.eraser.NaturalDisasterMonitor';
const JWT_SECRET = 'VeryFuckingStrongPassword'; // 生产环境请修改

// MARK: - 2. APNs 双通道配置
const keysOptions = {
    token: {
        key: path.join(__dirname, 'AuthKey_4P8H3V8HA4.p8'),
        keyId: '4P8H3V8HA4',
        teamId: '3P763V36ZR'
    }
};

// APNs 初始化
const apnProviderSandbox = new apn.Provider({ ...keysOptions, production: false });
const apnProviderProduction = new apn.Provider({ ...keysOptions, production: true });

console.log("🚀 服务初始化中...");

// MARK: - 3. 中间件配置
app.use(cors());
app.use(express.json());

// [核心合并逻辑] 静态资源托管
// 这行代码让根目录下的 admin.html, index.html 等文件都可以被访问
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MARK: - 4. 页面路由 (整合前端访问入口)

// 首页路由 -> index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// [新增] 管理后台路由 -> admin.html
// 访问 https://your-domain:3000/admin 即可打开管理后台
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// MARK: - 5. 身份验证中间件 (JWT)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ message: '未授权：请先登录' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Token 无效或过期' });
        req.user = user;
        next();
    });
};

// MARK: - 6. 数据库辅助函数
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

// MARK: - 7. 辅助逻辑 (颜色 & 推送)
const getColorName = (level) => {
    if (!level) return 'yellow';
    const l = String(level);
    if (['特别严重', 'critical', 'red'].includes(l)) return 'red';
    if (['严重', 'severe', 'orange', '较重'].includes(l)) return 'orange';
    return 'yellow';
};

const sendLiveActivityUpdate = (token, report) => {
    if (!token) return;
    const notification = new apn.Notification();
    notification.headers = () => ({
        "apns-priority": "10",
        "apns-expiration": "0",
        "apns-push-type": "liveactivity",
        "apns-topic": `${BUNDLE_ID}.push-type.liveactivity`
    });
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

    apnProviderSandbox.send(notification, token).then(result => {
        if (result.sent.length > 0) console.log("✅ [Sandbox] 推送成功");
    });
    apnProviderProduction.send(notification, token).then(result => {
        if (result.sent.length > 0) console.log("✅ [Production] 推送成功");
    });
};

// MARK: - 8. API 路由

// 图片上传
const upload = multer({ 
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, 'uploads/'),
        filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
    })
});
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file' });
    res.status(201).json({ filePath: `/uploads/${req.file.filename}` });
});

// 登录 (获取 JWT)
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const db = readDb();
    const user = db.users.find(u => u.username === username);
    if (user && await bcrypt.compare(password, user.passwordHash)) {
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        res.status(200).json({ message: 'OK', token });
    } else {
        res.status(401).json({ message: 'Fail' });
    }
});

// 注册
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    const db = readDb();
    if (db.users.find(u => u.username === username)) return res.status(409).json({ message: 'Exist' });
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = { id: uuidv4(), username, passwordHash };
    db.users.push(newUser);
    writeDb(db);
    res.status(201).json({ userId: newUser.id });
});

// --- 用户管理 (需鉴权) ---
app.get('/api/users', authenticateToken, (req, res) => {
    res.status(200).json(readDb().users.map(u => ({ id: u.id, username: u.username })));
});

app.delete('/api/users/:id', authenticateToken, (req, res) => {
    const db = readDb();
    const newUsers = db.users.filter(u => u.id !== req.params.id);
    if (db.users.length === newUsers.length) return res.status(404).json({ message: 'Not found' });
    db.users = newUsers;
    writeDb(db);
    res.status(200).json({ message: 'Deleted' });
});

app.put('/api/users/:id', authenticateToken, async (req, res) => {
    const db = readDb();
    const idx = db.users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ message: 'Not found' });
    db.users[idx].passwordHash = await bcrypt.hash(req.body.password, SALT_ROUNDS);
    writeDb(db);
    res.status(200).json({ message: 'Updated' });
});

// --- 灾害报告 ---
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
    const db = readDb();
    const idx = db.reports.findIndex(r => r.id === reportId);
    if (idx !== -1) {
        db.reports[idx].liveActivityToken = token;
        writeDb(db);
        console.log(`💾 Token 更新`);
        res.status(200).json({ message: 'Saved' });
    } else {
        res.status(404).json({ message: 'Not found' });
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
        if (updatedReport.liveActivityToken) sendLiveActivityUpdate(updatedReport.liveActivityToken, updatedReport);
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

// MARK: - 9. 启动 HTTPS 服务 (合并入口)
try {
    const privateKey = fs.readFileSync('/root/ygkkkca/private.key', 'utf8');
    const certificate = fs.readFileSync('/root/ygkkkca/cert.crt', 'utf8');
    
    https.createServer({ key: privateKey, cert: certificate }, app).listen(PORT, () => {
        console.log(`\n✅ 全栈服务启动成功! (端口: ${PORT})`);
        console.log(`🌐 API 地址:   https://localhost:${PORT}/api/reports`);
        console.log(`💻 管理后台:   https://localhost:${PORT}/admin`);
        console.log(`🔒 安全模式:   HTTPS + JWT Auth`);
    });
} catch (error) {
    console.error('❌ HTTPS 证书读取失败:', error.message);
    process.exit(1);
}
