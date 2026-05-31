const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// --- MongoDB Connection ---
// আপনার লোকাল মঙ্গোডিবি লিংক অথবা Atlas লিংক এখানে দিন
const MONGO_URI = 'mongodb://localhost:27017/telitask_db'; 
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err));

// --- Schemas & Models ---

// User Model
const userSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true },
    name: String,
    balance: { type: Number, default: 0 },
    deviceId: String,
    isBanned: { type: Boolean, default: false },
    vpnInfo: Object,
    settings: { type: Object, default: { autoReward: true } }, // User specific settings
    joinedAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Task Model
const taskSchema = new mongoose.Schema({
    id: Number, // ID ফ্রন্টএন্ড থেকে ম্যানুয়ালি পাঠানো হবে (Date.now())
    title: String,
    link: String,
    reward: Number,
    type: String, // daily, onetime, copy
    active: { type: Boolean, default: true }
});
const Task = mongoose.model('Task', taskSchema);

// Completed Task Model
const completedTaskSchema = new mongoose.Schema({
    userTaskId: { type: String, unique: true }, // uid_taskId
    timestamp: { type: Date, default: Date.now }
});
const CompletedTask = mongoose.model('CompletedTask', completedTaskSchema);

// Withdraw Model
const withdrawSchema = new mongoose.Schema({
    id: Number,
    uid: String,
    amount: Number,
    method: String,
    number: String,
    status: { type: String, default: 'pending' },
    date: { type: Date, default: Date.now }
});
const Withdraw = mongoose.model('Withdraw', withdrawSchema);

// History Model
const historySchema = new mongoose.Schema({
    uid: String,
    desc: String,
    amount: String,
    status: String,
    date: { type: Date, default: Date.now }
});
const History = mongoose.model('History', historySchema);

// Notification Model
const notificationSchema = new mongoose.Schema({
    type: String, // global, personal
    target: String,
    title: String,
    msg: String,
    time: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

// Settings Model (For Maintenance Mode)
const settingsSchema = new mongoose.Schema({
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMsg: String
});
const Settings = mongoose.model('Settings', settingsSchema);

// --- ROUTES ---

// 1. Register / Get User
app.post('/api/register', async (req, res) => {
    const { uid, name, deviceId, vpnInfo } = req.body;
    try {
        let user = await User.findOne({ uid });
        if (!user) {
            user = new User({ uid, name, deviceId, vpnInfo });
        } else {
            // Update VPN info on every login/refresh
            user.vpnInfo = vpnInfo;
        }
        await user.save();
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/user/:uid', async (req, res) => {
    try {
        const user = await User.findOne({ uid: req.params.uid });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Task Routes
app.get('/api/tasks', async (req, res) => {
    const tasks = await Task.find({ active: true });
    res.json(tasks);
});

app.post('/api/tasks', async (req, res) => {
    try {
        const newTask = new Task(req.body);
        await newTask.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/complete-task', async (req, res) => {
    const { uid, taskId, reward, title } = req.body;
    const userTaskId = `${uid}_${taskId}`;

    try {
        // Check duplicate
        const exists = await CompletedTask.findOne({ userTaskId });
        if (exists) return res.json({ success: false, message: 'Task already completed' });

        // Save completion
        await CompletedTask.create({ userTaskId });

        // Update Balance
        const user = await User.findOne({ uid });
        if (user && !user.isBanned) {
            user.balance = (parseFloat(user.balance) + parseFloat(reward)).toFixed(2);
            await user.save();

            // Add History
            await History.create({ uid, desc: `Task: ${title}`, amount: `+${reward}`, status: 'Success' });
            res.json({ success: true, balance: user.balance });
        } else {
            res.json({ success: false, message: 'User banned or not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Withdraw Routes
app.post('/api/withdraw', async (req, res) => {
    try {
        const withdraw = new Withdraw(req.body);
        await withdraw.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/withdraws', async (req, res) => {
    // Pending requests for Admin
    const reqs = await Withdraw.find({ status: 'pending' });
    res.json(reqs);
});

app.post('/api/withdraw-action', async (req, res) => {
    const { id, status } = req.body; // status: 'approved' or 'rejected'
    try {
        const w = await Withdraw.findOne({ id });
        if(w) {
            w.status = status;
            await w.save();
            
            // Add History
            await History.create({ uid: w.uid, desc: `Withdraw (${status})`, amount: w.amount, status: status });
            res.json({ success: true });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. History & Notifications
app.get('/api/history/:uid', async (req, res) => {
    const history = await History.find({ uid: req.params.uid }).sort({ date: -1 });
    res.json(history);
});

app.get('/api/notifications/:uid', async (req, res) => {
    const notifs = await Notification.find({
        $or: [{ type: 'global' }, { target: req.params.uid }]
    }).sort({ time: -1 });
    res.json(notifs);
});

app.post('/api/notification', async (req, res) => {
    try {
        const newNotif = new Notification(req.body);
        await newNotif.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Admin / Settings
app.get('/api/admin/users', async (req, res) => {
    const users = await User.find();
    res.json(users);
});

app.post('/api/admin/toggle-ban', async (req, res) => {
    const { uid } = req.body;
    const user = await User.findOne({ uid });
    if(user) {
        user.isBanned = !user.isBanned;
        await user.save();
        res.json({ success: true, isBanned: user.isBanned });
    }
});

app.post('/api/admin/update-balance', async (req, res) => {
    const { uid, amount } = req.body;
    const user = await User.findOne({ uid });
    if(user) {
        user.balance = (parseFloat(user.balance) + parseFloat(amount)).toFixed(2);
        await user.save();
        res.json({ success: true, balance: user.balance });
    }
});

// Maintenance Mode
app.get('/api/settings', async (req, res) => {
    let settings = await Settings.findOne();
    if(!settings) settings = new Settings();
    await settings.save();
    res.json(settings);
});

app.post('/api/settings', async (req, res) => {
    const { maintenanceMode, maintenanceMsg } = req.body;
    let settings = await Settings.findOne();
    if(!settings) settings = new Settings();
    settings.maintenanceMode = maintenanceMode;
    settings.maintenanceMsg = maintenanceMsg;
    await settings.save();
    res.json({ success: true });
});

// Start Server
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
