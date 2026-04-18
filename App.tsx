import React, { useState, useEffect, useMemo, useRef } from 'react';
import { format, parseISO, isSameMonth } from 'date-fns';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { AlertCircle, CheckCircle2, TrendingUp, Wallet, Banknote, IndianRupee, Moon, Sun, Edit2, X, Trash2, Loader2, Calendar, Plus, LogOut, Award, Trophy, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface CategoryConfig {
  _id?: string;
  name: string;
  limit: number;
  keywords: string[];
  color: string;
}

interface RewardData {
  totalPoints: number;
  level: string;
  weeklySavings?: number;
}

const getProgress = (level: string, points: number) => {
  if (level === 'Bronze') return { min: 0, max: 500, percent: (points / 500) * 100, next: 'Silver' };
  if (level === 'Silver') return { min: 500, max: 1500, percent: ((points - 500) / 1000) * 100, next: 'Gold' };
  if (level === 'Gold') return { min: 1500, max: 3000, percent: ((points - 1500) / 1500) * 100, next: 'Platinum' };
  return { min: 3000, max: 3000, percent: 100, next: 'Max Level' };
};

interface Expense {
  id: string;
  date: string; // ISO string
  amount: number;
  category: string;
  note: string;
  isImpulsive?: boolean;
}

interface AlertMessage {
  type: 'success' | 'warning' | 'error';
  message: string;
}

// --- Helper Functions ---
const parseExpenseText = (text: string, currentCategories: CategoryConfig[]): { amount: number | null; category: string } => {
  const lowerText = text.toLowerCase().replace(/[^\w\s₹$€£]/g, ' ');
  
  // Extract amount
  const amountMatch = text.match(/(?:(?:rs\.?|inr|₹|\$|€|£)\s*)?(\d+(?:\.\d+)?)/i);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

  // Extract category
  let detectedCategory = currentCategories && currentCategories.length > 0 ? currentCategories[currentCategories.length - 1].name : 'Others';
  const words = lowerText.split(/\s+/);
  
  for (const cat of (currentCategories || [])) {
    if ((cat.keywords || []).some(word => words.includes(word))) {
      detectedCategory = cat.name;
      break;
    }
  }

  return { amount, category: detectedCategory };
};

const checkAnomaly = (newAmount: number, category: string, allExpenses: Expense[]): boolean => {
  const categoryExpenses = allExpenses
    .filter(e => e.category === category)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  if (categoryExpenses.length === 0) return false;

  const sum = categoryExpenses.reduce((acc, curr) => acc + curr.amount, 0);
  const avg = sum / categoryExpenses.length;

  return newAmount > avg * 1.5;
};

// --- Main Component ---
export default function App() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [inputText, setInputText] = useState('');
  const [inputDate, setInputDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [alerts, setAlerts] = useState<AlertMessage[]>([]);
  const [lastAdded, setLastAdded] = useState<Expense | null>(null);
  const [insight, setInsight] = useState<{ isImpulsive: boolean; reasons: string[]; suggestion: string } | null>(null);
  
  // Reward States
  const [rewards, setRewards] = useState<{ totalPoints: number; level: string } | null>(null);
  const [weeklySummary, setWeeklySummary] = useState<{ weeklySavings: number; weeklyImpulsePoints: number } | null>(null);

  // New States for Dark Mode and Budgets
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });
  const [categories, setCategories] = useState<CategoryConfig[]>([]);
  const [isEditingBudgets, setIsEditingBudgets] = useState(false);
  const [tempCategories, setTempCategories] = useState<CategoryConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Auth States
  const [user, setUser] = useState<{name: string; email: string; uid?: string; age?: number} | null>(() => {
    const savedUser = localStorage.getItem('user');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [idToken, setIdToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [isAuthReady, setIsAuthReady] = useState(true); // JWT doesn't need async init
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  
  // Auth Form State
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authAge, setAuthAge] = useState('');
  const [authError, setAuthError] = useState('');

  const fetchRewardsData = async () => {
    if (!idToken) return;
    try {
      const [rRes, sRes] = await Promise.all([
        fetch('/api/rewards', { headers: { 'Authorization': `Bearer ${idToken}` } }),
        fetch('/api/weekly-summary', { headers: { 'Authorization': `Bearer ${idToken}` } })
      ]);
      if (rRes.ok) setRewards(await rRes.json());
      if (sRes.ok) setWeeklySummary(await sRes.json());
    } catch (e) {
      console.error(e);
    }
  };

  // Load from API when token is ready
  useEffect(() => {
    if (!idToken) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const currentMonthStr = format(new Date(), 'yyyy-MM');
        const [expensesRes, settingsRes, rewardsRes, summaryRes] = await Promise.all([
          fetch(`/api/expenses?month=${currentMonthStr}`, { headers: { 'Authorization': `Bearer ${idToken}` } }),
          fetch('/api/settings', { headers: { 'Authorization': `Bearer ${idToken}` } }),
          fetch('/api/rewards', { headers: { 'Authorization': `Bearer ${idToken}` } }),
          fetch('/api/weekly-summary', { headers: { 'Authorization': `Bearer ${idToken}` } })
        ]);
        
        if (expensesRes.status === 401 || settingsRes.status === 401) {
          handleLogout();
          return;
        }

        if (expensesRes.ok) setExpenses(await expensesRes.json());
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          setCategories(data.categories || []);
        }
        if (rewardsRes.ok) setRewards(await rewardsRes.json());
        if (summaryRes.ok) setWeeklySummary(await summaryRes.json());
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchData();
  }, [idToken]);

  useEffect(() => {
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const currentMonthExpenses = useMemo(() => {
    const now = new Date();
    return expenses.filter(e => isSameMonth(parseISO(e.date), now));
  }, [expenses]);

  const categoryTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    (categories || []).forEach(c => totals[c.name] = 0);
    currentMonthExpenses.forEach(e => {
      if (totals[e.category] !== undefined) {
        totals[e.category] += e.amount;
      } else {
        totals[e.category] = e.amount;
      }
    });
    return totals;
  }, [currentMonthExpenses, categories]);

  const totalMonthlySpend = useMemo(() => {
    return (Object.values(categoryTotals) as number[]).reduce((a, b) => a + b, 0);
  }, [categoryTotals]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlerts([]);
    setLastAdded(null);
    setInsight(null);

    if (!inputText.trim()) {
      setAlerts([{ type: 'error', message: 'Please enter an expense description.' }]);
      return;
    }

    const { amount, category } = parseExpenseText(inputText, categories);

    if (amount === null || isNaN(amount) || amount <= 0) {
      setAlerts([{ type: 'error', message: 'Could not detect a valid amount. Please include a number.' }]);
      return;
    }

    const newAlerts: AlertMessage[] = [];
    
    // Check budget limit
    const currentCategoryTotal = categoryTotals[category] || 0;
    const newCategoryTotal = currentCategoryTotal + amount;
    const categoryConfig = categories.find(c => c.name === category);
    const limit = categoryConfig ? categoryConfig.limit : 0;
    
    if (limit > 0) {
      if (newCategoryTotal > limit) {
        newAlerts.push({
          type: 'error',
          message: `Budget Exceeded! You've spent ₹${newCategoryTotal} on ${category} this month (Limit: ₹${limit}).`
        });
      } else if (newCategoryTotal > limit * 0.8) {
        newAlerts.push({
          type: 'warning',
          message: `Nearing Budget! You've spent ₹${newCategoryTotal} on ${category} this month (Limit: ₹${limit}).`
        });
      }
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          amount,
          category,
          note: inputText.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const newExpense = {
          id: data.id, date: data.date, amount: data.amount, category: data.category, note: data.note
        };
        
        setExpenses(prev => [newExpense, ...prev]);
        setLastAdded(newExpense);
        
        if (data.insight && data.insight.isImpulsive) {
           setInsight(data.insight);
        } else {
           newAlerts.push({ type: 'success', message: 'Expense added automatically.' });
        }
        
        setAlerts(newAlerts);
        setInputText('');
        fetchRewardsData();
      } else {
        setAlerts([{ type: 'error', message: 'Failed to save expense to database.' }]);
      }
    } catch (error) {
      setAlerts([{ type: 'error', message: 'Network error. Failed to save expense.' }]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/expenses/${id}`, { 
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (res.ok) {
        setExpenses(prev => prev.filter(e => e.id !== id));
        setAlerts([{ type: 'success', message: 'Expense deleted successfully!' }]);
        fetchRewardsData();
      } else {
        setAlerts([{ type: 'error', message: 'Failed to delete expense.' }]);
      }
    } catch (error) {
      setAlerts([{ type: 'error', message: 'Network error. Failed to delete expense.' }]);
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenBudgetModal = () => {
    setTempCategories(JSON.parse(JSON.stringify(categories))); // Deep copy
    setIsEditingBudgets(true);
  };

  const handleSaveBudgets = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ categories: tempCategories }),
      });
      
      if (res.ok) {
        const updatedSettings = await res.json();
        setCategories(updatedSettings.categories);
        setIsEditingBudgets(false);
        fetchRewardsData();
      }
    } catch (error) {
      console.error('Failed to update settings:', error);
    }
  };

  const handleAddCategory = () => {
    setTempCategories([
      ...tempCategories,
      { name: 'New Category', limit: 1000, keywords: [], color: '#9ca3af' }
    ]);
  };

  const handleRemoveCategory = (index: number) => {
    setTempCategories(tempCategories.filter((_, i) => i !== index));
  };

  const handleTempCategoryChange = (index: number, field: keyof CategoryConfig, value: any) => {
    const newCats = [...tempCategories];
    newCats[index] = { ...newCats[index], [field]: value };
    setTempCategories(newCats);
  };

  const getCategoryColor = (catName: string) => {
    const cat = categories.find(c => c.name === catName);
    return cat ? cat.color : '#9ca3af';
  };

  const chartData = (Object.entries(categoryTotals) as [string, number][])
    .filter(([_, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsLoggingIn(true);
    
    try {
      if (authMode === 'register') {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: authName, email: authEmail, password: authPassword, age: parseInt(authAge) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to register');
        
        setAuthMode('login');
        setAuthPassword('');
        setAuthError('Registration successful. Please log in.');
      } else {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: authEmail, password: authPassword }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to login');
        
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        setIdToken(data.token);
        setUser(data.user);
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setIdToken(null);
    setUser(null);
    setExpenses([]);
    setCategories([]);
    setAuthEmail('');
    setAuthPassword('');
    setAuthAge('');
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user || !idToken) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4 transition-colors duration-200">
        <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-xl border border-gray-200 dark:border-gray-800 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/20 mx-auto mb-6">
            <Wallet className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Spndr</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">know where your money goes.</p>
          
          <form onSubmit={handleAuthSubmit} className="space-y-4 text-left">
            {authError && (
              <div className={`p-3 rounded-lg text-sm ${authError.includes('successful') ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                {authError}
              </div>
            )}
            
            {authMode === 'register' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                  <input 
                    type="text" 
                    value={authName}
                    onChange={e => setAuthName(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Age</label>
                  <input 
                    type="number" 
                    value={authAge}
                    onChange={e => setAuthAge(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                    required
                    min="13"
                    max="120"
                  />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
              <input 
                type="email" 
                value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
              <input 
                type="password" 
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                required
              />
            </div>
            
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-xl transition-colors shadow-sm disabled:opacity-50 mt-4 flex justify-center"
            >
              {isLoggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : (authMode === 'login' ? 'Login' : 'Register')}
            </button>
          </form>
          
          <p className="mt-6 text-sm text-gray-600 dark:text-gray-400">
            {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
            <button 
              onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}
              className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
            >
              {authMode === 'login' ? 'Register' : 'Login'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-sans p-4 md:p-8 transition-colors duration-200">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20 shrink-0">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-xl font-bold tracking-tight leading-none mb-1">Spndr</h1>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">know where your money goes.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 mr-2">
              <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 rounded-full flex items-center justify-center font-bold text-sm">
                {user?.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
              </div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate max-w-[120px]">
                {user?.name || user?.email}
              </span>
            </div>
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              aria-label="Toggle Dark Mode"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button
              onClick={handleLogout}
              className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              aria-label="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Command Bar */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-2 transition-colors relative z-10">
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 flex items-center px-4 bg-gray-50 dark:bg-gray-950 rounded-xl border border-transparent focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
              <Banknote className="w-5 h-5 text-gray-400 shrink-0" />
              <input
                autoFocus
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="e.g., ₹450 at Swiggy for lunch"
                className="w-full bg-transparent border-none focus:ring-0 px-3 py-4 text-gray-900 dark:text-white placeholder-gray-400 outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium px-6 py-4 rounded-xl transition-colors flex items-center justify-center gap-2 shrink-0 shadow-sm shadow-blue-600/20"
              >
                {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save'}
              </button>
            </div>
          </form>
        </div>

        {/* Alerts & Feedback */}
        <AnimatePresence>
          {(alerts.length > 0 || lastAdded || insight) && (
            <motion.div 
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              className="space-y-3"
            >
              {insight && (
                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800/50 rounded-xl p-4 flex items-start gap-3 transition-colors">
                  <AlertCircle className="w-5 h-5 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-orange-900 dark:text-orange-200">Wait a second...</p>
                    <ul className="text-sm text-orange-800 dark:text-orange-300 mt-1 list-disc list-inside">
                      {insight.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                    <p className="text-sm font-medium text-orange-900 dark:text-orange-200 mt-2">💡 {insight.suggestion}</p>
                  </div>
                </div>
              )}
              
              {lastAdded && !insight && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-xl p-4 flex items-start gap-3 transition-colors">
                  <CheckCircle2 className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-200">Added Automatically</p>
                    <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                      Amount: <span className="font-mono font-semibold">₹{lastAdded.amount}</span> <br/>
                      Category: <span className="font-semibold">{lastAdded.category}</span>
                    </p>
                  </div>
                </div>
              )}
              
              {alerts.map((alert, idx) => (
                <div 
                  key={idx} 
                  className={`rounded-xl p-4 flex items-start gap-3 border transition-colors ${
                    alert.type === 'error' ? 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800/50 text-red-800 dark:text-red-200' :
                    alert.type === 'warning' ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-800/50 text-orange-800 dark:text-orange-200' :
                    'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800/50 text-green-800 dark:text-green-200'
                  }`}
                >
                  <AlertCircle className={`w-5 h-5 shrink-0 mt-0.5 ${
                    alert.type === 'error' ? 'text-red-600 dark:text-red-400' :
                    alert.type === 'warning' ? 'text-orange-600 dark:text-orange-400' :
                    'text-green-600 dark:text-green-400'
                  }`} />
                  <p className="text-sm font-medium">{alert.message}</p>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Rewards & Leveling */}
        {rewards && weeklySummary && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 flex flex-col items-center gap-6 relative overflow-hidden transition-colors">
              <div className="w-full">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-500" />
                  Financial Reward Tier: {rewards.level}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  You've earned {rewards.totalPoints.toLocaleString()} total points from saving money!
                </p>
                
                <div className="mt-4">
                  <div className="flex justify-between text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    <span>Level Progress</span>
                    <span>Next: {getProgress(rewards.level, rewards.totalPoints).next}</span>
                  </div>
                  <div className="h-2.5 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-full transition-all duration-1000" 
                      style={{ width: `${Math.min(100, Math.max(0, getProgress(rewards.level, rewards.totalPoints).percent))}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              <div className="flex gap-6 w-full shrink-0 justify-around pt-4 border-t border-gray-100 dark:border-gray-800">
                <div className="text-center">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Weekly Savings</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400 font-mono flex items-center justify-center">
                    <span className="text-green-400/50 text-xl mr-1">₹</span>
                    {weeklySummary.weeklySavings.toLocaleString()}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Total Points</p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 font-mono flex items-center justify-center">
                    <Award className="w-5 h-5 text-blue-400/50 mr-1" />
                    {rewards.totalPoints.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            {/* Impulse Tracker */}
            <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 flex flex-col justify-between relative overflow-hidden transition-colors">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Zap className="w-5 h-5 text-orange-500" />
                  Impulse Tracker
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Age {user?.age || '20+'} demographic insight: Users in your age group ({Math.floor((user?.age || 20) / 10) * 10}s) tend to prefer structured budgeting to reduce impulsiveness.
                </p>
              </div>

              <div className="mt-6">
                <div className="flex justify-between items-end mb-2">
                  <div>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Weekly Impulse Points</span>
                    <p className="text-2xl font-bold text-orange-600 dark:text-orange-400 font-mono">
                      {weeklySummary.weeklyImpulsePoints} <span className="text-sm font-sans text-gray-400">pts</span>
                    </p>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                    weeklySummary.weeklyImpulsePoints > 30 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                    weeklySummary.weeklyImpulsePoints > 10 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  }`}>
                    {weeklySummary.weeklyImpulsePoints > 30 ? 'High' : weeklySummary.weeklyImpulsePoints > 10 ? 'Moderate' : 'Low'}
                  </span>
                </div>
                <div className="h-3 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-orange-400 to-red-600 rounded-full transition-all duration-1000" 
                    style={{ width: `${Math.min(100, (weeklySummary.weeklyImpulsePoints / 50) * 100)}%` }}
                  ></div>
                </div>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 text-right mt-1 font-mono hover:underline cursor-help" title="Max visual capacity at 50 points">/ 50 pts</p>
              </div>
            </div>
          </div>
        )}

        {/* Bento Grid Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          
          {/* Total Spend */}
          <div className="md:col-span-4 bg-white dark:bg-gray-900 rounded-3xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 flex flex-col justify-center relative overflow-hidden">
            <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-50 dark:bg-blue-900/20 rounded-full blur-2xl transition-colors"></div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 relative z-10">Monthly Spend</p>
            <p className="text-4xl font-bold text-gray-900 dark:text-white mt-2 flex items-center font-mono tracking-tight relative z-10">
              <span className="text-gray-400 dark:text-gray-500 mr-1 font-sans font-normal text-3xl">₹</span>
              {totalMonthlySpend.toLocaleString()}
            </p>
          </div>

          {/* Budgets */}
          <div className="md:col-span-8 bg-white dark:bg-gray-900 rounded-3xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Budget Status</h3>
              <button 
                onClick={handleOpenBudgetModal}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors text-gray-400 hover:text-gray-900 dark:hover:text-white"
                aria-label="Edit Budgets"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
              {(categories || []).map(cat => {
                const spent = categoryTotals[cat.name] || 0;
                const limit = cat.limit;
                const percentage = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
                
                let colorClass = "bg-blue-500 dark:bg-blue-400";
                if (percentage >= 100) colorClass = "bg-red-500 dark:bg-red-400";
                else if (percentage >= 80) colorClass = "bg-orange-500 dark:bg-orange-400";

                return (
                  <div key={cat.name} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-gray-700 dark:text-gray-300">{cat.name}</span>
                      <span className="text-gray-500 dark:text-gray-400 font-mono text-xs mt-0.5">
                        ₹{spent.toLocaleString()} / ₹{limit.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${percentage}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className={`h-full rounded-full ${colorClass}`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Chart */}
          <div className="md:col-span-5 bg-white dark:bg-gray-900 rounded-3xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="text-base font-semibold mb-6 flex items-center gap-2 text-gray-900 dark:text-white">
              <TrendingUp className="w-4 h-4 text-gray-400" />
              Spending by Category
            </h3>
            {chartData.length > 0 ? (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={getCategoryColor(entry.name)} />
                      ))}
                    </Pie>
                    <RechartsTooltip 
                      formatter={(value: number) => [`₹${value}`, 'Amount']}
                      contentStyle={{ 
                        borderRadius: '12px', 
                        border: '1px solid var(--color-gray-200)', 
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        backgroundColor: isDarkMode ? '#111827' : '#ffffff',
                        color: isDarkMode ? '#f3f4f6' : '#111827',
                        fontFamily: 'JetBrains Mono, monospace'
                      }}
                    />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400 dark:text-gray-600 text-sm">
                No expenses this month
              </div>
            )}
          </div>

          {/* Recent Transactions */}
          <div className="md:col-span-7 bg-white dark:bg-gray-900 rounded-3xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 flex flex-col">
            <h3 className="text-base font-semibold mb-4 text-gray-900 dark:text-white">Recent Transactions</h3>
            <div className="flex-1 overflow-y-auto pr-2 -mr-2 max-h-[320px]">
              {expenses.length > 0 ? (
                <div className="space-y-2">
                  <AnimatePresence initial={false}>
                    {expenses.map(expense => (
                      <motion.div 
                        key={expense.id}
                        initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                        animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
                        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                        transition={{ duration: 0.2 }}
                        className="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-2xl transition-colors group"
                      >
                        <div className="flex items-center gap-4">
                          <div 
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm"
                            style={{ backgroundColor: getCategoryColor(expense.category) }}
                          >
                            {expense.category.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{expense.note}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{format(parseISO(expense.date), 'MMM d, yyyy')}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-gray-900 dark:text-white font-mono">₹{expense.amount}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{expense.category}</p>
                          </div>
                          <button
                            onClick={() => handleDelete(expense.id)}
                            disabled={deletingId === expense.id}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                            title="Delete expense"
                          >
                            {deletingId === expense.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-600 text-sm">
                  No transactions yet
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Budget Edit Modal */}
      <AnimatePresence>
        {isEditingBudgets && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-gray-900/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200 dark:border-gray-800"
            >
              <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Manage Categories</h3>
                <button 
                  onClick={() => setIsEditingBudgets(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                {(tempCategories || []).map((cat, index) => (
                  <div key={index} className="space-y-3 p-4 bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 relative group">
                    <button
                      onClick={() => handleRemoveCategory(index)}
                      className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      title="Remove Category"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    
                    <div className="grid grid-cols-2 gap-3 pr-8">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
                        <input
                          type="text"
                          value={cat.name}
                          onChange={(e) => handleTempCategoryChange(index, 'name', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Monthly Limit (₹)</label>
                        <input
                          type="number"
                          min="0"
                          value={cat.limit}
                          onChange={(e) => handleTempCategoryChange(index, 'limit', Number(e.target.value))}
                          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Keywords (comma separated)</label>
                      <input
                        type="text"
                        value={(cat.keywords || []).join(', ')}
                        onChange={(e) => handleTempCategoryChange(index, 'keywords', e.target.value.split(',').map(k => k.trim()).filter(k => k))}
                        placeholder="e.g. netflix, spotify"
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                      />
                    </div>
                  </div>
                ))}
                
                <button
                  onClick={handleAddCategory}
                  className="w-full py-3 border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-2xl text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-200 dark:hover:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all flex items-center justify-center gap-2 text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Add Category
                </button>
              </div>
              <div className="p-6 bg-gray-50 dark:bg-gray-950/50 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
                <button
                  onClick={() => setIsEditingBudgets(false)}
                  className="px-5 py-2.5 rounded-xl font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveBudgets}
                  className="px-5 py-2.5 rounded-xl font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-600/20 transition-colors"
                >
                  Save Changes
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
