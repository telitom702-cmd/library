const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const config = require('./config/config');
const User = require('./models/User');
const Task = require('./models/Task');
const Transaction = require('./models/Transaction');
const Withdrawal = require('./models/Withdrawal');

// Initialize bot
const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

// Connect to MongoDB
mongoose.connect(config.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected successfully'))
.catch(err => console.error('MongoDB connection error:', err));

// Middleware to check if user exists, if not create
bot.use(async (ctx, next) => {
  const telegramId = ctx.from.id;
  
  try {
    let user = await User.findOne({ telegramId });
    
    if (!user) {
      user = new User({
        telegramId: telegramId,
        username: ctx.from.username || '',
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name || '',
        languageCode: ctx.from.language_code || 'en',
        isBot: ctx.from.is_bot || false
      });
      await user.save();
      console.log(`New user created: ${user.fullName} (${telegramId})`);
      
      // Welcome message
      await ctx.reply(
        `Welcome to ${config.BOT_NAME}! 🎉\n\n` +
        `I'm here to help you earn ${config.CURRENCY_SYMBOL} by completing simple tasks.\n\n` +
        `Use /menu to see available options.`,
        Markup.inlineKeyboard([
          [Markup.button.url('👥 Join Our Channel', 'https://t.me/yourchannel')]
        ])
      );
    } else {
      // Update last active time
      user.lastActive = new Date();
      await user.save();
    }
    
    ctx.state.user = user;
    return next();
  } catch (error) {
    console.error('Error in user middleware:', error);
    return next();
  }
});

// Command handlers
bot.start(async (ctx) => {
  const user = ctx.state.user;
  
  const welcomeMessage = `
Welcome back, ${user.firstName}! 👋

 ${config.BOT_NAME} - Earn ${config.CURRENCY_SYMBOL} by completing tasks!

📊 Your Stats:
• Balance: ${config.CURRENCY_SYMBOL}${user.balance}
• Level: ${user.level}
• XP: ${user.xp}/${user.xpToNextLevel}
• Referrals: ${user.referrals.length}

🎯 Use /menu to see available options
💰 Use /balance to check your earnings
👥 Use /referral to get your referral link
📝 Use /tasks to see available tasks
`;
  
  await ctx.reply(welcomeMessage, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📋 Main Menu', 'menu')],
      [Markup.button.callback('💰 Check Balance', 'balance')],
      [Markup.button.callback('🎯 View Tasks', 'tasks')]
    ])
  });
});

bot.command('menu', async (ctx) => {
  const user = ctx.state.user;
  
  const menuMessage = `
🏠 Main Menu

💰 Balance: ${config.CURRENCY_SYMBOL}${user.balance}
🎯 Level: ${user.level} (${user.xp}/${user.xpToNextLevel} XP)
👥 Referrals: ${user.referrals.length}

Select an option:
`;
  
  await ctx.reply(menuMessage, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [
        Markup.callbackButton('💰 Balance', 'balance'),
        Markup.callbackButton('🎯 Tasks', 'tasks')
      ],
      [
        Markup.callbackButton('👥 Referral', 'referral'),
        Markup.callbackButton('📊 Stats', 'stats')
      ],
      [
        Markup.callbackButton('💸 Withdraw', 'withdraw'),
        Markup.callbackButton('🏆 Leaderboard', 'leaderboard')
      ]
    ])
  });
});

bot.command('balance', async (ctx) => {
  const user = ctx.state.user;
  
  const balanceMessage = `
💰 Your Balance

Current Balance: ${config.CURRENCY_SYMBOL}${user.balance}
Total Earnings: ${config.CURRENCY_SYMBOL}${user.totalEarnings}
Daily Tasks Completed: ${user.dailyTasksCompleted}/${config.MAX_DAILY_TASKS || 20}

Recent Transactions:
`;
  
  // Get recent transactions
  const transactions = await Transaction.find({ userId: user.telegramId })
    .sort({ createdAt: -1 })
    .limit(5);
  
  let transactionList = '';
  if (transactions.length > 0) {
    transactions.forEach(t => {
      const sign = t.type === 'withdrawal' ? '-' : '+';
      transactionList += `${t.createdAt.toLocaleDateString()}: ${sign}${config.CURRENCY_SYMBOL}${t.amount} - ${t.description}\n`;
    });
  } else {
    transactionList = 'No transactions yet.';
  }
  
  await ctx.reply(balanceMessage + transactionList, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.callbackButton('🏠 Back to Menu', 'menu')]
    ])
  });
});

bot.command('tasks', async (ctx) => {
  const user = ctx.state.user;
  
  // Get active tasks
  const tasks = await Task.find({ 
    isActive: true, 
    expiryDate: { $gt: new Date() },
    'completedBy.userId': { $ne: user.telegramId }
  }).limit(10);
  
  if (tasks.length === 0) {
    return ctx.reply('No tasks available at the moment. Please check back later!', {
      ...Markup.inlineKeyboard([
        [Markup.callbackButton('🏠 Back to Menu', 'menu')]
      ])
    });
  }
  
  let tasksMessage = `
🎯 Available Tasks

Daily Limit: ${user.dailyTasksCompleted}/${config.MAX_DAILY_TASKS || 20}
\n`;
  
  tasks.forEach((task, index) => {
    const isCompleted = task.completedBy.some(c => c.userId.toString() === user.telegramId.toString());
    const canComplete = task.canUserComplete(user.telegramId);
    const status = canComplete ? '✅ Available' : (isCompleted ? '✅ Completed' : '❌ Not Available');
    
    tasksMessage += `${index + 1}. ${task.title}\n`;
    tasksMessage += `   Type: ${task.type} | Reward: ${config.CURRENCY_SYMBOL}${task.reward}\n`;
    tasksMessage += `   Status: ${status}\n\n`;
  });
  
  await ctx.reply(tasksMessage, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.callbackButton('🏠 Back to Menu', 'menu')]
    ])
  });
});

bot.command('referral', async (ctx) => {
  const user = ctx.state.user;
  
  // Generate referral code (using user ID)
  const referralCode = user.telegramId;
  const referralLink = `https://t.me/${config.BOT_USERNAME}?start=${referralCode}`;
  
  const referralMessage = `
👥 Referral Program

Your Referral Link:
 ${referralLink}

🎁 Rewards:
• ${config.CURRENCY_SYMBOL}${config.REFERRAL_REWARD} for each referral
• ${config.REFERRAL_COMMISSION_PERCENTAGE}% commission on their earnings

Your Referrals: ${user.referrals.length}
Total Referral Earnings: ${config.CURRENCY_SYMBOL}${(user.referrals.length * config.REFERRAL_REWARD)}

Share your link with friends to earn more!
`;
  
  await ctx.reply(referralMessage, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [
        Markup.urlButton('📋 Copy Link', referralLink),
        Markup.callbackButton('🏠 Back to Menu', 'menu')
      ]
    ])
  });
});

bot.command('stats', async (ctx) => {
  const user = ctx.state.user;
  
  const statsMessage = `
📊 Your Statistics

👤 Profile:
• Name: ${user.fullName}
• Joined: ${user.joinedAt.toLocaleDateString()}
• Level: ${user.level}
• XP: ${user.xp}/${user.xpToNextLevel}

💰 Earnings:
• Current Balance: ${config.CURRENCY_SYMBOL}${user.balance}
• Total Earnings: ${config.CURRENCY_SYMBOL}${user.totalEarnings}

🎯 Tasks:
• Completed Today: ${user.dailyTasksCompleted}/${config.MAX_DAILY_TASKS || 20}

👥 Referrals:
• Total Referrals: ${user.referrals.length}
• Referral Earnings: ${config.CURRENCY_SYMBOL}${(user.referrals.length * config.REFERRAL_REWARD)}
`;
  
  await ctx.reply(statsMessage, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.callbackButton('🏠 Back to Menu', 'menu')]
    ])
  });
});

bot.command('withdraw', async (ctx) => {
  const user = ctx.state.user;
  
  if (user.balance < config.MIN_WITHDRAWAL_AMOUNT) {
    return ctx.reply(
      `❌ Withdrawal not available.\n\n` +
      `Minimum withdrawal amount is ${config.CURRENCY_SYMBOL}${config.MIN_WITHDRAWAL_AMOUNT}.\n` +
      `Your current balance is ${config.CURRENCY_SYMBOL}${user.balance}.`,
      {
        ...Markup.inlineKeyboard([
          [Markup.callbackButton('🏠 Back to Menu', 'menu')]
        ])
      }
    );
  }
  
  const withdrawalMessage = `
💸 Withdraw Request

Current Balance: ${config.CURRENCY_SYMBOL}${user.balance}
Minimum Withdrawal: ${config.CURRENCY_SYMBOL}${config.MIN_WITHDRAWAL_AMOUNT}
Available Balance: ${config.CURRENCY_SYMBOL}${user.balance}

Select Payment Method:
`;
  
  await ctx.reply(withdrawalMessage, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [
        Markup.callbackButton('📱 bKash', 'withdraw_bkash'),
        Markup.callbackButton('💸 Nagad', 'withdraw_nagad')
      ],
      [
        Markup.callbackButton('₿ Crypto', 'withdraw_crypto'),
        Markup.callbackButton('🏠 Back to Menu', 'menu')
      ]
    ])
  });
});

// Callback query handlers
bot.on('callback_query', async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  const user = ctx.state.user;
  
  try {
    // Acknowledge callback
    await ctx.answerCbQuery();
    
    switch (callbackData) {
      case 'menu':
        await ctx.editMessageText('🏠 Main Menu\n\nSelect an option:', {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.callbackButton('💰 Balance', 'balance'),
              Markup.callbackButton('🎯 Tasks', 'tasks')
            ],
            [
              Markup.callbackButton('👥 Referral', 'referral'),
              Markup.callbackButton('📊 Stats', 'stats')
            ],
            [
              Markup.callbackButton('💸 Withdraw', 'withdraw'),
              Markup.callbackButton('🏆 Leaderboard', 'leaderboard')
            ]
          ])
        });
        break;
        
      case 'balance':
        // Similar to /balance command
        const balanceMessage = `
💰 Your Balance

Current Balance: ${config.CURRENCY_SYMBOL}${user.balance}
Total Earnings: ${config.CURRENCY_SYMBOL}${user.totalEarnings}
Daily Tasks Completed: ${user.dailyTasksCompleted}/${config.MAX_DAILY_TASKS || 20}
        `;
        
        await ctx.editMessageText(balanceMessage, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.callbackButton('🏠 Back to Menu', 'menu')]
          ])
        });
        break;
        
      case 'tasks':
        // Similar to /tasks command
        const tasks = await Task.find({ 
          isActive: true, 
          expiryDate: { $gt: new Date() },
          'completedBy.userId': { $ne: user.telegramId }
        }).limit(10);
        
        if (tasks.length === 0) {
          await ctx.editMessageText('No tasks available at the moment. Please check back later!', {
            ...Markup.inlineKeyboard([
              [Markup.callbackButton('🏠 Back to Menu', 'menu')]
            ])
          });
          break;
        }
        
        let tasksMessage = `
🎯 Available Tasks

Daily Limit: ${user.dailyTasksCompleted}/${config.MAX_DAILY_TASKS || 20}
\n`;
        
        tasks.forEach((task, index) => {
          const isCompleted = task.completedBy.some(c => c.userId.toString() === user.telegramId.toString());
          const canComplete = task.canUserComplete(user.telegramId);
          const status = canComplete ? '✅ Available' : (isCompleted ? '✅ Completed' : '❌ Not Available');
          
          tasksMessage += `${index + 1}. ${task.title}\n`;
          tasksMessage += `   Type: ${task.type} | Reward: ${config.CURRENCY_SYMBOL}${task.reward}\n`;
          tasksMessage += `   Status: ${status}\n\n`;
        });
        
        await ctx.editMessageText(tasksMessage, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.callbackButton('🏠 Back to Menu', 'menu')]
          ])
        });
        break;
        
      case 'referral':
        // Similar to /referral command
        const referralCode = user.telegramId;
        const referralLink = `https://t.me/${config.BOT_USERNAME}?start=${referralCode}`;
        
        const referralMessage = `
👥 Referral Program

Your Referral Link:
 ${referralLink}

🎁 Rewards:
• ${config.CURRENCY_SYMBOL}${config.REFERRAL_REWARD} for each referral
• ${config.REFERRAL_COMMISSION_PERCENTAGE}% commission on their earnings

Your Referrals: ${user.referrals.length}
Total Referral Earnings: ${config.CURRENCY_SYMBOL}${(user.referrals.length * config.REFERRAL_REWARD)}
        `;
        
        await ctx.editMessageText(referralMessage, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.urlButton('📋 Copy Link', referralLink),
              Markup.callbackButton('🏠 Back to Menu', 'menu')
            ]
          ])
        });
        break;
        
      case 'withdraw_bkash':
        await ctx.editMessageText(`
💸 Withdraw Request - bKash

Current Balance: ${config.CURRENCY_SYMBOL}${user.balance}
Minimum Withdrawal: ${config.CURRENCY_SYMBOL}${config.MIN_WITHDRAWAL_AMOUNT}

Please send:
• Your bKash number
• Your preferred withdrawal amount

Example:
bKash: 01XXXXXXXXXX
Amount: ${config.CURRENCY_SYMBOL}500
        `, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.callbackButton('🏠 Back to Menu', 'menu')]
          ])
        });
        break;
        
      case 'withdraw_nagad':
        await ctx.editMessageText(`
💸 Withdraw Request - Nagad

Current Balance: ${config.CURRENCY_SYMBOL}${user.balance}
Minimum Withdrawal: ${config.CURRENCY_SYMBOL}${config.MIN_WITHDRAWAL_AMOUNT}

Please send:
• Your Nagad number
• Your preferred withdrawal amount

Example:
Nagad: 01XXXXXXXXXX
Amount: ${config.CURRENCY_SYMBOL}500
        `, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.callbackButton('🏠 Back to Menu', 'menu')]
          ])
        });
        break;
        
      case 'withdraw_crypto':
        await ctx.editMessageText(`
💸 Withdraw Request - Crypto

Current Balance: ${config.CURRENCY_SYMBOL}${user.balance}
Minimum Withdrawal: ${config.CURRENCY_SYMBOL}${config.MIN_WITHDRAWAL_AMOUNT}

Please send:
• Your wallet address (BTC, ETH, etc.)
• Your preferred withdrawal amount

Example:
Wallet: bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq
Amount: ${config.CURRENCY_SYMBOL}500
        `, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.callbackButton('🏠 Back to Menu', 'menu')]
          ])
        });
        break;
        
      default:
        // Handle task selection
        if (callbackData.startsWith('task_')) {
          const taskId = callbackData.split('_')[1];
          const task = await Task.findById(taskId);
          
          if (!task || !task.canUserComplete(user.telegramId)) {
            await ctx.editMessageText('This task is no longer available or you have already completed it.', {
              ...Markup.inlineKeyboard([
                [Markup.callbackButton('🏠 Back to Menu', 'menu')]
              ])
            });
            return;
          }
          
          // Show task details
          const taskDetails = `
🎯 Task Details

Title: ${task.title}
Description: ${task.description}
Category: ${task.category}
Reward: ${config.CURRENCY_SYMBOL}${task.reward}
Proof Required: ${task.requiredProof ? 'Yes' : 'No'}

 ${task.proofInstructions}

Status: ✅ Available
          `;
          
          await ctx.editMessageText(taskDetails, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [
                Markup.callbackButton('✅ Complete Task', `complete_${taskId}`),
                Markup.callbackButton('🏠 Back to Tasks', 'tasks')
              ]
            ])
          });
        }
        
        // Handle task completion
        if (callbackData.startsWith('complete_')) {
          const taskId = callbackData.split('_')[1];
          const task = await Task.findById(taskId);
          
          if (!task || !task.canUserComplete(user.telegramId)) {
            await ctx.editMessageText('This task is no longer available or you have already completed it.', {
              ...Markup.inlineKeyboard([
                [Markup.callbackButton('🏠 Back to Menu', 'menu')]
              ])
            });
            return;
          }
          
          // Check if user can complete more tasks today
          if (!user.canCompleteTask()) {
            await ctx.editMessageText(`You have reached your daily task limit of ${config.MAX_DAILY_TASKS || 20}. Please try again tomorrow.`, {
              ...Markup.inlineKeyboard([
                [Markup.callbackButton('🏠 Back to Menu', 'menu')]
              ])
            });
            return;
          }
          
          // If proof is required, ask for screenshot
          if (task.requiredProof) {
            await ctx.editMessageText(`
📸 Task Completion - ${task.title}

Please provide a screenshot as proof of completion.

Instructions:
1. Take a clear screenshot showing you've completed the task
2. Send the screenshot to this chat
3. Your reward will be credited after verification

Reward: ${config.CURRENCY_SYMBOL}${task.reward}
            `, {
              parse_mode: 'HTML',
              ...Markup.inlineKeyboard([
                [Markup.callbackButton('🏠 Cancel', 'tasks')]
              ])
            });
            
            // Set state for screenshot submission
            ctx.state.pendingTask = task;
            return;
          } else {
            // Auto-credit reward if no proof required
            await completeTask(ctx, user, task);
          }
        }
    }
  } catch (error) {
    console.error('Error in callback query handler:', error);
    await ctx.editMessageText('An error occurred. Please try again later.', {
      ...Markup.inlineKeyboard([
        [Markup.callbackButton('🏠 Back to Menu', 'menu')]
      ])
    });
  }
});

// Handle photo uploads for task completion
bot.on('photo', async (ctx) => {
  const user = ctx.state.user;
  
  // Check if user has a pending task
  if (!ctx.state.pendingTask) {
    return;
  }
  
  const task = ctx.state.pendingTask;
  const photo = ctx.message.photo;
  
  // Get the highest resolution photo
  const fileId = photo[photo.length - 1].file_id;
  
  try {
    // Download photo to get file path
    const filePath = await bot.telegram.getFileLink(fileId);
    
    // Add task completion with proof
    await task.addCompletion(user.telegramId, filePath.href);
    
    // Update user's daily task count
    user.dailyTasksCompleted += 1;
    await user.save();
    
    // Create transaction record
    const transaction = new Transaction({
      userId: user.telegramId,
      type: 'task_completion',
      amount: task.reward,
      balanceAfter: user.balance,
      description: `Completed task: ${task.title}`,
      taskId: task._id
    });
    await transaction.save();
    
    // Send confirmation message
    await ctx.reply(`
✅ Task Submitted Successfully!

Your submission for "${task.title}" has been sent to the admin for verification.

Reward: ${config.CURRENCY_SYMBOL}${task.reward} (will be credited upon approval)

You can check your status in the task list.
    `, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.callbackButton('🏠 Back to Menu', 'menu')]
      ])
    });
    
    // Reset pending task state
    ctx.state.pendingTask = null;
    
    // Notify admin about new submission
    notifyAdminNewSubmission(ctx, user, task, filePath.href);
    
  } catch (error) {
    console.error('Error handling photo submission:', error);
    await ctx.reply('An error occurred while processing your submission. Please try again.', {
      ...Markup.inlineKeyboard([
        [Markup.callbackButton('🏠 Back to Menu', 'menu')]
      ])
    });
    ctx.state.pendingTask = null;
  }
});

// Helper function to complete a task
async function completeTask(ctx, user, task) {
  try {
    // Add task completion
    await task.addCompletion(user.telegramId);
    
    // Update user's balance and daily task count
    user.dailyTasksCompleted += 1;
    await user.addBalance(task.reward);
    await user.save();
    
    // Add XP
    const xpGained = Math.floor(task.reward / 2);
    const levelUp = await user.addXP(xpGained);
    
    // Create transaction record
    const transaction = new Transaction({
      userId: user.telegramId,
      type: 'task_completion',
      amount: task.reward,
      balanceAfter: user.balance,
      description: `Completed task: ${task.title}`,
      taskId: task._id
    });
    await transaction.save();
    
    // Send completion message
    let completionMessage = `
✅ Task Completed Successfully!

Task: ${task.title}
Reward Credited: ${config.CURRENCY_SYMBOL}${task.reward}
New Balance: ${config.CURRENCY_SYMBOL}${user.balance}
    `;
    
    if (levelUp) {
      completionMessage += `\n\n🎉 Level Up! You are now level ${user.level}!`;
    }
    
    await ctx.reply(completionMessage, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.callbackButton('🏠 Back to Menu', 'menu')]
      ])
    });
    
  } catch (error) {
    console.error('Error completing task:', error);
    await ctx.reply('An error occurred while completing the task. Please try again.', {
      ...Markup.inlineKeyboard([
        [Markup.callbackButton('🏠 Back to Menu', 'menu')]
      ])
    });
  }
}

// Helper function to notify admin about new submission
async function notifyAdminNewSubmission(ctx, user, task, proofUrl) {
  try {
    // Get all admin IDs
    const adminIds = config.ADMIN_IDS || [];
    
    for (const adminId of adminIds) {
      await bot.telegram.sendMessage(adminId, `
📸 New Task Submission

User: ${user.fullName} (@${user.username || 'No Username'})
Telegram ID: ${user.telegramId}
Task: ${task.title}
Reward: ${config.CURRENCY_SYMBOL}${task.reward}
Proof: ${proofUrl}

Use the admin panel to review this submission.
      `, {
        parse_mode: 'HTML'
      });
    }
  } catch (error) {
    console.error('Error notifying admin:', error);
  }
}

// Handle /start command with referral
bot.start(async (ctx) => {
  const startPayload = ctx.startPayload;
  
  if (startPayload) {
    // This is a referral
    const referrerId = parseInt(startPayload);
    
    try {
      // Check if referrer exists
      const referrer = await User.findOne({ telegramId: referrerId });
      
      if (referrer) {
        // Add referral to user
        ctx.state.user.referredBy = referrerId;
        await ctx.state.user.save();
        
        // Add referral to referrer's list
        await referrer.addReferral(ctx.state.user.telegramId);
        
        // Credit referral reward to referrer
        await referrer.addBalance(config.REFERRAL_REWARD);
        
        // Create transaction for referral reward
        const transaction = new Transaction({
          userId: referrerId,
          type: 'referral_reward',
          amount: config.REFERRAL_REWARD,
          balanceAfter: referrer.balance,
          description: `Referral reward for ${ctx.state.user.fullName}`,
          referralId: ctx.state.user.telegramId
        });
        await transaction.save();
        
        // Notify referrer
        await bot.telegram.sendMessage(referrerId, `
🎉 New Referral!

 ${ctx.state.user.fullName} (@${ctx.state.user.username || 'No Username'}) has joined using your referral link!

Referral Reward: ${config.CURRENCY_SYMBOL}${config.REFERRAL_REWARD} credited to your balance.
        `, {
          parse_mode: 'HTML'
        });
        
        // Notify user about successful referral
        await ctx.reply(`
👥 Welcome! You were referred by @${referrer.username || 'User'}!

You've been successfully registered. Use /menu to get started.
        `, {
          parse_mode: 'HTML'
        });
      } else {
        // Referrer not found, proceed with normal registration
        await ctx.reply(`Welcome to ${config.BOT_NAME}! 🎉\n\nI'm here to help you earn ${config.CURRENCY_SYMBOL} by completing simple tasks.\n\nUse /menu to see available options.`);
      }
    } catch (error) {
      console.error('Error processing referral:', error);
      await ctx.reply(`Welcome to ${config.BOT_NAME}! 🎉\n\nI'm here to help you earn ${config.CURRENCY_SYMBOL} by completing simple tasks.\n\nUse /menu to see available options.`);
    }
  } else {
    // Normal start command
    await ctx.reply(`Welcome to ${config.BOT_NAME}! 🎉\n\nI'm here to help you earn ${config.CURRENCY_SYMBOL} by completing simple tasks.\n\nUse /menu to see available options.`);
  }
  
  // Call the regular start handler
  ctx.scene = 'start';
  return bot.middleware()(ctx, () => {});
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error while handling update ${ctx.update.update_id}:`, err);
  ctx.reply('An error occurred. Please try again later.');
});

// Launch bot
bot.launch()
  .then(() => console.log(`${config.BOT_NAME} bot launched successfully!`))
  .catch(err => console.error('Error launching bot:', err));

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
