import React, { useState } from 'react';
import { PayrollBreakdownDisplay } from '../components/PayrollBreakdownDisplay';
import {
  exampleBasicPromotion,
  examplePromotionWithOvertime,
  exampleMultipleSalaryChanges,
  exampleDemotion,
  exampleWeeklyPayrollChange,
  exampleSalaryAdjustment,
  exampleHighEarnerOvertime,
  formatBreakdownForDisplay,
} from '../lib/payrollExamples';
import { SplitPayrollBreakdown } from '../lib/payrollCalculations';

/**
 * Demo page showcasing pro-rata payroll calculations
 */
export default function PayrollDemoPage() {
  const [selectedExample, setSelectedExample] = useState<string>('example1');
  const [breakdown, setBreakdown] = useState<SplitPayrollBreakdown>(
    exampleBasicPromotion()
  );
  const [showDetails, setShowDetails] = useState(false);

  const examples = [
    {
      id: 'example1',
      title: 'Basic Promotion Mid-Period',
      description:
        'Employee promoted from $4/hr to $6/hr mid-period with 40 hours total',
      fn: exampleBasicPromotion,
    },
    {
      id: 'example2',
      title: 'Promotion with Overtime',
      description:
        'Promotion with 50 hours worked, showing overtime calculations',
      fn: examplePromotionWithOvertime,
    },
    {
      id: 'example3',
      title: 'Multiple Salary Changes',
      description: 'Three different rates within single pay period',
      fn: exampleMultipleSalaryChanges,
    },
    {
      id: 'example4',
      title: 'Demotion',
      description: 'Employee demoted from $25/hr to $18/hr with 45 hours',
      fn: exampleDemotion,
    },
    {
      id: 'example5',
      title: 'Weekly Payroll Change',
      description: 'Mid-week change in 2-week pay period (80 hours total)',
      fn: exampleWeeklyPayrollChange,
    },
    {
      id: 'example6',
      title: 'Salary Adjustment',
      description: 'COLA adjustment mid-month (160 hours)',
      fn: exampleSalaryAdjustment,
    },
    {
      id: 'example7',
      title: 'High Earner with Overtime',
      description:
        'Executive with significant overtime impact ($50 to $65/hr, 60 hours)',
      fn: exampleHighEarnerOvertime,
    },
  ];

  const handleSelectExample = (exampleId: string) => {
    setSelectedExample(exampleId);
    const example = examples.find((ex) => ex.id === exampleId);
    if (example) {
      setBreakdown(example.fn());
      setShowDetails(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Pro-Rata Payroll Calculator
          </h1>
          <p className="text-lg text-gray-600">
            Comprehensive salary change handling with overtime calculations
          </p>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sidebar - Examples */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-md p-6 sticky top-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Examples</h2>

              <div className="space-y-2">
                {examples.map((example) => (
                  <button
                    key={example.id}
                    onClick={() => handleSelectExample(example.id)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedExample === example.id
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                    }`}
                  >
                    <div className="font-medium text-sm">{example.title}</div>
                    <div
                      className={`text-xs mt-1 ${
                        selectedExample === example.id
                          ? 'text-blue-100'
                          : 'text-gray-600'
                      }`}
                    >
                      {example.description}
                    </div>
                  </button>
                ))}
              </div>

              {/* Info Box */}
              <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h3 className="font-semibold text-blue-900 mb-2">How It Works</h3>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• Tracks salary history with effective dates</li>
                  <li>• Splits pay periods at salary change points</li>
                  <li>• Calculates each portion separately</li>
                  <li>• Handles overtime per portion</li>
                  <li>• Combines for accurate total pay</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Main Content - Breakdown Display */}
          <div className="lg:col-span-2 space-y-6">
            {/* Current Example Info */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="mb-4">
                <h2 className="text-2xl font-bold text-gray-900">
                  {examples.find((ex) => ex.id === selectedExample)?.title}
                </h2>
                <p className="text-gray-600 mt-2">
                  {examples.find((ex) => ex.id === selectedExample)?.description}
                </p>
              </div>
            </div>

            {/* Payroll Breakdown */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <PayrollBreakdownDisplay breakdown={breakdown} />
            </div>

            {/* Toggle Details */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium rounded-lg transition-colors"
            >
              {showDetails ? 'Hide' : 'Show'} Detailed Breakdown
            </button>

            {/* Detailed Breakdown */}
            {showDetails && (
              <div className="bg-gray-900 rounded-lg shadow-md p-6 overflow-x-auto">
                <pre className="text-green-400 font-mono text-xs whitespace-pre-wrap break-words">
                  {formatBreakdownForDisplay(breakdown)}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Documentation Section */}
        <div className="mt-8 bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Implementation Guide
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Feature 1 */}
            <div className="border-l-4 border-blue-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">
                Salary History Tracking
              </h3>
              <p className="text-gray-600 text-sm mb-3">
                Each employee has a salary history with multiple entries, each
                having:
              </p>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Effective date for when change takes effect</li>
                <li>• Hourly rate for the period</li>
                <li>• Reason (promotion, demotion, adjustment)</li>
                <li>• Optional notes explaining the change</li>
              </ul>
            </div>

            {/* Feature 2 */}
            <div className="border-l-4 border-green-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">
                Period Splitting
              </h3>
              <p className="text-gray-600 text-sm mb-3">
                When a salary change occurs mid-period:
              </p>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Hours are distributed proportionally</li>
                <li>• Each portion gets its own rate</li>
                <li>• Overtime calculated per portion</li>
                <li>• Results are combined for total pay</li>
              </ul>
            </div>

            {/* Feature 3 */}
            <div className="border-l-4 border-purple-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">
                Overtime Handling
              </h3>
              <p className="text-gray-600 text-sm mb-3">
                Overtime (hours over 40/week) is calculated:
              </p>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• At 1.5x the applicable hourly rate</li>
                <li>• Separately for each portion</li>
                <li>• Combined with regular pay for total</li>
                <li>• Accurate even with mid-period changes</li>
              </ul>
            </div>

            {/* Feature 4 */}
            <div className="border-l-4 border-orange-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">
                Calculation Steps
              </h3>
              <p className="text-gray-600 text-sm mb-3">
                The system performs:
              </p>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>1. Identify salary changes in period</li>
                <li>2. Split period at change points</li>
                <li>3. Calculate pay for each portion</li>
                <li>4. Sum for final payroll amount</li>
              </ul>
            </div>
          </div>

          {/* Code Example */}
          <div className="mt-6 bg-gray-50 rounded-lg p-4 border border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-3">Quick Usage Example</h3>
            <pre className="bg-gray-900 text-green-400 p-4 rounded text-xs overflow-x-auto">
{`// Create salary history
const history = createSalaryHistory('EMP001', 4, new Date('2024-01-01'));

// Add promotion effective Jan 6
const withPromo = addSalaryChange(
  history,
  new Date('2024-01-06'),
  6,
  'promotion'
);

// Calculate payroll for Jan 1-10 with 40 total hours
const breakdown = calculateSplitPayroll(
  'EMP001',
  withPromo,
  new Date('2024-01-01'),
  new Date('2024-01-10'),
  40
);

// Result shows:
// Part 1: 20 hours @ $4 = $80
// Part 2: 20 hours @ $6 = $120
// Total: $200`}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-gray-600 text-sm">
          <p>
            Pro-Rata Payroll Calculator • Handles mid-period salary changes with
            precision
          </p>
        </div>
      </div>
    </div>
  );
}
