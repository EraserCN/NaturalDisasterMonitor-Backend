// MARK: - 自然灾害报告后端服务 (支持多用户 & HTTPS)
// 这个服务器为 SwiftUI 灾害报告 App 提供一个简单的 REST API。
// 它负责处理用户注册、登录、报告的增删改查 (CRUD) 操作，以及图片上传。
// 使用 bcrypt 对用户密码进行安全哈希。

// MARK: - 1. 引入模块
const express = require('express');
const https = require('https'); // <-- 新增: 引入 https 模块
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

// MARK: - 2. 初始化
const app = express();
// 注意: 如果你要使用 HTTPS 默认端口，可以将 3000 改为 443
// 但注意 443 端口通常需要 root 权限运行
const PORT = process.env.PORT || 3000; 
const DB_FILE_PATH = path.join(__dirname, 'db.json');
const SALT_ROUNDS = 10;

// MARK: - 3. 中间件设置
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MARK: - 4. 数据库辅助函数 (无变化)
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

// MARK: - 5. 图片上传配置 (无变化)
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

// --- 用户认证路由 ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: '用户名和密码不能为空' });
    }
    const db = readDb();
    const existingUser = db.users.find(u => u.username === username);
    if (existingUser) {
        return res.status(409).json({ message: '用户名已存在' });
    }
    try {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const newUser = {
            id: uuidv4(),
            username: username,
            passwordHash: passwordHash
        };
        db.users.push(newUser);
        writeDb(db);
        console.log(`新用户注册成功: ${username}`);
        res.status(201).json({ message: '用户注册成功', userId: newUser.id });
    } catch (error) {
        console.error('注册过程中出错:', error);
        res.status(500).json({ message: '服务器内部错误' });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`收到用户登录请求: ${username}`);
    const db = readDb();
    const user = db.users.find(u => u.username === username);
    if (!user) {
        return res.status(401).json({ message: '用户名或密码无效' });
    }
    try {
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (isMatch) {
            res.status(200).json({ message: '登录成功' });
        } else {
            res.status(401).json({ message: '用户名或密码无效' });
        }
    } catch (error) {
        console.error('登录过程中出错:', error);
        res.status(500).json({ message: '服务器内部错误' });
    }
});

// --- 图片上传路由 ---
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: '没有上传图片文件。' });
    }
    const filePath = `/uploads/${req.file.filename}`;
    res.status(201).json({ filePath: filePath });
});

// --- 灾害报告 CRUD 路由 ---
app.get('/api/reports', (req, res) => {
    const db = readDb();
    res.status(200).json(db.reports);
});

app.post('/api/reports', (req, res) => {
    const db = readDb();
    const newReport = req.body;
    newReport.id = newReport.id || uuidv4();
    db.reports.unshift(newReport);
    writeDb(db);
    console.log('创建了新报告:', newReport.title);
    res.status(201).json(newReport);
});

app.put('/api/reports/:id', (req, res) => {
    const db = readDb();
    const reportIndex = db.reports.findIndex(r => r.id === req.params.id);
    if (reportIndex !== -1) {
        const updatedReport = { ...db.reports[reportIndex], ...req.body };
        db.reports[reportIndex] = updatedReport;
        writeDb(db);
        console.log('更新了报告:', updatedReport.title);
        res.status(200).json(updatedReport);
    } else {
        res.status(404).json({ message: '报告未找到' });
    }
});

app.delete('/api/reports/:id', (req, res) => {
    const db = readDb();
    const reportToDelete = db.reports.find(r => r.id === req.params.id);
    const newReports = db.reports.filter(r => r.id !== req.params.id);

    if (db.reports.length !== newReports.length) {
        if (reportToDelete && reportToDelete.imagePath) {
            const imagePath = path.join(__dirname, reportToDelete.imagePath);
            if(fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
                console.log('删除了关联的图片:', reportToDelete.imagePath);
            }
        }
        db.reports = newReports;
        writeDb(db);
        console.log('删除了报告，ID为:', req.params.id);
        res.status(200).json({ message: '报告删除成功' });
    } else {
        res.status(404).json({ message: '报告未找到' });
    }
});

// MARK: - 7. 启动 HTTPS 服务器 (已更新)

try {
    // 读取证书文件
    // 注意：读取 /root/ 目录下的文件通常需要使用 sudo 运行 node
    const privateKey = fs.readFileSync('/root/ygkkkca/private.key', 'utf8');
    const certificate = fs.readFileSync('/root/ygkkkca/cert.crt', 'utf8');
    
    const credentials = { 
        key: privateKey, 
        cert: certificate 
    };

    // 创建 HTTPS 服务器
    const httpsServer = https.createServer(credentials, app);

    httpsServer.listen(PORT, () => {
        console.log(`HTTPS 后端服务器正在运行于 https://localhost:${PORT}`);
    });

} catch (error) {
    console.error('启动 HTTPS 服务器失败，请检查证书路径和权限。');
    console.error('错误信息:', error.message);
    process.exit(1);
}
