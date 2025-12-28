// MARK: - 自然灾害报告后端服务 (HTTPS + 双通道APNs推送 + 路径修正版)

const express = require('express');
const https = require('https');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const apn = require('apn');

// MARK: - 1. 初始化配置
const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE_PATH = path.join(__dirname, 'db.json');
const SALT_ROUNDS = 10;
const BUNDLE_ID = 'org.eraser.NaturalDisasterMonitor';

// MARK: - 2. APNs 双通道配置
// 确保 'AuthKey_4P8H3V8HA4.p8' 文件在 server.js 同级目录下
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

console.log("🚀 APNs 推送服务已初始化 (双通道模式)");

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

// MARK: - 6. 核心：双通道推送逻辑 (含详细错误捕获)
const sendLiveActivityUpdate = (token, report) => {
    if (!token) {
        console.error("❌ [错误] 无法推送: Token 为空");
        return;
    }

    const notification = new apn.Notification();
    notification.expiry = Math.floor(Date.now() / 1000) + 3600;
    notification.priority = 10;
    notification.topic = `${BUNDLE_ID}.push-type.liveactivity`;
    notification.pushType = "liveactivity";

    notification.payload = {
        "timestamp": Math.floor(Date.now() / 1000),
        "event": "update",
        "content-state": {
            "currentLevel": report.level,
            "levelColorName": getColorName(report.level),
            "updateTimestamp": Math.floor(Date.now() / 1000)
        },
        "alert": {
            "title": `灾害更新：${report.title}`,
            "body": `当前等级已变更为：${report.level}`
        },
        "sound": "default"
    };

    console.log(`📡 正在尝试双通道推送... (Token: ${token.substring(0, 6)}...)`);

    // --- 尝试 Sandbox 通道 ---
    console.log("   -> [Sandbox] 发起请求...");
    apnProviderSandbox.send(notification, token)
        .then(result => {
            if (result.sent.length > 0) {
                console.log("✅ [Sandbox] 推送成功！");
            } else if (result.failed.length > 0) {
                // 打印失败详情
                const failure = result.failed[0];
                if (failure.response && failure.response.reason === 'BadDeviceToken') {
                    // console.log("⚠️ [Sandbox] BadDeviceToken (这是正常的，说明是生产环境Token)");
                } else {
                    console.error("❌ [Sandbox] 业务报错:", JSON.stringify(failure, null, 2));
                }
            }
        })
        .catch(err => {
            // 🔥 这里是关键，之前卡住就是因为没捕获这个
            console.error("🔥 [Sandbox] 连接/证书严重错误:", err);
        });

    // --- 尝试 Production 通道 ---
    console.log("   -> [Production] 发起请求...");
    apnProviderProduction.send(notification, token)
        .then(result => {
            if (result.sent.length > 0) {
                console.log("✅ [Production] 推送成功！");
            } else if (result.failed.length > 0) {
                const failure = result.failed[0];
                if (failure.response && failure.response.reason === 'BadDeviceToken') {
                    // console.log("⚠️ [Production] BadDeviceToken (这是正常的，说明是开发环境Token)");
                } else {
                    console.error("❌ [Production] 业务报错:", JSON.stringify(failure, null, 2));
                }
            }
        })
        .catch(err => {
            // 🔥 这里是关键
            console.error("🔥 [Production] 连接/证书严重错误:", err);
        });
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

app.get('/api/reports', (req, res) => { res.status(200).json(readDb().reports); });

app.post('/api/reports', (req, res) => {
    const db = readDb();
    const newReport = Object.assign({}, req.body, { id: req.body.id || uuidv4(), liveActivityToken: null });
    db.reports.unshift(newReport);
    writeDb(db);
    console.log('📝 新报告:', newReport.title);
    res.status(201).json(newReport);
});

// 保存 Token
app.post('/api/live-activity/token', (req, res) => {
    const { reportId, token } = req.body;
    if (!reportId || !token) return res.status(400).json({ message: 'Missing args' });
    const db = readDb();
    const idx = db.reports.findIndex(r => r.id === reportId);
    if (idx !== -1) {
        db.reports[idx].liveActivityToken = token;
        writeDb(db);
        console.log(`💾 Token 保存成功: ${token.substring(0, 6)}...`);
        res.status(200).json({ message: 'Saved' });
    } else {
        res.status(404).json({ message: 'Report not found' });
    }
});

// 更新报告
app.put('/api/reports/:id', (req, res) => {
    const db = readDb();
    const idx = db.reports.findIndex(r => r.id === req.params.id);
    if (idx !== -1) {
        const updatedReport = Object.assign({}, db.reports[idx], req.body);
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

// MARK: - 8. 启动 HTTPS (关键修正点)
try {
    // 👇👇👇 使用你提供的原路径 👇👇👇
    const privateKey = fs.readFileSync('/root/ygkkkca/private.key', 'utf8');
    const certificate = fs.readFileSync('/root/ygkkkca/cert.crt', 'utf8');
    
    const credentials = { key: privateKey, cert: certificate };

    const httpsServer = https.createServer(credentials, app);

    httpsServer.listen(PORT, () => {
        console.log(`✅ HTTPS 服务已恢复 (端口: ${PORT})`);
        console.log(`✅ APNs 双通道就绪`);
    });

} catch (error) {
    console.error('❌ HTTPS 启动失败:', error.message);
    process.exit(1);
}
