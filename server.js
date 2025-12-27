// MARK: - 自然灾害报告后端服务 (HTTPS + Web托管版 + 双通道APNs推送 + 调试增强版)

// 1. 引入模块
const express = require('express');
const https = require('https');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const apn = require('apn');

// 2. 初始化配置
const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE_PATH = path.join(__dirname, 'db.json');
const SALT_ROUNDS = 10;

// ⚠️ 请务必确认这里是你的 App Bundle ID
const BUNDLE_ID = 'com.ethanyi.NaturalDisasterMonitor';

// MARK: - ✅ APNs 双通道配置
// 确保 'AuthKey_4P8H3V8HA4.p8' 文件放在和 server.js 同一级目录下
const keysOptions = {
    token: {
        key: path.join(__dirname, 'AuthKey_4P8H3V8HA4.p8'),
        keyId: '4P8H3V8HA4',
        teamId: '3P763V36ZR'
    }
};

// 通道 1: 开发环境 (Sandbox)
const apnProviderSandbox = new apn.Provider({
    ...keysOptions,
    production: false
});

// 通道 2: 生产环境 (Production)
const apnProviderProduction = new apn.Provider({
    ...keysOptions,
    production: true
});

console.log("🚀 APNs 推送服务已初始化 (双通道模式)");

// 3. 中间件设置
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// MARK: - 4. 数据库辅助函数
const readDb = () => {
    try {
        if (!fs.existsSync(DB_FILE_PATH)) {
            const initialDb = { users: [], reports: [] };
            fs.writeFileSync(DB_FILE_PATH, JSON.stringify(initialDb));
            return initialDb;
        }
        return JSON.parse(fs.readFileSync(DB_FILE_PATH));
    } catch (error) {
        console.error('读取数据库错误:', error);
        return { users: [], reports: [] };
    }
};

const writeDb = (db) => {
    try {
        fs.writeFileSync(DB_FILE_PATH, JSON.stringify(db, null, 2));
    } catch (error) {
        console.error('写入数据库错误:', error);
    }
};

// MARK: - 5. 图片上传配置
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// MARK: - 6. 核心功能：双通道推送逻辑 (含错误捕获)
const sendLiveActivityUpdate = (token, report) => {
    if (!token) {
        console.error("❌ 无法推送: Token 为空");
        return;
    }

    const notification = new apn.Notification();
    notification.expiry = Math.floor(Date.now() / 1000) + 3600;
    notification.priority = 10;
    notification.topic = `${BUNDLE_ID}.push-type.liveactivity`;
    notification.pushType = "liveactivity";

    // 构造 Payload
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

    console.log(`📡 准备双通道推送... (Token前6位: ${token.substring(0, 6)})`);

    // --- 尝试 Sandbox 通道 ---
    apnProviderSandbox.send(notification, token)
        .then(result => {
            if (result.sent.length > 0) {
                console.log("✅ [Sandbox] 推送成功！(开发环境)");
            } else if (result.failed.length > 0) {
                const err = result.failed[0];
                // 忽略 BadDeviceToken，因为这可能是生产环境 Token
                if (err.response?.reason !== 'BadDeviceToken') {
                    console.error("❌ [Sandbox] 业务失败:", JSON.stringify(err, null, 2));
                }
            }
        })
        .catch(err => {
            console.error("🔥 [Sandbox] 网络/连接错误:", err.message);
        });

    // --- 尝试 Production 通道 ---
    apnProviderProduction.send(notification, token)
        .then(result => {
            if (result.sent.length > 0) {
                console.log("✅ [Production] 推送成功！(生产环境)");
            } else if (result.failed.length > 0) {
                const err = result.failed[0];
                // 忽略 BadDeviceToken，因为这可能是开发环境 Token
                if (err.response?.reason !== 'BadDeviceToken') {
                    console.error("❌ [Production] 业务失败:", JSON.stringify(err, null, 2));
                }
            }
        })
        .catch(err => {
            console.error("🔥 [Production] 网络/连接错误:", err.message);
        });
};

const getColorName = (level) => {
    if (level === '严重' || level === 'critical' || level === 'red') return 'red';
    if (level === '较重' || level === 'severe' || level === 'orange') return 'orange';
    return 'yellow';
};

// MARK: - 7. API 路由

// --- 用户注册 ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: '参数缺失' });

    const db = readDb();
    if (db.users.find(u => u.username === username)) {
        return res.status(409).json({ message: '用户已存在' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const newUser = { id: uuidv4(), username, passwordHash };
        db.users.push(newUser);
        writeDb(db);
        res.status(201).json({ message: '注册成功', userId: newUser.id });
    } catch (e) { res.status(500).json({ message: '服务器错误' }); }
});

// --- 用户登录 ---
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const db = readDb();
    const user = db.users.find(u => u.username === username);

    if (!user) return res.status(401).json({ message: '认证失败' });

    if (await bcrypt.compare(password, user.passwordHash)) {
        res.status(200).json({ message: '登录成功' });
    } else {
        res.status(401).json({ message: '认证失败' });
    }
});

// --- 图片上传 ---
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: '无文件' });
    res.status(201).json({ filePath: `/uploads/${req.file.filename}` });
});

// --- 获取所有报告 ---
app.get('/api/reports', (req, res) => {
    res.status(200).json(readDb().reports);
});

// --- 创建新报告 ---
app.post('/api/reports', (req, res) => {
    const db = readDb();
    const newId = req.body.id || uuidv4();
    const newReport = Object.assign({}, req.body, { id: newId, liveActivityToken: null });
    
    db.reports.unshift(newReport);
    writeDb(db);
    console.log('📝 新报告创建:', newReport.title);
    res.status(201).json(newReport);
});

// --- 保存灵动岛 Token ---
app.post('/api/live-activity/token', (req, res) => {
    const { reportId, token } = req.body;
    if (!reportId || !token) return res.status(400).json({ message: '参数缺失' });

    const db = readDb();
    const idx = db.reports.findIndex(r => r.id === reportId);
    
    if (idx !== -1) {
        db.reports[idx].liveActivityToken = token;
        writeDb(db);
        console.log(`💾 Token 已绑定: ${reportId.substring(0,8)}...`);
        res.status(200).json({ message: 'Token保存成功' });
    } else {
        res.status(404).json({ message: '报告未找到' });
    }
});

// --- 更新报告 (触发推送) ---
app.put('/api/reports/:id', (req, res) => {
    const db = readDb();
    const idx = db.reports.findIndex(r => r.id === req.params.id);
    
    if (idx !== -1) {
        const updatedReport = Object.assign({}, db.reports[idx], req.body);
        db.reports[idx] = updatedReport;
        writeDb(db);
        console.log('🔄 报告已更新:', db.reports[idx].title);

        // 触发双通道推送
        if (updatedReport.liveActivityToken) {
            sendLiveActivityUpdate(updatedReport.liveActivityToken, updatedReport);
        }

        res.status(200).json(db.reports[idx]);
    } else {
        res.status(404).json({ message: '未找到' });
    }
});

// --- 删除报告 ---
app.delete('/api/reports/:id', (req, res) => {
    const db = readDb();
    const newReports = db.reports.filter(r => r.id !== req.params.id);

    if (db.reports.length !== newReports.length) {
        const report = db.reports.find(r => r.id === req.params.id);
        if (report && report.imagePath) {
            const imgPath = path.join(__dirname, report.imagePath);
            if(fs.existsSync(imgPath)) try { fs.unlinkSync(imgPath); } catch(e){}
        }

        db.reports = newReports;
        writeDb(db);
        console.log('🗑️ 报告已删除:', req.params.id);
        res.status(200).json({ message: '已删除' });
    } else {
        res.status(404).json({ message: '未找到' });
    }
});

// MARK: - 8. 启动 HTTPS 服务器
try {
    const privateKey = fs.readFileSync('/root/ygkkkca/private.key', 'utf8');
    const certificate = fs.readFileSync('/root/ygkkkca/cert.crt', 'utf8');
    const credentials = { key: privateKey, cert: certificate };

    const httpsServer = https.createServer(credentials, app);

    httpsServer.listen(PORT, () => {
        console.log(`✅ HTTPS 服务启动成功 (端口: ${PORT})`);
        console.log(`✅ APNs 状态: 双通道就绪`);
    });

} catch (error) {
    console.error('❌ HTTPS 启动失败:', error.message);
    process.exit(1);
}
