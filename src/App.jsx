import React, { useState, useEffect } from 'react';
import { Upload, DollarSign, TrendingUp, TrendingDown, Check, X, ArrowRight, Database, RefreshCw, Save } from 'lucide-react';
import Papa from 'papaparse';
import TransactionGrid from './components/TransactionGrid';
import WidgetPanel from './components/WidgetPanel';

const API_URL = 'http://localhost:3001/api';

const DEFAULT_WIDGETS = [
  { id: 1, title: 'Spending by Category', groupBy: 'category', metric: 'expenses', limit: 10 },
];

export default function App() {
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
        fetch(`${API_URL}/transactions`),
        fetch(`${API_URL}/transactions/summary`)
      ]);

      if (!txnRes.ok || !summaryRes.ok) throw new Error('Failed to fetch data');

      const txnData = await txnRes.json();
      const summaryData = await summaryRes.json();

      setTransactions(txnData.transactions.map((t, idx) => ({
        id: t._id || idx,
        date: t.date,
        description: t.description,
        amount: t.amount,
        type: t.type,
        category: t.category,
        counterparty: t.counterparty
      })));

      // Build category totals from aggregation
      const categoryRes = await fetch(`${API_URL}/transactions/aggregate?groupBy=category`);
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
      const res = await fetch(`${API_URL}/transactions/import`, {
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

  useEffect(() => {
    fetchTransactions();
  }, []);

  const requiredFields = [
    { key: 'date', label: 'Execution Date', description: 'Transaction date (Uitvoeringsdatum)' },
    { key: 'amount', label: 'Amount', description: 'Transaction amount (Bedrag)' },
    { key: 'description', label: 'Description', description: 'Transaction description (Mededeling)' },
    { key: 'counterparty', label: 'Counterparty Name', description: 'Name of counterparty (Naam van de tegenpartij)' },
    { key: 'type', label: 'Transaction Type', description: 'Type of transaction (Type verrichting)' },
    { key: 'status', label: 'Status', description: 'Transaction status (Status)' }
  ];

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
    const mapping = { date: '', amount: '', description: '', counterparty: '', type: '', status: '' };
    headers.forEach(header => {
      const h = header.toLowerCase();
      if (h.includes('uitvoeringsdatum') || h.includes('datum')) mapping.date = header;
      else if (h.includes('bedrag') || h.includes('amount')) mapping.amount = header;
      else if (h.includes('mededeling') || h.includes('description')) mapping.description = header;
      else if (h.includes('naam van de tegenpartij') || h.includes('tegenpartij')) mapping.counterparty = header;
      else if (h.includes('type verrichting') || h.includes('type')) mapping.type = header;
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
      const counterparty = String(row[columnMapping.counterparty] ?? '');
      const fullDescription = counterparty ? `${counterparty} - ${description}` : description;
      
      let amount = row[columnMapping.amount];
      if (typeof amount === 'string') {
        amount = parseFloat(amount.replace(',', '.').replace(/[^\d.-]/g, ''));
      }
      if (isNaN(amount)) amount = 0;

      return {
        id: idx,
        date: row[columnMapping.date] || '',
        description: fullDescription.trim(),
        amount,
        type: row[columnMapping.type] || '',
        status: row[columnMapping.status] || '',
        category: categorizeTransaction(fullDescription, amount),
        counterparty
      };
    }).filter(t => t.description && !isNaN(t.amount) && 
              (!t.status || !t.status.toLowerCase().includes('geweigerd')));

    processed.sort((a, b) => new Date(b.date) - new Date(a.date));
    setTransactions(processed);
    calculateSummary(processed);
    setShowMapping(false);
  };

  const calculateSummary = (txns) => {
    const income = txns.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const expenses = Math.abs(txns.filter(t => t.amount < 0).reduce((sum, t) => sum + t.amount, 0));
    const categoryTotals = {};
    txns.forEach(t => {
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

  const resetAnalyzer = () => {
    setTransactions([]);
    setSummary(null);
    setPreview(null);
    setColumnMapping(null);
    setRawData(null);
    setShowMapping(true);
  };

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
                    Import CSV
                  </button>
                </>
              )}
            </div>
          </div>
          <p className="text-gray-600 mb-6">
            {viewMode === 'saved'
              ? 'Viewing transactions from database'
              : 'Upload your Belgian bank statement CSV to track income and expenses'}
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

          {viewMode === 'upload' && !preview && (
            <div className="border-2 border-dashed border-indigo-300 rounded-xl p-8 text-center hover:border-indigo-500 transition-colors bg-indigo-50">
              <Upload className="mx-auto h-12 w-12 text-indigo-400 mb-4" />
              <label className="cursor-pointer">
                <span className="text-indigo-600 font-semibold hover:text-indigo-700">Click to upload</span>
                <span className="text-gray-600"> or drag and drop</span>
                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              </label>
              <p className="text-sm text-gray-500 mt-2">Belgian bank CSV format supported (KBC, BNP, ING, Belfius, etc.)</p>
            </div>
          )}
        </div>

        {preview && showMapping && (
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