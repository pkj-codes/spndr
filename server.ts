import express from 'express';
import { createServer as createViteServer } from 'vite';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Gracefully warn instead of immediately crashing, but rely strictly on it if provided
  console.warn('WARNING: JWT_SECRET environment variable is missing. Using a fallback for local dev only. Do NOT use in production!');
}
const ACTIVE_JWT_SECRET = JWT_SECRET || 'fallback_secret_for_dev';

// --- MongoDB Models ---
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  age: { type: Number, default: 25 }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const rewardSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  totalPoints: { type: Number, default: 0 },
  level: { type: String, default: 'Bronze' }
});

const Reward = mongoose.model('Reward', rewardSchema);

const expenseSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  date: { type: String, required: true },
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  note: { type: String, required: true },
  isImpulsive: { type: Boolean, default: false }
}, { timestamps: true });

const Expense = mongoose.model('Expense', expenseSchema);

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  limit: { type: Number, required: true },
  keywords: [{ type: String }],
  color: { type: String, default: '#3b82f6' }
});

const settingsSchema = new mongoose.Schema({
  userId: { type: String, default: 'default', unique: true },
  categories: [categorySchema]
});

const Settings = mongoose.model('Settings', settingsSchema);

const DEFAULT_CATEGORIES = [
  { name: 'Food', limit: 3000, keywords: ['swiggy', 'zomato', 'restaurant', 'food', 'lunch', 'dinner', 'breakfast', 'snack', 'cafe', 'coffee'], color: '#f97316' },
  { name: 'Travel', limit: 2000, keywords: ['uber', 'ola', 'bus', 'train', 'flight', 'cab', 'auto', 'petrol', 'fuel', 'ticket', 'metro'], color: '#3b82f6' },
  { name: 'Bills', limit: 5000, keywords: ['electricity', 'recharge', 'rent', 'water', 'internet', 'wifi', 'bill', 'mobile', 'gas'], color: '#ef4444' },
  { name: 'Others', limit: 2000, keywords: [], color: '#8b5cf6' }
];

  async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust proxy to allow express-rate-limit to correctly identify user IPs behind a proxy
  app.set('trust proxy', 1);

  // Enhance security with HTTP headers
  app.use(helmet({
    contentSecurityPolicy: false, // CSP is mostly for frontend control, disabled to allow Vite hot reload without issues
  }));

  // Limit payload size to prevent DOS from oversized payloads
  app.use(express.json({ limit: '10kb' }));

  // --- Rate Limiters ---
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    message: { error: 'Too many requests from this IP, please try again after 15 minutes' },
    validate: { xForwardedForHeader: false, trustProxy: false, forwardedHeader: false, default: true },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // Limit each IP to 5 login requests per 15 mins
    message: { error: 'Too many login attempts from this IP, please try again after 15 minutes' },
    validate: { xForwardedForHeader: false, trustProxy: false, forwardedHeader: false, default: true },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/', generalLimiter);

  // --- Connect to MongoDB ---
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    console.error('MONGODB_URI environment variable is required');
  } else {
    try {
      await mongoose.connect(MONGODB_URI);
      console.log('Connected to MongoDB');
    } catch (err) {
      console.error('Failed to connect to MongoDB:', err);
    }
  }

  // --- Reward Helpers ---
  async function updateUserRewards(userId: string) {
    const user = await User.findById(userId);
    const settings = await Settings.findOne({ userId });
    const expenses = await Expense.find({ userId }).select('amount date').lean();
    
    const monthlyBudget = settings ? settings.categories.reduce((acc: number, c: any) => acc + c.limit, 0) : 0;
    const weeklyBudget = Math.round(monthlyBudget / 4);

    const spendingByWeek: Record<number, number> = {};
    expenses.forEach((e: any) => {
        const d = new Date(e.date);
        const weekId = Math.floor((d.getTime() - 3 * 86400000) / 604800000);
        spendingByWeek[weekId] = (spendingByWeek[weekId] || 0) + e.amount;
    });

    const currentWeekId = Math.floor((new Date().getTime() - 3 * 86400000) / 604800000);
    const createdWeekId = user ? Math.floor((new Date(user.createdAt).getTime() - 3 * 86400000) / 604800000) : currentWeekId;

    let totalPoints = 0;
    for (let w = createdWeekId; w <= currentWeekId; w++) {
        const spent = spendingByWeek[w] || 0;
        const savings = Math.max(0, weeklyBudget - spent);
        totalPoints += savings;
    }

    let level = 'Bronze';
    if (totalPoints >= 3000) level = 'Platinum';
    else if (totalPoints >= 1500) level = 'Gold';
    else if (totalPoints >= 500) level = 'Silver';

    await Reward.findOneAndUpdate(
        { userId },
        { totalPoints, level },
        { new: true, upsert: true }
    );
  }

  async function getWeeklySummary(userId: string) {
    const settings = await Settings.findOne({ userId });
    const expenses = await Expense.find({ userId }).select('amount date isImpulsive').lean();
    
    const monthlyBudget = settings ? settings.categories.reduce((acc: number, c: any) => acc + c.limit, 0) : 0;
    const weeklyBudget = Math.round(monthlyBudget / 4);

    const currentWeekId = Math.floor((new Date().getTime() - 3 * 86400000) / 604800000);
    
    let spentThisWeek = 0;
    let weeklyImpulsePoints = 0;
    expenses.forEach((e: any) => {
        const d = new Date(e.date);
        const weekId = Math.floor((d.getTime() - 3 * 86400000) / 604800000);
        if (weekId === currentWeekId) {
            spentThisWeek += e.amount;
            if (e.isImpulsive) weeklyImpulsePoints += 10;
        }
    });

    const weeklySavings = Math.max(0, weeklyBudget - spentThisWeek);
    return { weeklySavings, weeklyImpulsePoints };
  }

  // --- Auth Middleware ---
  const authMiddleware = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = authHeader.split('Bearer ')[1];
    try {
      const decoded = jwt.verify(token, ACTIVE_JWT_SECRET);
      req.user = decoded; // Contains { userId, email, name, etc }
      next();
    } catch (error) {
      console.error('Error verifying auth token', error);
      res.status(401).json({ error: 'Unauthorized' });
    }
  };

  // --- API Routes ---
  
  // Register route
  app.post('/api/auth/register', loginLimiter, async (req: any, res: any) => {
    try {
      const { name, email, password, age } = req.body;
      if (!name || !email || !password || !age) {
        return res.status(400).json({ error: 'All fields are required' });
      }
      if (typeof password !== 'string' || password.length > 100) {
        return res.status(400).json({ error: 'Password must be a string and up to 100 characters max.' });
      }
      if (typeof email !== 'string' || email.length > 254) {
        return res.status(400).json({ error: 'Email must be a string and up to 254 characters max.' });
      }
      if (typeof name !== 'string' || name.length > 100) {
        return res.status(400).json({ error: 'Name must be a string and up to 100 characters max.' });
      }

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already in use' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = await User.create({ name, email, password: hashedPassword, age: parseInt(age) });

      // Initialize default settings for this user
      await Settings.create({ userId: newUser._id.toString(), categories: DEFAULT_CATEGORIES });
      await Reward.create({ userId: newUser._id.toString() });

      res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to register user' });
    }
  });

  // Login route
  app.post('/api/auth/login', loginLimiter, async (req: any, res: any) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
      if (typeof password !== 'string' || password.length > 100) {
        return res.status(400).json({ error: 'Invalid password format or length.' });
      }
      if (typeof email !== 'string' || email.length > 254) {
        return res.status(400).json({ error: 'Invalid email format or length.' });
      }

      const user = await User.findOne({ email });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });

      const isMatch = await bcrypt.compare(password, user.password as string);
      if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

      const token = jwt.sign({ userId: user._id.toString(), email: user.email, name: user.name, age: user.age }, ACTIVE_JWT_SECRET, { expiresIn: '7d' });

      // Ensure their settings exist
      const existingSettings = await Settings.findOne({ userId: user._id.toString() });
      if (!existingSettings) {
        await Settings.create({ userId: user._id.toString(), categories: DEFAULT_CATEGORIES });
      }

      res.status(200).json({ message: 'Login successful', token, user: { uid: user._id.toString(), email: user.email, name: user.name, age: user.age } });
    } catch (error) {
      res.status(500).json({ error: 'Failed to login' });
    }
  });

  // Get all expenses
  app.get('/api/expenses', authMiddleware, async (req: any, res: any) => {
    try {
      const { month, limit } = req.query;
      let query: any = { userId: req.user.userId };
      
      // Strict regex match to prevent NoSQL injection and ensure correct format
      if (month) {
        if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
          return res.status(400).json({ error: 'Invalid month format. Expected YYYY-MM.' });
        }
        query.date = { $regex: `^${month}` };
      }
      
      let dbQuery = Expense.find(query).sort({ date: -1, createdAt: -1 });
      const parsedLimit = limit ? parseInt(limit as string, 10) : 200;
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
        return res.status(400).json({ error: 'Invalid limit parameter' });
      }
      dbQuery = dbQuery.limit(parsedLimit);

      const expenses = await dbQuery;
      const formattedExpenses = expenses.map(e => ({
        id: e._id.toString(),
        date: e.date,
        amount: e.amount,
        category: e.category,
        note: e.note
      }));
      res.json(formattedExpenses);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch expenses' });
    }
  });

  // Add an expense
  app.post('/api/expenses', authMiddleware, async (req: any, res: any) => {
    try {
      const { amount, category, note } = req.body;
      const date = new Date().toISOString(); // Auto-timestamp

      // 1. Basic validation and sanitization
      if (typeof amount !== 'number' || amount <= 0 || amount > 100000000) {
        return res.status(400).json({ error: 'Amount must be a positive number and within reasonable limits.' });
      }
      if (!category || typeof category !== 'string' || category.length > 50) {
        return res.status(400).json({ error: 'Invalid or oversized category.' });
      }
      if (typeof note !== 'string' || note.length > 500) {
        return res.status(400).json({ error: 'Note must be a string and less than 500 characters.' });
      }

      // Basic anti-XSS sanitization for strings
      const sanitizedNote = note.replace(/[<>]/g, '');
      const sanitizedCategory = category.replace(/[<>]/g, '');

      // 2. Validate category against allowed categories
      const settings = await Settings.findOne({ userId: req.user.userId });
      const allowedCategories = settings 
        ? settings.categories.map((c: any) => c.name) 
        : DEFAULT_CATEGORIES.map((c: any) => c.name);
      
      if (!allowedCategories.includes(sanitizedCategory)) {
        return res.status(400).json({ error: `Category must be one of: ${allowedCategories.join(', ')}` });
      }

      // --- Post-Spend Analysis Logic ---
      const reasons: string[] = [];
      let suggestion = "Keep tracking your expenses!";

      // Rule 1: High Amount ( > 1.5x average of last 5 in same category)
      const last5 = await Expense.find({ userId: req.user.userId, category: sanitizedCategory })
        .sort({ createdAt: -1 })
        .limit(5);

      if (last5.length > 0) {
        const avg = last5.reduce((sum, exp) => sum + exp.amount, 0) / last5.length;
        if (amount > avg * 1.5) {
          reasons.push(`You've spent more than usual on ${sanitizedCategory}.`);
          suggestion = "Consider setting a stricter limit for this category.";
        }
      }

      // Rule 2: Frequent transactions (3+ today in same category)
      const todayStr = date.split('T')[0];
      const todaySameCatCount = await Expense.countDocuments({
        userId: req.user.userId,
        category: sanitizedCategory,
        date: { $regex: `^${todayStr}` }
      });
      const newCount = todaySameCatCount + 1; // Including the current one

      if (newCount >= 3) {
        reasons.push(`This is your ${newCount}th ${sanitizedCategory} expense today.`);
        suggestion = "Try to pause and evaluate if this is necessary.";
      }

      const isImpulsive = reasons.length > 0;

      const newExpense = await Expense.create({ userId: req.user.userId, date, amount, category: sanitizedCategory, note: sanitizedNote, isImpulsive });
      
      await updateUserRewards(req.user.userId);

      res.status(201).json({
        id: newExpense._id.toString(),
        date: newExpense.date,
        amount: newExpense.amount,
        category: newExpense.category,
        note: newExpense.note,
        insight: {
          isImpulsive,
          reasons,
          suggestion
        }
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to add expense' });
    }
  });

  // Delete an expense
  app.delete('/api/expenses/:id', authMiddleware, async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const deleted = await Expense.findOneAndDelete({ _id: id, userId: req.user.userId });
      if (!deleted) {
        return res.status(404).json({ error: 'Expense not found or unauthorized' });
      }

      await updateUserRewards(req.user.userId);

      res.status(200).json({ message: 'Expense deleted successfully' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete expense' });
    }
  });

  // Get settings (categories)
  app.get('/api/settings', authMiddleware, async (req: any, res: any) => {
    try {
      const settings = await Settings.findOne({ userId: req.user.userId });
      if (settings) {
        res.json({ categories: settings.categories });
      } else {
        res.json({ categories: DEFAULT_CATEGORIES });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch settings' });
    }
  });

  // Update settings (categories)
  app.put('/api/settings', authMiddleware, async (req: any, res: any) => {
    try {
      const { categories } = req.body;
      
      if (!Array.isArray(categories) || categories.length > 50) {
        return res.status(400).json({ error: 'Invalid categories payload. Maximum 50 categories allowed.' });
      }

      // Validate and sanitize each category
      const sanitizedCategories = [];
      for (const cat of categories) {
        if (!cat.name || typeof cat.name !== 'string' || cat.name.length > 30) {
          return res.status(400).json({ error: 'Invalid category name (max 30 characters).' });
        }
        if (typeof cat.limit !== 'number' || cat.limit < 0 || cat.limit > 100000000) {
          return res.status(400).json({ error: 'Invalid category limit.' });
        }
        if (cat.color && (typeof cat.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(cat.color))) {
          return res.status(400).json({ error: 'Invalid color hex code.' });
        }
        if (!Array.isArray(cat.keywords) || cat.keywords.length > 50) {
          return res.status(400).json({ error: 'Too many keywords (max 50).' });
        }
        
        const validKeywords = cat.keywords
          .filter((k: any) => typeof k === 'string' && k.length <= 30)
          .map((k: string) => k.replace(/[<>]/g, ''));

        sanitizedCategories.push({
          name: cat.name.replace(/[<>]/g, ''),
          limit: cat.limit,
          color: cat.color || '#3b82f6',
          keywords: validKeywords
        });
      }

      const updatedSettings = await Settings.findOneAndUpdate(
        { userId: req.user.userId },
        { categories: sanitizedCategories },
        { new: true, upsert: true }
      );
      
      await updateUserRewards(req.user.userId);

      res.json({ categories: updatedSettings.categories });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  // Get rewards
  app.get('/api/rewards', authMiddleware, async (req: any, res: any) => {
    try {
      let reward = await Reward.findOne({ userId: req.user.userId });
      if (!reward) {
        await updateUserRewards(req.user.userId);
        reward = await Reward.findOne({ userId: req.user.userId });
      }
      res.json({ totalPoints: reward?.totalPoints || 0, level: reward?.level || 'Bronze' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch rewards' });
    }
  });

  // Get weekly summary
  app.get('/api/weekly-summary', authMiddleware, async (req: any, res: any) => {
    try {
      const summary = await getWeeklySummary(req.user.userId);
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch weekly summary' });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
