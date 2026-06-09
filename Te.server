const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path'); 
const config = require('./config');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- MongoDB Connection ---
const connectDB = async () => {
    if (mongoose.connection.readyState >= 1) return;
    try {
        // 🟢 এখানে dbName আলাদা করে দেওয়ার দরকার নেই, কারণ আপনার config.js এর লিংকে telitask ডাটাবেস নাম দেওয়া আছে
        await mongoose.connect(config.MONGO_URI);
        console.log("✅ MongoDB Connected to DB: telitask");
    } catch (error) {
        console.error("❌ MongoDB Connection Error:", error);
    }
};
connectDB();

// --- MongoDB Models ---
const UserSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true },
    name: String,
    username: String,
    deviceId: String,
    balance: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false },
    vpnInfo: Object,
    settings: { autoReward: { type: Boolean, default: true } }
}, { timestamps: true });

const TaskSchema = new mongoose.Schema({ id: { type: Number, required: true, unique: true }, title: String, link: String, reward: Number, type: String });
const NotificationSchema = new mongoose.Schema({ type: String, target: String, title: String, msg: String, time: { type: Date, default: Date.now } });
const WithdrawSchema = new mongoose.Schema({ id: Number, uid: String, amount: Number, method: String, number: String, status: { type: String, default: 'pending' } });
const SettingsSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: mongoose.Schema.Types.Mixed });
const TaskHistorySchema = new mongoose.Schema({
    uid: { type: String, required: true },
    taskId: { type: Number, required: true },
    taskTitle: String,
    reward: Number,
    completedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Task = mongoose.model('Task', TaskSchema);
const Notification = mongoose.model('Notification', NotificationSchema);
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);
const Setting = mongoose.model('Setting', SettingsSchema);
const TaskHistory = mongoose.model('TaskHistory', TaskHistorySchema);

// --- Helper: Admin Check ---
const isAdmin = async (req, res, next) => {
    const adminUid = req.headers['admin-uid'] || req.body.adminUid;
    if (adminUid !== config.ADMIN_TELEGRAM_ID) return res.status(403).json({ message: "Access Denied" });
    next();
};

// --- API ROUTES ---
app.post('/api/register', async (req, res) => {
    const { uid, name, username, deviceId, vpnInfo, settings } = req.body;
    if (!uid) return res.status(400).json({ error: "Telegram UID required" });
    try {
        let user = await User.findOne({ uid });
        if (!user) { user = new User({ uid, name, username, deviceId, vpnInfo, settings }); } 
        else {
            if (name) user.name = name; if (username) user.username = username;
            if (deviceId) user.deviceId = deviceId;
            if (vpnInfo) user.vpnInfo = vpnInfo; if (settings) user.settings = { ...user.settings, ...settings };
        }
        await user.save(); res.json(user);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 🟢 ইউজার ব্যালেন্স না আসার বাগ ফিক্স করা হয়েছে
app.get('/api/user/:uid', async (req, res) => { 
    try {
        const user = await User.findOne({ uid: req.params.uid }); 
        if (!user) return res.status(404).json({ error: "User not found" });
        
        const completedTasks = await TaskHistory.find({ uid: req.params.uid }).select('taskId -_id');
        const userObj = user.toObject();
        userObj.completedTasks = completedTasks.map(t => t.taskId);
        res.json(userObj); 
    } catch (error) {
        res.status(500).json({ error: "Server Error fetching user" });
    }
});

app.get('/api/admin/users', isAdmin, async (req, res) => { const users = await User.find(); res.json(users); });

app.post('/api/complete-task', async (req, res) => {
    const { uid, taskId, reward, title } = req.body;
    const rewardSetting = await Setting.findOne({ key: 'rewardEnabled' });
    if (rewardSetting && rewardSetting.value === false) return res.json({ success: false, message: 'রিওয়ার্ড বর্তমানে বন্ধ আছে!' });
    const user = await User.findOne({ uid });
    if (!user) return res.json({ success: false, message: 'ইউজার পাওয়া যায়নি!' });
    if (user.isBanned) return res.json({ success: false, message: 'আপনার একাউন্ট ব্যান করা হয়েছে!' });
    const alreadyCompleted = await TaskHistory.findOne({ uid, taskId });
    if (alreadyCompleted) return res.json({ success: false, message: 'আপনি এই টাস্কটি আগেই করেছেন!' });
    
    user.balance += Number(reward); await user.save(); 
    const history = new TaskHistory({ uid, taskId, taskTitle: title, reward });
    await history.save();
    res.json({ success: true, message: 'টাকা যোগ হয়েছে!' });
});

app.get('/api/tasks', async (req, res) => { const tasks = await Task.find(); res.json(tasks); });
app.post('/api/tasks', isAdmin, async (req, res) => { const newTask = new Task(req.body); await newTask.save(); res.json({ success: true }); });
app.delete('/api/tasks/:id', isAdmin, async (req, res) => { await Task.findOneAndDelete({ id: parseInt(req.params.id) }); res.json({ success: true }); });

app.get('/api/notifications/:uid', async (req, res) => {
    const notifs = await Notification.find({ $or: [{ type: 'global' }, { target: req.params.uid }] }).sort({ time: -1 }); res.json(notifs);
});
app.post('/api/notification', isAdmin, async (req, res) => { const newNotif = new Notification(req.body); await newNotif.save(); res.json({ success: true }); });

app.post('/api/withdraw', async (req, res) => {
    const { id, uid, amount, method, number } = req.body; const user = await User.findOne({ uid });
    if (!user || user.balance < amount) return res.json({ error: "পর্যাপ্ত ব্যালেন্স নেই" });
    user.balance -= Number(amount); await user.save();
    const newWithdraw = new Withdraw({ id, uid, amount, method, number, status: 'pending' }); await newWithdraw.save(); res.json({ success: true });
});
app.get('/api/withdraws', isAdmin, async (req, res) => { const withdraws = await Withdraw.find({ status: 'pending' }); res.json(withdraws); });
app.post('/api/withdraw-action', isAdmin, async (req, res) => {
    const { id, status } = req.body; const withdraw = await Withdraw.findOne({ id });
    if (withdraw && status === 'rejected') { const user = await User.findOne({ uid: withdraw.uid }); if (user) { user.balance += withdraw.amount; await user.save(); } }
    await Withdraw.updateOne({ id }, { status }); res.json({ success: true });
});

app.post('/api/admin/toggle-ban', isAdmin, async (req, res) => { const user = await User.findOne({ uid: req.body.uid }); if (user) { user.isBanned = !user.isBanned; await user.save(); } res.json({ success: true }); });
app.post('/api/admin/update-balance', isAdmin, async (req, res) => { const { uid, amount } = req.body; const user = await User.findOne({ uid }); if (user) { user.balance += Number(amount); await user.save(); } res.json({ success: true }); });

app.get('/api/settings', async (req, res) => { const settings = await Setting.find(); const settingsObj = {}; settings.forEach(s => settingsObj[s.key] = s.value); res.json(settingsObj); });
app.post('/api/settings', isAdmin, async (req, res) => { const keys = Object.keys(req.body); for (const key of keys) { await Setting.findOneAndUpdate({ key }, { value: req.body[key] }, { upsert: true }); } res.json({ success: true }); });

app.get('/api/check-admin/:uid', async (req, res) => { res.json({ isAdmin: req.params.uid === config.ADMIN_TELEGRAM_ID }); });

// সার্ভার চালু করার সিস্টেম (Vercel এবং Render উভয়ের জন্য কাজ করবে)
if (process.env.VERCEL) {
    module.exports = app;
} else {
    const PORT = config.PORT;
    app.listen(PORT, () => { 
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        try {
            require('./bot'); // বট অটোমেটিক চালু হবে
            console.log("🤖 Telegram Bot Initiated!");
        } catch (error) {
            console.error("❌ Bot Init Failed:", error.message);
        }
    });
}
