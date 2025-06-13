// MARK: - 自然灾害报告后端服务 (支持多用户)
// 这个服务器为 SwiftUI 灾害报告 App 提供一个简单的 REST API。
// 它负责处理用户注册、登录、报告的增删改查 (CRUD) 操作，以及图片上传。
// 使用 bcrypt 对用户密码进行安全哈希。

// MARK: - 1. 引入模块
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt'); // <-- 新增 bcrypt

// MARK: - 2. 初始化
const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE_PATH = path.join(__dirname, 'db.json');
const SALT_ROUNDS = 10; // bcrypt 加密强度

// MARK: - 3. 中间件设置
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MARK: - 4. 数据库辅助函数 (已更新)

// 从 JSON 文件读取整个数据库 (包括 users 和 reports)
const readDb = () => {
    try {
        if (!fs.existsSync(DB_FILE_PATH)) {
            // 如果文件不存在，创建一个包含 users 和 reports 空数组的初始结构
            const initialDb = { users: [], reports: [] };
            fs.writeFileSync(DB_FILE_PATH, JSON.stringify(initialDb));
            return initialDb;
        }
        const data = fs.readFileSync(DB_FILE_PATH);
        return JSON.parse(data);
    } catch (error) {
        console.error('读取数据库时出错:', error);
        return { users: [], reports: [] }; // 出错时返回空结构
    }
};

// 将整个数据库对象写入 JSON 文件
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

// POST: /api/register (新增)
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
        // 哈希密码
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


// POST: /login (已更新)
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`收到用户登录请求: ${username}`);

    const db = readDb();
    const user = db.users.find(u => u.username === username);

    if (!user) {
        return res.status(401).json({ message: '用户名或密码无效' });
    }

    try {
        // 比较明文密码和哈希值
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


// --- 图片上传路由 (无变化) ---
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: '没有上传图片文件。' });
    }
    const filePath = `/uploads/${req.file.filename}`;
    res.status(201).json({ filePath: filePath });
});


// --- 灾害报告 CRUD 路由 (微调以使用新DB结构) ---

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


// MARK: - 7. 启动服务器
app.listen(PORT, () => {
    console.log(`后端服务器正在运行于 http://localhost:${PORT}`);
});
