// MARK: - 自然灾害报告后端服务 (HTTPS + Web托管版 - 兼容旧版Node.js)

// MARK: - 1. 引入模块
const express = require('express');
const https = require('https');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

// MARK: - 2. 初始化
const app = express();
// 默认端口 3000
const PORT = process.env.PORT || 3000;
const DB_FILE_PATH = path.join(__dirname, 'db.json');
const SALT_ROUNDS = 10;

// MARK: - 3. 中间件设置
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- 托管静态网页 ---
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
        const data = fs.readFileSync(DB_FILE_PATH);
        return JSON.parse(data);
    } catch (error) {
        console.error('读取数据库时出错:', error);
        return { users: [], reports: [] };
    }
};

const writeDb = (db) => {
    try {
        fs.writeFileSync(DB_FILE_PATH, JSON.stringify(db, null, 2));
    } catch (error) {
        console.error('写入数据库时出错:', error);
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

// MARK: - 6. API 路由

// --- 用户认证 ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: '用户名和密码不能为空' });

    const db = readDb();
    if (db.users.find(u => u.username === username)) {
        return res.status(409).json({ message: '用户名已存在' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const newUser = { id: uuidv4(), username, passwordHash };
        db.users.push(newUser);
        writeDb(db);
        console.log(`新用户注册: ${username}`);
        res.status(201).json({ message: '用户注册成功', userId: newUser.id });
    } catch (error) {
        res.status(500).json({ message: '服务器错误' });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const db = readDb();
    const user = db.users.find(u => u.username === username);

    if (!user) return res.status(401).json({ message: '用户名或密码无效' });

    try {
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (isMatch) res.status(200).json({ message: '登录成功' });
        else res.status(401).json({ message: '用户名或密码无效' });
    } catch (error) {
        res.status(500).json({ message: '服务器错误' });
    }
});

// --- 图片上传 ---
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: '没有上传图片文件' });
    res.status(201).json({ filePath: `/uploads/${req.file.filename}` });
});

// --- 报告 CRUD ---
app.get('/api/reports', (req, res) => {
    const db = readDb();
    res.status(200).json(db.reports);
});

app.post('/api/reports', (req, res) => {
    const db = readDb();
    // 兼容处理
    const newId = (req.body.id) ? req.body.id : uuidv4();
    const newReport = Object.assign({}, req.body, { id: newId });
    
    db.reports.unshift(newReport);
    writeDb(db);
    console.log('新报告:', newReport.title);
    res.status(201).json(newReport);
});

app.put('/api/reports/:id', (req, res) => {
    const db = readDb();
    const idx = db.reports.findIndex(r => r.id === req.params.id);
    if (idx !== -1) {
        // 兼容处理 Spread 语法在极老版本可能也有问题，但通常 Node 8+ 支持
        // 这里改用 Object.assign 确保万无一失
        const updatedReport = Object.assign({}, db.reports[idx], req.body);
        db.reports[idx] = updatedReport;
        writeDb(db);
        console.log('更新报告:', db.reports[idx].title);
        res.status(200).json(db.reports[idx]);
    } else {
        res.status(404).json({ message: '未找到' });
    }
});

app.delete('/api/reports/:id', (req, res) => {
    const db = readDb();
    const report = db.reports.find(r => r.id === req.params.id);
    const newReports = db.reports.filter(r => r.id !== req.params.id);

    if (db.reports.length !== newReports.length) {
        // --- 修改点在这里 ---
        // 原代码: if (report?.imagePath) 
        // 兼容代码:
        if (report && report.imagePath) {
            const imgPath = path.join(__dirname, report.imagePath);
            if (fs.existsSync(imgPath)) {
                try {
                    fs.unlinkSync(imgPath);
                } catch(e) {
                    console.error("删除图片失败", e);
                }
            }
        }
        db.reports = newReports;
        writeDb(db);
        console.log('删除报告 ID:', req.params.id);
        res.status(200).json({ message: '已删除' });
    } else {
        res.status(404).json({ message: '未找到' });
    }
});

// MARK: - 7. 启动 HTTPS 服务器
try {
    const privateKey = fs.readFileSync('/root/ygkkkca/private.key', 'utf8');
    const certificate = fs.readFileSync('/root/ygkkkca/cert.crt', 'utf8');
    const credentials = { key: privateKey, cert: certificate };

    const httpsServer = https.createServer(credentials, app);

    httpsServer.listen(PORT, () => {
        console.log(`HTTPS 服务已启动`);
        console.log(`端口: ${PORT}`);
    });

} catch (error) {
    console.error('HTTPS 启动失败，请检查证书路径权限');
    console.error(error.message);
    process.exit(1);
}
