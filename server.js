// MARK: - 自然灾害报告后端服务 (apn库专用修复版)

const express = require('express');
const https = require('https');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const apn = require('apn'); // ✅ 坚持使用 apn 库

// MARK: - 1. 初始化配置
const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE_PATH = path.join(__dirname, 'db.json');
const SALT_ROUNDS = 10;
const BUNDLE_ID = 'org.eraser.NaturalDisasterMonitor';

// MARK: - 2. APNs 双通道配置
const keysOptions = {
    token: {
        key: path.join(__dirname, 'AuthKey_4P8H3V8HA4.p8'),
        keyId: '4P8H3V8HA4',
        teamId: '3P763V36ZR'
    }
};

// 双通道初始化 (apn 库)
const apnProviderSandbox = new apn.Provider({ ...keysOptions, production: false });
const apnProviderProduction = new apn.Provider({ ...keysOptions, production: true });

console.log("🚀 APNs 推送服务已初始化 (使用 apn 库)");

// MARK: - 3. 中间件
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

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

const getColorName = (level) => {
    if (['严重', 'critical', 'red'].includes(level)) return 'red';
    if (['较重', 'severe', 'orange'].includes(level)) return 'orange';
    return 'yellow';
};

// MARK: - 6. 核心：双通道推送逻辑 (修复 InvalidPushType)
const sendLiveActivityUpdate = (token, report) => {
    if (!token) return console.error("❌ Token 为空");

    const notification = new apn.Notification();
    
    // ✅ 关键修复 1: 显式设置 pushType (解决 400 错误)
    notification.pushType = "liveactivity"; 
    
    // ✅ 关键修复 2: Topic 必须带后缀
    notification.topic = `${BUNDLE_ID}.push-type.liveactivity`;
    
    notification.expiry = Math.floor(Date.now() / 1000) + 3600;
    notification.priority = 10;
    
    // ✅ 关键修复 3: 使用 rawPayload 强制覆盖结构
    // apn 库默认结构不支持 content-state，必须这样写才能传进去
    notification.rawPayload = {
        aps: {
            timestamp: Math.floor(Date.now() / 1000),
            event: 'update',
            'content-state': {
                currentLevel: report.level,
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

    console.log(`📡 正在尝试双通道推送... (Token: ${token.substring(0, 6)}...)`);

    // --- Sandbox 通道 ---
    apnProviderSandbox.send(notification, token)
        .then(result => {
            if (result.sent.length > 0) {
                console.log("✅ [Sandbox] 推送成功！");
            } else if (result.failed.length > 0) {
                const failure = result.failed[0];
                if (failure.response?.reason !== 'BadDeviceToken') {
                    console.error("❌ [Sandbox] 失败:", JSON.stringify(failure, null, 2));
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
                const failure = result.failed[0];
                if (failure.response?.reason !== 'BadDeviceToken') {
                    console.error("❌ [Production] 失败:", JSON.stringify(failure, null, 2));
                }
            }
        })
        .catch(err => console.error("🔥 [Production] 错误:", err.message));
};

// MARK: - 7. API 路由
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

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const db = readDb();
    const user = db.users.find(u => u.username === username);
    if (user && await bcrypt.compare(password, user.passwordHash)) res.status(200).json({ message: 'OK' });
    else res.status(401).json({ message: 'Fail' });
});

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
        console.log(`✅ APNs (apn库) 就绪`);
    });
} catch (error) {
    console.error('❌ HTTPS 启动失败:', error.message);
    process.exit(1);
}
