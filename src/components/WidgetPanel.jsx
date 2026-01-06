import React, { useState, useMemo } from 'react';
import { Plus, X, GripVertical, ChevronDown, ChevronUp, BarChart3, Settings, CreditCard, AlertTriangle, CheckCircle } from 'lucide-react';

const GROUP_BY_OPTIONS = [
  { value: 'category', label: 'Category' },
  { value: 'counterparty', label: 'Counterparty' },
  { value: 'type', label: 'Transaction Type' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const METRIC_OPTIONS = [
  { value: 'totalAmount', label: 'Total Amount' },
  { value: 'expenses', label: 'Expenses Only' },
  { value: 'income', label: 'Income Only' },
  { value: 'count', label: 'Transaction Count' },
  { value: 'avgAmount', label: 'Average Amount' },
];

const SOURCE_FILTER_OPTIONS = [
  { value: 'all', label: 'All Sources' },
  { value: 'bank_statement', label: 'Bank Statement (CSV)' },
  { value: 'mastercard_pdf', label: 'Mastercard (PDF)' },
];

function Widget({ widget, transactions, onRemove, onUpdate }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const aggregatedData = useMemo(() => {
    const groups = {};

    // Filter by source if specified
    const sourceFilter = widget.sourceFilter || 'all';
    let filteredTransactions = sourceFilter === 'all'
      ? transactions
      : transactions.filter(txn => txn.source === sourceFilter);

    // Exclude credit card lump-sum payments to avoid double-counting
    // (they're replaced by detailed PDF transactions)
    filteredTransactions = filteredTransactions.filter(txn => !txn.isCreditCardPayment);

    filteredTransactions.forEach(txn => {
      let key;
      switch (widget.groupBy) {
        case 'month':
          key = txn.date ? txn.date.substring(0, 7) : 'Unknown';
          break;
        case 'year':
          key = txn.date ? txn.date.substring(0, 4) : 'Unknown';
          break;
        case 'counterparty':
          key = txn.counterparty || 'Unknown';
          break;
        case 'type':
          key = txn.type || 'Unknown';
          break;
        case 'category':
        default:
          key = txn.category || 'Uncategorized';
      }

      if (!groups[key]) {
        groups[key] = {
          totalAmount: 0,
          expenses: 0,
          income: 0,
          count: 0,
        };
      }

      groups[key].count += 1;
      groups[key].totalAmount += txn.amount;
      if (txn.amount < 0) {
        groups[key].expenses += Math.abs(txn.amount);
      } else {
        groups[key].income += txn.amount;
      }
    });

    // Calculate averages and convert to array
    return Object.entries(groups)
      .map(([name, data]) => ({
        name,
        ...data,
        avgAmount: data.totalAmount / data.count,
      }))
      .sort((a, b) => {
        // Sort by the selected metric
        const aVal = Math.abs(a[widget.metric]);
        const bVal = Math.abs(b[widget.metric]);
        return bVal - aVal;
      })
      .slice(0, widget.limit || 10);
  }, [transactions, widget.groupBy, widget.metric, widget.limit, widget.sourceFilter]);

  const maxValue = useMemo(() => {
    if (aggregatedData.length === 0) return 1;
    return Math.max(...aggregatedData.map(d => Math.abs(d[widget.metric])));
  }, [aggregatedData, widget.metric]);

  const formatValue = (value, metric) => {
    if (metric === 'count') return value.toLocaleString();
    return `€${value.toFixed(2)}`;
  };

  const getBarColor = (value, metric) => {
    if (metric === 'income') return 'bg-green-500';
    if (metric === 'expenses') return 'bg-red-500';
    if (metric === 'totalAmount') return value >= 0 ? 'bg-green-500' : 'bg-red-500';
    return 'bg-indigo-500';
  };

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      {/* Widget header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-gray-400 cursor-grab" />
          <BarChart3 className="h-5 w-5 text-indigo-600" />
          <span className="font-semibold text-gray-800">{widget.title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="p-1 hover:bg-gray-200 rounded"
            title="Configure widget"
          >
            <Settings className="h-4 w-4 text-gray-500" />
          </button>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 hover:bg-gray-200 rounded"
          >
            {isCollapsed ? (
              <ChevronDown className="h-4 w-4 text-gray-500" />
            ) : (
              <ChevronUp className="h-4 w-4 text-gray-500" />
            )}
          </button>
          <button
            onClick={onRemove}
            className="p-1 hover:bg-red-100 rounded"
            title="Remove widget"
          >
            <X className="h-4 w-4 text-gray-500 hover:text-red-600" />
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {isEditing && (
        <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={widget.title}
                onChange={(e) => onUpdate({ ...widget, title: e.target.value })}
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Group by</label>
              <select
                value={widget.groupBy}
                onChange={(e) => onUpdate({ ...widget, groupBy: e.target.value })}
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500"
              >
                {GROUP_BY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Metric</label>
              <select
                value={widget.metric}
                onChange={(e) => onUpdate({ ...widget, metric: e.target.value })}
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500"
              >
                {METRIC_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Show top</label>
              <select
                value={widget.limit}
                onChange={(e) => onUpdate({ ...widget, limit: Number(e.target.value) })}
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={20}>20</option>
                <option value={50}>All</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Source Filter</label>
              <select
                value={widget.sourceFilter || 'all'}
                onChange={(e) => onUpdate({ ...widget, sourceFilter: e.target.value })}
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500"
              >
                {SOURCE_FILTER_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Widget content */}
      {!isCollapsed && (
        <div className="p-4">
          {aggregatedData.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No data to display</p>
          ) : (
            <div className="space-y-3">
              {aggregatedData.map((item) => {
                const value = item[widget.metric];
                const percentage = (Math.abs(value) / maxValue) * 100;
                return (
                  <div key={item.name}>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700 truncate max-w-[60%]" title={item.name}>
                        {item.name}
                      </span>
                      <span className="text-sm text-gray-600">
                        {formatValue(Math.abs(value), widget.metric)}
                        {widget.metric !== 'count' && (
                          <span className="text-xs text-gray-400 ml-1">
                            ({item.count})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${getBarColor(value, widget.metric)}`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Special widget to compare Mastercard CSV payments vs PDF details
function MastercardReconciliation({ transactions, onRemove }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const reconciliation = useMemo(() => {
    // Sum of Mastercard lump-sum payments from CSV (marked as isCreditCardPayment)
    const csvPayments = transactions.filter(t => t.isCreditCardPayment);
    const csvTotal = Math.abs(csvPayments.reduce((sum, t) => sum + t.amount, 0));

    // Sum of detailed transactions from PDF
    const pdfTransactions = transactions.filter(t => t.source === 'mastercard_pdf');
    const pdfTotal = Math.abs(pdfTransactions.reduce((sum, t) => sum + t.amount, 0));

    // Difference (positive means PDF has more, negative means CSV has more)
    const difference = pdfTotal - csvTotal;

    return {
      csvTotal,
      csvCount: csvPayments.length,
      pdfTotal,
      pdfCount: pdfTransactions.length,
      difference,
      isBalanced: Math.abs(difference) < 0.01
    };
  }, [transactions]);

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden border-2 border-orange-200">
      <div className="flex items-center justify-between px-4 py-3 bg-orange-50 border-b border-orange-200">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-orange-600" />
          <span className="font-semibold text-gray-800">Mastercard Reconciliation</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 hover:bg-orange-100 rounded"
          >
            {isCollapsed ? (
              <ChevronDown className="h-4 w-4 text-gray-500" />
            ) : (
              <ChevronUp className="h-4 w-4 text-gray-500" />
            )}
          </button>
          <button
            onClick={onRemove}
            className="p-1 hover:bg-red-100 rounded"
            title="Remove widget"
          >
            <X className="h-4 w-4 text-gray-500 hover:text-red-600" />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-4 space-y-4">
          {/* CSV Payments */}
          <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-blue-800">Bank CSV Payments</p>
              <p className="text-xs text-blue-600">{reconciliation.csvCount} payment(s)</p>
            </div>
            <p className="text-lg font-bold text-blue-700">€{reconciliation.csvTotal.toFixed(2)}</p>
          </div>

          {/* PDF Details */}
          <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-orange-800">PDF Transactions</p>
              <p className="text-xs text-orange-600">{reconciliation.pdfCount} transaction(s)</p>
            </div>
            <p className="text-lg font-bold text-orange-700">€{reconciliation.pdfTotal.toFixed(2)}</p>
          </div>

          {/* Difference */}
          <div className={`flex justify-between items-center p-3 rounded-lg ${
            reconciliation.isBalanced
              ? 'bg-green-50'
              : 'bg-yellow-50'
          }`}>
            <div className="flex items-center gap-2">
              {reconciliation.isBalanced ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
              )}
              <div>
                <p className={`text-sm font-medium ${
                  reconciliation.isBalanced ? 'text-green-800' : 'text-yellow-800'
                }`}>
                  {reconciliation.isBalanced ? 'Balanced' : 'Difference'}
                </p>
                <p className={`text-xs ${
                  reconciliation.isBalanced ? 'text-green-600' : 'text-yellow-600'
                }`}>
                  {reconciliation.isBalanced
                    ? 'All payments accounted for'
                    : reconciliation.difference > 0
                      ? 'PDF has more than CSV'
                      : 'CSV has more than PDF (missing PDF transactions?)'}
                </p>
              </div>
            </div>
            <p className={`text-lg font-bold ${
              reconciliation.isBalanced
                ? 'text-green-700'
                : reconciliation.difference > 0
                  ? 'text-yellow-700'
                  : 'text-red-700'
            }`}>
              {reconciliation.difference >= 0 ? '+' : ''}€{reconciliation.difference.toFixed(2)}
            </p>
          </div>

          {!reconciliation.isBalanced && Math.abs(reconciliation.difference) > 0.01 && (
            <p className="text-xs text-gray-500 text-center">
              This could indicate missing PDF uploads or transactions that span different statement periods.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function WidgetPanel({ transactions, widgets, onWidgetsChange }) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showReconciliation, setShowReconciliation] = useState(() => {
    const saved = localStorage.getItem('showMastercardReconciliation');
    return saved ? JSON.parse(saved) : false;
  });

  const toggleReconciliation = () => {
    const newValue = !showReconciliation;
    setShowReconciliation(newValue);
    localStorage.setItem('showMastercardReconciliation', JSON.stringify(newValue));
  };

  const addWidget = (preset) => {
    const newWidget = {
      id: Date.now(),
      ...preset,
    };
    onWidgetsChange([...widgets, newWidget]);
    setShowAddMenu(false);
  };

  const removeWidget = (id) => {
    onWidgetsChange(widgets.filter(w => w.id !== id));
  };

  const updateWidget = (id, updatedWidget) => {
    onWidgetsChange(widgets.map(w => w.id === id ? updatedWidget : w));
  };

  const presets = [
    { title: 'Spending by Category', groupBy: 'category', metric: 'expenses', limit: 10 },
    { title: 'Top Counterparties', groupBy: 'counterparty', metric: 'expenses', limit: 10 },
    { title: 'Monthly Spending', groupBy: 'month', metric: 'expenses', limit: 12 },
    { title: 'Income by Category', groupBy: 'category', metric: 'income', limit: 10 },
    { title: 'Transactions by Type', groupBy: 'type', metric: 'count', limit: 10 },
    { title: 'Yearly Overview', groupBy: 'year', metric: 'totalAmount', limit: 5 },
    { title: 'Mastercard Spending', groupBy: 'counterparty', metric: 'expenses', limit: 10, sourceFilter: 'mastercard_pdf' },
    { title: 'Bank Statement Only', groupBy: 'category', metric: 'expenses', limit: 10, sourceFilter: 'bank_statement' },
  ];

  return (
    <div className="space-y-6">
      {/* Reconciliation toggle */}
      <div className="flex justify-end">
        <button
          onClick={toggleReconciliation}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
            showReconciliation
              ? 'bg-orange-100 text-orange-700 border border-orange-300'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <CreditCard className="h-4 w-4" />
          <span className="text-sm font-medium">
            {showReconciliation ? 'Hide' : 'Show'} Mastercard Reconciliation
          </span>
        </button>
      </div>

      {/* Mastercard Reconciliation Widget */}
      {showReconciliation && (
        <MastercardReconciliation
          transactions={transactions}
          onRemove={toggleReconciliation}
        />
      )}

      {/* Widget grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {widgets.map((widget) => (
          <Widget
            key={widget.id}
            widget={widget}
            transactions={transactions}
            onRemove={() => removeWidget(widget.id)}
            onUpdate={(updated) => updateWidget(widget.id, updated)}
          />
        ))}

        {/* Add widget card */}
        <div className="bg-white rounded-xl shadow-lg border-2 border-dashed border-gray-300 min-h-[200px] flex items-center justify-center">
          {showAddMenu ? (
            <div className="p-4 w-full">
              <div className="flex justify-between items-center mb-4">
                <span className="font-semibold text-gray-800">Add Widget</span>
                <button onClick={() => setShowAddMenu(false)} className="p-1 hover:bg-gray-100 rounded">
                  <X className="h-4 w-4 text-gray-500" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {presets.map((preset, idx) => (
                  <button
                    key={idx}
                    onClick={() => addWidget(preset)}
                    className="text-left px-3 py-2 text-sm bg-gray-50 hover:bg-indigo-50 hover:text-indigo-700 rounded-lg transition-colors"
                  >
                    {preset.title}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddMenu(true)}
              className="flex flex-col items-center gap-2 text-gray-500 hover:text-indigo-600 transition-colors"
            >
              <Plus className="h-8 w-8" />
              <span className="font-medium">Add Widget</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
