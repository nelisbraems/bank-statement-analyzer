import React, { useState, useEffect } from 'react';
import { Upload, DollarSign, TrendingUp, TrendingDown, Check, X, ArrowRight, Database, RefreshCw, Save, CreditCard, Lock, LogOut } from 'lucide-react';
import Papa from 'papaparse';
import TransactionGrid from './components/TransactionGrid';
import WidgetPanel from './components/WidgetPanel';

const API_URL = import.meta.env.PROD ? '/api' : 'http://localhost:3001/api';

// Get stored auth token
const getAuthToken = () => localStorage.getItem('authToken');
const setAuthToken = (token) => {
  if (token) localStorage.setItem('authToken', token);
  else localStorage.removeItem('authToken');
};

// Helper to add auth headers to fetch requests
const authFetch = (url, options = {}) => {
  const token = getAuthToken();
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
  });
};

// Login Screen Component
function LoginScreen({ onLogin, error, loading }) {
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onLogin(password);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="h-8 w-8 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Bank Statement Analyzer</h1>
          <p className="text-gray-600 mt-2">Enter password to access your data</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="mb-6">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-lg"
              autoFocus
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

const DEFAULT_WIDGETS = [
  { id: 1, title: 'Spending by Category', groupBy: 'category', metric: 'expenses', limit: 10 },
];

export default function App() {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [preview, setPreview] = useState(null);
  const [columnMapping, setColumnMapping] = useState(null);
  const [rawData, setRawData] = useState(null);
  const [showMapping, setShowMapping] = useState(true);
  const [viewMode, setViewMode] = useState('saved'); // 'saved' or 'upload'
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [widgets, setWidgets] = useState(() => {
    const saved = localStorage.getItem('bankAnalyzerWidgets');
    return saved ? JSON.parse(saved) : DEFAULT_WIDGETS;
  });

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    setAuthLoading(true);
    try {
      const res = await authFetch(`${API_URL}/auth/check`);
      const data = await res.json();

      if (!data.passwordRequired) {
        // No password configured, auto-authenticate
        setIsAuthenticated(true);
      } else if (data.authenticated) {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error('Auth check error:', err);
      // If server is unreachable, still show login
      setIsAuthenticated(false);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async (password) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setAuthToken(data.token);
        setIsAuthenticated(true);
      } else {
        setAuthError(data.error || 'Invalid password');
      }
    } catch (err) {
      console.error('Login error:', err);
      setAuthError('Could not connect to server');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await authFetch(`${API_URL}/auth/logout`, { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    }
    setAuthToken(null);
    setIsAuthenticated(false);
    setTransactions([]);
    setSummary(null);
  };

  // Persist widgets to localStorage
  useEffect(() => {
    localStorage.setItem('bankAnalyzerWidgets', JSON.stringify(widgets));
  }, [widgets]);

  // Fetch saved transactions from database
  const fetchTransactions = async () => {
    setLoading(true);
    setError(null);
    try {
      const [txnRes, summaryRes] = await Promise.all([
        authFetch(`${API_URL}/transactions`),
        authFetch(`${API_URL}/transactions/summary`)
      ]);

      if (!txnRes.ok || !summaryRes.ok) throw new Error('Failed to fetch data');

      const txnData = await txnRes.json();
      const summaryData = await summaryRes.json();

      setTransactions(txnData.transactions.map((t, idx) => ({
        id: t._id || idx,
        date: t.date,
        description: t.description,
        details: t.details || null,
        amount: t.amount,
        type: t.type,
        category: t.category,
        counterparty: t.counterparty,
        source: t.source || 'bank_statement',
        isCreditCardPayment: t.isCreditCardPayment || false
      })));

      // Build category totals from aggregation
      const categoryRes = await authFetch(`${API_URL}/transactions/aggregate?groupBy=category`);
      const categoryData = await categoryRes.json();
      const categoryTotals = {};
      categoryData.results.forEach(r => {
        if (r._id && r._id !== 'Income') {
          categoryTotals[r._id] = r.expenses;
        }
      });

      setSummary({
        income: summaryData.totalIncome,
        expenses: summaryData.totalExpenses,
        net: summaryData.netBalance,
        categoryTotals
      });
      setShowMapping(false);
    } catch (err) {
      console.error('Fetch error:', err);
      setError('Failed to load transactions. Is the server running?');
    } finally {
      setLoading(false);
    }
  };

  // Save imported transactions to database
  const saveToDatabase = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(`${API_URL}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions })
      });

      if (!res.ok) throw new Error('Failed to save');

      const data = await res.json();
      alert(data.message || `Successfully saved ${data.insertedCount} transactions!`);
      setViewMode('saved');
      fetchTransactions();
    } catch (err) {
      console.error('Save error:', err);
      setError('Failed to save transactions');
    } finally {
      setSaving(false);
    }
  };

  // Fetch transactions when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchTransactions();
    }
  }, [isAuthenticated]);

  const requiredFields = [
    { key: 'date', label: 'Execution Date', description: 'Transaction date (Uitvoeringsdatum)' },
    { key: 'amount', label: 'Amount', description: 'Transaction amount (Bedrag)' },
    { key: 'description', label: 'Description', description: 'Transaction description (Mededeling)' },
    { key: 'details', label: 'Details', description: 'Transaction details (Details/Omschrijving)' },
    { key: 'counterparty', label: 'Counterparty Name', description: 'Name of counterparty (Naam van de tegenpartij)' },
    { key: 'type', label: 'Transaction Type', description: 'Type of transaction (Type verrichting)' },
    { key: 'status', label: 'Status', description: 'Transaction status (Status)' }
  ];

  // Extract counterparty from description or details when not provided
  const extractCounterparty = (description, details) => {
    // First try to extract from details (often has more info for debit card payments)
    if (details) {
      const detailsStr = details.trim();

      // Pattern: "BETALING MET DEBETKAART NUMMER XXXX XXXX XXXX XXXX [optional: store code] [MERCHANT NAME] [CITY] [POSTAL] [DATE]"
      // Examples:
      //   "BETALING MET DEBETKAART NUMMER 4871 04XX XXXX 8334 ACTION ZOTTEGEM 9620 30/12/2025"
      //   "BETALING MET DEBETKAART NUMMER 4871 04XX XXXX 7976 GRAND CAFE DRUGSTORE HASSELT 3500 01/01/2026"
      //   "BETALING MET DEBETKAART NUMMER 4871 04XX XXXX 8334 AD DELH ZOTTEGEM 9620 30/12/2025"
      //   "BETALING MET DEBETKAART NUMMER 4871 04XX XXXX 8334 3943 DREAMLAND ZOTTEGE 9620 ZOTTEGEM 31/12/2025"
      //   "BETALING MET DEBETKAART NUMMER 4871 04XX XXXX 7976 3599 COLRUYT"
      // Strategy: get everything after card number, strip store code/city/postal/date from the end
      const debitCardMatch = detailsStr.match(/BETALING MET DEBETKAART NUMMER \d{4} \d{2}XX XXXX \d{4}\s+(.+)/i);
      if (debitCardMatch) {
        let rest = debitCardMatch[1].trim();
        // Remove date at the end (dd/mm/yyyy)
        rest = rest.replace(/\s+\d{2}\/\d{2}\/\d{4}\s*$/, '').trim();
        // Remove location after postal code (e.g., "9620 ZOTTEGEM" at end)
        rest = rest.replace(/\s+\d{4}\s+[A-Z]+\s*$/i, '').trim();
        // Remove trailing postal code and truncated city (e.g., "ZOTTEGE 9620")
        rest = rest.replace(/\s+[A-Z]+\s+\d{4}\s*$/i, '').trim();
        // Remove leading store code if present (4 digits at start)
        rest = rest.replace(/^\d{4}\s+/, '').trim();

        // If we still have something, return it
        if (rest && !rest.match(/^\d+$/)) {
          return expandMerchantName(rest);
        }
      }

      // Pattern: "TERUGBETALING WOONKREDIET [account] [reference]" - house loan repayment
      if (detailsStr.match(/^TERUGBETALING WOONKREDIET/i)) {
        return 'Woonkrediet (Hypotheek)';
      }

      // Pattern: "GELDOPNEMING ... [ATM LOCATION]"
      const atmMatch = detailsStr.match(/GELDOPNEMING[^A-Z]*([A-Z][A-Z\s]+?)\s+\d{4}/i);
      if (atmMatch) {
        return `ATM ${atmMatch[1].trim()}`;
      }

      // Pattern: "DOMICILIERING ... [CREDITOR]"
      const domMatch = detailsStr.match(/DOMICILIERING[^:]*:\s*([^,\n]+)/i);
      if (domMatch) {
        return domMatch[1].trim();
      }

      // Pattern: "OVERSCHRIJVING ... NAAM: [NAME]" or just extract first recognizable name
      const nameMatch = detailsStr.match(/NAAM[:\s]+([A-Za-z][A-Za-z\s&\-'\.]+?)(?:\s+[A-Z]{2}\d|\s+IBAN|\s+BIC|\s*$)/i);
      if (nameMatch) {
        return nameMatch[1].trim();
      }
    }

    if (!description) return null;
    const desc = description.trim();

    // Pattern: "[4 digits] [Name] [Location] -" (bakery/shop terminal format)
    const terminalMatch = desc.match(/^\d{4}\s+(.+?)\s+\w+\s+-$/);
    if (terminalMatch) return terminalMatch[1].trim();

    // Pattern: "[Name]: [reference]" (e.g., "Jaxx: 72288235")
    const colonMatch = desc.match(/^([A-Za-z][A-Za-z0-9\s&'-]+):\s*\d+/);
    if (colonMatch) return colonMatch[1].trim();

    // Pattern: "[7-char code] [Name]" (e.g., "75Q9GCO Pelsbarn", "75MC00I H M Online BE")
    const codeMatch = desc.match(/^[A-Z0-9]{7}\s+(.+?)(?:\s+(?:BE|NL|DE|FR))?$/i);
    if (codeMatch) {
      let name = codeMatch[1].trim();
      name = name.replace(/\s+B\.?V\.?$/i, '').trim();
      name = name.replace(/\s+-\s*balans-?$/i, '').trim();
      if (name.match(/^H\s+M\b/i)) name = name.replace(/^H\s+M\b/i, 'H&M');
      return name;
    }

    // Pattern: "ACUPUNCTUUR[LOCATION]"
    if (desc.match(/^ACUPUNCTUUR[A-Z]/i)) {
      const location = desc.replace(/^ACUPUNCTUUR/i, '');
      return `Acupunctuur ${location.charAt(0).toUpperCase() + location.slice(1).toLowerCase()}`;
    }

    // Known brand patterns
    if (desc.match(/Klarna$/i)) return 'Klarna';
    if (desc.match(/SHEIN$/i)) return 'Shein';

    // Credit card payment
    if (desc.match(/^MASTERCARD\s+\d+/i)) return 'Mastercard Payment';

    return null;
  };

  // Expand common merchant abbreviations
  const expandMerchantName = (name) => {
    const abbreviations = {
      'AD DELH': 'AD Delhaize',
      'DELH': 'Delhaize',
      'COLR': 'Colruyt',
      'CARF': 'Carrefour',
      'CARREF': 'Carrefour',
      'LIDL': 'Lidl',
      'ALDI': 'Aldi',
      'AH': 'Albert Heijn',
      'ALBERT H': 'Albert Heijn',
      'KRUIDV': 'Kruidvat',
      'HEMA': 'HEMA',
      'ACTION': 'Action',
      'ZEEMAN': 'Zeeman',
      'PRIMARK': 'Primark',
      'C&A': 'C&A',
      'H&M': 'H&M',
      'MEDIAMARKT': 'MediaMarkt',
      'MEDIAMARK': 'MediaMarkt',
      'FNAC': 'Fnac',
      'BRICO': 'Brico',
      'HUBO': 'Hubo',
      'GAMMA': 'Gamma',
      'DREAMLAND': 'Dreamland',
      'STANDAARD': 'Standaard Boekhandel',
    };

    const upperName = name.toUpperCase().trim();
    for (const [abbrev, full] of Object.entries(abbreviations)) {
      if (upperName.startsWith(abbrev)) {
        return full;
      }
    }

    // Title case the name if no match found
    return name.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  // Check if transaction is a credit card payment (to exclude from spending totals)
  const isCreditCardPayment = (description, type) => {
    if (type === 'Kredietkaartbetaling') return true;
    if (description && description.match(/^MASTERCARD\s+\d+/i)) return true;
    return false;
  };

  const categorizeTransaction = (description, amount) => {
    const desc = description.toLowerCase();
    if (amount > 0) return 'Income';
    if (desc.includes('grocery') || desc.includes('supermarket') || desc.includes('food') || 
        desc.includes('delhaize') || desc.includes('colruyt') || desc.includes('carrefour') ||
        desc.includes('aldi') || desc.includes('lidl')) return 'Groceries';
    if (desc.includes('restaurant') || desc.includes('cafe') || desc.includes('coffee') || 
        desc.includes('resto') || desc.includes('horeca') || desc.includes('pizza') ||
        desc.includes('takeaway')) return 'Dining';
    if (desc.includes('gas') || desc.includes('fuel') || desc.includes('shell') || 
        desc.includes('benzine') || desc.includes('nmbs') || desc.includes('de lijn') ||
        desc.includes('total') || desc.includes('q8')) return 'Transportation';
    if (desc.includes('rent') || desc.includes('mortgage') || desc.includes('huur')) return 'Housing';
    if (desc.includes('electric') || desc.includes('water') || desc.includes('internet') || 
        desc.includes('phone') || desc.includes('proximus') || desc.includes('telenet') ||
        desc.includes('engie') || desc.includes('luminus')) return 'Utilities';
    if (desc.includes('amazon') || desc.includes('bol.com') || desc.includes('coolblue') ||
        desc.includes('zalando') || desc.includes('h&m')) return 'Shopping';
    if (desc.includes('netflix') || desc.includes('spotify') || desc.includes('streamz') ||
        desc.includes('disney') || desc.includes('cinema')) return 'Entertainment';
    if (desc.includes('gym') || desc.includes('fitness') || desc.includes('basic-fit') ||
        desc.includes('apotheek') || desc.includes('pharmacy')) return 'Health & Fitness';
    return 'Other';
  };

  const detectColumns = (headers) => {
    const mapping = { date: '', amount: '', description: '', details: '', counterparty: '', type: '', status: '' };
    headers.forEach(header => {
      const h = header.toLowerCase();
      if (h.includes('uitvoeringsdatum') || (h.includes('datum') && !h.includes('valuta'))) mapping.date = header;
      else if (h.includes('bedrag') || h.includes('amount')) mapping.amount = header;
      else if (h.includes('mededeling') || h === 'description') mapping.description = header;
      else if (h === 'details' || h.includes('omschrijving')) mapping.details = header;
      else if (h.includes('naam van de tegenpartij') || h.includes('tegenpartij')) mapping.counterparty = header;
      else if (h.includes('type verrichting') || h === 'type') mapping.type = header;
      else if (h.includes('status')) mapping.status = header;
    });
    return mapping;
  };

  const processFile = (file) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      delimitersToGuess: [',', ';', '\t'],
      complete: (results) => {
        try {
          const headers = Object.keys(results.data[0] || {}).map(h => h.trim());
          const cleanedData = results.data.map(row => {
            const cleanRow = {};
            Object.keys(row).forEach(key => {
              cleanRow[key.trim()] = row[key];
            });
            return cleanRow;
          });
          const mapping = detectColumns(headers);
          setColumnMapping(mapping);
          setRawData(cleanedData);
          setPreview({ headers, sampleRows: cleanedData.slice(0, 5), totalRows: cleanedData.length });
          setShowMapping(true);
        } catch (error) {
          console.error('Error processing file:', error);
          alert('Error processing file. Please ensure it\'s a valid CSV.');
        }
      },
      error: (error) => {
        console.error('Parse error:', error);
        alert('Failed to parse CSV file. Please check the format.');
      }
    });
  };

  const handleMappingChange = (field, value) => {
    setColumnMapping(prev => ({ ...prev, [field]: value }));
  };

  const confirmMapping = () => {
    if (!columnMapping.date || !columnMapping.amount) {
      alert('Date and Amount fields are required!');
      return;
    }

    const processed = rawData.map((row, idx) => {
      const description = String(row[columnMapping.description] ?? '');
      const details = String(row[columnMapping.details] ?? '');
      let counterparty = String(row[columnMapping.counterparty] ?? '').trim();
      const type = row[columnMapping.type] || '';

      // Extract counterparty from description/details if not provided
      if (!counterparty) {
        counterparty = extractCounterparty(description, details) || '';
      }

      // Use details as description if description is empty but details exists
      const primaryDescription = description || details;
      const fullDescription = counterparty
        ? `${counterparty} - ${primaryDescription}`
        : primaryDescription;

      let amount = row[columnMapping.amount];
      if (typeof amount === 'string') {
        amount = parseFloat(amount.replace(',', '.').replace(/[^\d.-]/g, ''));
      }
      if (isNaN(amount)) amount = 0;

      // Check if this is a credit card payment
      const creditCardPayment = isCreditCardPayment(description || details, type);

      return {
        id: idx,
        date: row[columnMapping.date] || '',
        description: fullDescription.trim(),
        details: details || null,
        amount,
        type,
        status: row[columnMapping.status] || '',
        category: creditCardPayment ? 'Credit Card Payment' : categorizeTransaction(fullDescription, amount),
        counterparty,
        isCreditCardPayment: creditCardPayment,
        source: 'bank_statement'
      };
    }).filter(t => {
      // Only filter out rejected transactions, keep everything else
      const isRejected = t.status && t.status.toLowerCase().includes('geweigerd');
      // Must have a date and valid amount
      const hasDate = t.date && t.date.trim() !== '';
      const hasAmount = !isNaN(t.amount);
      return hasDate && hasAmount && !isRejected;
    });

    processed.sort((a, b) => new Date(b.date) - new Date(a.date));
    setTransactions(processed);
    calculateSummary(processed);
    setShowMapping(false);
  };

  const calculateSummary = (txns) => {
    // Exclude credit card payments from totals to avoid double-counting
    const nonCreditCardTxns = txns.filter(t => !t.isCreditCardPayment);
    const income = nonCreditCardTxns.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const expenses = Math.abs(nonCreditCardTxns.filter(t => t.amount < 0).reduce((sum, t) => sum + t.amount, 0));
    const categoryTotals = {};
    nonCreditCardTxns.forEach(t => {
      if (t.amount < 0) {
        categoryTotals[t.category] = (categoryTotals[t.category] || 0) + Math.abs(t.amount);
      }
    });
    setSummary({ income, expenses, net: income - expenses, categoryTotals });
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file && (file.type === 'text/csv' || file.name.endsWith('.csv'))) {
      processFile(file);
    } else {
      alert('Please upload a CSV file');
    }
  };

  // Handle PDF upload for Mastercard statements
  const handlePdfUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const pdfFiles = files.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (pdfFiles.length === 0) {
      alert('Please upload PDF files');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      pdfFiles.forEach(file => formData.append('files', file));

      const res = await authFetch(`${API_URL}/transactions/parse-pdf`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error('Failed to parse PDF');

      const data = await res.json();

      if (data.transactions.length === 0) {
        setError('No transactions found in the PDF(s). Make sure these are Mastercard statement PDFs.');
        return;
      }

      // Process transactions with IDs
      const processed = data.transactions.map((t, idx) => ({
        ...t,
        id: idx,
        isCreditCardPayment: false // These ARE the credit card details, not the lump sum payment
      }));

      processed.sort((a, b) => {
        // Parse DD/MM/YYYY dates
        const parseDate = (d) => {
          const [day, month, year] = d.split('/');
          return new Date(year, month - 1, day);
        };
        return parseDate(b.date) - parseDate(a.date);
      });

      setTransactions(processed);
      calculateSummary(processed);
      setShowMapping(false);
      setPreview({ totalRows: processed.length, isPdf: true, fileCount: pdfFiles.length });

      if (data.errors && data.errors.length > 0) {
        console.warn('PDF parsing errors:', data.errors);
      }
    } catch (err) {
      console.error('PDF upload error:', err);
      setError('Failed to parse PDF files. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const resetAnalyzer = () => {
    setTransactions([]);
    setSummary(null);
    setPreview(null);
    setColumnMapping(null);
    setRawData(null);
    setShowMapping(true);
  };

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  // Show login screen if not authenticated
  if (!isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} error={authError} loading={authLoading} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
          <div className="flex justify-between items-start mb-2">
            <h1 className="text-3xl font-bold text-gray-800">Bank Statement Analyzer</h1>
            <div className="flex gap-2">
              {viewMode === 'upload' && (
                <button
                  onClick={() => { resetAnalyzer(); setViewMode('saved'); fetchTransactions(); }}
                  className="text-sm text-gray-600 hover:text-gray-800 font-medium flex items-center gap-1"
                >
                  <Database className="h-4 w-4" />
                  View Saved
                </button>
              )}
              {viewMode === 'saved' && (
                <>
                  <button
                    onClick={fetchTransactions}
                    disabled={loading}
                    className="text-sm text-gray-600 hover:text-gray-800 font-medium flex items-center gap-1"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                  <button
                    onClick={() => { resetAnalyzer(); setViewMode('upload'); }}
                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                  >
                    <Upload className="h-4 w-4" />
                    Import Data
                  </button>
                </>
              )}
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-red-600 font-medium flex items-center gap-1 ml-2"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
          <p className="text-gray-600 mb-6">
            {viewMode === 'saved'
              ? 'Viewing transactions from database'
              : 'Upload bank statement CSV or Mastercard PDF statements'}
          </p>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {loading && viewMode === 'saved' && (
            <div className="text-center py-12">
              <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin mx-auto mb-4" />
              <p className="text-gray-600">Loading transactions...</p>
            </div>
          )}

          {viewMode === 'upload' && !preview && !loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* CSV Upload */}
              <div className="border-2 border-dashed border-indigo-300 rounded-xl p-8 text-center hover:border-indigo-500 transition-colors bg-indigo-50">
                <Upload className="mx-auto h-12 w-12 text-indigo-400 mb-4" />
                <label className="cursor-pointer">
                  <span className="text-indigo-600 font-semibold hover:text-indigo-700">Bank Statement CSV</span>
                  <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                </label>
                <p className="text-sm text-gray-500 mt-2">KBC, BNP, ING, Belfius, etc.</p>
              </div>

              {/* PDF Upload */}
              <div className="border-2 border-dashed border-orange-300 rounded-xl p-8 text-center hover:border-orange-500 transition-colors bg-orange-50">
                <CreditCard className="mx-auto h-12 w-12 text-orange-400 mb-4" />
                <label className="cursor-pointer">
                  <span className="text-orange-600 font-semibold hover:text-orange-700">Mastercard PDF</span>
                  <input type="file" accept=".pdf" multiple onChange={handlePdfUpload} className="hidden" />
                </label>
                <p className="text-sm text-gray-500 mt-2">Upload one or more statement PDFs</p>
              </div>
            </div>
          )}

          {viewMode === 'upload' && loading && (
            <div className="text-center py-12">
              <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin mx-auto mb-4" />
              <p className="text-gray-600">Processing files...</p>
            </div>
          )}
        </div>

        {preview && showMapping && !preview.isPdf && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Map Your Columns</h2>
            <p className="text-gray-600 mb-6">
              Found {preview.totalRows} transactions. Please verify or adjust the column mapping below:
            </p>
            
            <div className="space-y-4 mb-6">
              {requiredFields.map(field => (
                <div key={field.key} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <label className="font-semibold text-gray-800 block mb-1">
                        {field.label}
                        {(field.key === 'date' || field.key === 'amount') && 
                          <span className="text-red-500 ml-1">*</span>
                        }
                      </label>
                      <p className="text-sm text-gray-500">{field.description}</p>
                    </div>
                    {columnMapping[field.key] ? 
                      <Check className="h-5 w-5 text-green-500 ml-4 flex-shrink-0" /> : 
                      <X className="h-5 w-5 text-gray-300 ml-4 flex-shrink-0" />
                    }
                  </div>
                  <select
                    value={columnMapping[field.key] || ''}
                    onChange={(e) => handleMappingChange(field.key, e.target.value)}
                    className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">-- Select Column --</option>
                    {preview.headers.map(header => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-gray-800 mb-3">Preview (first 3 rows):</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="text-left py-2 px-2">Date</th>
                      <th className="text-left py-2 px-2">Description</th>
                      <th className="text-right py-2 px-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.slice(0, 3).map((row, idx) => (
                      <tr key={idx} className="border-b border-gray-200">
                        <td className="py-2 px-2">
                          {columnMapping.date ? row[columnMapping.date] : '-'}
                        </td>
                        <td className="py-2 px-2 max-w-xs truncate">
                          {columnMapping.counterparty && row[columnMapping.counterparty] ? 
                            `${row[columnMapping.counterparty]} - ` : ''}
                          {columnMapping.description ? row[columnMapping.description] : '-'}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {columnMapping.amount ? row[columnMapping.amount] : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <button
              onClick={confirmMapping}
              className="w-full bg-indigo-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
            >
              Continue to Analysis
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        )}

        {!showMapping && summary && !loading && (
          <>
            {viewMode === 'upload' && transactions.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-green-800">Ready to save {transactions.length} transactions</p>
                  <p className="text-sm text-green-600">Save to database to persist your data</p>
                </div>
                <button
                  onClick={saveToDatabase}
                  disabled={saving}
                  className="bg-green-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Saving...' : 'Save to Database'}
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-green-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Total Income</p>
                    <p className="text-2xl font-bold text-green-600">€{summary.income.toFixed(2)}</p>
                  </div>
                  <TrendingUp className="h-10 w-10 text-green-500" />
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-red-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Total Expenses</p>
                    <p className="text-2xl font-bold text-red-600">€{summary.expenses.toFixed(2)}</p>
                  </div>
                  <TrendingDown className="h-10 w-10 text-red-500" />
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Net Balance</p>
                    <p className={`text-2xl font-bold ${summary.net >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                      €{summary.net.toFixed(2)}
                    </p>
                  </div>
                  <DollarSign className="h-10 w-10 text-blue-500" />
                </div>
              </div>
            </div>

            {/* Dynamic Widgets */}
            <div className="mb-6">
              <WidgetPanel
                transactions={transactions}
                widgets={widgets}
                onWidgetsChange={setWidgets}
              />
            </div>

            {/* Transaction Grid */}
            <TransactionGrid transactions={transactions} />
          </>
        )}
      </div>
    </div>
  );
}